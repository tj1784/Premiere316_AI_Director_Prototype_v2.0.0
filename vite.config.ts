import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: path.resolve(__dirname, "client"),
  plugins: [react()],
  resolve: {
    alias: {
      "@shared": path.resolve(__dirname, "shared")
    }
  },
  build: {
    outDir: path.resolve(__dirname, "client/dist"),
    emptyOutDir: true
  },
  server: {
    port: 5198,
    fs: {
      allow: [path.resolve(__dirname)]
    },
    proxy: {
      "/api": "http://127.0.0.1:8789",
      "/media": "http://127.0.0.1:8789",
      "/integrations/comfyui": {
        target: "http://127.0.0.1:8789",
        ws: true
      }
    }
  }
});
