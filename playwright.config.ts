import { defineConfig, devices } from '@playwright/test';
import { existsSync } from 'node:fs';

const remote = process.env.BASE_URL;
const baseURL = remote || 'http://localhost:8788';
if (!remote && ['dist/index.html', 'dist/_headers', 'dist/sw.js'].some(path => !existsSync(path))) {
  throw new Error('Build dist and generated headers before running local e2e tests');
}

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 120_000,
  expect: { timeout: 30_000 },
  outputDir: 'test-results',
  reporter: process.env.CI ? [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]] : 'list',
  use: { baseURL, serviceWorkers: 'allow', trace: 'retain-on-failure' },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
  webServer: remote ? undefined : {
    command: './node_modules/.bin/wrangler pages dev dist --port 8788',
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
