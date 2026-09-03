/**
 * Browser-side client for the WebMCP indexing tools
 * (`index_zip`, `index_folder`, `get_index_status`).
 *
 * WHY IT LOOKS LIKE THIS
 *
 * A WebMCP tool's `execute` must return quickly with JSON — it cannot block
 * for minutes while hundreds of images are uploaded and embedded. So indexing
 * is a job: `indexZip` / `indexFiles` create it, return `{ jobId, collectionId }`
 * immediately, and keep uploading in the background. The agent then polls
 * `getIndexStatus(jobId)` until it reads `complete`.
 *
 * The archive is opened here, in the browser: entry names and sizes are read
 * to plan the job, then each image is decompressed only when its batch is
 * about to be sent. The Worker never holds the zip.
 */

import JSZip from 'jszip';

// ---------------------------------------------------------------------------
// Contract
// ---------------------------------------------------------------------------

export type IndexJobState = 'queued' | 'running' | 'complete' | 'failed';

export type IndexJobError = { file: string; message: string };

export type IndexJobHandle = { jobId: string; collectionId: string };

export type IndexStatus = {
  jobId: string;
  state: IndexJobState;
  processed: number;
  total: number;
  collectionId: string;
  errors: IndexJobError[];
  /** Additive: an honest account of anything the caps or scope changed. */
  notice?: string | null;
  collectionName?: string;
  failed?: number;
  /** True once at least one image is embedded — partial results are usable. */
  searchable?: boolean;
};

export type IndexOptions = {
  collectionName: string;
  orgId: string;
  signal?: AbortSignal;
  /** Additive: progress ticks for in-page UI while the agent polls. */
  onProgress?: (status: { processed: number; total: number }) => void;
  /**
   * Additive: overrides the default metadata-map endpoint fetcher. Called at
   * most once per header-set per session; failures degrade to the
   * deterministic parse and never fail an upload.
   */
  fetchMapping?: MappingFetcher;
};

export type IndexedSearchResult = {
  id: string;
  similarity: number;
  title: string;
  artist: string | null;
  year: number | null;
  medium: string | null;
  classification: string | null;
  description: string | null;
  original_filename: string | null;
  imageUrl: string | null;
};

const DEFAULT_BATCH_SIZE = 4;

// ---------------------------------------------------------------------------
// Metadata
// ---------------------------------------------------------------------------

export type ItemMetadata = {
  title?: string;
  artist?: string;
  year?: number;
  date_text?: string;
  medium?: string;
  classification?: string;
  description?: string;
  credit_line?: string;
  accession_number?: string;
};

/** Column aliases, most specific first. Sidecars in the wild are inconsistent. */
const COLUMN_ALIASES: Array<[keyof ItemMetadata | 'filename', string[]]> = [
  [
    'filename',
    ['filename', 'file', 'filepath', 'path', 'image', 'imagefile', 'imagename', 'imgfile'],
  ],
  ['title', ['title', 'worktitle', 'artworktitle', 'objecttitle', 'caption', 'label']],
  ['artist', ['artist', 'creator', 'author', 'maker', 'artistname', 'photographer']],
  ['year', ['year', 'date', 'dated', 'datecreated', 'yearcreated', 'created']],
  ['medium', ['medium', 'materials', 'material', 'technique', 'support']],
  [
    'classification',
    ['classification', 'objecttype', 'type', 'category', 'genre', 'class'],
  ],
  ['description', ['description', 'desc', 'notes', 'note', 'summary', 'abstract']],
  ['credit_line', ['creditline', 'credit', 'creditlines']],
  [
    'accession_number',
    ['accessionnumber', 'accession', 'accessionno', 'objectnumber', 'inventorynumber', 'refno'],
  ],
];

/** Fallbacks tried only when no stronger column claimed the role. */
const WEAK_ALIASES: Array<[keyof ItemMetadata | 'filename', string[]]> = [
  ['filename', ['name', 'id', 'key']],
  ['title', ['name', 'subject']],
];

