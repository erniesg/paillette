#!/usr/bin/env node

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import Papa from 'papaparse';

import {
  OPEN_ACCESS_PROVIDER_PRESETS,
  buildDryRunManifest,
  normalizeArticArtwork,
  normalizeClevelandArtwork,
  normalizeMetArtwork,
  normalizeNgaArtwork,
} from './lib/open-access-art-ingest.mjs';

const DEFAULT_PROVIDER_PRESET = 'pilot';

const args = new Map(
  process.argv.slice(2).map((arg) => {
    const [key, ...rest] = arg.replace(/^--/, '').split('=');
    return [key, rest.length ? rest.join('=') : 'true'];
  })
);

const providerArg = String(args.get('providers') || DEFAULT_PROVIDER_PRESET);
const providers = (
  OPEN_ACCESS_PROVIDER_PRESETS[providerArg] || providerArg.split(',')
)
  .map((provider) => provider.trim().toLowerCase())
  .filter(Boolean);
const sampleSize = Number.parseInt(String(args.get('sample-size') || '3'), 10);
const sampleCaptionMode = String(args.get('sample-caption') || 'any')
  .trim()
  .toLowerCase();
const monthlyVectorQueries = Number.parseInt(
  String(args.get('monthly-vector-queries') || '100000'),
  10
);
const jinaTilesPerImage = Number.parseInt(
  String(args.get('jina-tiles-per-image') || '1'),
  10
);
const outPath = args.get('out');

const fetchJson = async (url, init) => {
  const response = await fetch(url, init);
  if (!response.ok) {
    throw new Error(`Request failed with ${response.status}: ${url}`);
  }
  return response.json();
};

const fetchJsonOrNull = async (url, init) => {
  const response = await fetch(url, init);
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(`Request failed with ${response.status}: ${url}`);
  }
  return response.json();
};

const fetchCsv = async (url) => {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Request failed with ${response.status}: ${url}`);
  }
  const text = await response.text();
  return Papa.parse(text, { header: true, skipEmptyLines: true }).data;
};

if (!['any', 'missing', 'present'].includes(sampleCaptionMode)) {
  throw new Error('--sample-caption must be any, missing, or present');
}

const articSearch = async ({
  extraMust = [],
  extraMustNot = [],
  limit = 0,
  fields,
} = {}) =>
  fetchJson('https://api.artic.edu/api/v1/artworks/search', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      limit,
      fields,
      query: {
        bool: {
          must: [
            { term: { is_public_domain: true } },
            { exists: { field: 'image_id' } },
            ...extraMust,
          ],
          ...(extraMustNot.length ? { must_not: extraMustNot } : {}),
        },
      },
    }),
  });

async function fetchMetSummary() {
  const search = await fetchJson(
    'https://collectionapi.metmuseum.org/public/collection/v1/search?isPublicDomain=true&hasImages=true&q=*'
  );
  const objectIds = Array.isArray(search.objectIDs)
    ? search.objectIDs.slice(0, sampleSize)
    : [];
  const records = await Promise.all(
    objectIds.map((id) =>
      fetchJsonOrNull(
        `https://collectionapi.metmuseum.org/public/collection/v1/objects/${encodeURIComponent(id)}`
      )
    )
  );
  const normalizedSamples = records.map(normalizeMetArtwork).filter(Boolean);
  const skipped = records
    .map((record, index) =>
      record ? null : { sourceRecordId: String(objectIds[index]), reason: 'met_object_detail_404' }
    )
    .filter(Boolean);

  return {
    provider: 'met',
    candidateCount: search.total || 0,
    captionCoverage: {
      total: search.total || 0,
      withInstitutionCaption: 0,
      missingInstitutionCaption: search.total || 0,
    },
    normalizedSamples,
    skipped,
    notes: [
      'The Met Collection API does not expose a general curatorial caption/description field in countable search results; title, tags, and metadata are retained as search text.',
    ],
  };
}

async function fetchArticSummary() {
  const total = await articSearch();
  const withDescription = await articSearch({
    extraMust: [{ exists: { field: 'description' } }],
  });
  const samplePayload = await articSearch({
    extraMust:
      sampleCaptionMode === 'present'
        ? [{ exists: { field: 'description' } }]
        : [],
    extraMustNot:
      sampleCaptionMode === 'missing'
        ? [{ exists: { field: 'description' } }]
        : [],
    limit: sampleSize,
    fields: [
      'id',
      'title',
      'is_public_domain',
      'image_id',
      'artist_title',
      'artist_display',
      'date_display',
      'date_start',
      'medium_display',
      'classification_title',
      'place_of_origin',
      'credit_line',
      'main_reference_number',
      'description',
      'department_title',
      'thumbnail',
      'api_link',
    ],
  });
  const candidateCount = total.pagination?.total || 0;
  const captionCount = withDescription.pagination?.total || 0;

  return {
    provider: 'artic',
    candidateCount,
    captionCoverage: {
      total: candidateCount,
      withInstitutionCaption: captionCount,
      missingInstitutionCaption: candidateCount - captionCount,
    },
    normalizedSamples: (samplePayload.data || [])
      .map(normalizeArticArtwork)
      .filter(Boolean),
    skipped: [],
    notes: [
      'ArtIC thumbnail alt text is present for image records but is not counted here as curatorial caption coverage.',
    ],
  };
}

