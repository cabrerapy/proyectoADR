import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    exclude: [...configDefaults.exclude, "**/cdk.out/**"],
    hookTimeout: 120_000,
    testTimeout: 120_000,
  },
});
