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

import {
  buildEntryMatcher,
  mapMetadataColumns,
  noSidecarReport,
  type MappedRole,
  type MetadataMappingReport,
  type SuppliedColumnMapping,
} from './metadata-columns';

export {
  ALL_ROLES,
  noSidecarReport,
  normalizeColumnName,
  type ColumnDecision,
  type MappedRole,
  type MetadataField,
  type MetadataMappingReport,
  type SuppliedColumnMapping,
} from './metadata-columns';

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
  /**
   * How this job read its CSV sidecar. Decided in the browser while the
   * archive was opened, so the server never sees it and it is stitched back on
   * here — the poller gets one payload with both the progress and the reason
   * its records look the way they do.
   */
  metadata?: JobMetadataSummary;
};

/** The sidecar account carried alongside a running job. */
export type JobMetadataSummary = {
  /** The sidecar file this came from, or null when there was none. */
  file: string | null;
  /** Rows read from the sidecar. */
  rows: number;
  /** Rows that named an image the archive actually contains. */
  matchedImages: number;
  mapping: MetadataMappingReport;
};

export type IndexOptions = {
  collectionName: string;
  orgId: string;
  signal?: AbortSignal;
  /** Additive: progress ticks for in-page UI while the agent polls. */
  onProgress?: (status: { processed: number; total: number }) => void;
  /**
   * An explicit `csv header -> catalogue field` mapping, applied instead of
   * the built-in rules. This is how a proposed mapping gets confirmed before
   * it is used, rather than guessed at silently.
   */
  columnMapping?: SuppliedColumnMapping;
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

export type MetadataSidecar = {
  /** Per-file metadata, keyed by lowercase basename. */
  items: Record<string, ItemMetadata>;
  /** What each column was taken to mean, and what went unclaimed. */
  mapping: MetadataMappingReport;
  /** Rows whose filename matched an image the archive actually contains. */
  matchedRows: number;
};

export type SidecarOptions = {
  /** Image entry names from the archive, so the filename column is provable. */
  knownFilenames?: string[];
  /** An explicit `header -> field` mapping that overrides the built-in rules. */
  columnMapping?: SuppliedColumnMapping;
};

const TEXT_FIELDS: Array<Exclude<MappedRole, 'filename' | 'year'>> = [
  'title',
  'artist',
  'medium',
  'classification',
  'description',
  'credit_line',
  'accession_number',
];

/**
 * Read a CSV sidecar into per-file metadata *and* an account of how its
 * columns were understood. A missing filename column is not a failure: the
 * rows cannot be attached to images, but the report still names every column
 * so the caller can say why the catalogue came out empty instead of leaving
 * the human to guess.
 */
export const readMetadataCsv = (
  text: string,
  options: SidecarOptions = {}
): MetadataSidecar => {
  const rows = parseCsvRows(text);
  const headers = rows[0] ?? [];
  const body = rows.slice(1);

  if (headers.length === 0) {
    return { items: {}, mapping: noSidecarReport(), matchedRows: 0 };
  }

  const entries = buildEntryMatcher(options.knownFilenames ?? []);

  const { columns, report } = mapMetadataColumns(headers, body, {
    ...(options.knownFilenames ? { knownFilenames: options.knownFilenames } : {}),
    ...(options.columnMapping ? { supplied: options.columnMapping } : {}),
  });

  const filenameColumn = columns.get('filename');
  if (filenameColumn === undefined) {
    return {
      items: {},
      mapping: {
        ...report,
        needsReview: body.length > 0,
        summary: `${report.summary} No column identifies which image each row describes, so none of these records could be attached — every image is titled from its filename instead.`,
      },
      matchedRows: 0,
    };
  }

  const items: Record<string, ItemMetadata> = {};
  let matchedRows = 0;

  for (const row of body) {
    const rawFilename = (row[filenameColumn] || '').trim();
    if (!rawFilename) continue;

    const metadata: ItemMetadata = {};
    const read = (field: MappedRole) => {
      const index = columns.get(field);
      const value = index === undefined ? '' : (row[index] || '').trim();
      return value || undefined;
    };

    for (const field of TEXT_FIELDS) {
      const value = read(field);
      if (value) metadata[field] = value;
    }

    const rawYear = read('year');
    if (rawYear) {
      metadata.date_text = rawYear;
      const year = firstYear(rawYear);
      if (year !== undefined) metadata.year = year;
    }

    // Key on the archive entry when the value resolves to one, so a sidecar
    // that says `436535` still lands on `436535.jpg`. Otherwise key on the
    // value itself and let the batch pump match it if it can.
    const entry = entries.resolve(rawFilename);
    if (entry) matchedRows += 1;
    items[entry ?? normalizeFilenameKey(rawFilename)] = metadata;
  }

  // Every column mapped, every row read, and not one of them landed on an
  // image: the sidecar describes something other than what is in the archive.
  // That is worth saying out loud, because from the outside it looks identical
  // to having had no sidecar at all.
  if (entries.size > 0 && body.length > 0 && matchedRows === 0) {
    return {
      items,
      mapping: {
        ...report,
        needsReview: true,
        summary: `${report.summary} None of the ${body.length} row(s) named an image in this archive — "${headers[filenameColumn] ?? ''}" is probably not the column that identifies the file. Set columnMapping to the column that is, or these images will be titled from their filenames.`,
      },
      matchedRows,
    };
  }

  return { items, mapping: report, matchedRows };
};

/**
 * Map an optional CSV sidecar to per-file metadata, keyed by lowercase
 * basename. Unknown columns are ignored; a missing sidecar is not an error.
 * `readMetadataCsv` is the same read with the mapping report attached.
 */
export const parseMetadataCsv = (
  text: string,
  options: SidecarOptions = {}
): Record<string, ItemMetadata> => readMetadataCsv(text, options).items;

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
  /** How the sidecar's columns were read. Present even when there was none. */
  mapping: MetadataMappingReport;
  /** The sidecar this mapping came from, if any. */
  metadataFile: string | null;
  /** Entries that could not even be listed. Never fatal. */
  errors: IndexJobError[];
};

