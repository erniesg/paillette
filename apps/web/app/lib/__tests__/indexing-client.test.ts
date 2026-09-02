import JSZip from 'jszip';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  IndexingError,
  getIndexStatus,
  indexFiles,
  indexZip,
  isIgnoredEntryName,
  normalizeFilenameKey,
  parseCsvRows,
  parseIndexZip,
  parseMetadataCsv,
  searchIndexedCollection,
} from '../indexing-client';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const imageBytes = (fill: number, length = 2000) =>
  new Uint8Array(new ArrayBuffer(length)).fill(fill);

const buildZip = async (
  entries: Record<string, Uint8Array | string>
): Promise<File> => {
  const zip = new JSZip();
  for (const [name, content] of Object.entries(entries)) zip.file(name, content);
  const bytes = await zip.generateAsync({ type: 'uint8array' });
  return new File([bytes as BlobPart], 'archive.zip', {
    type: 'application/zip',
  });
};

/** Rewrite one entry's compression method to an algorithm JSZip cannot read. */
const withUnsupportedCompression = (bytes: Uint8Array, target: string) => {
  const patched = Uint8Array.from(bytes);
  const view = new DataView(patched.buffer);
  const decoder = new TextDecoder();

  for (let offset = 0; offset + 4 < patched.length; offset += 1) {
    const signature = view.getUint32(offset, true);
    if (signature === 0x04034b50) {
      const nameLength = view.getUint16(offset + 26, true);
      const name = decoder.decode(
        patched.subarray(offset + 30, offset + 30 + nameLength)
      );
      if (name === target) view.setUint16(offset + 8, 99, true);
    }
    if (signature === 0x02014b50) {
      const nameLength = view.getUint16(offset + 28, true);
      const name = decoder.decode(
        patched.subarray(offset + 46, offset + 46 + nameLength)
      );
      if (name === target) view.setUint16(offset + 10, 99, true);
    }
  }
  return patched;
};

const waitFor = async (predicate: () => boolean, label: string) => {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`Timed out waiting for: ${label}`);
};

type FetchCall = { url: string; init: RequestInit };

/**
 * Stand in for the Remix proxy routes. Tracks every call so the batching and
 * completion behaviour can be asserted end to end.
 */
const stubIndexingApi = (
  options: {
    accepted?: string[];
    batchSize?: number;
    itemsResponder?: (call: number, form: FormData) => Response | Promise<Response>;
  } = {}
) => {
  const calls: FetchCall[] = [];
  const forms: FormData[] = [];
  let processed = 0;
  let itemsCalls = 0;

  const fetcher = vi.fn(async (input: any, init: RequestInit = {}) => {
    const url = String(input);
    calls.push({ url, init });

    if (url === '/api/public-index/jobs') {
      const body = JSON.parse(String(init.body));
      const accepted =
        options.accepted ?? body.files.map((file: { name: string }) => file.name);
      return Response.json({
        success: true,
        data: {
          jobId: 'job-42',
          collectionId: 'collection-42',
          accepted,
          batchSize: options.batchSize ?? 2,
          orgId: 'sandbox',
          caps: {},
        },
      });
    }

    if (url.endsWith('/items')) {
      itemsCalls += 1;
      const form = init.body as FormData;
      forms.push(form);
      if (options.itemsResponder) {
        const response = await options.itemsResponder(itemsCalls, form);
        if (response) return response;
      }
      processed += form.getAll('files').length;
      return Response.json({
        success: true,
        data: {
          jobId: 'job-42',
          state: 'running',
          processed,
          total: 4,
          collectionId: 'collection-42',
          errors: [],
        },
      });
    }

    if (url.endsWith('/complete')) {
      return Response.json({
        success: true,
        data: {
          jobId: 'job-42',
          state: 'complete',
          processed,
          total: 4,
          collectionId: 'collection-42',
          errors: [],
        },
      });
    }

    return Response.json(
      { success: false, error: { code: 'NOT_FOUND', message: 'no route' } },
      { status: 404 }
    );
  });

  vi.stubGlobal('fetch', fetcher);
  return {
    calls,
    forms,
    fetcher,
    urls: () => calls.map((call) => call.url),
    filenames: () =>
      forms.flatMap((form) =>
        form.getAll('files').map((file) => (file as File).name)
      ),
  };
};

