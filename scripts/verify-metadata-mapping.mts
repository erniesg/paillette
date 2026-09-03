/**
 * Live check for the CSV column mapping, against a real deployment.
 *
 * This exists because `pnpm test` stubs the network, and this repository has
 * already shipped two indexing bugs a green suite could not see: a rejected
 * embedding task that indexed zero images while reporting success, and a
 * missing Vectorize metadata index that made every search return nothing. A
 * mapping that produces the right titles in a unit test proves nothing about
 * whether those titles reach the collection.
 *
 * So this drives the *real* client code — the same `parseIndexZip` and
 * `readMetadataCsv` the browser runs — against the real anonymous indexing
 * endpoints, then searches the collection it built and reads the titles back
 * out of the search results.
 *
 * Two archives are built from genuine NGA public-domain JPEGs:
 *
 *   1. Museum-shaped: files named after an object id, and a sidecar with
 *      headers we have never seen (`Object ID`, `Artist Display Name`,
 *      `Object Date`, `Curator Note`) and no filename column at all. Passing
 *      means arbitrary columns survive the round trip.
 *   2. No sidecar: passing means the archive still indexes and the titles come
 *      from the filenames.
 *
 * Usage:  pnpm exec tsx scripts/verify-metadata-mapping.mts [baseUrl]
 *
 * Nothing here deploys, migrates, or mutates anything but the shared anonymous
 * indexing sandbox that `index_zip` already writes to.
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Reached through the workspace that owns it: pnpm isolates dependencies per
// package, and `jszip` belongs to `apps/web`, not to the repo root.
import JSZip from '../apps/web/node_modules/jszip/lib/index.js';

import {
  parseIndexZip,
  readMetadataCsv,
} from '../apps/web/app/lib/indexing-client';

const BASE = process.argv[2] || 'https://paillette-stg.berlayar.ai';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE_ZIP = path.join(ROOT, 'data/samples/sample-art-25-no-metadata.zip');
const IMAGE_COUNT = 6;

const log = (...parts: unknown[]) => console.log(...parts);

let failures = 0;
const check = (label: string, pass: boolean, detail?: unknown) => {
  log(`  ${pass ? 'PASS' : 'FAIL'}  ${label}`);
  if (!pass) {
    failures += 1;
    if (detail !== undefined) log('        got:', JSON.stringify(detail));
  }
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// ---------------------------------------------------------------------------
// Fixtures — real images, invented (but realistic) column headings
// ---------------------------------------------------------------------------

type SourceImage = { name: string; bytes: Uint8Array };

const loadSourceImages = async (): Promise<SourceImage[]> => {
  const zip = await JSZip.loadAsync(await readFile(SOURCE_ZIP));
  const names = Object.keys(zip.files)
    .filter((name) => /\.jpe?g$/i.test(name) && !name.includes('__MACOSX'))
    .sort()
    .slice(0, IMAGE_COUNT);

  return Promise.all(
    names.map(async (name) => ({
      name: name.split('/').pop()!,
      bytes: await zip.files[name]!.async('uint8array'),
    }))
  );
};

/** Titles a filename could never produce, so a wrong mapping cannot fake them. */
const RECORDS = [
  ['437329', 'Cypresses Above a Walled Garden', 'Beatrix Vollmer', '1889'],
  ['436121', 'Study of a Kingfisher at Rest', 'Anselm Roux', '1901/1903'],
  ['459122', 'The Ferry at Low Tide', 'Josephine Marchetti', 'c. 1874'],
  ['210447', 'Interior with a Blue Jug', 'Hendrik Vasse', '1922'],
  ['388014', 'Quarry Road After Rain', 'Marguerite Oyelaran', '1958'],
  ['501993', 'Portrait of the Locksmith', 'Ivo Perenyi', '1836'],
] as const;

const csvCell = (value: string) => `"${value.replace(/"/g, '""')}"`;

/**
 * A sidecar in somebody else's dialect: not one of these headings is a name
 * this codebase chose, and the only join to the images is a bare object id in
 * a column called `Object ID`.
 */
const buildMuseumArchive = async (images: SourceImage[]) => {
  const zip = new JSZip();
  const used = RECORDS.slice(0, images.length);

  used.forEach(([id], index) => {
    zip.file(`${id}.jpg`, images[index]!.bytes);
  });

  const rows = [
    [
      'Object Number',
      'Object ID',
      'Department',
      'Object Name',
      'Title',
      'Artist Display Name',
      'Artist Nationality',
      'Object Date',
      'Medium',
      'Credit Line',
      'Classification',
      'Curator Note',
    ],
    ...used.map(([id, title, artist, date], index) => [
      `19${60 + index}.4.${index + 1}`,
      id,
      'European Paintings',
      'Painting',
      title,
      artist,
      'Dutch',
      date,
      'oil on canvas',
      'Bequest of a private collector',
      'Paintings',
      'internal only',
    ]),
  ];

  zip.file('catalogue.csv', rows.map((row) => row.map(csvCell).join(',')).join('\n'));
  return {
    bytes: await zip.generateAsync({ type: 'uint8array' }),
    expected: used,
  };
};

