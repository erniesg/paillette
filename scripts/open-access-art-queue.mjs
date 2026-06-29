#!/usr/bin/env node
import { resolve } from 'node:path';

import {
  buildQueuePlan,
  numberOption,
  parseArgs,
  readJson,
  writeJson,
} from './lib/open-access-art.mjs';

const args = parseArgs(process.argv.slice(2));

if (args.flags.has('help')) {
  printHelp();
  process.exit(0);
}

try {
  const manifestPath = args.values.get('manifest');
  if (!manifestPath) throw new Error('--manifest is required');
  const outDir = args.values.get('out-dir') || 'tmp/open-access-queue';
  const plan = buildQueuePlan(readJson(manifestPath), {
    limit: numberOption(args.values, 'limit', 0),
    batchSize: numberOption(args.values, 'batch-size', 10),
    maxAttempts: numberOption(args.values, 'max-attempts', 3),
    assetMode: args.values.get('asset-mode') || 'r2',
  });
  const out = resolve(outDir, 'queue-plan.json');
  writeJson(out, plan);
  console.log(
    JSON.stringify(
      {
        out,
        summary: plan.summary,
        queue: plan.queue,
        enqueue: plan.enqueue,
      },
      null,
      2
    )
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(error.exitCode || 1);
}

function printHelp() {
  console.log(`Usage: pnpm open:queue -- --manifest tmp/nga-launch-dry-run.json --out-dir tmp/nga-launch-queue --limit=10 --asset-mode=r2

Writes a dry-run queue plan only. It never enqueues messages.`);
}
