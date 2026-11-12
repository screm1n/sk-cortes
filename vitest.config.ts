import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    root: ".",
    include: ["src/server/**/*.test.ts", "tests/**/*.test.ts"],
    environment: "node",
  },
});
