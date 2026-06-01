import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { sqlString } from './ngs-missing-image-backfill.mjs';

const ACCEPTED_DECISIONS = new Set(['accept', 'accepted']);
const isDataUrl = (value) => /^data:/i.test(String(value || ''));

const positiveNumber = (value) => {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
};

export function stripUrlQuery(value) {
  return String(value || '').split('?', 1)[0];
}

export function mapReviewBoxToSourcePixels({ box, reviewSize, sourceSize }) {
  if (!Array.isArray(box) || box.length !== 4) return null;

  const reviewWidth = positiveNumber(reviewSize?.width);
  const reviewHeight = positiveNumber(reviewSize?.height);
  const sourceWidth = positiveNumber(sourceSize?.width);
  const sourceHeight = positiveNumber(sourceSize?.height);

  if (!reviewWidth || !reviewHeight || !sourceWidth || !sourceHeight) {
    return null;
  }

  const [x1, y1, x2, y2] = box.map(Number);
  if (![x1, y1, x2, y2].every(Number.isFinite)) return null;

  const left = Math.max(
    0,
    Math.min(sourceWidth - 1, Math.round((x1 / reviewWidth) * sourceWidth))
  );
  const top = Math.max(
    0,
    Math.min(sourceHeight - 1, Math.round((y1 / reviewHeight) * sourceHeight))
  );
  const right = Math.max(
    left + 1,
    Math.min(sourceWidth, Math.round((x2 / reviewWidth) * sourceWidth))
  );
  const bottom = Math.max(
    top + 1,
    Math.min(sourceHeight, Math.round((y2 / reviewHeight) * sourceHeight))
  );

  return {
    left,
    top,
    width: right - left,
    height: bottom - top,
  };
}

export function reviewSourceCropSpec(selectedImage, actualSourceSize) {
  const source = selectedImage?.reviewSource;
  if (!source?.path) return null;

  const extract = mapReviewBoxToSourcePixels({
    box: source.box,
    reviewSize: { width: source.width, height: source.height },
    sourceSize: actualSourceSize,
  });

  return extract ? { inputPath: source.path, extract } : null;
}

export function sourceImageCandidateUrls(sourceRow = {}, reviewRow = {}) {
  const candidates = [];
  const seen = new Set();
  const push = (kind, url) => {
    const value = String(url || '').trim();
    if (!value || seen.has(value)) return;
    seen.add(value);
    candidates.push({ kind, url: value });
  };

  const assetCandidates = [
    ...(Array.isArray(sourceRow.asset_candidates)
      ? sourceRow.asset_candidates
      : []),
    ...(Array.isArray(sourceRow.assetCandidates)
      ? sourceRow.assetCandidates
      : []),
  ];
  for (const candidate of assetCandidates) {
    if (typeof candidate === 'string') {
      push('db-asset', candidate);
      continue;
    }
    push(
      candidate.kind || candidate.role || candidate.source || 'db-asset',
      candidate.url
    );
  }

  push('db-web-image', sourceRow.web_image_url || sourceRow.webImageUrl);

  const ngsImageUrl = sourceRow.ngs_image_url || sourceRow.ngsImageUrl;
  if (ngsImageUrl) {
    push('ngs-direct', ngsImageUrl);
    push(
      'ngs-zoom-2048',
      `${ngsImageUrl}/_jcr_content/renditions/cq5dam.zoom.2048.2048.jpeg`
    );
    push(
      'ngs-web-1280',
      `${ngsImageUrl}/_jcr_content/renditions/cq5dam.web.1280.1280.jpeg`
    );
  }

  const rootsUrls = [
    sourceRow.roots_listing_url,
    sourceRow.rootsListingUrl,
    reviewRow.sourceUrl,
  ];
  for (const rootsUrl of rootsUrls) {
    const match = String(rootsUrl || '').match(
      /roots\.gov\.sg\/Collection-Landing\/listing\/(\d+)/i
    );
    if (match) {
      push(
        'roots-collection-image',
        `https://www.roots.gov.sg/CollectionImages/${match[1]}.jpg`
      );
    }
  }

  return candidates;
}

