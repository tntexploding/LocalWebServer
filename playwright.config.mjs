import {defineConfig} from '@playwright/test';

export default defineConfig({
  testDir: './tests/browser',
  outputDir: './tests/.artifacts/playwright',
  fullyParallel: false,
  workers: 1,
  timeout: 30000,
  use: {
    channel: 'chrome',
    headless: true,
    viewport: {width: 1440, height: 900},
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
});
