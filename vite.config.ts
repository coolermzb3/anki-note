import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const pagesRepoName = process.env.GITHUB_REPOSITORY?.split("/")[1];

export default defineConfig({
  base: process.env.GITHUB_PAGES && pagesRepoName ? `/${pagesRepoName}/` : "/",
  plugins: [react()],
  build: {
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      output: {
        manualChunks: {
          music: ["vexflow", "tone"],
          charts: ["echarts"],
          storage: ["dexie"],
        },
      },
    },
  },
});