/**
 * `Blob.text()` is missing in older Safari and in the jsdom build the web
 * tests run under, so fall back to FileReader rather than losing a sidecar.
 */
export const readTextFile = async (file: Blob): Promise<string> => {
  const blob = file as Blob & { text?: () => Promise<string> };
  if (typeof blob.text === 'function') return blob.text();

  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () =>
      reject(reader.error ?? new Error('Could not read the file'));
    reader.readAsText(file);
  });
};

export const normalizeColumnName = (value: string) =>
  value.toLowerCase().replace(/[^a-z0-9]/g, '');

/** Match a sidecar row to an entry regardless of folder prefix or case. */
export const normalizeFilenameKey = (value: string) =>
  (value.split(/[\\/]/).pop() || value).trim().toLowerCase();

/**
 * A deliberately small RFC-4180 reader: quoted fields, escaped quotes,
 * embedded newlines and CRLF. Sidecar CSVs do not need more than this, and
 * `apps/web` cannot take a new dependency without a workspace install.
 */
export const parseCsvRows = (text: string): string[][] => {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  let touched = false;

  const endField = () => {
    row.push(field);
    field = '';
    touched = true;
  };
  const endRow = () => {
    endField();
    if (row.some((value) => value.trim() !== '')) rows.push(row);
    row = [];
    touched = false;
  };

  const source = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index]!;

    if (quoted) {
      if (character === '"') {
        if (source[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        field += character;
      }
      continue;
    }

    if (character === '"' && field === '') {
      quoted = true;
      touched = true;
    } else if (character === ',') {
      endField();
    } else if (character === '\r') {
      if (source[index + 1] === '\n') index += 1;
      endRow();
    } else if (character === '\n') {
      endRow();
    } else {
      field += character;
    }
  }

  if (field !== '' || touched || row.length) endRow();
  return rows;
};

const firstYear = (value: string): number | undefined => {
  // Not \b: "1890s" and "1954." must both yield a year, and a word boundary
  // fails against a trailing letter.
  const match = value.match(/(?<!\d)(\d{3,4})(?!\d)/);
  if (!match) return undefined;
  const year = Number(match[1]);
  return year >= 0 && year <= 9999 ? year : undefined;
};

/**
 * Map an optional CSV sidecar to per-file metadata, keyed by lowercase
 * basename. Unknown columns are ignored; a missing sidecar is not an error.
 */
export const parseMetadataCsv = (text: string): Record<string, ItemMetadata> => {
  const rows = parseCsvRows(text);
  if (rows.length < 2) return {};

  const headers = rows[0]!.map(normalizeColumnName);
  const columnFor = new Map<keyof ItemMetadata | 'filename', number>();

  for (const [field, aliases] of [...COLUMN_ALIASES, ...WEAK_ALIASES]) {
    if (columnFor.has(field)) continue;
    for (const alias of aliases) {
      const index = headers.indexOf(alias);
      // A column may only fill one role, so `name` cannot be both file and title.
      if (index >= 0 && ![...columnFor.values()].includes(index)) {
        columnFor.set(field, index);
        break;
      }
    }
  }

  const filenameColumn = columnFor.get('filename');
  if (filenameColumn === undefined) return {};

  const output: Record<string, ItemMetadata> = {};
  for (const row of rows.slice(1)) {
    const rawFilename = (row[filenameColumn] || '').trim();
    if (!rawFilename) continue;

    const metadata: ItemMetadata = {};
    const read = (field: keyof ItemMetadata) => {
      const index = columnFor.get(field);
      const value = index === undefined ? '' : (row[index] || '').trim();
      return value || undefined;
    };

    const title = read('title');
    if (title) metadata.title = title;
    const artist = read('artist');
    if (artist) metadata.artist = artist;
    const medium = read('medium');
    if (medium) metadata.medium = medium;
    const classification = read('classification');
    if (classification) metadata.classification = classification;
    const description = read('description');
    if (description) metadata.description = description;
    const creditLine = read('credit_line');
    if (creditLine) metadata.credit_line = creditLine;
    const accession = read('accession_number');
    if (accession) metadata.accession_number = accession;

    const rawYear = read('year');
    if (rawYear) {
      metadata.date_text = rawYear;
      const year = firstYear(rawYear);
      if (year !== undefined) metadata.year = year;
    }

    output[normalizeFilenameKey(rawFilename)] = metadata;
  }

  return output;
};

