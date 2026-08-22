import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, test } from 'node:test';

import {
  EXPECTED_NGA_SOURCE_SHA256,
  NGA_SOURCE_COMMIT,
  PILOT_OBJECT_IDS,
  STAGING_ORG_ID,
  assertStagingBackfillIdentity,
  buildNgaBackfillArtifacts,
  enrichNgaArtistVector,
  validateNgaSourceFiles,
  validateStagedNgaScope,
} from '../lib/nga-artist-backfill.mjs';
import {
  buildNgaArtistUpdateSql,
  sqlJsonLiteral,
} from '../lib/nga-structured-search-backfill.mjs';

const ORG_ID = 'eabbf000-708e-4d4c-8ac8-966b59d4fcac';
const temporaryDirectories = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

const stagedRecord = (objectId, overrides = {}) => ({
  id: `open-access-art:nga:${objectId}`,
  org_id: ORG_ID,
  custom_metadata: { provider: 'nga', retained: { exact: true } },
  field_sources: { title: 'nga.objects' },
  ...overrides,
});

const artistRecord = (objectId, primaryArtistId = '1364') => ({
  id: `open-access-art:nga:${objectId}`,
  primaryArtistId,
  customMetadata: {
    ngaArtists: { sourceCommit: NGA_SOURCE_COMMIT, relationships: [] },
  },
  fieldSources: { primary_artist_id: 'nga.objects_constituents' },
});

