import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { loadCachedAppearance, resolveAppearance } from "./lib/theme";

// Apply the light/dark chrome palette before the first paint; the cached mode
// avoids flashing the other appearance while settings.json loads.
document.documentElement.dataset.appearance = resolveAppearance(loadCachedAppearance());

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
