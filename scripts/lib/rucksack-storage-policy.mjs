import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export function readRucksackObjectStorageBucket({
  cwd = process.cwd(),
  policyPath = '.agent/storage.yaml',
} = {}) {
  const path = resolve(cwd, policyPath);
  if (!existsSync(path)) return null;

  const lines = readFileSync(path, 'utf8').split(/\r?\n/u);
  let inObjectStorage = false;
  for (const line of lines) {
    if (/^object_storage:\s*$/u.test(line)) {
      inObjectStorage = true;
      continue;
    }
    if (inObjectStorage && /^\S/u.test(line)) {
      return null;
    }
    if (!inObjectStorage) continue;

    const match = line.match(/^\s+bucket:\s*(.*?)\s*$/u);
    if (!match) continue;

    const raw = match[1].trim();
    if (!raw || raw === '""' || raw === "''") return null;
    return raw.replace(/^['"]|['"]$/gu, '').trim() || null;
  }

  return null;
}

export function resolveR2Bucket({ cliBucket, defaultBucket }) {
  const explicitBucket = String(cliBucket || '').trim();
  if (explicitBucket) {
    return { bucket: explicitBucket, approved: true, source: '--bucket' };
  }

  const policyBucket = readRucksackObjectStorageBucket();
  if (policyBucket) {
    return {
      bucket: policyBucket,
      approved: true,
      source: '.agent/storage.yaml',
    };
  }

  return { bucket: defaultBucket, approved: false, source: 'default' };
}

export function requireApprovedR2Bucket({ approved, operation }) {
  if (approved) return;

  throw new Error(
    `approved R2 bucket is required before ${operation}; pass --bucket <bucket> or set object_storage.bucket in .agent/storage.yaml after human approval`
  );
}
