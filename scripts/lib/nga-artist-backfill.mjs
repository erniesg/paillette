import { createHash } from 'node:crypto';

import { buildNgaArtistUpdateSql } from './nga-structured-search-backfill.mjs';

export const NGA_SOURCE_COMMIT = '79d114c2186ca38af27a9478717f1e509d799495';
export const FULL_STAGED_COUNT = 63_253;
export const PILOT_OBJECT_IDS = Object.freeze([
  '131994',
  '110821',
  '11236',
  '38',
  '579',
]);
export const STAGING_D1_DATABASE = 'paillette-db-stg';
export const STAGING_IMAGE_VECTOR_INDEX = 'paillette-embeddings-v2-stg';
export const STAGING_ORG_ID = 'eabbf000-708e-4d4c-8ac8-966b59d4fcac';

export function assertStagingBackfillIdentity(expectedOrgId) {
  if (expectedOrgId !== STAGING_ORG_ID) {
    throw new Error(
      `expected organization must be the staging organization ${STAGING_ORG_ID}`
    );
  }
}

export const NGA_SOURCE_HEADERS = Object.freeze({
  'objects.csv':
    'objectid,uuid,accessioned,accessionnum,locationid,title,displaydate,beginyear,endyear,visualbrowsertimespan,medium,dimensions,inscription,markings,attributioninverted,attribution,provenancetext,creditline,classification,subclassification,visualbrowserclassification,parentid,isvirtual,departmentabbr,portfolio,series,volume,watermarks,lastdetectedmodification,wikidataid,customprinturl',
  'published_images.csv':
    'uuid,iiifurl,iiifthumburl,viewtype,sequence,width,height,maxpixels,openaccess,created,modified,depictstmsobjectid,assistivetext',
  'objects_constituents.csv':
    'objectid,constituentid,displayorder,roletype,role,prefix,suffix,displaydate,beginyear,endyear,country,zipcode',
  'constituents.csv':
    'constituentid,uuid,ulanid,preferreddisplayname,forwarddisplayname,lastname,displaydate,artistofngaobject,beginyear,endyear,visualbrowsertimespan,nationality,visualbrowsernationality,constituenttype,wikidataid',
  'constituents_altnames.csv':
    'altnameid,constituentid,lastname,displayname,forwarddisplayname,nametype',
});

export const EXPECTED_NGA_SOURCE_SHA256 = Object.freeze({
  'objects.csv':
    '0435ee2468c5043046daef4a0c39badb586d52d4ed24712287423a4897961d67',
  'published_images.csv':
    '8fb22d56ba09490937fb54ff07560c18ca4eb3468c24aa91167eeb4e9cc3a16d',
  'objects_constituents.csv':
    'a460accc402ad8b0130e3b108f9bc9d03ac9621721db9ef713f944205eba6c1d',
  'constituents.csv':
    '090ed9c7d71a3fb83660bbf0e52d6b6a133eab60bf87b4115a4b36bb9042d3b9',
  'constituents_altnames.csv':
    '129547888f858aa15d951dff27c6761abd308357a1c0787438ded8091964a44f',
});

export const sha256 = (value) =>
  createHash('sha256').update(value).digest('hex');

export const canonicalJson = (value) => {
  const normalize = (item) => {
    if (Array.isArray(item)) return item.map(normalize);
    if (item && typeof item === 'object') {
      return Object.fromEntries(
        Object.keys(item)
          .sort()
          .map((key) => [key, normalize(item[key])])
      );
    }
    return item;
  };
  return JSON.stringify(normalize(value));
};

export function validateNgaSourceFiles(entries, sourceCommit) {
  if (sourceCommit !== NGA_SOURCE_COMMIT) {
    throw new Error(`source commit must be pinned to ${NGA_SOURCE_COMMIT}`);
  }
  const filenames = Object.keys(EXPECTED_NGA_SOURCE_SHA256);
  if (
    Object.keys(entries || {}).length !== filenames.length ||
    filenames.some((filename) => !entries?.[filename]?.sha256)
  ) {
    throw new Error('all five NGA source SHA-256 digests are required');
  }
  for (const filename of filenames) {
    const entry = entries[filename];
    if (entry.commit !== sourceCommit) {
      throw new Error(`mixed source commit for ${filename}`);
    }
    if (entry.sha256 !== EXPECTED_NGA_SOURCE_SHA256[filename]) {
      throw new Error(`source SHA-256 mismatch for ${filename}`);
    }
    if (entry.header !== NGA_SOURCE_HEADERS[filename]) {
      throw new Error(`NGA source header drift for ${filename}`);
    }
  }
  return entries;
}

const objectIdFromArtworkId = (id) => {
  const match = /^open-access-art:nga:(\d+)$/.exec(String(id || ''));
  if (!match) throw new Error(`invalid staged NGA artwork ID: ${id}`);
  return match[1];
};