export function isLargerSameAspectSource(
  localSize,
  candidateSize,
  { maxAspectDelta = 0.015, minAreaGain = 1.05 } = {}
) {
  const localWidth = positiveNumber(localSize?.width);
  const localHeight = positiveNumber(localSize?.height);
  const candidateWidth = positiveNumber(candidateSize?.width);
  const candidateHeight = positiveNumber(candidateSize?.height);
  if (!localWidth || !localHeight || !candidateWidth || !candidateHeight) {
    return false;
  }

  const localAspect = localWidth / localHeight;
  const candidateAspect = candidateWidth / candidateHeight;
  const aspectDelta = Math.abs(candidateAspect - localAspect) / localAspect;
  const areaGain =
    (candidateWidth * candidateHeight) / (localWidth * localHeight);
  return aspectDelta <= maxAspectDelta && areaGain >= minAreaGain;
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
    const cropMetadata =
      selection.cropMetadata || activeResult.cropMetadata || null;
    const cropUrl = activeResult.cropUrl || selection.cropUrl;
    const cropPath =
      cropUrl && !isDataUrl(cropUrl) ? stripUrlQuery(cropUrl) : null;
    const sourceTransform =
      selection.sourceTransform || activeResult.sourceTransform || null;
    const sourceUrl =
      cropMetadata?.sourceUrl ||
      sourceTransform?.sourceUrl ||
      row.original ||
      null;
    const sourceWidth = Number(
      cropMetadata?.sourceWidth || sourceTransform?.width || row.fullWidth || 0
    );
    const sourceHeight = Number(
      cropMetadata?.sourceHeight ||
        sourceTransform?.height ||
        row.fullHeight ||
        0
    );
    const reviewBox =
      cropMetadata?.nativeCropBox || selection.box || activeResult.box || null;
    const sourcePath =
      sourceUrl && !isDataUrl(sourceUrl)
        ? resolve(reviewDir, stripUrlQuery(sourceUrl))
        : null;
    const canUseNativeSource =
      cropMetadata?.sourceUrl &&
      Array.isArray(cropMetadata.nativeCropBox) &&
      sourcePath &&
      exists(sourcePath);
    const resolvedCropPath = cropPath ? resolve(reviewDir, cropPath) : null;

    if (resolvedCropPath && !exists(resolvedCropPath) && !canUseNativeSource) {
      throw new Error(
        `accepted review crop is missing on disk for ${id}: ${resolvedCropPath}`
      );
    }
    if (!resolvedCropPath && !canUseNativeSource) {
      throw new Error(`accepted review crop is missing a cropUrl for ${id}`);
    }

    const originalPath = row.original
      ? resolve(reviewDir, stripUrlQuery(row.original))
      : null;
    const selectedPath =
      resolvedCropPath && exists(resolvedCropPath)
        ? resolvedCropPath
        : sourcePath;
    const selectedKind =
      selectedPath === resolvedCropPath
        ? 'review_crop'
        : 'review_source_native_crop';

    output.push({
      id,
      title: row.title || null,
      artist: row.artist || null,
      dateText: row.dateText || null,
      medium: row.medium || null,
      selectedImage: {
        ok: true,
        kind: selectedKind,
        path: selectedPath,
        originalPath,
        sourceUrl: cropPath || sourceUrl || null,
        sourceContentType: 'image/jpeg',
        reviewChoice: selection.choice || null,
        reviewChoiceLabel: selection.choiceLabel || null,
        reviewBox,
        reviewCropUrl: cropPath ? cropUrl : null,
        reviewOverlayUrl:
          activeResult.overlayUrl || selection.overlayUrl || null,
        activeMethod: activeResult.method || null,
        sourceTransform,
        cropMetadata,
        reviewSource: sourceUrl
          ? {
              path: sourcePath,
              sourceUrl,
              width: sourceWidth || null,
              height: sourceHeight || null,
              box: reviewBox,
            }
          : null,
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
