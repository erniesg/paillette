import { defineConfig, devices } from '@playwright/test';
import { resolve } from 'node:path';

const STAGING_ORIGIN = 'https://paillette-stg.berlayar.ai';
const baseURL = process.env.NGA_STAGING_WEB_BASE_URL || STAGING_ORIGIN;

if (baseURL !== STAGING_ORIGIN) {
  throw new Error(
    `NGA staging browser gate requires exactly ${STAGING_ORIGIN}; received ${baseURL}`
  );
}

const evidenceDirectory = resolve(
  process.env.NGA_STAGING_EVIDENCE_DIR || 'test-results/nga-staging-gate'
);

export default defineConfig({
  testDir: './e2e',
  testMatch: 'nga-staging-gate.spec.ts',
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  workers: 1,
  reporter: [
    ['list'],
    [
      'json',
      { outputFile: resolve(evidenceDirectory, 'playwright-report.json') },
    ],
  ],
  outputDir: resolve(evidenceDirectory, 'playwright-artifacts'),
  use: {
    ...devices['Desktop Chrome'],
    baseURL,
    channel: 'chrome',
    trace: 'on',
    screenshot: 'on',
    video: 'off',
  },
});
