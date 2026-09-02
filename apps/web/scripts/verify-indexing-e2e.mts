/**
 * End-to-end proof: a real zip, parsed by the real browser client, becomes a
 * searchable collection through the real API Hono app backed by real SQLite.
 *
 * Only two things are faked: the Jina embeddings HTTP call and the R2/Vectorize
 * bindings (which have no local implementation). Everything else — zip reading,
 * CSV mapping, batching, multipart, D1 SQL, job state, vector filtering, the
 * search join — is the shipped code path.
 *
 * Run: pnpm --filter @paillette/web exec tsx <this file>
 */

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import JSZip from 'jszip';

const REPO = '/Users/erniesg/code/erniesg/paillette';
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as any;

const apiApp = (await import(`${REPO}/apps/api/src/index.ts`)).default;
const { getIndexStatus, indexZip, searchIndexedCollection } = await import(
  `${REPO}/apps/web/app/lib/indexing-client.ts`
);

// --- bindings -------------------------------------------------------------

const sqlite = new DatabaseSync(':memory:');
sqlite.exec(readFileSync(`${REPO}/packages/database/src/schema.sql`, 'utf8'));

const DB = {
  prepare(sql: string) {
    let bound: any[] = [];
    const stmt = {
      bind: (...args: any[]) => {
        bound = args.map((v) =>
          v === undefined || v === null
            ? null
            : typeof v === 'boolean'
              ? Number(v)
              : typeof v === 'number' || typeof v === 'string'
                ? v
                : String(v)
        );
        return stmt;
      },
      first: async () => sqlite.prepare(sql).get(...bound) ?? null,
      all: async () => ({ results: sqlite.prepare(sql).all(...bound) }),
      run: async () => ({ meta: { changes: sqlite.prepare(sql).run(...bound).changes } }),
    };
    return stmt;
  },
  batch: async (stmts: any[]) => {
    const out = [];
    for (const s of stmts) out.push(await s.run());
    return out;
  },
};

const r2 = new Map<string, ArrayBuffer>();
const IMAGES = {
  put: async (key: string, value: ArrayBuffer) => {
    r2.set(key, value);
    return { key };
  },
  get: async (key: string) =>
    r2.has(key)
      ? { body: r2.get(key)!, httpEtag: `"${key}"`, writeHttpMetadata: () => {} }
      : null,
};

const makeVectorize = () => {
  const vectors: any[] = [];
  return {
    vectors,
    upsert: async (v: any[]) => void vectors.push(...v),
    query: async (values: number[], opts: any) => ({
      matches: vectors
        .filter((vec) =>
          Object.entries(opts.filter || {}).every(([k, v]) => vec.metadata[k] === v)
        )
        // Rank by cosine similarity against the query vector, so the search
        // result ordering is genuinely produced by the embeddings.
        .map((vec) => ({
          id: vec.id,
          score: vec.values.reduce((s: number, x: number, i: number) => s + x * values[i], 0),
          metadata: vec.metadata,
        }))
        .sort((a, b) => b.score - a.score)
        .slice(0, opts.topK ?? 10),
    }),
  };
};

const VECTORIZE_V2 = makeVectorize();
const CAPTION_VECTORIZE_V2 = makeVectorize();

const env = {
  ENVIRONMENT: 'staging',
  API_VERSION: 'v1',
  EMBEDDING_INDEX_VERSION: 'v2',
  JINA_API_KEY: 'fake',
  JINA_MULTIMODAL_MODEL: 'jina-clip-v2',
  JINA_EMBEDDING_DIMENSIONS: '1024',
  JINA_TEXT_MODEL: 'jina-embeddings-v5-text-small',
  JINA_TEXT_EMBEDDING_DIMENSIONS: '1024',
  DB,
  IMAGES,
  VECTORIZE_V2,
  CAPTION_VECTORIZE_V2,
  CACHE: {
    get: async () => null,
    put: async () => {},
  },
};