// ---------------------------------------------------------------------------

describe('CSV reader', () => {
  it('handles quoted fields, embedded commas, newlines and escaped quotes', () => {
    const rows = parseCsvRows(
      'filename,title\r\n' +
        '"a.jpg","Barn, red"\r\n' +
        '"b.jpg","Line one\nLine two"\r\n' +
        '"c.jpg","He said ""hello"""\r\n'
    );

    expect(rows).toEqual([
      ['filename', 'title'],
      ['a.jpg', 'Barn, red'],
      ['b.jpg', 'Line one\nLine two'],
      ['c.jpg', 'He said "hello"'],
    ]);
  });

  it('ignores blank lines and a BOM', () => {
    expect(parseCsvRows('﻿filename,title\n\na.jpg,One\n\n')).toEqual([
      ['filename', 'title'],
      ['a.jpg', 'One'],
    ]);
  });
});

describe('CSV metadata mapping', () => {
  it('is forgiving about column names', () => {
    const metadata = parseMetadataCsv(
      'File Name,Work Title,Creator,Date,Materials,Object Type\n' +
        'one.jpg,Sunrise,A. Painter,1954,Oil on canvas,Painting\n'
    );

    expect(metadata['one.jpg']).toEqual({
      title: 'Sunrise',
      artist: 'A. Painter',
      medium: 'Oil on canvas',
      classification: 'Painting',
      date_text: '1954',
      year: 1954,
    });
  });

  it('keeps the raw date and extracts a year from it', () => {
    const metadata = parseMetadataCsv('image,title,dated\nb.png,Dusk,c. 1890s\n');
    expect(metadata['b.png']).toMatchObject({
      date_text: 'c. 1890s',
      year: 1890,
    });
  });

  it('matches sidecar paths to archive entries by basename', () => {
    const metadata = parseMetadataCsv(
      'path,title\nimages/sub/One.JPG,Sunrise\n'
    );
    expect(metadata[normalizeFilenameKey('One.JPG')]).toMatchObject({
      title: 'Sunrise',
    });
  });

  it('returns nothing when no column identifies a file', () => {
    expect(parseMetadataCsv('title,artist\nSunrise,A. Painter\n')).toEqual({});
  });

  it('does not let one column fill two roles', () => {
    // `name` is the only file-ish column, so it must not also become the title.
    const metadata = parseMetadataCsv('name,artist\none.jpg,A. Painter\n');
    expect(metadata['one.jpg']).toEqual({ artist: 'A. Painter' });
  });

  it('tolerates ragged rows and unknown columns', () => {
    const metadata = parseMetadataCsv(
      'filename,title,mood\none.jpg,Sunrise\ntwo.jpg,Dusk,calm\n'
    );
    expect(metadata['one.jpg']).toEqual({ title: 'Sunrise' });
    expect(metadata['two.jpg']).toEqual({ title: 'Dusk' });
  });
});

