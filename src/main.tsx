import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import ScreenshotOverlay from "./screens/ScreenshotOverlay";
import "./index.css";

// 根据窗口标签决定渲染哪个组件
function getAppComponent() {
  // 检查 URL 参数来判断窗口类型
  const params = new URLSearchParams(window.location.search);
  const windowType = params.get('window');
  
  if (windowType === 'screenshot-overlay') {
    return ScreenshotOverlay;
  }
  return App;
}

const AppComponent = getAppComponent();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <AppComponent />
  </React.StrictMode>
);
