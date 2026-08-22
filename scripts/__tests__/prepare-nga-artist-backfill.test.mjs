import assert from 'node:assert/strict';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
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
  publishPreparedArtifacts,
  sha256,
  validateNgaSourceFiles,
  validatePreflightBindings,
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

const createPreflight = ({ phase = 'pilot', suffix = '' } = {}) => {
  const root = mkdtempSync(join(tmpdir(), `nga-preflight-${suffix}`));
  temporaryDirectories.push(root);
  const vectorDirectory = join(root, 'image-vectors');
  mkdirSync(vectorDirectory);
  const ids = PILOT_OBJECT_IDS.map((id) => `open-access-art:nga:${id}`);
  const idsText = `${JSON.stringify(ids)}\n`;
  const stagedText = `${JSON.stringify(ids.map((id) => stagedRecord(id.split(':').at(-1))))}\n`;
  const vectorText = `${ids
    .map((id) =>
      JSON.stringify({
        id,
        values: [0.1, 0.2],
        metadata: { artworkId: id, provider: 'nga' },
      })
    )
    .join('\n')}\n`;
  const idsPath = join(root, 'ids.json');
  const stagedPath = join(root, 'staged-nga-records.json');
  const vectorPath = join(vectorDirectory, 'original-0001.ndjson');
  writeFileSync(idsPath, idsText);
  writeFileSync(stagedPath, stagedText);
  writeFileSync(vectorPath, vectorText);
  const manifest = {
    schemaVersion: 1,
    environment: 'staging',
    phase,
    expectedOrgId: ORG_ID,
    resources: {
      d1Database: 'paillette-db-stg',
      imageVectorIndex: 'paillette-embeddings-v2-stg',
    },
    counts: { ids: 5, stagedRecords: 5, imageVectors: 5 },
    inputs: {
      ids: { path: 'ids.json', sha256: sha256(idsText), count: 5 },
      stagedRecords: {
        path: 'staged-nga-records.json',
        sha256: sha256(stagedText),
        count: 5,
      },
      imageVectors: [
        {
          path: 'image-vectors/original-0001.ndjson',
          sha256: sha256(vectorText),
          count: 5,
        },
      ],
    },
  };
  const manifestPath = join(root, 'preflight-manifest.json');
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return {
    root,
    idsPath,
    stagedPath,
    vectorDirectory,
    vectorPath,
    manifestPath,
  };
};

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

test('binds every preparation input to its hashed preflight manifest', async () => {
  const preflight = createPreflight();
  const bindings = await validatePreflightBindings({
    phase: 'pilot',
    expectedOrgId: ORG_ID,
    preflightManifestPaths: [preflight.manifestPath],
    stagedRecordPaths: [preflight.stagedPath],
    imageVectorPaths: [preflight.vectorDirectory],
  });

  assert.equal(bindings.length, 1);
  assert.match(bindings[0].manifestSha256, /^[a-f0-9]{64}$/);
  assert.equal(
    bindings[0].stagedRecords.sha256,
    sha256(readFileSync(preflight.stagedPath))
  );
  assert.equal(
    bindings[0].imageVectors[0].sha256,
    sha256(readFileSync(preflight.vectorPath))
  );

  writeFileSync(preflight.stagedPath, '[]\n');
  await assert.rejects(
    validatePreflightBindings({
      phase: 'pilot',
      expectedOrgId: ORG_ID,
      preflightManifestPaths: [preflight.manifestPath],
      stagedRecordPaths: [preflight.stagedPath],
      imageVectorPaths: [preflight.vectorDirectory],
    }),
    /preflight.*SHA-256|digest mismatch/i
  );
});

test('rejects unmanifested or mixed repeatable preparation inputs', async () => {
  const first = createPreflight({ suffix: 'first-' });
  const second = createPreflight({ suffix: 'second-' });
  await assert.rejects(
    validatePreflightBindings({
      phase: 'pilot',
      expectedOrgId: ORG_ID,
      preflightManifestPaths: [first.manifestPath],
      stagedRecordPaths: [first.stagedPath, second.stagedPath],
      imageVectorPaths: [first.vectorDirectory],
    }),
    /unmanifested staged-records|input set/i
  );
});

test('rejects a hash-confirmed preflight whose staged IDs differ from ids.json', async () => {
  const preflight = createPreflight();
  const staged = JSON.parse(readFileSync(preflight.stagedPath, 'utf8'));
  staged[0].id = 'open-access-art:nga:999';
  const stagedText = `${JSON.stringify(staged)}\n`;
  writeFileSync(preflight.stagedPath, stagedText);
  const manifest = JSON.parse(readFileSync(preflight.manifestPath, 'utf8'));
  manifest.inputs.stagedRecords.sha256 = sha256(stagedText);
  writeFileSync(
    preflight.manifestPath,
    `${JSON.stringify(manifest, null, 2)}\n`
  );

  await assert.rejects(
    validatePreflightBindings({
      phase: 'pilot',
      expectedOrgId: ORG_ID,
      preflightManifestPaths: [preflight.manifestPath],
      stagedRecordPaths: [preflight.stagedPath],
      imageVectorPaths: [preflight.vectorDirectory],
    }),
    /preflight.*ID.*(?:gap|mismatch|differ)/i
  );
});

test('publishes atomically and leaves no partial final directory after failure', async () => {
  const parent = mkdtempSync(join(tmpdir(), 'nga-atomic-publication-'));
  temporaryDirectories.push(parent);
  const output = join(parent, 'artifacts');
  const valid = 'complete\n';
  const invalid = 'will-fail-verification\n';

  await assert.rejects(
    publishPreparedArtifacts(output, [
      { path: 'mapping.json', content: valid, sha256: sha256(valid) },
      {
        path: 'vectors/chunk.ndjson',
        content: invalid,
        sha256: '0'.repeat(64),
      },
    ]),
    /generated artifact SHA-256 mismatch/i
  );
  assert.equal(existsSync(output), false);

  await publishPreparedArtifacts(output, [
    { path: 'mapping.json', content: valid, sha256: sha256(valid) },
    { path: 'vectors/chunk.ndjson', content: invalid, sha256: sha256(invalid) },
  ]);
  assert.equal(readFileSync(join(output, 'mapping.json'), 'utf8'), valid);
  assert.equal(
    readFileSync(join(output, 'vectors', 'chunk.ndjson'), 'utf8'),
    invalid
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
