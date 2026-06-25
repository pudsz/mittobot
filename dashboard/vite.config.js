import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const API_TARGET = process.env.VITE_BOT_API_URL || "http://localhost:3001";

export default defineConfig({
  plugins: [react()],
  server: {
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
