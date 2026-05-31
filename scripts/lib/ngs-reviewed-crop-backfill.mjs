import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { sqlString } from './ngs-missing-image-backfill.mjs';

const ACCEPTED_DECISIONS = new Set(['accept', 'accepted']);

export function stripUrlQuery(value) {
  return String(value || '').split('?', 1)[0];
}

export function normalizeReviewDecision(decision) {
  if (!decision) return null;
  if (typeof decision === 'string') return decision.toLowerCase();
  if (typeof decision.decision === 'string')
    return decision.decision.toLowerCase();
  if (decision.accepted === true) return 'accept';
  return null;
}

export function selectReviewedCropsForBackfill({
  reviewDir,
  decisionsPayload,
  rows,
  exists = existsSync,
}) {
  const rowById = new Map((rows || []).map((row) => [String(row.id), row]));
  const decisions =
    decisionsPayload?.decisions &&
    typeof decisionsPayload.decisions === 'object'
      ? decisionsPayload.decisions
      : {};
  const selected = decisionsPayload?.selected || {};
  const output = [];

  for (const [id, decision] of Object.entries(decisions)) {
    if (!ACCEPTED_DECISIONS.has(normalizeReviewDecision(decision))) {
      continue;
    }

    const row = rowById.get(id) || { id };
    const selection = selected[id] || {};
    const activeResult = selection.activeResult || {};
    const cropUrl = activeResult.cropUrl || selection.cropUrl;
    const cropPath = stripUrlQuery(cropUrl);

    if (!cropPath) {
      throw new Error(`accepted review crop is missing a cropUrl for ${id}`);
    }

    const resolvedCropPath = resolve(reviewDir, cropPath);
    if (!exists(resolvedCropPath)) {
      throw new Error(
        `accepted review crop is missing on disk for ${id}: ${resolvedCropPath}`
      );
    }

    const originalPath = row.original
      ? resolve(reviewDir, stripUrlQuery(row.original))
      : null;

    output.push({
      id,
      title: row.title || null,
      artist: row.artist || null,
      dateText: row.dateText || null,
      medium: row.medium || null,
      selectedImage: {
        ok: true,
        kind: 'review_crop',
        path: resolvedCropPath,
        originalPath,
        sourceUrl: cropPath,
        sourceContentType: 'image/jpeg',
        reviewChoice: selection.choice || null,
        reviewChoiceLabel: selection.choiceLabel || null,
        reviewBox: selection.box || activeResult.box || null,
        reviewCropUrl: cropUrl,
        reviewOverlayUrl:
          activeResult.overlayUrl || selection.overlayUrl || null,
        activeMethod: activeResult.method || null,
        sourceTransform:
          selection.sourceTransform || activeResult.sourceTransform || null,
        points: selection.points || [],
      },
    });
  }

  return output;
}

export function reviewCropBackfillPayload(
  row,
  {
    originalAssetId,
    thumbnailAssetId,
    appliedAt = new Date().toISOString(),
    version = 'ngs-reviewed-crops-v1',
  }
) {
  const selected = row.selectedImage || {};

  return {
    version,
    applied_at: appliedAt,
    source: 'ngs_remaining_sam3_human_review',
    selected_kind: 'review_crop',
    selected_source: 'accepted_review_crop',
    review_choice: selected.reviewChoice || null,
    review_choice_label: selected.reviewChoiceLabel || null,
    review_method: selected.activeMethod || null,
    review_box: selected.reviewBox || null,
    review_crop_url: selected.reviewCropUrl || null,
    review_overlay_url: selected.reviewOverlayUrl || null,
    source_transform: selected.sourceTransform || null,
    original_asset_id: originalAssetId,
    thumbnail_asset_id: thumbnailAssetId,
  };
}

export function reviewCropArtworkStatement(
  row,
  {
    orgId,
    appliedAt = new Date().toISOString(),
    version = 'ngs-reviewed-crops-v1',
  }
) {
  const backfillPayload = reviewCropBackfillPayload(row, {
    originalAssetId: row.originalAssetId,
    thumbnailAssetId: row.thumbnailAssetId,
    appliedAt,
    version,
  });
  const customMetadataExpression = `json_set(COALESCE(NULLIF(custom_metadata, ''), '{}'), '$.image_backfill', json('${sqlString(JSON.stringify(backfillPayload))}'))`;

  return `
UPDATE artworks
SET
  image_url = '${sqlString(row.imageUrl)}',
  thumbnail_url = '${sqlString(row.thumbnailUrl)}',
  embedding_id = '${sqlString(row.id)}',
  dominant_colors = json('${sqlString(JSON.stringify(row.colors?.dominantColors || []))}'),
  color_palette = json('${sqlString(JSON.stringify(row.colors?.palette || []))}'),
  color_extracted_at = '${sqlString(row.colorExtractedAt || appliedAt)}',
  color_extraction_version = '${sqlString(version)}',
  custom_metadata = ${customMetadataExpression},
  updated_at = CURRENT_TIMESTAMP
WHERE id = '${sqlString(row.id)}'
  AND org_id = '${sqlString(orgId)}'
  AND deleted_at IS NULL;`.trim();
}
