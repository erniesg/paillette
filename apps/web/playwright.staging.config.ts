import { defineConfig, devices } from '@playwright/test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
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
const runBindingPath = process.env.NGA_STAGING_RUN_BINDING;
const sourceDiscovery = process.argv.includes('--list');

type NgaStagingRunBinding = {
  schemaVersion: 'nga-playwright-handoff-v1';
  runId: string;
  phase: 'pilot' | 'full';
  snapshot: 'baseline' | 'candidate';
  evaluatorGitSha: string;
  deploymentIdentityHash: string;
  pythonCompletedAt: string;
  playwrightNotBefore: string;
  cooldownSeconds: number;
  browserPublicSearchRequestBudget: number;
  expectedTestCount: number;
};

let metadata: Record<string, unknown> = {};
if (runBindingPath) {
  const bindingBytes = readFileSync(resolve(runBindingPath));
  const binding = JSON.parse(
    bindingBytes.toString('utf8')
  ) as NgaStagingRunBinding;
  const completedAt = Date.parse(binding.pythonCompletedAt);
  const notBefore = Date.parse(binding.playwrightNotBefore);
  const valid =
    binding.schemaVersion === 'nga-playwright-handoff-v1' &&
    /^[a-f0-9]{32}$/.test(binding.runId) &&
    ['pilot', 'full'].includes(binding.phase) &&
    ['baseline', 'candidate'].includes(binding.snapshot) &&
    /^[a-f0-9]{40}$/.test(binding.evaluatorGitSha) &&
    /^[a-f0-9]{64}$/.test(binding.deploymentIdentityHash) &&
    Number.isFinite(completedAt) &&
    Number.isFinite(notBefore) &&
    binding.cooldownSeconds === 60 &&
    binding.browserPublicSearchRequestBudget === 6 &&
    notBefore - completedAt >= binding.cooldownSeconds * 1000 &&
    binding.expectedTestCount === 7;
  if (!valid) {
    throw new Error('NGA staging Playwright run binding is invalid.');
  }
  if (Date.now() < notBefore) {
    throw new Error(
      `NGA anonymous-search cooldown is active until ${binding.playwrightNotBefore}.`
    );
  }
  metadata = {
    ngaStagingRun: binding,
    bindingSha256: createHash('sha256').update(bindingBytes).digest('hex'),
  };
} else if (!sourceDiscovery) {
  throw new Error(
    'NGA staging execution requires NGA_STAGING_RUN_BINDING from the Python gate.'
  );
}

export default defineConfig({
  testDir: './e2e',
  testMatch: 'nga-staging-gate.spec.ts',
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  workers: 1,
  metadata,
  projects: [{ name: 'nga-staging-chrome' }],
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
    // The spec writes exactly seven named screenshots into the evidence root.
    // Automatic screenshots would create extra, unbound manifest artifacts.
    screenshot: 'off',
    video: 'off',
  },
});