/**
 * Read a zip's directory without decompressing its images. A malformed or
 * unreadable entry is reported and skipped rather than failing the archive.
 *
 * The sidecar is mapped only once every image entry is known, because the
 * surest way to identify the filename column is that its values name files
 * this archive actually contains.
 */
export const parseIndexZip = async (
  file: File | Blob,
  options: { columnMapping?: SuppliedColumnMapping } = {}
): Promise<ParsedZip> => {
  const zip = await JSZip.loadAsync(file);
  const images: ZipEntry[] = [];
  const skipped: Array<{ name: string; size: number }> = [];
  const errors: IndexJobError[] = [];
  let csvText: string | null = null;
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
          csvText = await entry.async('string');
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

  const sidecar =
    csvText === null
      ? null
      : readMetadataCsv(csvText, {
          knownFilenames: images.map((entry) => entry.name),
          ...(options.columnMapping ? { columnMapping: options.columnMapping } : {}),
        });

  return {
    images,
    skipped,
    metadata: sidecar?.items ?? {},
    mapping: sidecar?.mapping ?? noSidecarReport(),
    metadataFile: csvName,
    errors,
  };
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

/**
 * The sidecar account for jobs this page started. The mapping is worked out in
 * the browser and never travels to the server, so `getIndexStatus` reads it
 * from here and merges it into the status the API returns. Bounded, because a
 * long agent session can start a lot of jobs.
 */
const JOB_METADATA = new Map<string, JobMetadataSummary>();
const JOB_METADATA_LIMIT = 32;

const rememberJobMetadata = (jobId: string, summary: JobMetadataSummary) => {
  JOB_METADATA.set(jobId, summary);
  while (JOB_METADATA.size > JOB_METADATA_LIMIT) {
    const oldest = JOB_METADATA.keys().next().value;
    if (oldest === undefined) break;
    JOB_METADATA.delete(oldest);
  }
};

/** What this page knows about a job's sidecar, if it started that job. */
export const getJobMetadataSummary = (jobId: string) =>
  JOB_METADATA.get(jobId) ?? null;

const startJob = async (
  entries: ZipEntry[],
  skipped: Array<{ name: string; size: number }>,
  metadata: Record<string, ItemMetadata>,
  opts: IndexOptions,
  source: 'zip' | 'files',
  summary: JobMetadataSummary
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
  rememberJobMetadata(job.jobId, summary);

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

/**
 * How many of *these images* ended up with a record — not how many rows
 * matched something, which is the same number until a sidecar has duplicate
 * or surplus rows, and a misleading one after that.
 */
const countMatchedImages = (
  names: string[],
  metadata: Record<string, ItemMetadata>
) => names.filter((name) => metadata[normalizeFilenameKey(name)]).length;

const summarize = (
  file: string | null,
  mapping: MetadataMappingReport | null,
  matchedImages: number
): JobMetadataSummary => ({
  file,
  rows: mapping?.rowCount ?? 0,
  matchedImages,
  mapping: mapping ?? noSidecarReport(),
});

/**
 * Read an archive's sidecar and report how its columns were understood,
 * without uploading anything. The point of a separate read is that a mapping
 * can be inspected — and corrected via `columnMapping` — *before* a hundred
 * images are indexed under titles nobody checked.
 */
export async function inspectZipMetadata(
  file: File | Blob,
  opts: { columnMapping?: SuppliedColumnMapping } = {}
): Promise<{
  images: number;
  skipped: Array<{ name: string; size: number }>;
  metadata: JobMetadataSummary;
  sampleTitles: Array<{ file: string; title: string | null; artist: string | null }>;
}> {
  let parsed: ParsedZip;
  try {
    parsed = await parseIndexZip(file, opts);
  } catch (error) {
    throw new IndexingError(
      `That file could not be read as a zip archive: ${describeError(error)}`,
      'INVALID_ARCHIVE'
    );
  }

  return {
    images: parsed.images.length,
    skipped: parsed.skipped,
    metadata: summarize(
      parsed.metadataFile,
      parsed.mapping,
      countMatchedImages(
        parsed.images.map((entry) => entry.name),
        parsed.metadata
      )
    ),
    // What the mapping actually produces, which is the only thing a human can
    // judge it by. A wrong column is obvious the moment you read three titles.
    sampleTitles: parsed.images.slice(0, 5).map((entry) => {
      const record = parsed.metadata[normalizeFilenameKey(entry.name)];
      return {
        file: entry.name,
        title: record?.title ?? null,
        artist: record?.artist ?? null,
      };
    }),
  };
}

/** `index_zip`: a zip of images (+ optional CSV sidecar) becomes a collection. */
export async function indexZip(
  file: File,
  opts: IndexOptions
): Promise<IndexJobHandle> {
  let parsed: ParsedZip;
  try {
    parsed = await parseIndexZip(file, {
      ...(opts.columnMapping ? { columnMapping: opts.columnMapping } : {}),
    });
  } catch (error) {
    throw new IndexingError(
      `That file could not be read as a zip archive: ${describeError(error)}`,
      'INVALID_ARCHIVE'
    );
  }

  return startJob(
    parsed.images,
    parsed.skipped,
    parsed.metadata,
    opts,
    'zip',
    summarize(
      parsed.metadataFile,
      parsed.mapping,
      countMatchedImages(
        parsed.images.map((entry) => entry.name),
        parsed.metadata
      )
    )
  );
}

/** `index_folder`: the agent supplies a file list; same batch path. */
export async function indexFiles(
  files: File[],
  opts: IndexOptions
): Promise<IndexJobHandle> {
  const images: ZipEntry[] = [];
  const skipped: Array<{ name: string; size: number }> = [];
  const sidecars: Array<{ name: string; text: string }> = [];

  for (const file of files) {
    const name = file.name.split(/[\\/]/).pop() || file.name;
    if (isIgnoredEntryName(name)) continue;

    if (extensionOf(name) === 'csv') {
      try {
        sidecars.push({ name, text: await readTextFile(file) });
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

  // Sidecars are read after the images, for the same reason as in a zip: the
  // filename column is identifiable by the files it names.
  const knownFilenames = images.map((entry) => entry.name);
  let metadata: Record<string, ItemMetadata> = {};
  let best: { name: string; sidecar: MetadataSidecar } | null = null;

  for (const entry of sidecars) {
    const read = readMetadataCsv(entry.text, {
      knownFilenames,
      ...(opts.columnMapping ? { columnMapping: opts.columnMapping } : {}),
    });
    metadata = { ...metadata, ...read.items };
    // Several CSVs in one folder is rare; report the one that mapped most.
    if (!best || read.matchedRows > best.sidecar.matchedRows) {
      best = { name: entry.name, sidecar: read };
    }
  }

  return startJob(
    images,
    skipped,
    metadata,
    opts,
    'files',
    summarize(
      best?.name ?? null,
      best?.sidecar.mapping ?? null,
      countMatchedImages(
        images.map((entry) => entry.name),
        metadata
      )
    )
  );
}

/**
 * `get_index_status`: pollable progress. Never blocks on the run itself.
 *
 * The sidecar account is stitched in from this page rather than the server,
 * because the mapping was decided here and the raw CSV is never uploaded.
 */
export async function getIndexStatus(
  jobId: string,
  opts?: { signal?: AbortSignal }
): Promise<IndexStatus> {
  const status = await requestJson<IndexStatus>(
    `/api/public-index/${jobId}/status`,
    { method: 'GET', signal: opts?.signal }
  );
  const metadata = JOB_METADATA.get(jobId);
  return metadata ? { ...status, metadata } : status;
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