// ---------------------------------------------------------------------------
// Learned header mapping (LLM fallback for columns the aliases miss)
// ---------------------------------------------------------------------------

/**
 * Maps raw header names to canonical `ItemMetadata` fields, or the special
 * values 'filename' / 'ignore'. Produced by the server's metadata-map
 * endpoint; only entries naming canonical metadata fields change the parse.
 */
export type MappingFetcher = (
  headers: string[],
  samples: string[][]
) => Promise<Record<string, string>>;

const METADATA_FIELDS: ReadonlySet<string> = new Set([
  'title',
  'artist',
  'year',
  'date_text',
  'medium',
  'classification',
  'description',
  'credit_line',
  'accession_number',
]);

/** Mirrors the server contract: at most 3 rows, cells capped at 120 chars. */
const LEARNING_SAMPLE_ROWS = 3;
const LEARNING_CELL_LIMIT = 120;
const LEARNING_MAX_HEADERS = 40;

/**
 * One fetch per header-set per session, keyed by the sorted normalized
 * headers. The try page parses the same archive twice (preflight, then the
 * indexing run); this is what keeps that to a single LLM call.
 */
const learnedMappings = new Map<string, Record<string, string>>();

/** Test seam: reset the per-session cache. */
export const clearLearnedMappingCache = () => learnedMappings.clear();

const headerSetSignature = (headers: string[]) =>
  [...headers].map(normalizeColumnName).sort().join('\n');

const allAliasNames = new Set(
  [...COLUMN_ALIASES, ...WEAK_ALIASES].flatMap(([, aliases]) => aliases)
);

/**
 * Parse with a learned mapping merged in as highest-priority aliases.
 * Learned entries naming canonical metadata fields claim their column before
 * the deterministic aliases run; 'filename' and 'ignore' targets are skipped
 * for the merge, with one fail-safe: a learned 'filename' column is used as
 * the row key only when no deterministic alias identified one.
 */
