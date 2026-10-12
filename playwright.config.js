import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'e2e',
  timeout: 30_000,
  workers: 1,
  reporter: [['list']],
  use: { ...devices['Desktop Chrome'], baseURL: 'http://127.0.0.1:4173/', trace: 'retain-on-failure' },
  webServer: { command: 'node e2e/servidor.mjs --relay', url: 'http://127.0.0.1:4173/', reuseExistingServer: !process.env.CI },
});