const buildBareArchive = async (images: SourceImage[]) => {
  const zip = new JSZip();
  images.slice(0, 3).forEach((image, index) => {
    zip.file(`quarry road after rain-${index + 1}.jpg`, image.bytes);
  });
  return zip.generateAsync({ type: 'uint8array' });
};

/**
 * `ZipEntry.read()` hands back a `File` built from a `Blob`, which is a
 * browser path JSZip will not take in Node. The bytes are not what is under
 * test here — the mapping is — so they are pulled straight out of the archive
 * and only `parseIndexZip`'s reading of the sidecar is exercised as written.
 */
const readEntryBytes = async (archive: Uint8Array) => {
  const zip = await JSZip.loadAsync(archive);
  const bytes = new Map<string, Uint8Array>();
  for (const [name, entry] of Object.entries(zip.files)) {
    if ((entry as any).dir) continue;
    bytes.set(name.split('/').pop()!, await (entry as any).async('uint8array'));
  }
  return bytes;
};

// ---------------------------------------------------------------------------
// The real endpoints
// ---------------------------------------------------------------------------

const api = async (path: string, init: RequestInit = {}) => {
  const response = await fetch(`${BASE}${path}`, init);
  const payload = (await response.json()) as {
    success?: boolean;
    data?: any;
    error?: { code?: string; message?: string };
  };
  if (!response.ok || !payload.success) {
    throw new Error(
      `${init.method || 'GET'} ${path} -> ${response.status} ${JSON.stringify(payload.error)}`
    );
  }
  return payload.data;
};

/**
 * The same sequence `indexZip` runs in the browser: plan the job, push the
 * images batch by batch with their mapped metadata, close it, poll.
 */
const runIndexingJob = async (
  archive: Uint8Array,
  collectionName: string,
  { columnMapping }: { columnMapping?: Record<string, string> } = {}
) => {
  const parsed = await parseIndexZip(
    archive as unknown as Blob,
    columnMapping ? { columnMapping } : {}
  );

  log(`\n  sidecar: ${parsed.metadataFile ?? '(none)'}`);
  log(`  mapping: ${parsed.mapping.summary}`);
  log(`  mapped:  ${JSON.stringify(parsed.mapping.mapped)}`);
  log(`  ignored: ${JSON.stringify(parsed.mapping.ignored)}`);

  const job = await api('/api/public-index/jobs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      collectionName,
      orgId: 'webmcp-index',
      source: 'zip',
      files: [
        ...parsed.images.map((entry) => ({ name: entry.name, size: entry.size })),
        ...parsed.skipped,
      ],
    }),
  });

  const bytes = await readEntryBytes(archive);
  const size = Math.max(1, job.batchSize || 4);

  for (let offset = 0; offset < job.accepted.length; offset += size) {
    const names: string[] = job.accepted.slice(offset, offset + size);
    const form = new FormData();
    const batchMetadata: Record<string, unknown> = {};

    for (const name of names) {
      const content = bytes.get(name);
      if (!content) continue;
      form.append('files', new Blob([content], { type: 'image/jpeg' }), name);
      const record = parsed.metadata[name.split(/[\\/]/).pop()!.toLowerCase()];
      if (record) batchMetadata[name] = record;
    }
    form.append('metadata', JSON.stringify(batchMetadata));

    const status = await api(`/api/public-index/${job.jobId}/items`, {
      method: 'POST',
      body: form,
    });
    log(`  uploaded batch: ${status.processed}/${status.total}`);
  }

  await api(`/api/public-index/${job.jobId}/complete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });

  let status: any;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    status = await api(`/api/public-index/${job.jobId}/status`);
    if (status.state === 'complete' || status.state === 'failed') break;
    await sleep(1500);
  }
  log(
    `  job ${job.jobId}: state=${status.state} processed=${status.processed}/${status.total} failed=${status.failed ?? 0}`
  );
  if (status.errors?.length) log('  errors:', JSON.stringify(status.errors.slice(0, 3)));

  return { job, status, parsed };
};

const search = async (jobId: string, query: string, topK = 10) =>
  api(`/api/public-index/${jobId}/search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, topK }),
  });

/**
 * Vectorize accepts an upsert well before it will answer a query about it.
 * Measured on staging on 2026-09-03: a six-image job reported `state:complete,
 * searchable:true` and then returned zero hits for roughly four more minutes.
 * So the first empty result is not a failure — only a persistently empty one
 * is, and the wait is worth reporting because anything driving this on camera
 * hits the same lag.
 */
const searchUntilVisible = async (jobId: string, query: string, topK = 10) => {
  const started = Date.now();
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const hits = await search(jobId, query, topK);
    if (hits.results.length > 0) {
      log(`  searchable after ~${Math.round((Date.now() - started) / 1000)}s`);
      return hits;
    }
    await sleep(10_000);
  }
  log(`  still no hits after ${Math.round((Date.now() - started) / 1000)}s`);
  return search(jobId, query, topK);
};

