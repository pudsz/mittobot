import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const API_TARGET = process.env.VITE_BOT_API_URL || "http://0.0.0.0:3432";

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "dist",
    sourcemap: false,
    minify: "esbuild",
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ["react", "react-dom", "react-router-dom"],
          ui: ["lucide-react", "recharts"],
        },
      },
    },
  },
  server: {
    host: "0.0.0.0",
    proxy: {
      // Proxy API requests to the bot's backend — avoids CORS issues in dev
      "/api": {
        target: API_TARGET,
        changeOrigin: true,
      },
      "/login": {
        target: API_TARGET,
        changeOrigin: true,
      },
    },
  },
});
