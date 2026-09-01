import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { readFile } from "node:fs/promises";
import path from "node:path";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

// In the Tauri webview the wordlist comes from the bundled resource via the
// load_wordlist command, but plain browser dev (npm run dev) has no Tauri
// bridge, so loadWordlist falls back to fetch("wordlist.txt"). Serve that URL
// straight from the resource file so the browser path mirrors the app path.
function wordlistDevMiddleware(): Plugin {
  return {
    name: "quillmd-wordlist-dev",
    configureServer(server) {
      server.middlewares.use("/wordlist.txt", async (_req, res, next) => {
        try {
          const file = path.resolve(__dirname, "src-tauri/resources/wordlist.txt");
          const body = await readFile(file, "utf-8");
          res.setHeader("Content-Type", "text/plain; charset=utf-8");
          res.end(body);
        } catch (err) {
          next(err);
        }
      });
    },
  };
}

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [react(), wordlistDevMiddleware()],

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
