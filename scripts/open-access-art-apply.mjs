#!/usr/bin/env node
import { resolve } from 'node:path';

import {
  DEFAULT_MAX_ASSET_BYTES,
  assertNoForbiddenApplyFlags,
  buildInitialLedger,
  buildR2ReadinessReport,
  downloadLedgerAssets,
  numberOption,
  parseArgs,
  readJson,
  uploadLedgerAssetsToR2,
  writeAssetManifest,
  writeJson,
} from './lib/open-access-art.mjs';

const args = parseArgs(process.argv.slice(2));

if (args.flags.has('help')) {
  printHelp();
  process.exit(0);
}

try {
  assertNoForbiddenApplyFlags(args.flags);

  const manifestPath = args.values.get('manifest');
  if (!manifestPath) throw new Error('--manifest is required');
  const outDir = resolve(args.values.get('out-dir') || 'tmp/open-access-apply');
  const assetMode = args.values.get('asset-mode') || 'r2';
  if (assetMode !== 'r2')
    throw new Error('--asset-mode=r2 is required for issue #18');
  const uploadAuth = args.values.get('upload-auth') || 's3';

  const uploadRequested = args.flags.has('upload');
  const uploadLimit = numberOption(args.values, 'limit', 2) || 2;
  const readinessOut = resolve(
    args.values.get('readiness-out') || 'tmp/nga-r2-readiness.json'
  );

  if (uploadRequested && uploadLimit > 2) {
    const error = new Error(
      'live R2 upload is capped at two records for issue #18'
    );
    error.exitCode = 4;
    throw error;
  }

  if (uploadRequested) {
    const readiness = buildR2ReadinessReport({ uploadAuth });
    writeJson(readinessOut, readiness);
    if (readiness.exit_code !== 0) {
      writeAssetManifest(
        resolve(outDir, 'asset-manifest.json'),
        { records: [] },
        {
          assetMode,
          uploadAuth,
          uploadRequested,
          readinessReport: readinessOut,
        }
      );
      console.error(
        `R2 readiness blocked upload with exit code ${readiness.exit_code}`
      );
      process.exit(readiness.exit_code);
    }
  }

  const manifest = readJson(manifestPath);
  let ledger = buildInitialLedger(manifest, { limit: uploadLimit });
  if (args.flags.has('download') || uploadRequested) {
    ledger = await downloadLedgerAssets(ledger, {
      outDir,
      downloadLimit: uploadLimit,
      concurrency: numberOption(args.values, 'concurrency', 4),
      maxBytes: numberOption(args.values, 'max-bytes', DEFAULT_MAX_ASSET_BYTES),
    });
  }

  if (uploadRequested) {
    ledger = await uploadLedgerAssetsToR2(ledger, {
      uploadAuth,
      uploadLimit,
      concurrency: numberOption(args.values, 'upload-concurrency', 1),
    });
  }

  const assetManifest = writeAssetManifest(
    resolve(outDir, 'asset-manifest.json'),
    ledger,
    {
      assetMode,
      uploadAuth,
      uploadRequested,
      readinessReport: uploadRequested ? readinessOut : null,
    }
  );
  writeJson(resolve(outDir, 'asset-ledger.json'), ledger);
  console.log(
    JSON.stringify(
      {
        outDir,
        asset_manifest: resolve(outDir, 'asset-manifest.json'),
        summary: assetManifest.summary,
        upload_requested: uploadRequested,
        upload_performed: assetManifest.upload_performed,
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
  console.log(`Usage: pnpm open:apply -- --manifest tmp/nga-launch-dry-run.json --out-dir tmp/nga-r2-upload-proof --limit=2 --asset-mode=r2 --download --upload --upload-auth=s3 --upload-concurrency=1

Live upload is capped at two records for issue #18 and is blocked unless the R2
readiness report exits 0. Use --upload-auth=wrangler only from a trusted machine
with Wrangler already logged in. This command never applies D1 SQL, enqueues
queue messages, generates paid captions, upserts vectors, or deploys.`);
}
