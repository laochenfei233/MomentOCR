//! Windows DXGI Desktop Duplication 抓屏。
//!
//! GDI BitBlt 抓 4K 一帧要 150–250ms：显存 → CPU 的读回 + 格式转换都由 GDI 做，
//! 期间 CPU 全程阻塞。DXGI Desktop Duplication 直接让 GPU 把桌面复制到一张
//! staging texture，CPU 只做一次 Map + memcpy，单帧通常 10–30ms。
//!
//! 限制：Desktop Duplication 是「帧变化」模型——桌面完全静止时 AcquireNextFrame
//! 可能超时。调用方需要处理超时（见 `capture_bgra` 的注释）。

use anyhow::{anyhow, Result};
use windows::core::Interface;
use windows::Win32::Foundation::HMODULE;
use windows::Win32::Graphics::Direct3D::*;
use windows::Win32::Graphics::Direct3D11::*;
use windows::Win32::Graphics::Dxgi::Common::*;
use windows::Win32::Graphics::Dxgi::*;

/// 一个可抓的输出（显示器）及其在虚拟桌面中的物理位置
#[derive(Clone, Copy, Debug)]
pub struct OutputInfo {
    pub adapter_index: u32,
    pub output_index: u32,
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

/// 枚举所有适配器上的所有输出。
/// 多显卡机器（独显 + 核显）上，不同显示器可能挂在不同 adapter 下，
/// 只枚举主 adapter 会漏掉副屏。
pub fn enumerate_outputs() -> Vec<OutputInfo> {
    let mut out = Vec::new();
    unsafe {
        let Ok(factory) = CreateDXGIFactory1::<IDXGIFactory1>() else {
            return out;
        };
        let mut a = 0u32;
        loop {
            let Ok(adapter) = factory.EnumAdapters1(a) else { break };
            let mut o = 0u32;
            loop {
                let Ok(output) = adapter.EnumOutputs(o) else { break };
                if let Ok(desc) = output.GetDesc() {
                    let coords = desc.DesktopCoordinates;
                    let width = (coords.right - coords.left) as u32;
                    let height = (coords.bottom - coords.top) as u32;
                    if width > 0 && height > 0 {
                        out.push(OutputInfo {
                            adapter_index: a,
                            output_index: o,
                            x: coords.left,
                            y: coords.top,
                            width,
                            height,
                        });
                    }
                }
                o += 1;
            }
            a += 1;
        }
    }
    out
}

/// 一个显示器输出上的桌面复制器
pub struct Duplicator {
    context: ID3D11DeviceContext,
    duplication: IDXGIOutputDuplication,
    staging: ID3D11Texture2D,
    width: u32,
    height: u32,
    /// 该屏在虚拟桌面里的物理原点（与屏幕几何匹配用）
    pub origin: (i32, i32),
    /// 上一帧是否已成功抓过（用于超时回退：staging 里还留着上一帧）
    has_frame: bool,
}

// ID3D11* 接口本身是线程安全的（内部引用计数），这里只保证能跨线程持有
unsafe impl Send for Duplicator {}

impl Duplicator {
    /// 在指定输出（显示器）上初始化复制器。初始化约 50–150ms，
    /// 应该在建窗/预热阶段做，不要放在按键路径上。
    pub fn new(adapter_index: u32, output_index: u32) -> Result<Self> {
        unsafe {
            let factory: IDXGIFactory1 = CreateDXGIFactory1()?;
            let adapter = factory.EnumAdapters1(adapter_index)?;

            let mut device: Option<ID3D11Device> = None;
            let mut context: Option<ID3D11DeviceContext> = None;
            let mut feature = D3D_FEATURE_LEVEL_11_0;
            // 指定了 adapter 时 driver type 必须是 UNKNOWN
            D3D11CreateDevice(
                &adapter,
                D3D_DRIVER_TYPE_UNKNOWN,
                HMODULE::default(),
                D3D11_CREATE_DEVICE_BGRA_SUPPORT,
                Some(&[D3D_FEATURE_LEVEL_11_0, D3D_FEATURE_LEVEL_10_1]),
                D3D11_SDK_VERSION,
                Some(&mut device),
                Some(&mut feature),
                Some(&mut context),
            )?;
            let device = device.ok_or_else(|| anyhow!("D3D11 设备创建失败"))?;
            let context = context.ok_or_else(|| anyhow!("D3D11 上下文创建失败"))?;

            let output = adapter.EnumOutputs(output_index)?;
            let output1: IDXGIOutput1 = output.cast()?;
            let duplication = output1.DuplicateOutput(&device)?;

            // 输出描述给出该屏在虚拟桌面里的物理位置，用于和屏幕几何对齐
            let desc = output.GetDesc()?;
            let width = (desc.DesktopCoordinates.right - desc.DesktopCoordinates.left) as u32;
            let height = (desc.DesktopCoordinates.bottom - desc.DesktopCoordinates.top) as u32;
            let origin_x = desc.DesktopCoordinates.left;
            let origin_y = desc.DesktopCoordinates.top;
            let staging = create_staging(&device, width, height)?;

            Ok(Self {
                context,
                duplication,
                staging,
                width,
                height,
                origin: (origin_x, origin_y),
                has_frame: false,
            })
        }
    }