describe('zip reading', () => {
  it('separates images from a sidecar and ignores archive noise', async () => {
    const file = await buildZip({
      'photos/one.jpg': imageBytes(1),
      'photos/two.PNG': imageBytes(2),
      'photos/notes.txt': 'not an image',
      'metadata.csv': 'filename,title\none.jpg,Sunrise\n',
      '__MACOSX/photos/._one.jpg': imageBytes(3),
      'photos/.DS_Store': imageBytes(4),
    });

    const parsed = await parseIndexZip(file);

    expect(parsed.images.map((entry) => entry.name).sort()).toEqual([
      'one.jpg',
      'two.PNG',
    ]);
    expect(parsed.metadata['one.jpg']).toEqual({ title: 'Sunrise' });
  });

  it('reads entry sizes without decompressing them', async () => {
    const file = await buildZip({ 'one.jpg': imageBytes(1, 3210) });
    const parsed = await parseIndexZip(file);
    expect(parsed.images[0]!.size).toBe(3210);
  });

  it('decompresses an entry only when it is read', async () => {
    const file = await buildZip({ 'one.jpg': imageBytes(7, 512) });
    const parsed = await parseIndexZip(file);

    const image = await parsed.images[0]!.read();
    expect(image.name).toBe('one.jpg');
    expect(image.type).toBe('image/jpeg');
    // jsdom's Blob has no arrayBuffer(); size is enough to prove it inflated.
    expect(image.size).toBe(512);
  });

  it('ignores archive noise by name', () => {
    expect(isIgnoredEntryName('__MACOSX/x/._a.jpg')).toBe(true);
    expect(isIgnoredEntryName('a/.DS_Store')).toBe(true);
    expect(isIgnoredEntryName('a/Thumbs.db')).toBe(true);
    expect(isIgnoredEntryName('a/one.jpg')).toBe(false);
  });

  it('reports a file that is not a zip as an unreadable archive', async () => {
    const notAZip = new File([imageBytes(1, 128)], 'archive.zip');

    await expect(
      indexZip(notAZip, { collectionName: 'x', orgId: 'nga' })
    ).rejects.toMatchObject({ code: 'INVALID_ARCHIVE' });
  });

  it('reports an entry compressed with an unsupported method', async () => {
    const zip = new JSZip();
    zip.file('one.jpg', imageBytes(1));
    zip.file('two.png', imageBytes(2));
    const bytes = await zip.generateAsync({ type: 'uint8array' });
    const broken = new File(
      [withUnsupportedCompression(bytes, 'one.jpg')],
      'archive.zip'
    );

    await expect(
      indexZip(broken, { collectionName: 'x', orgId: 'nga' })
    ).rejects.toMatchObject({ code: 'INVALID_ARCHIVE' });
  });

  it('refuses a zip that holds no supported images', async () => {
    const file = await buildZip({ 'readme.txt': 'nothing here' });

    await expect(
      indexZip(file, { collectionName: 'x', orgId: 'nga' })
    ).rejects.toMatchObject({ code: 'NO_INDEXABLE_FILES' });
  });
});