// ---------------------------------------------------------------------------

const main = async () => {
  log(`Live metadata-mapping check against ${BASE}`);
  const images = await loadSourceImages();
  log(`Loaded ${images.length} real NGA JPEGs from sample-art-25-no-metadata.zip`);

  // -- 0. The mapping, before any network is involved --------------------
  log('\n== Column mapping (offline, real client code) ==');
  const { bytes: museumZip, expected } = await buildMuseumArchive(images);
  const preview = await parseIndexZip(museumZip as unknown as Blob);
  check(
    'identifies "Object ID" as the join to the images',
    preview.mapping.mapped.filename === 'Object ID',
    preview.mapping.mapped
  );
  check(
    'maps Artist Display Name, not Artist Nationality',
    preview.mapping.mapped.artist === 'Artist Display Name',
    preview.mapping.mapped.artist
  );
  check(
    'reports the columns it did not claim',
    ['Department', 'Object Name', 'Artist Nationality'].every((column) =>
      preview.mapping.ignored.includes(column)
    ),
    preview.mapping.ignored
  );
  check(
    'attaches every row to an image',
    Object.keys(preview.metadata).length === expected.length,
    Object.keys(preview.metadata)
  );

  // -- 1. Museum-shaped archive, end to end ------------------------------
  log('\n== 1. Archive with unfamiliar CSV columns ==');
  const name = `Mapping check ${new Date().toISOString().slice(0, 19)}`;
  const museum = await runIndexingJob(museumZip, name);
  check(
    'every image embedded',
    museum.status.state === 'complete' &&
      museum.status.processed === expected.length,
    { state: museum.status.state, processed: museum.status.processed }
  );

  // The proof: search the live collection and read the titles back. These
  // strings exist only in the CSV, so a filename-derived fallback cannot
  // produce them and a dropped column cannot either.
  const hits = await searchUntilVisible(museum.job.jobId, 'a quiet painting', 10);
  log(
    `  search returned ${hits.results.length} hits; titles: ` +
      JSON.stringify(hits.results.map((result: any) => result.title))
  );
  const titles = new Set(hits.results.map((result: any) => result.title));
  const artists = new Set(hits.results.map((result: any) => result.artist));
  check(
    'titles come from the CSV, not the filenames',
    expected.every(([, title]) => titles.has(title)),
    [...titles]
  );
  check(
    'artists come from the CSV',
    expected.every(([, , artist]) => artists.has(artist)),
    [...artists]
  );
  check(
    'no title is a filename fallback',
    ![...titles].some((title) => /^\d+$/.test(String(title))),
    [...titles]
  );

  const dated = hits.results.find(
    (result: any) => result.title === 'The Ferry at Low Tide'
  );
  check('parses a year out of "c. 1874"', dated?.year === 1874, dated?.year);

  const targeted = await search(museum.job.jobId, 'Portrait of the Locksmith', 3);
  check(
    'a CSV title is searchable text, not just a label',
    targeted.results[0]?.title === 'Portrait of the Locksmith',
    targeted.results.map((result: any) => result.title)
  );

  // -- 2. No sidecar at all ----------------------------------------------
  log('\n== 2. Archive with no CSV ==');
  const bare = await runIndexingJob(
    await buildBareArchive(images),
    `No-sidecar check ${new Date().toISOString().slice(0, 19)}`
  );
  check(
    'indexes anyway',
    bare.status.state === 'complete' && bare.status.processed === 3,
    { state: bare.status.state, processed: bare.status.processed }
  );
  check(
    'reports "no sidecar" rather than an error',
    bare.parsed.mapping.needsReview === false &&
      bare.parsed.mapping.summary.includes('titled from its filename'),
    bare.parsed.mapping.summary
  );

  const bareHits = await searchUntilVisible(bare.job.jobId, 'quarry road after rain', 5);
  log(
    `  search returned ${bareHits.results.length} hits; titles: ` +
      JSON.stringify(bareHits.results.map((result: any) => result.title))
  );
  check(
    'titles are derived from the filenames',
    bareHits.results.length > 0 &&
      bareHits.results.every((result: any) =>
        /quarry road after rain/i.test(String(result.title))
      ),
    bareHits.results.map((result: any) => result.title)
  );

  // -- 3. A mapping supplied by the caller -------------------------------
  log('\n== 3. Caller-supplied column mapping (offline) ==');
  const supplied = readMetadataCsv(
    'pic,zzz,qqq\n437329.jpg,Mostly Harmless,Q. Anon\n',
    {
      knownFilenames: ['437329.jpg'],
      columnMapping: { qqq: 'artist', zzz: 'title' },
    }
  );
  check(
    'an explicit mapping overrides the rules',
    supplied.items['437329.jpg']?.artist === 'Q. Anon' &&
      supplied.items['437329.jpg']?.title === 'Mostly Harmless',
    supplied.items
  );
  check('and is reported as supplied', supplied.mapping.source === 'supplied');

  log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
};

main().catch((error) => {
  console.error('\nverification aborted:', error);
  process.exit(1);
});