    pub fn size(&self) -> (u32, u32) {
        (self.width, self.height)
    }

    /// 抓一帧 BGRA 像素（行紧密排列，宽×高×4 字节）。
    ///
    /// 桌面静止时 AcquireNextFrame 会超时；此时若之前抓过帧，staging texture 里
    /// 仍是上一帧内容，可直接返回（内容与「当前桌面」一致，因为期间没有变化）。
    /// 从未抓到过帧则返回 Err，调用方应回退到 GDI。
    pub fn capture_bgra(&mut self) -> Result<Vec<u8>> {
        unsafe {
            let mut info = DXGI_OUTDUPL_FRAME_INFO::default();
            let mut resource: Option<IDXGIResource> = None;
            let acquired = self
                .duplication
                .AcquireNextFrame(30, &mut info, &mut resource);
            let fresh = acquired.is_ok() && resource.is_some();

            // 桌面无变化且抓过帧：staging 里就是当前内容，直接复用
            if !fresh && self.has_frame {
                return self.read_staging();
            }
            let resource = resource.ok_or_else(|| anyhow!("抓屏超时（桌面无变化）"))?;
            let texture: ID3D11Texture2D = resource.cast()?;
            self.context.CopyResource(&self.staging, &texture);
            let _ = self.duplication.ReleaseFrame();
            self.has_frame = true;
            self.read_staging()
        }
    }

    unsafe fn read_staging(&self) -> Result<Vec<u8>> {
        let mut mapped = D3D11_MAPPED_SUBRESOURCE::default();
        self.context
            .Map(&self.staging, 0, D3D11_MAP_READ, 0, Some(&mut mapped))?;
        let row_bytes = (self.width * 4) as usize;
        let mut out = Vec::with_capacity(row_bytes * self.height as usize);
        for y in 0..self.height as usize {
            let src = std::slice::from_raw_parts(
                (mapped.pData as *const u8).add(y * mapped.RowPitch as usize),
                row_bytes,
            );
            out.extend_from_slice(src);
        }
        self.context.Unmap(&self.staging, 0);
        Ok(out)
    }
}

unsafe fn create_staging(device: &ID3D11Device, w: u32, h: u32) -> Result<ID3D11Texture2D> {
    let desc = D3D11_TEXTURE2D_DESC {
        Width: w,
        Height: h,
        MipLevels: 1,
        ArraySize: 1,
        Format: DXGI_FORMAT_B8G8R8A8_UNORM,
        SampleDesc: DXGI_SAMPLE_DESC {
            Count: 1,
            Quality: 0,
        },
        Usage: D3D11_USAGE_STAGING,
        BindFlags: 0,
        CPUAccessFlags: D3D11_CPU_ACCESS_READ.0 as u32,
        MiscFlags: 0,
    };
    let mut texture: Option<ID3D11Texture2D> = None;
    device.CreateTexture2D(&desc, None, Some(&mut texture))?;
    texture.ok_or_else(|| anyhow!("staging 纹理创建失败"))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 真机测速：cargo test --release measure_dxgi -- --ignored --nocapture
    #[test]
    #[ignore]
    fn measure_dxgi_init_and_capture() {
        let outputs = enumerate_outputs();
        println!("enumerate_outputs: {outputs:?}");

        for info in &outputs {
            let t = std::time::Instant::now();
            match Duplicator::new(info.adapter_index, info.output_index) {
                Ok(mut d) => {
                    println!(
                        "init a={} o={}: origin={:?} size={:?} in {:?}",
                        info.adapter_index, info.output_index, d.origin, d.size(), t.elapsed()
                    );
                    let t = std::time::Instant::now();
                    match d.capture_bgra() {
                        Ok(data) => println!("  capture: {:?} {} bytes", t.elapsed(), data.len()),
                        Err(e) => println!("  capture failed: {e}"),
                    }
                }
                Err(e) => println!("init a={} o={} failed: {e}", info.adapter_index, info.output_index),
            }
        }

        let t = std::time::Instant::now();
        let mut dup = Duplicator::new(0, 0).expect("DXGI 初始化失败");
        println!("init: {:?}  size={:?}", t.elapsed(), dup.size());

        for i in 0..5 {
            let t = std::time::Instant::now();
            match dup.capture_bgra() {
                Ok(data) => println!(
                    "capture #{i}: {:?}  {} bytes ({}x{})",
                    t.elapsed(),
                    data.len(),
                    dup.width,
                    dup.height
                ),
                Err(e) => println!("capture #{i} failed: {e}"),
            }
        }
    }
}