const parseMetadataCsvWithMapping = (
  text: string,
  learned: Record<string, string>
): Record<string, ItemMetadata> => {
  const rows = parseCsvRows(text);
  if (rows.length < 2) return {};

  const rawHeaders = rows[0]!;
  const headers = rawHeaders.map(normalizeColumnName);

  const targetFor = (rawHeader: string): string | undefined => {
    const target = learned[rawHeader] ?? learned[rawHeader.trim()];
    return typeof target === 'string' ? target.trim().toLowerCase() : undefined;
  };

  // Learned aliases first, in column order, so they outrank the tables below
  // — but the row key comes first of all: if the learned mapping mislabels
  // the filename column, the parse must not lose its keys entirely.
  const learnedAliases: Array<[keyof ItemMetadata, string[]]> = [];
  let learnedFilenameColumn: number | undefined;
  rawHeaders.forEach((rawHeader, index) => {
    const target = targetFor(rawHeader);
    if (!target) return;
    if (target === 'filename') {
      learnedFilenameColumn ??= index;
      return;
    }
    if (target === 'ignore' || !METADATA_FIELDS.has(target)) return;
    learnedAliases.push([target as keyof ItemMetadata, [normalizeColumnName(rawHeader)]]);
  });

  const filenameEntries = [
    ...COLUMN_ALIASES.filter(([field]) => field === 'filename'),
    ...WEAK_ALIASES.filter(([field]) => field === 'filename'),
  ];

  const columnFor = new Map<keyof ItemMetadata | 'filename', number>();
  for (const [field, aliases] of [
    ...filenameEntries,
    ...learnedAliases,
    ...COLUMN_ALIASES,
    ...WEAK_ALIASES,
  ]) {
    if (columnFor.has(field)) continue;
    for (const alias of aliases) {
      const index = headers.indexOf(alias);
      // A column may only fill one role, so `name` cannot be both file and title.
      if (index >= 0 && ![...columnFor.values()].includes(index)) {
        columnFor.set(field, index);
        break;
      }
    }
  }

  // A learned 'filename' target only becomes the row key when the aliases
  // found nothing — 'filename' is deliberately skipped in the merge above.
  let filenameColumn = columnFor.get('filename');
  if (filenameColumn === undefined && learnedFilenameColumn !== undefined) {
    filenameColumn = learnedFilenameColumn;
  }
  if (filenameColumn === undefined) return {};

  const output: Record<string, ItemMetadata> = {};
  for (const row of rows.slice(1)) {
    const rawFilename = (row[filenameColumn] || '').trim();
    if (!rawFilename) continue;

    const metadata: ItemMetadata = {};
    const read = (field: keyof ItemMetadata) => {
      const index = columnFor.get(field);
      const value = index === undefined ? '' : (row[index] || '').trim();
      return value || undefined;
    };

    const title = read('title');
    if (title) metadata.title = title;
    const artist = read('artist');
    if (artist) metadata.artist = artist;
    const medium = read('medium');
    if (medium) metadata.medium = medium;
    const classification = read('classification');
    if (classification) metadata.classification = classification;
    const description = read('description');
    if (description) metadata.description = description;
    const creditLine = read('credit_line');
    if (creditLine) metadata.credit_line = creditLine;
    const accession = read('accession_number');
    if (accession) metadata.accession_number = accession;

    const rawYear = read('year');
    if (rawYear) {
      metadata.date_text = rawYear;
      const year = firstYear(rawYear);
      if (year !== undefined) metadata.year = year;
    }

    output[normalizeFilenameKey(rawFilename)] = metadata;
  }

  return output;
};

/**
 * `parseMetadataCsv` plus an LLM fallback for the columns its aliases miss.
 *
 * The deterministic parse always runs first and is what the caller gets when
 * nothing is learnable or the mapping cannot be fetched — this wrapper never
 * throws and never fails an upload. Headers qualify for learning when no
 * alias claims them and their values look like real data (a non-empty
 * majority of rows); empty or junk columns are not worth an API call.
 */
export const parseMetadataCsvWithLearning = async (
  text: string,
  opts: { fetchMapping?: MappingFetcher } = {}
): Promise<Record<string, ItemMetadata>> => {
  const deterministic = parseMetadataCsv(text);
  if (!opts.fetchMapping) return deterministic;

  const rows = parseCsvRows(text);
  if (rows.length < 2) return deterministic;

  const rawHeaders = rows[0]!;
  if (rawHeaders.length > LEARNING_MAX_HEADERS) return deterministic;
  const dataRows = rows.slice(1);

  const learnable: string[] = [];
  const learnableIndices: number[] = [];
  const seen = new Set<string>();
  rawHeaders.forEach((rawHeader, index) => {
    const normalized = normalizeColumnName(rawHeader);
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    if (allAliasNames.has(normalized)) return;
    const nonEmpty = dataRows.filter(
      (row) => (row[index] || '').trim() !== ''
    ).length;
    if (nonEmpty * 2 <= dataRows.length) return;
    learnable.push(rawHeader.trim());
    learnableIndices.push(index);
  });

  if (learnable.length === 0) return deterministic;

  const signature = headerSetSignature(rawHeaders);
  let learned = learnedMappings.get(signature);
  if (!learned) {
    const samples = dataRows
      .slice(0, LEARNING_SAMPLE_ROWS)
      .map((row) =>
        learnableIndices.map(
          (index) => (row[index] || '').trim().slice(0, LEARNING_CELL_LIMIT)
        )
      );
    try {
      learned = await opts.fetchMapping(learnable, samples);
    } catch {
      // No mapping is strictly worse metadata, never a lost archive.
      return deterministic;
    }
    learnedMappings.set(signature, learned);
  }

  return parseMetadataCsvWithMapping(text, learned);
};

