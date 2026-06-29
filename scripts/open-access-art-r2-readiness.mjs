#!/usr/bin/env node
import {
  buildR2ReadinessReport,
  parseArgs,
  writeJson,
} from './lib/open-access-art.mjs';

const args = parseArgs(process.argv.slice(2));

if (args.flags.has('help')) {
  printHelp();
  process.exit(0);
}

const report = buildR2ReadinessReport();
const out = args.values.get('out');
if (out) writeJson(out, report);
console.log(
  JSON.stringify(
    {
      status: report.status,
      exit_code: report.exit_code,
      missing_names: report.missing_names,
      out: out || null,
    },
    null,
    2
  )
);
process.exit(report.exit_code);

function printHelp() {
  console.log(`Usage: node scripts/open-access-art-r2-readiness.mjs --out tmp/nga-r2-readiness.json

Exit codes:
  0  R2 bucket name and required Cloudflare/R2 names are present
  3  Missing secret/auth names
  4  Missing ANVIL_R2_BUCKET human bucket decision

The JSON report records names and booleans only; it does not write secret values.`);
}
