import React from "react";
import ReactDOM from "react-dom/client";
import { getCurrentWindow } from "@tauri-apps/api/window";
import App from "./App";
import SnipasteOverlay from "./screens/SnipasteOverlay";
import PinWindow from "./screens/PinWindow";
import "./index.css";

async function bootstrap() {
  const windowLabel = getCurrentWindow().label;

  let AppComponent = App;

  if (windowLabel.startsWith("snipaste-overlay")) {
    // 多屏会话每屏一个窗口：snipaste-overlay-{i}
    AppComponent = SnipasteOverlay;
  } else if (windowLabel.startsWith("pin-")) {
    // 贴图数据由 PinWindow 按 label 向 Rust 侧取回
    AppComponent = PinWindow;
  }

  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <AppComponent />
    </React.StrictMode>
  );
}

bootstrap();