/**
 * The production fetcher: POSTs the headers and sample rows to the anonymous
 * metadata-map endpoint and unwraps its envelope. Any non-answer throws; the
 * caller (parseMetadataCsvWithLearning) turns that into the deterministic
 * parse.
 */
export const makeApiMappingFetcher = (baseUrl: string): MappingFetcher => {
  const endpoint = `${baseUrl.replace(/\/+$/, '')}/api/public-index/metadata-map`;
  return async (headers, samples) => {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ headers, samples }),
    });
    if (!response.ok) {
      throw new Error(`Metadata mapping failed with ${response.status}`);
    }
    const payload = (await response.json()) as {
      success?: boolean;
      data?: { mapping?: Record<string, string> };
    };
    if (!payload?.success || typeof payload.data?.mapping !== 'object') {
      throw new Error('Metadata mapping response was malformed');
    }
    return payload.data.mapping;
  };
};

const defaultMappingFetcher = makeApiMappingFetcher('');

// ---------------------------------------------------------------------------
// Zip reading
// ---------------------------------------------------------------------------

const IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif', 'avif']);
const EXTENSION_MIME: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  avif: 'image/avif',
};

const extensionOf = (name: string) =>
  (name.split('.').pop() || '').toLowerCase();

export const isImageEntryName = (name: string) =>
  IMAGE_EXTENSIONS.has(extensionOf(name));

/** Archive noise no human means to index. */
export const isIgnoredEntryName = (name: string) => {
  const base = name.split('/').pop() || name;
  return (
    name.startsWith('__MACOSX/') ||
    name.includes('/__MACOSX/') ||
    base.startsWith('.') ||
    base === 'Thumbs.db'
  );
};

export type ZipEntry = {
  name: string;
  size: number;
  /** Decompress on demand — the pump calls this only for the current batch. */
  read: () => Promise<File>;
};

export type ParsedZip = {
  images: ZipEntry[];
  /**
   * Real entries this client will not upload. They are still declared to the
   * server so the status payload can say why each one was left out, instead of
   * the human wondering where a file went.
   */
  skipped: Array<{ name: string; size: number }>;
  metadata: Record<string, ItemMetadata>;
  /** Entries that could not even be listed. Never fatal. */
  errors: IndexJobError[];
};

/**
 * Read a zip's directory without decompressing its images. A malformed or
 * unreadable entry is reported and skipped rather than failing the archive.
 * A CSV sidecar is parsed with the learned-header fallback unless the caller
 * opts out by passing a fetchMapping of undefined explicitly.
 */
export const parseIndexZip = async (
  file: File | Blob,
  opts: { fetchMapping?: MappingFetcher } = {}
): Promise<ParsedZip> => {
  const zip = await JSZip.loadAsync(file);
  const images: ZipEntry[] = [];
  const skipped: Array<{ name: string; size: number }> = [];
  const errors: IndexJobError[] = [];
  let metadata: Record<string, ItemMetadata> = {};
  let csvName: string | null = null;

  const entries = Object.values(zip.files) as Array<
    JSZip.JSZipObject & { _data?: { uncompressedSize?: number } }
  >;

  for (const entry of entries) {
    if (entry.dir || isIgnoredEntryName(entry.name)) continue;

    if (extensionOf(entry.name) === 'csv') {
      // Take the shallowest CSV: an export's sidecar sits beside the images.
      const depth = entry.name.split('/').length;
      if (!csvName || depth < csvName.split('/').length) {
        try {
          metadata = await parseMetadataCsvWithLearning(
            await entry.async('string'),
            { fetchMapping: opts.fetchMapping ?? defaultMappingFetcher }
          );
          csvName = entry.name;
        } catch (error) {
          errors.push({
            file: entry.name,
            message: `Could not read the metadata sidecar: ${describeError(error)}`,
          });
        }
      }
      continue;
    }

    const entrySize = Number(entry._data?.uncompressedSize) || 0;
    if (!isImageEntryName(entry.name)) {
      skipped.push({
        name: entry.name.split('/').pop() || entry.name,
        size: entrySize,
      });
      continue;
    }

    const name = entry.name.split('/').pop() || entry.name;
    images.push({
      name,
      size: entrySize,
      read: async () =>
        new File([await entry.async('blob')], name, {
          type: EXTENSION_MIME[extensionOf(name)] || 'application/octet-stream',
        }),
    });
  }

  return { images, skipped, metadata, errors };
};

