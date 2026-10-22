import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/e2e',
  globalSetup: './tests/setup.ts',
  workers: 1,
  timeout: 45_000,
  use: {
    viewport: { width: 1512, height: 982 },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
    ...(process.env.LUNA_TEST_FIREFOX
      ? [
          {
            name: 'firefox',
            use: {
              browserName: 'firefox' as const,
              launchOptions: { executablePath: process.env.LUNA_FIREFOX_EXECUTABLE },
            },
          },
        ]
      : []),
  ],
});
