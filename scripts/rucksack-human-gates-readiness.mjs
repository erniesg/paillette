#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const GATE_ISSUES = [18, 20, 26];
const SECRET_NAME_RE =
  /\b(?:CLOUDFLARE_ACCOUNT_ID|CLOUDFLARE_API_TOKEN|R2_ACCESS_KEY_ID|R2_SECRET_ACCESS_KEY|R2_ENDPOINT|JINA_API_KEY|GITHUB_TOKEN|RUCKSACK_UNLOCK_PORTAL_GITHUB_TOKEN|DISCORD_WEBHOOK_URL)\b/gu;

const args = parseArgs(process.argv.slice(2));

if (args.flags.has('help')) {
  printHelp();
  process.exit(0);
}

try {
  const repo = requiredValue(args.values, 'repo');
  const manifestPath = resolve(requiredValue(args.values, 'manifest'));
  const outPath = resolve(
    args.values.get('out') || 'tmp/rucksack-human-gates-readiness.json'
  );
  const manifest = readJsonFile(manifestPath);
  const issues = loadIssues({ repo, issuesJson: args.values.get('issues-json') });
  const report = buildReadinessReport({ repo, manifestPath, manifest, issues });

  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(
    JSON.stringify(
      {
        out: outPath,
        status: report.status,
        ready_issue_numbers: report.ready_issue_numbers,
        missing_issue_numbers: report.missing_issue_numbers,
      },
      null,
      2
    )
  );
  process.exit(report.status === 'ready_for_launch_review' ? 0 : 4);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(error?.exitCode || 2);
}

function buildReadinessReport({ repo, manifestPath, manifest, issues }) {
  const issueMap = new Map(issues.map((issue) => [Number(issue.number), issue]));
  const r2Upload = summarizeR2Upload(issueMap.get(18));
  const captionVector = summarizeCaptionVector(issueMap.get(20));
  const unlockPortal = summarizeUnlockPortal(issueMap.get(26));
  const gates = {
    r2_upload: r2Upload,
    caption_vector: captionVector,
    unlock_portal: unlockPortal,
  };
  const readyIssueNumbers = Object.values(gates)
    .filter((gate) => gate.ready)
    .map((gate) => gate.issue_number)
    .sort((a, b) => a - b);
  const missingIssueNumbers = GATE_ISSUES.filter(
    (number) => !readyIssueNumbers.includes(number)
  );
  const report = {
    schema_version: '1',
    kind: 'rucksack_human_gates_readiness',
    generated_at: new Date().toISOString(),
    repo,
    status:
      missingIssueNumbers.length === 0
        ? 'ready_for_launch_review'
        : 'blocked_on_human_gates',
    ready_issue_numbers: readyIssueNumbers,
    missing_issue_numbers: missingIssueNumbers,
    manifest: summarizeManifest({ manifestPath, manifest }),
    gates,
    launch_scope: {
      live_launch_approved: false,
      d1_apply_approved: false,
      queue_enqueue_approved: false,
      vector_upsert_approved: false,
      generated_caption_approved: false,
      deploy_approved: false,
    },
    redaction_checks: {
      secret_names_detected: secretNamesForReport(gates),
      report_contains_secret_values: false,
    },
  };
  report.redaction_checks.report_contains_secret_values =
    reportContainsKnownSecretValues(report);
  if (report.redaction_checks.report_contains_secret_values) {
    report.status = 'blocked_on_redaction_check';
  }
  return report;
}

function summarizeManifest({ manifestPath, manifest }) {
  const records = Array.isArray(manifest.records) ? manifest.records : [];
  const targetKeys =
    manifest.summary?.target_object_keys ||
    records
      .map((record) => record?.target?.object_key || record?.target_object_key)
      .filter(Boolean);
  return {
    path: manifestPath,
    kind: manifest.kind || null,
    generated_at: manifest.generated_at || null,
    summary: {
      image_count: Number(manifest.summary?.image_count || records.length || 0),
      target_object_key_count: targetKeys.length,
      target_object_keys: targetKeys,
    },
  };
}