// ---------------------------------------------------------------------------
// Transport
// ---------------------------------------------------------------------------

const describeError = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

const isAbort = (error: unknown) =>
  error instanceof Error && error.name === 'AbortError';

class IndexingError extends Error {
  constructor(
    message: string,
    readonly code: string
  ) {
    super(message);
    this.name = 'IndexingError';
  }
}

const requestJson = async <T>(
  path: string,
  init: RequestInit & { signal?: AbortSignal }
): Promise<T> => {
  const response = await fetch(path, init);
  let payload: {
    success?: boolean;
    data?: T;
    error?: { code?: string; message?: string };
  };
  try {
    payload = await response.json();
  } catch {
    throw new IndexingError(
      `Indexing request failed with ${response.status}`,
      'INVALID_RESPONSE'
    );
  }
  if (!response.ok || !payload.success || payload.data === undefined) {
    throw new IndexingError(
      payload.error?.message || `Indexing request failed with ${response.status}`,
      payload.error?.code || 'INDEXING_FAILED'
    );
  }
  return payload.data;
};

type CreatedJob = {
  jobId: string;
  collectionId: string;
  accepted: string[];
  batchSize: number;
};

const createJob = async (
  entries: Array<{ name: string; size: number }>,
  opts: IndexOptions,
  source: 'zip' | 'files'
) =>
  requestJson<CreatedJob>('/api/public-index/jobs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      collectionName: opts.collectionName,
      orgId: opts.orgId,
      source,
      files: entries.map((entry) => ({ name: entry.name, size: entry.size })),
    }),
    signal: opts.signal,
  });

