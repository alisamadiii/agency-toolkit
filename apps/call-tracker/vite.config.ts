import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@shared": path.resolve(__dirname, "./shared"),
    },
  },
  server: {
    proxy: {
      "/api": {
        target: "http://localhost:8787",
        // Recording uploads can be large and slow — never cut them off.
        timeout: 0,
        proxyTimeout: 0,
      },
    },
  },
});
