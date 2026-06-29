#!/usr/bin/env node
import {
  buildDryRunManifest,
  listOption,
  numberOption,
  parseArgs,
  writeJson,
} from './lib/open-access-art.mjs';

const args = parseArgs(process.argv.slice(2));

if (args.flags.has('help')) {
  printHelp();
  process.exit(0);
}

try {
  const manifest = buildDryRunManifest({
    providers: listOption(args.values, 'providers', ['nga']),
    sampleSize: numberOption(args.values, 'sample-size', 5),
    sampleCaption: args.values.get('sample-caption') || 'none',
    objectPrefix: args.values.get('object-prefix'),
    imageSize: args.values.get('iiif-size'),
  });
  const out = args.values.get('out');
  if (out) writeJson(out, manifest);
  console.log(
    JSON.stringify(
      {
        summary: manifest.summary,
        out: out || null,
        safety: manifest.safety,
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
  console.log(`Usage: pnpm open:dry-run -- --providers=nga --sample-size=5 --out tmp/nga-launch-dry-run.json

Writes a bounded NGA open-access media plan. It does not download, upload,
generate captions, apply D1 SQL, enqueue queue messages, upsert vectors, or deploy.`);
}