// --- fake embedding provider ---------------------------------------------
// Deterministic pseudo-embeddings: text and image inputs that share a concept
// token land near each other, so search ranking is meaningful rather than noise.

const conceptVector = (seed: string) => {
  const values = new Array(1024).fill(0);
  for (let i = 0; i < seed.length; i += 1) {
    values[(seed.charCodeAt(i) * 7 + i * 13) % 1024] += 1;
  }
  const norm = Math.sqrt(values.reduce((s, v) => s + v * v, 0)) || 1;
  return values.map((v) => v / norm);
};

// Map each uploaded image's bytes to the concept its filename encodes.
const imageConcepts = new Map<string, string>();

let jinaCalls = 0;
const realFetch = globalThis.fetch;

globalThis.fetch = (async (input: any, init: any = {}) => {
  const url = String(input?.url ?? input);

  if (url.includes('api.jina.ai')) {
    jinaCalls += 1;
    const body = JSON.parse(String(init.body));
    const value = body.input[0];
    if (typeof value === 'object' && value.image) {
      const concept = imageConcepts.get(value.image.slice(0, 32)) ?? 'unknown';
      return Response.json({ data: [{ embedding: conceptVector(concept) }] });
    }
    return Response.json({ data: [{ embedding: conceptVector(String(value)) }] });
  }

  // Stand in for the Remix proxy hop. The URL rewrite here is exactly the one
  // asserted in apps/web/app/routes/__tests__/public-index-routes.test.ts.
  if (url.startsWith('/api/public-index/')) {
    const rest = url.slice('/api/public-index/'.length);
    const upstream =
      rest === 'jobs'
        ? 'jobs'
        : rest.startsWith('assets/')
          ? rest
          : `jobs/${rest.replace(/\/status$/, '')}`;
    return apiApp.fetch(
      new Request(`https://api.local/api/v1/public-index/${upstream}`, {
        method: init.method ?? 'GET',
        headers: { ...(init.headers ?? {}), 'CF-Connecting-IP': '203.0.113.9' },
        body: init.body,
      }),
      env
    );
  }

  return realFetch(input, init);
}) as typeof fetch;

// --- build a realistic zip ------------------------------------------------

const bytesFor = (concept: string) => {
  const buffer = new Uint8Array(new ArrayBuffer(4096));
  for (let i = 0; i < buffer.length; i += 1) {
    buffer[i] = (concept.charCodeAt(i % concept.length) + i) % 256;
  }
  return buffer;
};

const zip = new JSZip();
zip.file('scans/red_barn_at_dusk.jpg', bytesFor('barn'));
zip.file('scans/harbour_boats.jpg', bytesFor('harbour'));
zip.file('scans/portrait_of_a_woman.jpg', bytesFor('portrait'));
zip.file('scans/notes.txt', 'not an image');
zip.file('__MACOSX/scans/._red_barn_at_dusk.jpg', bytesFor('junk'));
zip.file(
  'metadata.csv',
  'File Name,Work Title,Creator,Date,Materials\n' +
    'red_barn_at_dusk.jpg,"Red Barn, at Dusk",A. Painter,c. 1954,Oil on canvas\n' +
    'harbour_boats.jpg,Harbour Boats,B. Sketcher,1890s,Watercolour\n'
);

const zipBytes = await zip.generateAsync({ type: 'uint8array' });
// JSZip only recognises Blob in a browser context; in Node it takes the raw
// bytes. The File -> JSZip path itself is covered by the jsdom unit tests.
const zipFile = zipBytes as unknown as File;

console.log(`zip built: ${(zipBytes.length / 1024).toFixed(1)} KB`);

// Teach the fake embedder which concept each image's bytes carry.
for (const concept of ['barn', 'harbour', 'portrait']) {
  const b64 = Buffer.from(bytesFor(concept)).toString('base64');
  imageConcepts.set(b64.slice(0, 32), concept);
}

// --- run ------------------------------------------------------------------

