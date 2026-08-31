import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// Vitest configuration (separate from vite.config.ts so the Tauri dev-server
// settings stay untouched). The setup file polyfills the browser layout APIs
// jsdom lacks (see src/test/setup.ts) — without it, ProseMirror's
// scrollToSelection throws under load and the suite flakes.
export default defineConfig({
  plugins: [react()],
  test: {
    setupFiles: ["./src/test/setup.ts"],
  },
});