test('guards every artist update by org, provider, prefix, and exact id', () => {
  const sql = buildNgaArtistUpdateSql(artistRecord('131994'), ORG_ID);

  assert.match(sql, new RegExp(`org_id = '${ORG_ID}'`));
  assert.match(sql, /json_extract\(custom_metadata, '\$\.provider'\) = 'nga'/);
  assert.match(sql, /id LIKE 'open-access-art:nga:%'/);
  assert.match(sql, /id = 'open-access-art:nga:131994'/);
  assert.match(sql, /primary_artist_id IS NOT '1364'/);
  assert.match(
    sql,
    /json_extract\(custom_metadata, '\$\.ngaArtists'\) IS NOT json\('/
  );
  assert.match(sql, /json_patch\(coalesce\(custom_metadata, '\{\}'\), json\('/);
  assert.match(sql, /json_patch\(coalesce\(field_sources, '\{\}'\), json\('/);
  assert.doesNotMatch(
    sql,
    /\b(?:title|artist|date_text|image_url|thumbnail_url|rights|asset_id)\s*=/
  );
});

test('escapes JSON SQL literals without changing the JSON value', () => {
  const literal = sqlJsonLiteral({ role: "artist's workshop" });
  assert.equal(
    literal,
    `'${JSON.stringify({ role: "artist's workshop" }).replaceAll("'", "''")}'`
  );
});

test('changes only image-vector primaryArtistId and hashes complete values', () => {
  const source = {
    id: 'open-access-art:nga:131994',
    values: [0.1, -0.25, 0.75],
    metadata: {
      provider: 'nga',
      artworkId: 'open-access-art:nga:131994',
      keep: ['x'],
    },
  };
  const snapshot = structuredClone(source);

  const result = enrichNgaArtistVector(source, artistRecord('131994'));

  assert.deepEqual(source, snapshot);
  assert.deepEqual(result.rollback, snapshot);
  assert.deepEqual(result.enriched, {
    ...snapshot,
    metadata: { ...snapshot.metadata, primaryArtistId: '1364' },
  });
  assert.equal(result.originalValuesSha256, result.enrichedValuesSha256);
  assert.match(result.originalValuesSha256, /^[a-f0-9]{64}$/);
});

test('requires the pinned commit, five exact digests, and literal official headers', () => {
  const entries = Object.fromEntries(
    Object.entries(EXPECTED_NGA_SOURCE_SHA256).map(([filename, sha256]) => [
      filename,
      { commit: NGA_SOURCE_COMMIT, sha256, header: undefined },
    ])
  );
  for (const [filename, entry] of Object.entries(entries)) {
    entry.header = {
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
    }[filename];
  }

  assert.doesNotThrow(() => validateNgaSourceFiles(entries, NGA_SOURCE_COMMIT));
  const missing = structuredClone(entries);
  delete missing['objects.csv'];
  assert.throws(
    () => validateNgaSourceFiles(missing, NGA_SOURCE_COMMIT),
    /all five.*SHA-256/i
  );
  const mixed = structuredClone(entries);
  mixed['objects.csv'].commit = '0'.repeat(40);
  assert.throws(
    () => validateNgaSourceFiles(mixed, NGA_SOURCE_COMMIT),
    /mixed.*commit/i
  );
  const drifted = structuredClone(entries);
  drifted['objects.csv'].header += ',fabricated';
  assert.throws(
    () => validateNgaSourceFiles(drifted, NGA_SOURCE_COMMIT),
    /header drift/i
  );
});

test('pilot scope is exactly the approved five IDs', () => {
  const records = PILOT_OBJECT_IDS.map(stagedRecord);
  const sourceCandidateIds = new Set(PILOT_OBJECT_IDS);
  assert.deepEqual(
    validateStagedNgaScope(records, { phase: 'pilot', sourceCandidateIds }),
    [...PILOT_OBJECT_IDS]
  );
  assert.throws(
    () =>
      validateStagedNgaScope(records.slice(0, 4), {
        phase: 'pilot',
        sourceCandidateIds,
      }),
    /exactly.*five/i
  );
  assert.throws(
    () =>
      validateStagedNgaScope([...records.slice(0, -1), stagedRecord('999')], {
        phase: 'pilot',
        sourceCandidateIds: new Set([...PILOT_OBJECT_IDS, '999']),
      }),
    /pilot allowlist/i
  );
});

test('preparation rejects every non-staging organization identity', () => {
  assert.doesNotThrow(() => assertStagingBackfillIdentity(STAGING_ORG_ID));
  assert.throws(
    () => assertStagingBackfillIdentity('704e8ccf-eebb-4433-96a4-5196b2862ad7'),
    /staging organization/i
  );
});

test('full scope rejects duplicate IDs, incomplete coverage, and upstream additions', () => {
  const ids = Array.from({ length: 63_253 }, (_, index) => String(index + 1));
  const sourceCandidateIds = new Set(ids);
  const records = ids.map(stagedRecord);
  assert.equal(
    validateStagedNgaScope(records, { phase: 'full', sourceCandidateIds })
      .length,
    63_253
  );
  assert.throws(
    () =>
      validateStagedNgaScope([...records.slice(0, -1), records[0]], {
        phase: 'full',
        sourceCandidateIds,
      }),
    /duplicate staged ID/i
  );
  assert.throws(
    () =>
      validateStagedNgaScope(records.slice(0, -1), {
        phase: 'full',
        sourceCandidateIds,
      }),
    /63,253/
  );
  assert.throws(
    () =>
      validateStagedNgaScope(records, {
        phase: 'full',
        sourceCandidateIds: new Set([...ids, '999999']),
      }),
    /upstream addition/i
  );
});

test('artifact construction fails before output for unresolved artists and vector gaps', () => {
  const outputDirectory = mkdtempSync(
    join(tmpdir(), 'nga-backfill-output-parent-')
  );
  temporaryDirectories.push(outputDirectory);
  const target = join(outputDirectory, 'artifacts');
  const records = PILOT_OBJECT_IDS.map(stagedRecord);
  const vectors = PILOT_OBJECT_IDS.slice(0, -1).map((id) => ({
    id: `open-access-art:nga:${id}`,
    values: [0.1],
    metadata: { provider: 'nga' },
  }));

  assert.throws(
    () =>
      buildNgaBackfillArtifacts({
        phase: 'pilot',
        expectedOrgId: ORG_ID,
        stagedRecords: records,
        sourceCandidateIds: new Set(PILOT_OBJECT_IDS),
        artistMetadata: new Map(),
        vectors,
      }),
    /missing artist relationship/i
  );
  const artistMetadata = new Map(
    PILOT_OBJECT_IDS.map((id) => [
      id,
      { primaryArtistId: id, relationships: [] },
    ])
  );
  assert.throws(
    () =>
      buildNgaBackfillArtifacts({
        phase: 'pilot',
        expectedOrgId: ORG_ID,
        stagedRecords: records,
        sourceCandidateIds: new Set(PILOT_OBJECT_IDS),
        artistMetadata,
        vectors,
      }),
    /vector-ID gap/i
  );
  assert.equal(existsSync(target), false);
});
