import React from "react";
import ReactDOM from "react-dom/client";
import { getCurrentWindow } from "@tauri-apps/api/window";
import App from "./App";
import ScreenshotOverlay from "./screens/ScreenshotOverlay";
import SnipasteOverlay from "./screens/SnipasteOverlay";
import PinWindow from "./screens/PinWindow";
import "./index.css";

async function bootstrap() {
  const windowLabel = getCurrentWindow().label;

  let AppComponent = App;

  if (windowLabel === "screenshot-overlay") {
    AppComponent = ScreenshotOverlay;
  } else if (windowLabel === "snipaste-overlay") {
    AppComponent = SnipasteOverlay;
  } else if (windowLabel.startsWith("pin-")) {
    // 贴图窗口需要从 URL 参数获取图片数据
    const params = new URLSearchParams(window.location.search);
    const imageData = params.get('image') || '';
    const x = parseInt(params.get('x') || '100');
    const y = parseInt(params.get('y') || '100');
    const width = parseInt(params.get('width') || '300');
    const height = parseInt(params.get('height') || '300');

    const PinAppComponent = () => (
      <PinWindow
        imageData={imageData}
        initialX={x}
        initialY={y}
        initialWidth={width}
        initialHeight={height}
      />
    );
    AppComponent = PinAppComponent;
  }

  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <AppComponent />
    </React.StrictMode>
  );
}

bootstrap();
