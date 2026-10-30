import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

// Unit tests for the pure logic (matching, prices, parsing, file names). Browser APIs are
// stubbed; anything that needs a real browser is covered by the Edge tests in e2e/.
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./', import.meta.url)),
      'wxt/browser': fileURLToPath(new URL('./tests/stubs/browser.ts', import.meta.url)),
    },
  },
  test: { include: ['tests/**/*.test.ts'], environment: 'node' },
});