describe('job lifecycle', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('returns a job handle before the uploads finish', async () => {
    let releaseItems: () => void = () => undefined;
    const itemsGate = new Promise<void>((resolve) => {
      releaseItems = resolve;
    });
    const api = stubIndexingApi({
      itemsResponder: async () => {
        await itemsGate;
        return undefined as unknown as Response;
      },
    });

    const file = await buildZip({
      'one.jpg': imageBytes(1),
      'two.jpg': imageBytes(2),
      'three.jpg': imageBytes(3),
    });

    const handle = await indexZip(file, {
      collectionName: 'Studio scans',
      orgId: 'nga',
    });

    // The contract: resolve now, poll later.
    expect(handle).toEqual({ jobId: 'job-42', collectionId: 'collection-42' });
    expect(api.urls()).toContain('/api/public-index/jobs');
    expect(api.urls()).not.toContain('/api/public-index/job-42/complete');

    releaseItems();
    await waitFor(
      () => api.urls().includes('/api/public-index/job-42/complete'),
      'job completion'
    );
  });

  it('uploads in batches, attaches per-file metadata, then closes the job', async () => {
    const api = stubIndexingApi({ batchSize: 2 });
    const file = await buildZip({
      'one.jpg': imageBytes(1),
      'two.jpg': imageBytes(2),
      'three.jpg': imageBytes(3),
      'meta.csv': 'filename,title\none.jpg,Sunrise\nthree.jpg,Dusk\n',
    });

    await indexZip(file, { collectionName: 'Studio scans', orgId: 'nga' });
    await waitFor(
      () => api.urls().includes('/api/public-index/job-42/complete'),
      'job completion'
    );

    expect(api.forms).toHaveLength(2);
    expect(api.forms[0]!.getAll('files')).toHaveLength(2);
    expect(api.forms[1]!.getAll('files')).toHaveLength(1);
    expect(api.filenames().sort()).toEqual(['one.jpg', 'three.jpg', 'two.jpg']);

    // Metadata travels with the batch that carries the file it describes.
    expect(JSON.parse(String(api.forms[0]!.get('metadata')))).toEqual({
      'one.jpg': { title: 'Sunrise' },
    });
    expect(JSON.parse(String(api.forms[1]!.get('metadata')))).toEqual({
      'three.jpg': { title: 'Dusk' },
    });

    const complete = api.calls.find((call) => call.url.endsWith('/complete'))!;
    expect(JSON.parse(String(complete.init.body))).toEqual({});
  });

  it('reports the plan the server made rather than the client wish list', async () => {
    // The server capped the job at two files; only those may be uploaded.
    const api = stubIndexingApi({
      accepted: ['one.jpg', 'two.jpg'],
      batchSize: 4,
    });
    const file = await buildZip({
      'one.jpg': imageBytes(1),
      'two.jpg': imageBytes(2),
      'three.jpg': imageBytes(3),
    });

    await indexZip(file, { collectionName: 'x', orgId: 'nga' });
    await waitFor(
      () => api.urls().includes('/api/public-index/job-42/complete'),
      'job completion'
    );

    expect(api.filenames().sort()).toEqual(['one.jpg', 'two.jpg']);
  });

  it('retries a failed batch once and keeps going with the rest', async () => {
    const api = stubIndexingApi({
      batchSize: 1,
      itemsResponder: (call) =>
        call <= 2
          ? Response.json(
              { success: false, error: { code: 'UPSTREAM', message: 'boom' } },
              { status: 502 }
            )
          : (undefined as unknown as Response),
    });
    const file = await buildZip({
      'one.jpg': imageBytes(1),
      'two.jpg': imageBytes(2),
    });

    await indexZip(file, { collectionName: 'x', orgId: 'nga' });
    await waitFor(
      () => api.urls().includes('/api/public-index/job-42/complete'),
      'job completion'
    );

    // one.jpg: attempt + retry, both failed. two.jpg: succeeded.
    expect(api.forms).toHaveLength(3);
    expect(api.filenames()).toEqual(['one.jpg', 'one.jpg', 'two.jpg']);
  });

  it('tells the server the run indexed nothing when every batch failed', async () => {
    const api = stubIndexingApi({
      batchSize: 4,
      itemsResponder: () =>
        Response.json(
          { success: false, error: { code: 'UPSTREAM', message: 'boom' } },
          { status: 502 }
        ),
    });
    const file = await buildZip({ 'one.jpg': imageBytes(1) });

    await indexZip(file, { collectionName: 'x', orgId: 'nga' });
    await waitFor(
      () => api.urls().includes('/api/public-index/job-42/complete'),
      'job completion'
    );

    const complete = api.calls.find((call) => call.url.endsWith('/complete'))!;
    expect(JSON.parse(String(complete.init.body))).toEqual({
      error: 'No images could be indexed.',
    });
  });

  it('skips an entry it cannot decompress and still indexes the rest', async () => {
    const api = stubIndexingApi({ batchSize: 4 });
    const file = await buildZip({
      'one.jpg': imageBytes(1),
      'two.jpg': imageBytes(2),
    });

    // Inject a single unreadable entry into an otherwise valid archive.
    const realLoad = JSZip.loadAsync.bind(JSZip);
    vi.spyOn(JSZip, 'loadAsync').mockImplementation(async (data: any) => {
      const zip = await realLoad(data);
      const broken = zip.files['one.jpg']!;
      broken.async = (() =>
        Promise.reject(new Error('Corrupted zip'))) as typeof broken.async;
      return zip;
    });

    await indexZip(file, { collectionName: 'x', orgId: 'nga' });
    await waitFor(
      () => api.urls().includes('/api/public-index/job-42/complete'),
      'job completion'
    );

    expect(api.filenames()).toEqual(['two.jpg']);
  });

  it('stops uploading when the caller aborts', async () => {
    const controller = new AbortController();
    const api = stubIndexingApi({
      batchSize: 1,
      itemsResponder: (call) => {
        if (call === 1) controller.abort();
        return undefined as unknown as Response;
      },
    });
    const file = await buildZip({
      'one.jpg': imageBytes(1),
      'two.jpg': imageBytes(2),
      'three.jpg': imageBytes(3),
    });

    await indexZip(file, {
      collectionName: 'x',
      orgId: 'nga',
      signal: controller.signal,
    });
    await waitFor(
      () => api.urls().includes('/api/public-index/job-42/complete'),
      'job completion'
    );

    expect(api.forms.length).toBeLessThan(3);
    const complete = api.calls.find((call) => call.url.endsWith('/complete'))!;
    expect(JSON.parse(String(complete.init.body))).toEqual({
      error: 'Indexing was cancelled.',
    });
  });

  it('reports progress while the agent polls', async () => {
    const api = stubIndexingApi({ batchSize: 1 });
    const onProgress = vi.fn();
    const file = await buildZip({
      'one.jpg': imageBytes(1),
      'two.jpg': imageBytes(2),
    });

    await indexZip(file, {
      collectionName: 'x',
      orgId: 'nga',
      onProgress,
    });
    await waitFor(
      () => api.urls().includes('/api/public-index/job-42/complete'),
      'job completion'
    );

    expect(onProgress.mock.calls.map(([status]) => status.processed)).toEqual([
      1, 2,
    ]);
  });
});

