/**
 * Regenerates data/samples/*.zip from live open-access museum APIs.
 *
 * Run (needs a workspace package's node_modules for `jszip`/`tsx` — this
 * script itself adds no new dependency):
 *
 *   corepack pnpm --filter @paillette/web exec tsx ../../scripts/build-sample-datasets.ts [sources...]
 *
 * With no arguments, regenerates every source with a working fetcher and no
 * missing prerequisite (see SOURCES below). Pass source ids to build a
 * subset, e.g. `... build-sample-datasets.ts met cleveland`.
 *
 * Each source:
 *  - queries its collection API for candidate works
 *  - keeps only records the API itself flags as public domain / CC0 on that
 *    record (never assumed from the collection as a whole)
 *  - deterministically samples `count` of them (seeded RNG), stratified by
 *    classification and capped at 3 works per artist, mirroring the
 *    selection method documented for the existing NGA zips
 *  - downloads each image and a metadata.csv sidecar (column format matches
 *    `apps/web/app/lib/indexing-client.ts`'s `parseMetadataCsv`)
 *  - writes `sample-<source>-<count>.zip` into data/samples/
 *
 * Verification (unzip -t, image decode, CSV/entry cross-check, and parsing
 * the CSV with the app's real, unmodified `parseMetadataCsv`) is a separate
 * step — see data/samples/README.md.
 */

import JSZip from 'jszip';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.resolve(__dirname, '../data/samples');

const USER_AGENT =
  'paillette-sample-dataset-builder/1.0 (+https://github.com/erniesg/paillette)';

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

type Candidate = {
  /** Stable id from the source API, used for the local filename. */
  sourceId: string;
  title: string;
  artist: string;
  /** Human-readable date text; must contain a parseable year (see firstYear
   * in indexing-client.ts) or downstream `year` extraction silently fails. */
  yearText: string;
  medium: string;
  classification: string;
  creditLine: string;
  accessionNumber: string;
  sourceUrl: string;
  imageUrl: string;
};

type SourceConfig = {
  id: string;
  label: string;
  count: number;
  withMetadata: boolean;
  licenceUrl: string;
  licenceName: string;
  fetchCandidates: () => Promise<Candidate[]>;
};

// ---------------------------------------------------------------------------
// Deterministic sampling (seeded RNG, no dependency)
// ---------------------------------------------------------------------------

function mulberry32(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function seededShuffle<T>(items: T[], rng: () => number): T[] {
  const result = items.slice();
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [result[i], result[j]] = [result[j]!, result[i]!];
  }
  return result;
}

/** Round-robins across classification buckets, capping 3 picks per artist. */
function selectStratified(
  candidates: Candidate[],
  count: number,
  seed: number
): Candidate[] {
  const rng = mulberry32(seed);
  const shuffled = seededShuffle(candidates, rng);

  const byClass = new Map<string, Candidate[]>();
  for (const candidate of shuffled) {
    const key = candidate.classification || 'Unclassified';
    const list = byClass.get(key) ?? [];
    list.push(candidate);
    byClass.set(key, list);
  }

  const classes = [...byClass.keys()];
  const pointers = new Map(classes.map((key) => [key, 0]));
  const artistCounts = new Map<string, number>();
  const picked: Candidate[] = [];

  let madeProgress = true;
  while (picked.length < count && madeProgress) {
    madeProgress = false;
    for (const key of classes) {
      if (picked.length >= count) break;
      const list = byClass.get(key)!;
      let idx = pointers.get(key)!;
      while (idx < list.length) {
        const candidate = list[idx]!;
        idx += 1;
        const artistKey = candidate.artist.trim().toLowerCase();
        const artistCount = artistCounts.get(artistKey) ?? 0;
        if (artistCount < 3) {
          artistCounts.set(artistKey, artistCount + 1);
          picked.push(candidate);
          madeProgress = true;
          break;
        }
      }
      pointers.set(key, idx);
    }
  }

  return picked;
}

// ---------------------------------------------------------------------------
// Fetch helpers
// ---------------------------------------------------------------------------

/**
 * Mirrors indexing-client.ts's `firstYear`: a bare digit somewhere in the
 * text (e.g. "12th century") is not enough — the app needs a standalone
 * 3-4 digit run, or `year` silently comes back undefined.
 */
function hasParseableYear(text: string): boolean {
  return /(?<!\d)\d{3,4}(?!\d)/.test(text);
}

/** Strips query-string secrets (e.g. Rijksmuseum's `key=`) before an error message can log a URL. */
function redactUrl(url: string): string {
  return url.replace(/([?&]key=)[^&]+/i, '$1***');
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    headers: { 'user-agent': USER_AGENT, accept: 'application/json' },
  });
  if (!response.ok) {
    throw new Error(`GET ${redactUrl(url)} -> HTTP ${response.status}`);
  }
  return (await response.json()) as T;
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const workers = Array.from(
    { length: Math.min(limit, items.length) },
    async () => {
      while (cursor < items.length) {
        const index = cursor;
        cursor += 1;
        results[index] = await fn(items[index]!, index);
      }
    }
  );
  await Promise.all(workers);
  return results;
}