function summarizeR2Upload(issue) {
  const text = issueText(issue);
  const uploadedObjectKeys = uniqueMatches(
    text,
    /generated\/open-access\/nga\/[^\s`'")]+/gu
  );
  const ready =
    isClosed(issue) &&
    /bounded R2 proof|bounded upload proof|R2 readiness and bounded upload proof/iu.test(
      text
    ) &&
    /paillette-assets-stg/u.test(text) &&
    uploadedObjectKeys.length > 0;
  return {
    issue_number: 18,
    title: issue?.title || 'R2 Asset Queue Proof',
    state: normalizedState(issue),
    ready,
    decision: ready ? 'accepted_bounded_proof' : 'missing_bounded_proof',
    bucket: /paillette-assets-stg/u.test(text) ? 'paillette-assets-stg' : null,
    uploaded_object_keys: uploadedObjectKeys,
    safety: {
      d1_apply: false,
      queue_enqueue: false,
      vector_upsert: false,
      paid_caption_generation: false,
      deploy: false,
    },
  };
}

function summarizeCaptionVector(issue) {
  const text = issueText(issue);
  const deferForV1 =
    /metadata plus institution captions only/iu.test(text) &&
    /Image embeddings:\s*defer/iu.test(text) &&
    /Caption generation:\s*defer/iu.test(text) &&
    /Caption embeddings:\s*defer/iu.test(text);
  return {
    issue_number: 20,
    title: issue?.title || 'Vector Caption Cost Gate',
    state: normalizedState(issue),
    ready: isClosed(issue) && deferForV1,
    decision: deferForV1 ? 'defer_for_v1' : 'missing_v1_decision',
    paid_provider_work_approved: false,
    local_model_download_approved: false,
  };
}

function summarizeUnlockPortal(issue) {
  const text = issueText(issue);
  const heldGithubComments =
    /hold the hosted unlock portal/iu.test(text) &&
    /GitHub issue comments/iu.test(text);
  return {
    issue_number: 26,
    title: issue?.title || 'Hosted Unlock Portal Activation',
    state: normalizedState(issue),
    ready: isClosed(issue) && heldGithubComments,
    decision: heldGithubComments
      ? 'held_github_comments'
      : 'missing_portal_or_hold_decision',
    hosted_unlock_portal_deployed: false,
    github_comments_control_plane: heldGithubComments,
  };
}

function loadIssues({ repo, issuesJson }) {
  if (issuesJson) {
    const payload = readJsonFile(resolve(issuesJson));
    if (!Array.isArray(payload)) {
      throw new Error('--issues-json must contain an array of issues');
    }
    return payload;
  }

  return GATE_ISSUES.map((number) => {
    const stdout = execFileSync(
      'gh',
      [
        'issue',
        'view',
        String(number),
        '--repo',
        repo,
        '--json',
        'number,title,state,body,comments,url,labels',
      ],
      { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 }
    );
    return JSON.parse(stdout);
  });
}

function issueText(issue) {
  if (!issue) return '';
  const comments = Array.isArray(issue.comments) ? issue.comments : [];
  return [issue.body, ...comments.map((comment) => comment?.body || '')]
    .filter(Boolean)
    .join('\n\n');
}

function isClosed(issue) {
  return normalizedState(issue) === 'closed';
}

function normalizedState(issue) {
  return String(issue?.state || 'missing').toLowerCase();
}

function uniqueMatches(text, regex) {
  return [...new Set([...String(text || '').matchAll(regex)].map(([match]) => match))];
}

function secretNamesForReport(value) {
  return [...new Set(JSON.stringify(value).match(SECRET_NAME_RE) || [])].sort();
}

function reportContainsKnownSecretValues(report) {
  const reportText = JSON.stringify(report);
  return [
    'CLOUDFLARE_API_TOKEN',
    'R2_ACCESS_KEY_ID',
    'R2_SECRET_ACCESS_KEY',
    'R2_ENDPOINT',
    'JINA_API_KEY',
    'GITHUB_TOKEN',
    'RUCKSACK_UNLOCK_PORTAL_GITHUB_TOKEN',
    'DISCORD_WEBHOOK_URL',
  ].some((name) => {
    const value = process.env[name];
    return typeof value === 'string' && value.length >= 8 && reportText.includes(value);
  });
}

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

function requiredValue(values, name) {
  const value = values.get(name);
  if (!value) {
    const error = new Error(`--${name} is required`);
    error.exitCode = 2;
    throw error;
  }
  return value;
}

function readJsonFile(path) {
  if (!existsSync(path)) {
    const error = new Error(`file not found: ${path}`);
    error.exitCode = 2;
    throw error;
  }
  return JSON.parse(readFileSync(path, 'utf8'));
}

function printHelp() {
  console.log(`Usage:
  node scripts/rucksack-human-gates-readiness.mjs --repo erniesg/paillette --manifest tmp/nga-launch-dry-run.json --out tmp/rucksack-human-gates-readiness.json

Options:
  --repo OWNER/REPO       GitHub repo used to read issues #18, #20, and #26.
  --manifest PATH         NGA dry-run manifest to summarize.
  --out PATH              Output JSON path. Default: tmp/rucksack-human-gates-readiness.json.
  --issues-json PATH      Optional offline test fixture containing issue JSON.

The report records only issue decisions, object keys, bucket names, and secret
names. It does not approve live launch, D1 apply, queue enqueue, vector upsert,
generated captions, deploy, or rollback.`);
}