const started = Date.now();
const handle = await indexZip(zipFile, {
  collectionName: 'Studio scans 2026',
  orgId: 'nga',
});
const returnedAfter = Date.now() - started;

console.log(`\nindexZip returned in ${returnedAfter}ms ->`, handle);
if (returnedAfter > 3000) throw new Error('indexZip blocked too long');

let status = await getIndexStatus(handle.jobId);
console.log('first poll:', {
  state: status.state,
  processed: status.processed,
  total: status.total,
});

const deadline = Date.now() + 20_000;
while (status.state !== 'complete' && status.state !== 'failed') {
  if (Date.now() > deadline) throw new Error('job did not finish');
  await new Promise((r) => setTimeout(r, 100));
  status = await getIndexStatus(handle.jobId);
}

console.log('\nfinal status:', JSON.stringify(status, null, 2));

// --- verify ---------------------------------------------------------------

const assert = (label: string, condition: boolean, detail?: unknown) => {
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${label}`, detail ?? '');
  if (!condition) process.exitCode = 1;
};

assert('job completed', status.state === 'complete');
assert('3 images indexed', status.processed === 3, status.processed);
assert('exactly one entry reported as skipped', status.errors.length === 1, status.errors);
assert(
  'notes.txt reported as skipped',
  status.errors[0]?.file === 'notes.txt',
  status.errors[0]
);
assert('__MACOSX noise never reached the server', !status.errors.some((e) => e.file.includes('._')));
assert('R2 holds 3 objects', r2.size === 3, r2.size);
assert('image index holds 3 vectors', VECTORIZE_V2.vectors.length === 3);
assert('caption index holds 3 vectors', CAPTION_VECTORIZE_V2.vectors.length === 3);

const rows = sqlite
  .prepare('SELECT title, artist, year, date_text, medium FROM artworks ORDER BY title')
  .all();
console.log('\nartwork rows:', rows);
assert(
  'CSV title applied',
  rows.some((r: any) => r.title === 'Red Barn, at Dusk' && r.artist === 'A. Painter')
);
assert(
  'CSV year parsed from "c. 1954"',
  rows.some((r: any) => r.title === 'Red Barn, at Dusk' && r.year === 1954)
);
assert(
  'CSV year parsed from "1890s"',
  rows.some((r: any) => r.title === 'Harbour Boats' && r.year === 1890)
);
assert(
  'filename title used where the CSV had no row',
  rows.some((r: any) => r.title === 'portrait of a woman')
);

const collection = sqlite
  .prepare('SELECT name, artwork_count FROM collections WHERE id = ?')
  .get(handle.collectionId);
console.log('collection:', collection);
assert('collection counts 3 artworks', collection.artwork_count === 3);

// The payoff: search the collection that did not exist 20 seconds ago.
const search = await searchIndexedCollection(handle.jobId, 'barn', { topK: 3 });
console.log(
  '\nsearch "barn" ->',
  search.results.map((r) => ({ title: r.title, score: r.similarity.toFixed(3), imageUrl: r.imageUrl }))
);
assert('search returns results', search.results.length > 0);
assert(
  'top hit is the barn',
  search.results[0]?.title === 'Red Barn, at Dusk',
  search.results[0]?.title
);
assert(
  'results carry a same-origin image url',
  Boolean(search.results[0]?.imageUrl?.startsWith('/api/public-index/assets/'))
);

// And the image itself is retrievable.
const assetPath = search.results[0]!.imageUrl!;
const assetId = assetPath.split('/').pop()!;
const assetResponse = await apiApp.fetch(
  new Request(`https://api.local/api/v1/public-index/assets/${assetId}`),
  env
);
assert('indexed image is served', assetResponse.status === 200, assetResponse.status);

console.log(`\njina calls: ${jinaCalls} (6 index + 1 query expected)`);
console.log(process.exitCode ? '\nRESULT: FAILURES ABOVE' : '\nRESULT: all checks passed');