async function fetchClevelandSummary() {
  const limit = 1000;
  let skip = 0;
  let total = null;
  let count = 0;
  let withCaption = 0;
  const normalizedSamples = [];

  while (total === null || skip < total) {
    const payload = await fetchJson(
      `https://openaccess-api.clevelandart.org/api/artworks/?cc0=1&has_image=1&limit=${limit}&skip=${skip}`
    );
    total = payload.info?.total || 0;
    const rows = payload.data || [];
    if (!rows.length) break;

    for (const row of rows) {
      count += 1;
      if (String(row.description || row.did_you_know || '').trim()) {
        withCaption += 1;
      }
      if (normalizedSamples.length < sampleSize) {
        const normalized = normalizeClevelandArtwork(row);
        if (normalized) normalizedSamples.push(normalized);
      }
    }

    skip += rows.length;
  }

  return {
    provider: 'cleveland',
    candidateCount: count,
    captionCoverage: {
      total: count,
      withInstitutionCaption: withCaption,
      missingInstitutionCaption: count - withCaption,
    },
    normalizedSamples,
    skipped: [],
    notes: [
      'Caption coverage counts Cleveland description or did_you_know fields.',
    ],
  };
}

async function fetchNgaSummary() {
  const [objects, images] = await Promise.all([
    fetchCsv(
      'https://raw.githubusercontent.com/NationalGalleryOfArt/opendata/main/data/objects.csv'
    ),
    fetchCsv(
      'https://raw.githubusercontent.com/NationalGalleryOfArt/opendata/main/data/published_images.csv'
    ),
  ]);
  const objectsById = new Map(
    objects
      .filter((object) => object.objectid)
      .map((object) => [String(object.objectid), object])
  );
  const objectIds = new Set();
  const objectIdsWithCaption = new Set();
  const normalizedSamples = [];

  for (const image of images) {
    if (String(image.openaccess).trim() !== '1') continue;
    const objectId = String(image.depictstmsobjectid || '').trim();
    if (!objectId) continue;
    const hasCaption = Boolean(String(image.assistivetext || '').trim());
    if (objectIds.has(objectId) && normalizedSamples.length >= sampleSize) {
      if (hasCaption) objectIdsWithCaption.add(objectId);
      objectIds.add(objectId);
      continue;
    }

    objectIds.add(objectId);
    if (hasCaption) objectIdsWithCaption.add(objectId);

    const sampleMatchesCaptionMode =
      sampleCaptionMode === 'any' ||
      (sampleCaptionMode === 'present' && hasCaption) ||
      (sampleCaptionMode === 'missing' && !hasCaption);
    if (sampleMatchesCaptionMode && normalizedSamples.length < sampleSize) {
      const normalized = normalizeNgaArtwork({
        object: objectsById.get(objectId),
        image,
      });
      if (normalized) normalizedSamples.push(normalized);
    }
  }

  return {
    provider: 'nga',
    candidateCount: objectIds.size,
    captionCoverage: {
      total: objectIds.size,
      withInstitutionCaption: objectIdsWithCaption.size,
      missingInstitutionCaption: objectIds.size - objectIdsWithCaption.size,
    },
    normalizedSamples,
    skipped: [],
    notes: [
      'Caption coverage counts published_images.assistivetext, which is image-descriptive text rather than long curatorial essay text.',
    ],
  };
}

const fetchers = {
  met: fetchMetSummary,
  artic: fetchArticSummary,
  cleveland: fetchClevelandSummary,
  nga: fetchNgaSummary,
};

const summaries = [];
for (const provider of providers) {
  const fetcher = fetchers[provider];
  if (!fetcher) {
    throw new Error(`Unsupported provider: ${provider}`);
  }
  summaries.push(await fetcher());
}

const manifest = buildDryRunManifest({
  providers: summaries,
  costOptions: {
    monthlyVectorQueries,
    jinaTilesPerImage,
  },
});
manifest.sampleCaptionMode = sampleCaptionMode;

const json = `${JSON.stringify(manifest, null, 2)}\n`;
if (outPath && outPath !== 'true') {
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, json, 'utf8');
} else {
  process.stdout.write(json);
}
