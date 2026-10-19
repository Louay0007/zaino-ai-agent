import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

/**
 * The visual verification page (not shipped, not published): compiles the host's
 * full index.css to get the real tokens (including the .dark flip) and renders every
 * plugin-ui component in light and dark side by side.
 * Run from the repo root: pnpm exec vite build --config packages/plugin-ui/preview/vite.config.ts
 */
export default defineConfig({
  root: __dirname,
  base: "./",
  plugins: [react(), tailwindcss()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
