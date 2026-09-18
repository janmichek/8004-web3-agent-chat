import { defineConfig } from "vite-plus";

export default defineConfig({
  test: {
    exclude: ["node_modules/**", "dist/**", "frontend/e2e/**", "frontend/dist/**"],
  },
});
