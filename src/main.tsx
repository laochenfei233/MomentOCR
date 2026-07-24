import React from "react";
import ReactDOM from "react-dom/client";
import { getCurrentWindow } from "@tauri-apps/api/window";
import App from "./App";
import ScreenshotOverlay from "./screens/ScreenshotOverlay";
import "./index.css";

// 根据窗口标签决定渲染哪个组件
async function bootstrap() {
  const windowLabel = getCurrentWindow().label;
  
  let AppComponent = App;
  if (windowLabel === "screenshot-overlay") {
    AppComponent = ScreenshotOverlay;
  }

  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <AppComponent />
    </React.StrictMode>
  );
}

bootstrap();
