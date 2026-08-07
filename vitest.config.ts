import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    setupFiles: ["./src/renderer/testSetup.ts"],
    css: true,
    include: ["src/**/*.test.{ts,tsx}", "packages/*/test/**/*.test.ts"],
  },
});