// ---------------------------------------------------------------------------
// Art Institute of Chicago
// ---------------------------------------------------------------------------

type ArticArtwork = {
  id: number;
  title: string | null;
  artist_display: string | null;
  image_id: string | null;
  is_public_domain: boolean;
  date_display: string | null;
  medium_display: string | null;
  classification_title: string | null;
  credit_line: string | null;
};

type ArticResponse = {
  data: ArticArtwork[];
  config: { iiif_url: string };
  pagination: { total_pages: number };
};

async function fetchArtic(): Promise<Candidate[]> {
  const fields =
    'id,title,artist_display,image_id,is_public_domain,date_display,medium_display,classification_title,credit_line';
  const candidates: Candidate[] = [];
  let iiifUrl = 'https://www.artic.edu/iiif/2';

  for (let page = 1; page <= 6 && candidates.length < 400; page += 1) {
    const url = `https://api.artic.edu/api/v1/artworks?fields=${fields}&limit=100&page=${page}`;
    const body = await fetchJson<ArticResponse>(url);
    iiifUrl = body.config.iiif_url;

    for (const item of body.data) {
      if (!item.is_public_domain || !item.image_id) continue;
      if (!item.title || !item.medium_display || !item.classification_title)
        continue;
      if (!item.date_display || !hasParseableYear(item.date_display)) continue;

      const artist =
        (item.artist_display ?? '').split('\n')[0]?.trim() || 'Unknown';
      candidates.push({
        sourceId: String(item.id),
        title: item.title,
        artist,
        yearText: item.date_display,
        medium: item.medium_display,
        classification: item.classification_title,
        creditLine: item.credit_line ?? '',
        accessionNumber: '',
        sourceUrl: `https://www.artic.edu/artworks/${item.id}`,
        imageUrl: `${iiifUrl}/${item.image_id}/full/!1200,1200/0/default.jpg`,
      });
    }
  }

  return candidates;
}

// ---------------------------------------------------------------------------
// The Metropolitan Museum of Art
// ---------------------------------------------------------------------------

type MetObject = {
  objectID: number;
  title: string | null;
  artistDisplayName: string | null;
  culture: string | null;
  objectDate: string | null;
  objectBeginDate: number | null;
  medium: string | null;
  classification: string | null;
  isPublicDomain: boolean;
  creditLine: string | null;
  accessionNumber: string | null;
  objectURL: string | null;
  primaryImageSmall: string | null;
  primaryImage: string | null;
};

async function fetchMet(): Promise<Candidate[]> {
  const terms = ['painting', 'drawing', 'print', 'sculpture', 'photograph'];
  const ids = new Set<number>();

  for (const term of terms) {
    const url = `https://collectionapi.metmuseum.org/public/collection/v1/search?q=${term}&hasImages=true&isPublicDomain=true`;
    const body = await fetchJson<{ objectIDs: number[] | null }>(url);
    for (const id of body.objectIDs ?? []) ids.add(id);
  }

  const idList = [...ids].slice(0, 500);
  const objects = await mapWithConcurrency(idList, 8, async (id) => {
    try {
      return await fetchJson<MetObject>(
        `https://collectionapi.metmuseum.org/public/collection/v1/objects/${id}`
      );
    } catch {
      return null;
    }
  });

  const candidates: Candidate[] = [];
  for (const item of objects) {
    if (!item || !item.isPublicDomain) continue;
    const imageUrl = item.primaryImageSmall || item.primaryImage;
    if (!imageUrl || !item.title || !item.medium || !item.classification)
      continue;

    let yearText = item.objectDate?.trim() || '';
    if (!hasParseableYear(yearText) && item.objectBeginDate) {
      yearText = yearText
        ? `${yearText} (${item.objectBeginDate})`
        : String(item.objectBeginDate);
    }
    if (!yearText || !hasParseableYear(yearText)) continue;

    candidates.push({
      sourceId: String(item.objectID),
      title: item.title,
      artist:
        item.artistDisplayName?.trim() || item.culture?.trim() || 'Unknown',
      yearText,
      medium: item.medium,
      classification: item.classification,
      creditLine: item.creditLine ?? '',
      accessionNumber: item.accessionNumber ?? '',
      sourceUrl:
        item.objectURL ||
        `https://www.metmuseum.org/art/collection/search/${item.objectID}`,
      imageUrl,
    });
  }

  return candidates;
}

// ---------------------------------------------------------------------------
// Cleveland Museum of Art
// ---------------------------------------------------------------------------

