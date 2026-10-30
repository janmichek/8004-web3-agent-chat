import fsd from "@feature-sliced/steiger-plugin";
import { defineConfig } from "steiger";

export default defineConfig([
  ...fsd.configs.recommended,
  {
    // Generated / tooling files live outside the FSD layers.
    ignores: ["**/*.test.ts", "**/vite-env.d.ts"],
  },
]);
