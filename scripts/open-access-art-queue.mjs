#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  DEFAULT_STAGING_ASSET_API_BASE,
  buildOpenAccessApplyPlan,
} from './lib/open-access-art-apply.mjs';
import {
  DEFAULT_OPEN_ACCESS_QUEUE_BATCH_SIZE,
  buildCloudflareQueueBatchPayload,
  buildOpenAccessAssetQueueMessages,
  chunkOpenAccessQueueMessages,
  writeOpenAccessQueueFiles,
} from './lib/open-access-art-queue.mjs';

const args = parseArgs(process.argv.slice(2));
if (args.flags.has('help')) {
  printHelp();
  process.exit(0);
}

const options = {
  manifest: args.values.get('manifest')
    ? resolve(args.values.get('manifest'))
    : null,
  plan: args.values.get('plan') ? resolve(args.values.get('plan')) : null,
  outDir: resolve(args.values.get('out-dir') || 'tmp/open-access-art-queue'),
  bucket: args.values.get('bucket') || 'paillette-assets-stg',
  apiBase: args.values.get('api-base') || DEFAULT_STAGING_ASSET_API_BASE,
  assetMode: args.values.get('asset-mode') || 'r2',
  externalProviders: providerList(args.values.get('external-providers')),
  limit: Number(args.values.get('limit') || '0'),
  batchSize: Number(
    args.values.get('batch-size') || DEFAULT_OPEN_ACCESS_QUEUE_BATCH_SIZE
  ),
  enqueue: args.flags.has('enqueue'),
  accountId: args.values.get('account-id') || process.env.CLOUDFLARE_ACCOUNT_ID,
  queueId: args.values.get('queue-id') || process.env.CLOUDFLARE_QUEUE_ID,
  apiToken: args.values.get('api-token') || process.env.CLOUDFLARE_API_TOKEN,
};

if (!options.plan && !options.manifest) {
  throw new Error('--plan or --manifest is required');
}
if (options.assetMode !== 'r2' && options.assetMode !== 'external') {
  throw new Error('--asset-mode must be r2 or external');
}

mkdirSync(options.outDir, { recursive: true });

const plan = options.plan
  ? readJson(options.plan)
  : buildOpenAccessApplyPlan({
      manifest: readJson(options.manifest),
      bucket: options.bucket,
      apiBase: options.apiBase,
      assetMode: options.assetMode,
      externalProviders: options.externalProviders,
      limit: options.limit,
    });
const messages = buildOpenAccessAssetQueueMessages(plan.records || []);
const outputs = writeOpenAccessQueueFiles(messages, {
  outDir: options.outDir,
  batchSize: options.batchSize,
  generatedAt: new Date().toISOString(),
});

let enqueueResult = null;
if (options.enqueue) {
  if (!options.accountId)
    throw new Error('--account-id or CLOUDFLARE_ACCOUNT_ID is required');
  if (!options.queueId)
    throw new Error('--queue-id or CLOUDFLARE_QUEUE_ID is required');
  if (!options.apiToken)
    throw new Error('--api-token or CLOUDFLARE_API_TOKEN is required');
  enqueueResult = await enqueueMessages(messages, options);
}

console.log(
  JSON.stringify(
    {
      summary: {
        recordCount: (plan.records || []).length,
        messageCount: messages.length,
        batchCount: outputs.batchFiles.length,
        providers: summarizeProviders(messages),
      },
      outputs,
      enqueue: enqueueResult,
    },
    null,
    2
  )
);

function parseArgs(argv) {
  const values = new Map();
  const flags = new Set();
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith('--')) continue;
    const raw = arg.slice(2);
    if (raw.includes('=')) {
      const [key, ...rest] = raw.split('=');
      values.set(key, rest.join('='));
      continue;
    }
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) {
      flags.add(raw);
    } else {
      values.set(raw, next);
      index += 1;
    }
  }
  return { values, flags };
}

function providerList(value) {
  return String(value || '')
    .split(',')
    .map((provider) => provider.trim().toLowerCase())
    .filter(Boolean);
}

function readJson(path) {
  if (!path || !existsSync(path)) throw new Error(`missing JSON file: ${path}`);
  return JSON.parse(readFileSync(path, 'utf8'));
}

function summarizeProviders(messages) {
  const providers = {};
  for (const message of messages) {
    providers[message.provider] = (providers[message.provider] || 0) + 1;
  }
  return providers;
}

async function enqueueMessages(messages, options) {
  const batches = chunkOpenAccessQueueMessages(messages, {
    batchSize: options.batchSize,
  });
  let sent = 0;

  for (const [index, batch] of batches.entries()) {
    const response = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${options.accountId}/queues/${options.queueId}/messages/batch`,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${options.apiToken}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify(buildCloudflareQueueBatchPayload(batch)),
      }
    );
    const payload = await response.json().catch(() => null);
    if (!response.ok || payload?.success === false) {
      throw new Error(
        `Cloudflare queue batch ${index + 1}/${batches.length} failed: ${response.status} ${JSON.stringify(payload)}`
      );
    }
    sent += batch.length;
    if ((index + 1) % 10 === 0 || index + 1 === batches.length) {
      console.error(`enqueued ${sent}/${messages.length}`);
    }
  }

  return {
    sent,
    batches: batches.length,
  };
}

function printHelp() {
  console.log(`Usage:
  pnpm open:queue -- --plan tmp/open-access-art-apply/apply-plan.json
  pnpm open:queue -- --manifest tmp/open-access-art-dry-run.json --out-dir tmp/open-access-art-queue
  pnpm open:queue -- --plan tmp/open-access-art-apply/apply-plan.json --enqueue --account-id <id> --queue-id <id>

Options:
  --plan PATH              Existing apply-plan.json from pnpm open:apply.
  --manifest PATH          Dry-run manifest from pnpm open:dry-run -- --out PATH.
  --out-dir PATH           Output directory. Default: tmp/open-access-art-queue.
  --limit N                Build from only the first N normalized records when using --manifest.
  --asset-mode r2|external Asset mode when building from --manifest. Default: r2.
  --external-providers CSV Provider keys to skip by leaving as external assets.
  --batch-size N           Queue batch size. Max 100. Default: 100.
  --enqueue                POST generated batches to Cloudflare Queues REST API.
  --account-id ID          Cloudflare account id. Falls back to CLOUDFLARE_ACCOUNT_ID.
  --queue-id ID            Cloudflare queue id. Falls back to CLOUDFLARE_QUEUE_ID.
  --api-token TOKEN        Cloudflare API token. Falls back to CLOUDFLARE_API_TOKEN.
`);
}
