import { defineConfig } from "vitest/config";

export default defineConfig({
  // Tests, templates, and examples import "oncue" as a user would; the oncue-source export
  // condition points that at src/ instead of the built dist/. The rest are Vite's defaults.
  ssr: { resolve: { conditions: ["oncue-source", "module", "node", "development|production"] } },
  test: {
    include: ["tests/**/*.test.ts", "composition/render/*.test.mjs"],
    reporters: ["dot"],
  },
});
