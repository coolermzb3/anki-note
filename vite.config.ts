import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const pagesRepoName = process.env.GITHUB_REPOSITORY?.split("/")[1];
const tailscaleAllowedHosts = process.env.TAILSCALE_HOSTNAME ? [process.env.TAILSCALE_HOSTNAME] : [];

export default defineConfig({
  base: process.env.GITHUB_PAGES && pagesRepoName ? `/${pagesRepoName}/` : "/",
  plugins: [react()],
  server: {
    allowedHosts: tailscaleAllowedHosts,
  },
  preview: {
    allowedHosts: tailscaleAllowedHosts,
  },
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
