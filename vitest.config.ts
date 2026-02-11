import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    testTimeout: 30000,
    hookTimeout: 30000,
    setupFiles: ["./src/tests/setup.ts"],
    include: ["src/tests/**/*.test.ts"],
    fileParallelism: false,
    sequence: {
      concurrent: false,
    },
  },
});
