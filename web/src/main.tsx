import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.js";
import "./styles.css";
import "./forge.css";
import "./redesign.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);

if ("serviceWorker" in navigator && window.location.protocol !== "file:") {
  window.addEventListener("load", () => void navigator.serviceWorker.register("/sw.js"));
}