type ClevelandArtwork = {
  id: number;
  accession_number: string | null;
  share_license_status: string | null;
  title: string | null;
  creation_date: string | null;
  creation_date_earliest: number | null;
  technique: string | null;
  type: string | null;
  creditline: string | null;
  url: string | null;
  creators: Array<{ description: string | null }> | null;
  images: { web?: { url: string } } | null;
};

async function fetchCleveland(): Promise<Candidate[]> {
  const candidates: Candidate[] = [];
  const pageSize = 100;

  for (let skip = 0; skip < 1000 && candidates.length < 400; skip += pageSize) {
    const url = `https://openaccess-api.clevelandart.org/api/artworks/?is_public_domain=true&limit=${pageSize}&skip=${skip}`;
    const body = await fetchJson<{ data: ClevelandArtwork[] }>(url);
    if (!body.data.length) break;

    for (const item of body.data) {
      if (item.share_license_status !== 'CC0') continue;
      const imageUrl = item.images?.web?.url;
      if (!imageUrl || !item.title || !item.technique || !item.type) continue;

      let yearText = item.creation_date?.trim() || '';
      if (!hasParseableYear(yearText) && item.creation_date_earliest) {
        yearText = yearText
          ? `${yearText} (${item.creation_date_earliest})`
          : String(item.creation_date_earliest);
      }
      if (!yearText || !hasParseableYear(yearText)) continue;

      candidates.push({
        sourceId: String(item.id),
        title: item.title,
        artist: item.creators?.[0]?.description?.trim() || 'Unknown',
        yearText,
        medium: item.technique,
        classification: item.type,
        creditLine: item.creditline ?? '',
        accessionNumber: item.accession_number ?? '',
        sourceUrl:
          item.url ||
          `https://www.clevelandart.org/art/${item.accession_number}`,
        imageUrl,
      });
    }
  }

  return candidates;
}

// ---------------------------------------------------------------------------
// Rijksmuseum (only if a key already exists in the environment)
// ---------------------------------------------------------------------------

type RijksArtObject = {
  objectNumber: string;
  title: string;
  longTitle: string;
  principalOrFirstMaker: string;
  webImage: { url: string } | null;
};

async function fetchRijksmuseum(): Promise<Candidate[]> {
  const key = process.env.RIJKSMUSEUM_API_KEY;
  if (!key) {
    console.log(
      '[rijksmuseum] no RIJKSMUSEUM_API_KEY in env; skipping rather than adding a new secret'
    );
    return [];
  }

  const candidates: Candidate[] = [];
  for (let page = 0; page < 4 && candidates.length < 400; page += 1) {
    const url = `https://www.rijksmuseum.nl/api/en/collection?key=${key}&imgonly=true&ps=100&p=${page}`;
    const body = await fetchJson<{ artObjects: RijksArtObject[] }>(url);
    for (const item of body.artObjects) {
      if (!item.webImage?.url) continue;
      // The list endpoint has no structured date field; `longTitle` usually
      // embeds one (e.g. "..., c. 1650") — fall back to it rather than a
      // per-object detail call for every candidate.
      const yearMatch = item.longTitle?.match(/(?<!\d)\d{3,4}(?!\d)/);
      if (!yearMatch) continue;

      candidates.push({
        sourceId: item.objectNumber,
        title: item.title,
        artist: item.principalOrFirstMaker || 'Unknown',
        yearText: yearMatch[0],
        medium: '',
        classification: '',
        creditLine: '',
        accessionNumber: item.objectNumber,
        sourceUrl: `https://www.rijksmuseum.nl/en/collection/${item.objectNumber}`,
        imageUrl: item.webImage.url,
      });
    }
  }
  return candidates;
}

// ---------------------------------------------------------------------------
// CSV + zip assembly
// ---------------------------------------------------------------------------

const CSV_HEADERS = [
  'filename',
  'title',
  'artist',
  'year',
  'medium',
  'classification',
  'credit_line',
  'accession_number',
  'source_url',
];