export function validateStagedNgaScope(
  stagedRecords,
  { phase, sourceCandidateIds }
) {
  if (!['pilot', 'full'].includes(phase)) {
    throw new Error('--phase must be pilot or full');
  }
  const ids = [];
  const seen = new Set();
  for (const record of stagedRecords || []) {
    const objectId = objectIdFromArtworkId(record?.id);
    if (seen.has(objectId)) throw new Error(`duplicate staged ID ${objectId}`);
    seen.add(objectId);
    ids.push(objectId);
  }

  if (phase === 'pilot') {
    if (ids.length !== PILOT_OBJECT_IDS.length) {
      throw new Error('pilot must contain exactly five staged IDs');
    }
    if (
      ids.some((id) => !PILOT_OBJECT_IDS.includes(id)) ||
      PILOT_OBJECT_IDS.some((id) => !seen.has(id))
    ) {
      throw new Error('pilot scope differs from the approved pilot allowlist');
    }
  } else if (ids.length !== FULL_STAGED_COUNT) {
    throw new Error(`full scope must contain exactly 63,253 staged IDs`);
  }

  const candidates = new Set(sourceCandidateIds || []);
  const missing = ids.filter((id) => !candidates.has(id));
  if (missing.length) {
    throw new Error(`staged ID absent from pinned source: ${missing[0]}`);
  }
  if (phase === 'full') {
    const additions = [...candidates].filter((id) => !seen.has(id));
    if (additions.length) {
      throw new Error(
        `upstream addition outside staged membership: ${additions[0]}`
      );
    }
  }

  return phase === 'pilot'
    ? [...PILOT_OBJECT_IDS]
    : [...ids].sort((a, b) => Number(a) - Number(b));
}

export function enrichNgaArtistVector(vector, record) {
  if (!Array.isArray(vector?.values)) {
    throw new Error(`vector ${vector?.id || '<unknown>'} is missing values`);
  }
  if (!/^\d+$/.test(String(record?.primaryArtistId || ''))) {
    throw new Error('vector enrichment requires a decimal primaryArtistId');
  }
  const rollback = structuredClone(vector);
  const enriched = structuredClone(vector);
  enriched.metadata = {
    ...(enriched.metadata || {}),
    primaryArtistId: String(record.primaryArtistId),
  };
  const originalValuesSha256 = sha256(canonicalJson(rollback.values));
  const enrichedValuesSha256 = sha256(canonicalJson(enriched.values));
  if (originalValuesSha256 !== enrichedValuesSha256) {
    throw new Error(`vector values changed for ${vector.id}`);
  }
  return {
    enriched,
    rollback,
    originalValuesSha256,
    enrichedValuesSha256,
  };
}

const vectorArtworkId = (vector) =>
  String(vector?.metadata?.artworkId || vector?.id || '');

export function buildNgaBackfillArtifacts({
  phase,
  expectedOrgId,
  stagedRecords,
  sourceCandidateIds,
  artistMetadata,
  vectors,
}) {
  const orderedIds = validateStagedNgaScope(stagedRecords, {
    phase,
    sourceCandidateIds,
  });
  const stagedByObjectId = new Map(
    stagedRecords.map((record) => [objectIdFromArtworkId(record.id), record])
  );
  const stagedArtworkIds = new Set(stagedRecords.map((record) => record.id));
  const vectorsByArtworkId = new Map();
  for (const vector of vectors || []) {
    const artworkId = vectorArtworkId(vector);
    if (String(vector?.id || '') !== artworkId) {
      throw new Error(`vector ID does not match artwork ID ${artworkId}`);
    }
    if (vectorsByArtworkId.has(artworkId)) {
      throw new Error(`duplicate vector ID ${artworkId}`);
    }
    vectorsByArtworkId.set(artworkId, vector);
  }

  const mapping = [];
  const sql = [];
  const enrichedVectors = [];
  const rollbackVectors = [];
  const vectorValueHashes = [];
  for (const objectId of orderedIds) {
    const metadata = artistMetadata.get(objectId);
    if (!metadata) {
      throw new Error(`missing artist relationship for ${objectId}`);
    }
    const staged = stagedByObjectId.get(objectId);
    if (staged.org_id !== expectedOrgId) {
      throw new Error(`unexpected organization for ${staged.id}`);
    }
    if (staged.custom_metadata?.provider !== 'nga') {
      throw new Error(`unexpected provider for ${staged.id}`);
    }
    const record = {
      id: staged.id,
      primaryArtistId: metadata.primaryArtistId,
      customMetadata: {
        ngaArtists: {
          sourceCommit: NGA_SOURCE_COMMIT,
          relationships: metadata.relationships,
        },
      },
      fieldSources: { primary_artist_id: 'nga.objects_constituents' },
    };
    const vector = vectorsByArtworkId.get(staged.id);
    if (!vector) throw new Error(`vector-ID gap for ${staged.id}`);
    const enriched = enrichNgaArtistVector(vector, record);
    mapping.push(record);
    sql.push(buildNgaArtistUpdateSql(record, expectedOrgId));
    enrichedVectors.push(enriched.enriched);
    rollbackVectors.push(enriched.rollback);
    vectorValueHashes.push({
      id: staged.id,
      originalSha256: enriched.originalValuesSha256,
      enrichedSha256: enriched.enrichedValuesSha256,
    });
  }
  const extras = [...vectorsByArtworkId.keys()].filter(
    (id) => !stagedArtworkIds.has(id)
  );
  if (extras.length) throw new Error(`unexpected vector ID ${extras[0]}`);

  return { mapping, sql, enrichedVectors, rollbackVectors, vectorValueHashes };
}
