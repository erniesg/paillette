#!/usr/bin/env node

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { readFileSync } from 'node:fs';

import { buildOpenAccessCostGate } from './lib/open-access-art-cost-gate.mjs';

const args = parseArgs(process.argv.slice(2));
if (args.flags.has('help') || args.flags.has('h')) {
  printHelp();
  process.exit(0);
}

const manifestPath = args.values.get('manifest')
  ? resolve(args.values.get('manifest'))
  : null;
if (!manifestPath) {
  failConfig('--manifest is required');
}

const outPath = args.values.get('out')
  ? resolve(args.values.get('out'))
  : null;
const manifest = readManifest(manifestPath);
const report = buildReport(manifest, args);

const json = `${JSON.stringify(report, null, 2)}\n`;
if (outPath) {
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, json, 'utf8');
}
process.stdout.write(json);
process.exitCode = report.exitCode;

function buildReport(manifest, args) {
  try {
    return buildOpenAccessCostGate({
      manifest,
      providers: {
        imageEmbeddings: args.values.get('image-embeddings') || 'pending',
        captionGeneration: args.values.get('caption-generation') || 'pending',
        captionEmbeddings: args.values.get('caption-embeddings') || 'pending',
      },
      approvedBulk: args.flags.has('approve-bulk'),
      thresholds: {
        sampleImageEmbeddings: numberArg(
          args.values.get('sample-image-embeddings')
        ),
        sampleCaptionGenerationRows: numberArg(
          args.values.get('sample-caption-generation-rows')
        ),
        sampleCaptionEmbeddingRows: numberArg(
          args.values.get('sample-caption-embedding-rows')
        ),
      },
    });
  } catch (error) {
    failConfig(error.message);
  }
}

function readManifest(manifestPath) {
  try {
    return JSON.parse(readFileSync(manifestPath, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') {
      failConfig(`manifest not found: ${manifestPath}`);
    }
    if (error instanceof SyntaxError) {
      failConfig(`manifest is not valid JSON: ${manifestPath}`);
    }
    failConfig(`could not read manifest: ${manifestPath}`);
  }
}

function failConfig(message) {
  process.stdout.write(
    `${JSON.stringify(
      {
        schema_version: 'open-access-art-cost-gate-v1',
        result: 'blocked',
        exitCode: 2,
        error: message,
      },
      null,
      2
    )}\n`
  );
  process.exit(2);
}

function parseArgs(argv) {
  const values = new Map();
  const flags = new Set();
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--' || !arg.startsWith('--')) continue;
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

function numberArg(value) {
  if (value === undefined || value === null || value === '') return undefined;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) {
    throw new Error(`invalid numeric value: ${value}`);
  }
  return number;
}

function printHelp() {
  console.log(`Usage:
  pnpm open:gate -- --manifest tmp/nga-dry-run.json
  pnpm open:gate -- --manifest tmp/nga-dry-run.json --image-embeddings=jina --caption-generation=local --caption-embeddings=jina --approve-bulk --out tmp/nga-cost-gate.json

Options:
  --manifest PATH                         Dry-run manifest from pnpm open:dry-run.
  --out PATH                              Optional JSON report output.
  --image-embeddings pending|local|jina|defer
  --caption-generation pending|local|paid-api|defer
  --caption-embeddings pending|jina|defer
  --approve-bulk                          Human approval has been recorded for work above sample thresholds.
  --sample-image-embeddings N             Default: 10.
  --sample-caption-generation-rows N       Default: 5.
  --sample-caption-embedding-rows N        Default: 5.

Exit codes:
  0 ready or explicitly deferred
  3 blocked by missing secret/auth
  4 blocked by human decision or bulk approval
`);
}
