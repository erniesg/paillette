#!/usr/bin/env node
import { resolve } from 'node:path';

import {
  DEFAULT_MAX_ASSET_BYTES,
  buildInitialLedger,
  downloadLedgerAssets,
  listOption,
  numberOption,
  parseArgs,
  readJson,
  summarizeLedgerRecords,
  updateLedgerSummary,
  writeJson,
} from './lib/open-access-art.mjs';

const args = parseArgs(process.argv.slice(2));

if (args.flags.has('help')) {
  printHelp();
  process.exit(0);
}

try {
  const providers = listOption(args.values, 'providers', ['nga']);
  const dbPath = args.values.get('db');
  if (!dbPath) throw new Error('--db is required');

  let ledger;
  if (args.flags.has('init')) {
    const manifestPath = args.values.get('manifest');
    if (!manifestPath) throw new Error('--manifest is required with --init');
    const manifest = readJson(manifestPath);
    ledger = buildInitialLedger(manifest, {
      providers,
      limit: numberOption(args.values, 'limit', 0),
    });
    ledger.manifest.path = resolve(manifestPath);
  } else {
    ledger = readJson(dbPath);
  }

  if (args.flags.has('download')) {
    ledger = await downloadLedgerAssets(ledger, {
      outDir: args.values.get('out-dir') || 'tmp/open-access-assets',
      downloadLimit: numberOption(args.values, 'download-limit', 0),
      concurrency: numberOption(args.values, 'concurrency', 4),
      maxBytes: numberOption(args.values, 'max-bytes', DEFAULT_MAX_ASSET_BYTES),
    });
  } else {
    updateLedgerSummary(ledger);
  }

  writeJson(dbPath, ledger);

  const outDir = args.values.get('out-dir');
  if (outDir) {
    writeJson(resolve(outDir, 'asset-status.json'), {
      schema_version: '1',
      kind: 'open_access_art_asset_status',
      generated_at: new Date().toISOString(),
      db: resolve(dbPath),
      summary: ledger.summary,
      records: ledger.records.map((record) => ({
        id: record.id,
        source_asset_id: record.source_asset_id,
        target_object_key: record.target_object_key,
        download: record.download,
      })),
    });
  }

  if (args.flags.has('status')) {
    console.log(
      JSON.stringify(
        {
          db: resolve(dbPath),
          outDir: outDir ? resolve(outDir) : null,
          summary: summarizeLedgerRecords(ledger.records),
        },
        null,
        2
      )
    );
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(error.exitCode || 1);
}

function printHelp() {
  console.log(`Usage: pnpm open:assets -- --manifest tmp/nga-launch-dry-run.json --db tmp/nga-launch-assets.sqlite --out-dir tmp/nga-launch-assets --init --status
       pnpm open:assets -- --db tmp/nga-launch-assets.sqlite --out-dir tmp/nga-launch-assets --download --download-limit=10 --status

The --db path is a portable JSON asset ledger. It may use a .sqlite suffix to
match the issue command, but this proof intentionally avoids native database
dependencies.`);
}