function csvEscape(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

function buildCsv(
  rows: Array<{ filename: string; candidate: Candidate }>
): string {
  const lines = [CSV_HEADERS.join(',')];
  for (const { filename, candidate } of rows) {
    lines.push(
      [
        filename,
        candidate.title,
        candidate.artist,
        candidate.yearText,
        candidate.medium,
        candidate.classification,
        candidate.creditLine,
        candidate.accessionNumber,
        candidate.sourceUrl,
      ]
        .map((value) => csvEscape(String(value ?? '')))
        .join(',')
    );
  }
  return lines.join('\r\n') + '\r\n';
}

const EXTENSION_BY_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

async function downloadImage(
  url: string
): Promise<{ buffer: Buffer; extension: string }> {
  const response = await fetch(url, { headers: { 'user-agent': USER_AGENT } });
  if (!response.ok)
    throw new Error(`GET ${redactUrl(url)} -> HTTP ${response.status}`);
  const contentType = (response.headers.get('content-type') || '')
    .split(';')[0]!
    .trim()
    .toLowerCase();
  const extension = EXTENSION_BY_MIME[contentType];
  if (!extension) {
    throw new Error(
      `GET ${redactUrl(url)} -> unsupported content-type "${contentType || 'unknown'}"`
    );
  }
  return { buffer: Buffer.from(await response.arrayBuffer()), extension };
}

async function buildSource(config: SourceConfig): Promise<void> {
  console.log(`\n[${config.id}] ${config.label}: fetching candidates...`);
  const candidates = await config.fetchCandidates();
  console.log(
    `[${config.id}] ${candidates.length} public-domain candidates with usable metadata`
  );

  if (candidates.length === 0) {
    console.warn(
      `[${config.id}] no candidates available (network blocked or source empty) — skipping zip`
    );
    return;
  }

  const seed =
    [...config.id].reduce((acc, char) => acc + char.charCodeAt(0), 0) * 1000 +
    config.count;
  const selected = selectStratified(candidates, config.count, seed);
  console.log(
    `[${config.id}] selected ${selected.length}/${config.count} requested`
  );

  const rows: Array<{ filename: string; candidate: Candidate }> = [];
  const downloads = await mapWithConcurrency(selected, 6, async (candidate) => {
    try {
      const { buffer, extension } = await downloadImage(candidate.imageUrl);
      const filename = `${config.id}-${candidate.sourceId}.${extension}`;
      return { filename, candidate, buffer };
    } catch (error) {
      console.warn(
        `[${config.id}] failed to download ${candidate.sourceUrl}: ${(error as Error).message}`
      );
      return null;
    }
  });

  const zip = new JSZip();
  let bytesWritten = 0;
  for (const download of downloads) {
    if (!download) continue;
    zip.file(download.filename, download.buffer);
    rows.push({ filename: download.filename, candidate: download.candidate });
    bytesWritten += download.buffer.byteLength;
  }

  if (rows.length === 0) {
    console.warn(`[${config.id}] every download failed — skipping zip`);
    return;
  }

  if (config.withMetadata) {
    zip.file('metadata.csv', buildCsv(rows));
  }

  const buffer = await zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
  });
  const outName = `sample-${config.id}-${rows.length}${config.withMetadata ? '' : '-no-metadata'}.zip`;
  const outPath = path.join(OUT_DIR, outName);
  await writeFile(outPath, buffer);
  console.log(
    `[${config.id}] wrote ${outName}: ${rows.length} images, ${(buffer.byteLength / 1024 / 1024).toFixed(2)} MiB ` +
      `(images: ${(bytesWritten / 1024 / 1024).toFixed(2)} MiB), licence: ${config.licenceName} (${config.licenceUrl})`
  );
}

// ---------------------------------------------------------------------------
// Source registry + entrypoint
// ---------------------------------------------------------------------------

const SOURCES: SourceConfig[] = [
  {
    id: 'artic',
    label: 'Art Institute of Chicago',
    count: 45,
    withMetadata: true,
    licenceName: 'CC0 (public-domain artworks)',
    licenceUrl: 'https://www.artic.edu/open-access',
    fetchCandidates: fetchArtic,
  },
  {
    id: 'met',
    label: 'The Metropolitan Museum of Art',
    count: 45,
    withMetadata: true,
    licenceName: 'CC0 (Open Access)',
    licenceUrl:
      'https://www.metmuseum.org/about-the-met/policies-and-documents/open-access',
    fetchCandidates: fetchMet,
  },
  {
    id: 'cleveland',
    label: 'Cleveland Museum of Art',
    count: 30,
    withMetadata: true,
    licenceName: 'CC0 (Open Access)',
    licenceUrl: 'https://www.clevelandart.org/open-access',
    fetchCandidates: fetchCleveland,
  },
  {
    id: 'rijksmuseum',
    label: 'Rijksmuseum',
    count: 30,
    withMetadata: true,
    licenceName: 'CC0 / public domain (Rijksstudio)',
    licenceUrl: 'https://www.rijksmuseum.nl/en/rijksstudio/rijksstudio-api',
    fetchCandidates: fetchRijksmuseum,
  },
];

async function main() {
  const requested = process.argv.slice(2);
  const sources = requested.length
    ? SOURCES.filter((s) => requested.includes(s.id))
    : SOURCES;

  if (requested.length && sources.length !== requested.length) {
    const known = SOURCES.map((s) => s.id).join(', ');
    throw new Error(
      `Unknown source in "${requested.join(' ')}" — known sources: ${known}`
    );
  }

  for (const source of sources) {
    try {
      await buildSource(source);
    } catch (error) {
      console.error(`[${source.id}] failed: ${(error as Error).message}`);
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