describe('indexFiles', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('takes a file list, consumes a CSV in it, and uses the same batch path', async () => {
    const api = stubIndexingApi({ batchSize: 4 });

    await indexFiles(
      [
        new File([imageBytes(1)], 'one.jpg', { type: 'image/jpeg' }),
        new File([imageBytes(2)], 'notes.txt', { type: 'text/plain' }),
        new File(['filename,title\none.jpg,Sunrise\n'], 'meta.csv', {
          type: 'text/csv',
        }),
      ],
      { collectionName: 'Folder drop', orgId: 'nga' }
    );
    await waitFor(
      () => api.urls().includes('/api/public-index/job-42/complete'),
      'job completion'
    );

    const created = JSON.parse(String(api.calls[0]!.init.body));
    expect(created.source).toBe('files');
    expect(created.files).toEqual([{ name: 'one.jpg', size: 2000 }]);
    expect(JSON.parse(String(api.forms[0]!.get('metadata')))).toEqual({
      'one.jpg': { title: 'Sunrise' },
    });
  });

  it('refuses a list with no supported images', async () => {
    stubIndexingApi();
    await expect(
      indexFiles([new File(['x'], 'notes.txt')], {
        collectionName: 'x',
        orgId: 'nga',
      })
    ).rejects.toBeInstanceOf(IndexingError);
  });
});

describe('status and search', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('reads job status without blocking on the run', async () => {
    const status = {
      jobId: 'job-42',
      state: 'running',
      processed: 3,
      total: 10,
      collectionId: 'collection-42',
      errors: [{ file: 'bad.jpg', message: 'rate limited' }],
      notice: 'Only the first 40 images are indexed.',
      searchable: true,
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ success: true, data: status }))
    );

    await expect(getIndexStatus('job-42')).resolves.toEqual(status);
  });

  it('surfaces the API error code when a job is unknown', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json(
          { success: false, error: { code: 'NOT_FOUND', message: 'gone' } },
          { status: 404 }
        )
      )
    );

    await expect(getIndexStatus('job-42')).rejects.toMatchObject({
      code: 'NOT_FOUND',
      message: 'gone',
    });
  });

  it('searches the collection the job just built', async () => {
    const fetcher = vi.fn(async () =>
      Response.json({
        success: true,
        data: {
          collectionId: 'collection-42',
          results: [{ id: 'a', similarity: 0.9, title: 'Red Barn' }],
        },
      })
    );
    vi.stubGlobal('fetch', fetcher);

    const result = await searchIndexedCollection('job-42', 'a red barn', {
      topK: 5,
    });

    expect(result.results[0]).toMatchObject({ title: 'Red Barn' });
    expect(fetcher).toHaveBeenCalledWith(
      '/api/public-index/job-42/search',
      expect.objectContaining({ method: 'POST' })
    );
    const [, searchInit] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(searchInit.body))).toEqual({
      query: 'a red barn',
      topK: 5,
    });
  });
});
