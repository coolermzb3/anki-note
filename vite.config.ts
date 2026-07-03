import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  build: {
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      output: {
        manualChunks: {
          music: ["vexflow", "tone"],
          charts: ["recharts"],
          storage: ["dexie"],
        },
      },
    },
  },
});