const closeJob = async (jobId: string, error?: string) => {
  try {
    await fetch(`/api/public-index/${jobId}/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(error ? { error } : {}),
    });
  } catch {
    // A job left open still reports its real processed/total on the next poll.
  }
};

/**
 * Upload the accepted entries batch by batch, sequentially. Batches are small
 * so each Worker invocation stays inside its CPU and subrequest budget, and a
 * batch that fails outright is retried once before the run moves on — the
 * remaining images should still be indexed.
 */
const pumpBatches = async (
  job: CreatedJob,
  readers: Map<string, () => Promise<File>>,
  metadata: Record<string, ItemMetadata>,
  opts: IndexOptions
) => {
  const batchSize = Math.max(1, job.batchSize || DEFAULT_BATCH_SIZE);
  let processed = 0;

  for (let offset = 0; offset < job.accepted.length; offset += batchSize) {
    if (opts.signal?.aborted) {
      await closeJob(job.jobId, 'Indexing was cancelled.');
      return;
    }

    const names = job.accepted.slice(offset, offset + batchSize);
    const form = new FormData();
    const batchMetadata: Record<string, ItemMetadata> = {};
    let attached = 0;

    for (const name of names) {
      const read = readers.get(name);
      if (!read) continue;
      try {
        form.append('files', await read(), name);
        attached += 1;
      } catch {
        // A corrupt entry is one lost image, not a lost archive. The server
        // never sees it, so it stays 'pending' and is reported at completion.
        continue;
      }
      const entry = metadata[normalizeFilenameKey(name)];
      if (entry) batchMetadata[name] = entry;
    }

    if (attached === 0) continue;
    form.append('metadata', JSON.stringify(batchMetadata));

    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const status = await requestJson<IndexStatus>(
          `/api/public-index/${job.jobId}/items`,
          { method: 'POST', body: form, signal: opts.signal }
        );
        processed = status.processed;
        opts.onProgress?.({ processed, total: status.total });
        break;
      } catch (error) {
        if (isAbort(error)) {
          await closeJob(job.jobId, 'Indexing was cancelled.');
          return;
        }
        if (attempt === 1) {
          console.warn(`Indexing batch failed for ${names.join(', ')}`, error);
        }
      }
    }
  }

  await closeJob(
    job.jobId,
    processed === 0 ? 'No images could be indexed.' : undefined
  );
};

const startJob = async (
  entries: ZipEntry[],
  skipped: Array<{ name: string; size: number }>,
  metadata: Record<string, ItemMetadata>,
  opts: IndexOptions,
  source: 'zip' | 'files'
): Promise<IndexJobHandle> => {
  if (entries.length === 0) {
    throw new IndexingError(
      'No supported images were found to index.',
      'NO_INDEXABLE_FILES'
    );
  }

  // Unsupported entries are declared too, so the server records a reason for
  // each and `get_index_status` can account for everything in the archive.
  const job = await createJob([...entries, ...skipped], opts, source);
  const readers = new Map(entries.map((entry) => [entry.name, entry.read]));

  // Deliberately not awaited: the caller is a WebMCP `execute` that must
  // return now. Progress is read back through `getIndexStatus(jobId)`.
  void pumpBatches(job, readers, metadata, opts).catch((error) => {
    console.warn('Indexing run failed', error);
  });

  return { jobId: job.jobId, collectionId: job.collectionId };
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** `index_zip`: a zip of images (+ optional CSV sidecar) becomes a collection. */
export async function indexZip(
  file: File,
  opts: IndexOptions
): Promise<IndexJobHandle> {
    let parsed: ParsedZip;
    try {
      parsed = await parseIndexZip(file, { fetchMapping: opts.fetchMapping });
    } catch (error) {
    throw new IndexingError(
      `That file could not be read as a zip archive: ${describeError(error)}`,
      'INVALID_ARCHIVE'
    );
  }
  return startJob(parsed.images, parsed.skipped, parsed.metadata, opts, 'zip');
}

/** `index_folder`: the agent supplies a file list; same batch path. */
export async function indexFiles(
  files: File[],
  opts: IndexOptions
): Promise<IndexJobHandle> {
  const images: ZipEntry[] = [];
  const skipped: Array<{ name: string; size: number }> = [];
  let metadata: Record<string, ItemMetadata> = {};

  for (const file of files) {
    const name = file.name.split(/[\\/]/).pop() || file.name;
    if (isIgnoredEntryName(name)) continue;

    if (extensionOf(name) === 'csv') {
      try {
        metadata = {
          ...metadata,
          ...(await parseMetadataCsvWithLearning(await readTextFile(file), {
            fetchMapping: opts.fetchMapping ?? defaultMappingFetcher,
          })),
        };
      } catch {
        // An unreadable sidecar just means filename-derived titles.
      }
      continue;
    }
    if (!isImageEntryName(name)) {
      skipped.push({ name, size: file.size });
      continue;
    }

    images.push({ name, size: file.size, read: async () => file });
  }

  return startJob(images, skipped, metadata, opts, 'files');
}

/** `get_index_status`: pollable progress. Never blocks on the run itself. */
export async function getIndexStatus(
  jobId: string,
  opts?: { signal?: AbortSignal }
): Promise<IndexStatus> {
  return requestJson<IndexStatus>(`/api/public-index/${jobId}/status`, {
    method: 'GET',
    signal: opts?.signal,
  });
}

/**
 * Additive: semantic search over the collection a job just built, so the agent
 * can index and then immediately search in one conversational turn.
 */
export async function searchIndexedCollection(
  jobId: string,
  query: string,
  opts?: { topK?: number; signal?: AbortSignal }
): Promise<{ collectionId: string; results: IndexedSearchResult[] }> {
  const data = await requestJson<{
    collectionId: string;
    results: IndexedSearchResult[];
  }>(`/api/public-index/${jobId}/search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, topK: opts?.topK ?? 20 }),
    signal: opts?.signal,
  });
  return data;
}

export { IndexingError };
