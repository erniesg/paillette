import { createHash } from 'node:crypto';
import { basename } from 'node:path';

export const DEFAULT_NGS_ORG_ID = 'cf98791d-f3cc-4f9f-b40c-a350efadbd05';
export const DEFAULT_STAGING_ASSET_API_BASE =
  'https://paillette-api-stg.berlayar.ai/api/v1/assets';

const ACCEPTED_CROP_DECISIONS = new Set([
  'accept',
  'accepted',
  'crop',
  'use_crop',
  'use_extracted',
  'extracted',
]);

export function sqlString(value) {
  return String(value ?? '').replaceAll("'", "''");
}

export function safeFilename(value) {
  return String(value || 'unknown')
    .trim()
    .replace(/[^a-z0-9._-]+/gi, '-')
    .replace(/^-+|-+$/g, '') || 'unknown';
}

export function stableAssetId({ artworkId, role, version = 'ngs-missing-v1' }) {
  return createHash('sha256')
    .update(`${version}:${artworkId}:${role}`)
    .digest('hex')
    .slice(0, 32);
}

export function buildAssetUrls({
  apiBase = DEFAULT_STAGING_ASSET_API_BASE,
  originalAssetId,
  thumbnailAssetId,
}) {
  const base = String(apiBase).replace(/\/+$/g, '');
  return {
    imageUrl: `${base}/${originalAssetId}/content`,
    thumbnailUrl: `${base}/${thumbnailAssetId}/content`,
  };
}

export function selectedInputName(row) {
  const downloadPath = row?.download?.path;
  return downloadPath ? basename(downloadPath) : `${safeFilename(row?.id)}.jpg`;
}

export function normalizeCropDecision(decision) {
  if (!decision) return null;
  if (typeof decision === 'string') return decision.toLowerCase();
  if (typeof decision.decision === 'string') {
    return decision.decision.toLowerCase();
  }
  if (decision.accepted === true) return 'accept';
  return null;
}

export function isAcceptedCropDecision(decision) {
  const normalized = normalizeCropDecision(decision);
  return normalized ? ACCEPTED_CROP_DECISIONS.has(normalized) : false;
}

export function selectImageForBackfill(
  row,
  { sam3ByName = new Map(), cropDecisionsByName = new Map() } = {}
) {
  if (!row?.download?.ok || !row.download.path) {
    return {
      ok: false,
      reason: row?.download?.reason || 'missing_valid_download',
    };
  }

  const name = selectedInputName(row);
  const sam3 = sam3ByName.get(name);
  const cropDecision = cropDecisionsByName.get(name);

  if (
    sam3?.action === 'crop' &&
    sam3.output_path &&
    isAcceptedCropDecision(cropDecision)
  ) {
    return {
      ok: true,
      kind: 'extracted',
      path: sam3.output_path,
      originalPath: row.download.path,
      sourceUrl: row.download.url || row.renditionZoom2048 || row.ngsImageUrl,
      sourceContentType: row.download.contentType || 'image/jpeg',
      sam3Reason: sam3.reason || null,
      sam3Box: sam3.source_box || sam3.final_box || null,
      decision: normalizeCropDecision(cropDecision),
    };
  }

  return {
    ok: true,
    kind: 'original',
    path: row.download.path,
    originalPath: row.download.path,
    sourceUrl: row.download.url || row.renditionZoom2048 || row.ngsImageUrl,
    sourceContentType: row.download.contentType || 'image/jpeg',
    sam3Reason: sam3?.reason || null,
    sam3Box: null,
    decision: normalizeCropDecision(cropDecision),
  };
}

export function mapByName(rows) {
  return new Map(
    rows
      .filter((row) => row?.name)
      .map((row) => [String(row.name), row])
  );
}

export function decisionsMap(payload) {
  if (!payload) return new Map();
  if (payload instanceof Map) return payload;

  const raw = payload.decisions && typeof payload.decisions === 'object'
    ? payload.decisions
    : payload;

  if (!raw || typeof raw !== 'object') return new Map();
  return new Map(Object.entries(raw));
}

export function captionRecordForRow(row, captionText) {
  const text = String(captionText || '').trim();
  if (!text) return null;

  return {
    text,
    model: row.captionModel || null,
    prompt_version: row.captionPromptVersion || null,
    generated_at: row.captionGeneratedAt || new Date().toISOString(),
    sources: [row.ngsPageUrl, row.ngsImageUrl].filter(Boolean),
  };
}
