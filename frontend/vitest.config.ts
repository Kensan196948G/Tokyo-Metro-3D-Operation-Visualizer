import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Playwright specs live in e2e/ and must not run under vitest
    exclude: ['e2e/**', 'node_modules/**', 'dist/**'],
  },
});
