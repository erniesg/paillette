import JSZip from 'jszip';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  clearLearnedMappingCache,
  indexFiles,
  indexZip,
  makeApiMappingFetcher,
  parseMetadataCsv,
  parseMetadataCsvWithLearning,
} from '../indexing-client';

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

const waitFor = async (predicate: () => boolean, label: string) => {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`Timed out waiting for: ${label}`);
};

/** Full client-side stub of the indexing surface, including metadata-map. */
const stubIndexingApi = (
  mapping: Record<string, string> = {},
  options: { batchSize?: number; status?: number } = {}
) => {
  const forms: FormData[] = [];
  const calls: Array<{ url: string; init: RequestInit }> = [];
  let processed = 0;

  const fetcher = vi.fn(async (input: any, init: RequestInit = {}) => {
    const url = String(input);
    calls.push({ url, init });

    if (url === '/api/public-index/metadata-map') {
      const status = options.status ?? 200;
      return Response.json(
        status === 200
          ? { success: true, data: { mapping } }
          : { success: false, error: { code: 'MAPPING_UNAVAILABLE' } },
        { status }
      );
    }
    if (url === '/api/public-index/jobs') {
      const body = JSON.parse(String(init.body));
      return Response.json({
        success: true,
        data: {
          jobId: 'job-42',
          collectionId: 'collection-42',
          accepted: body.files.map((file: { name: string }) => file.name),
          batchSize: options.batchSize ?? 4,
          orgId: 'sandbox',
          caps: {},
        },
      });
    }
    if (url.endsWith('/items')) {
      const form = init.body as FormData;
      forms.push(form);
      processed += form.getAll('files').length;
      return Response.json({
        success: true,
        data: {
          jobId: 'job-42',
          state: 'running',
          processed,
          total: processed,
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
          total: processed,
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
    mappingCalls: () =>
      calls.filter((call) => call.url.endsWith('/metadata-map')),
    urls: () => calls.map((call) => call.url),
  };
};

beforeEach(() => {
  clearLearnedMappingCache();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('parseMetadataCsvWithLearning', () => {
  it('keeps the deterministic result when every header already maps', async () => {
    const fetchMapping = vi.fn();
    const csv = 'filename,title\none.jpg,Sunrise\n';

    await expect(
      parseMetadataCsvWithLearning(csv, { fetchMapping })
    ).resolves.toEqual(parseMetadataCsv(csv));
    expect(fetchMapping).not.toHaveBeenCalled();
  });

  it('only asks the mapper about unmapped columns with non-trivial values', async () => {
    const fetchMapping = vi
      .fn()
      .mockResolvedValue({ 'Object Ref': 'accession_number' });
    const csv =
      'filename,title,Object Ref,AllEmpty\n' +
      'one.jpg,Sunrise,1890.1,\n' +
      'two.jpg,Dusk,1890.2,\n';

    const metadata = await parseMetadataCsvWithLearning(csv, { fetchMapping });

    expect(fetchMapping).toHaveBeenCalledTimes(1);
    const [headers, samples] = fetchMapping.mock.calls[0] as unknown as [
      string[],
      string[][],
    ];
    // The all-empty column is not worth an API call, and the samples that
    // travel with the request stay aligned to the headers that were sent.
    expect(headers).toEqual(['Object Ref']);
    expect(samples).toEqual([['1890.1'], ['1890.2']]);
    expect(metadata['one.jpg']).toMatchObject({
      title: 'Sunrise',
      accession_number: '1890.1',
    });
  });

  it('caches one fetch per header-set per session', async () => {
    const fetchMapping = vi.fn().mockResolvedValue({ Mood: 'medium' });
    const first = 'filename,title,Mood\none.jpg,Sunrise,calm\n';
    const second =
      'filename,title,Mood\nten.jpg,Shore,still\n,,\n'; // same schema, new rows

    const a = await parseMetadataCsvWithLearning(first, { fetchMapping });
    const b = await parseMetadataCsvWithLearning(second, { fetchMapping });

    expect(fetchMapping).toHaveBeenCalledTimes(1);
    expect(a['one.jpg']).toMatchObject({ medium: 'calm' });
    expect(b['ten.jpg']).toMatchObject({ medium: 'still' });
  });

  it('lets a different header-set fetch its own mapping', async () => {
    const fetchMapping = vi.fn().mockResolvedValue({});
    await parseMetadataCsvWithLearning('filename,Mood\na.jpg,calm\n', {
      fetchMapping,
    });
    await parseMetadataCsvWithLearning('filename,Sentiment\na.jpg,calm\n', {
      fetchMapping,
    });

    expect(fetchMapping).toHaveBeenCalledTimes(2);
  });

  it('gives learned mappings priority over the deterministic aliases', async () => {
    // `label` deterministically becomes the title; the archive owner's
    // mapping says it is really a description. The extra keys the fetcher
    // returns beyond the unmapped headers are honoured too.
    const fetchMapping = vi
      .fn()
      .mockResolvedValue({ Mood: 'classification', label: 'description' });
    const csv =
      'filename,label,Mood\none.jpg,Sunrise,calm\n';

    const metadata = await parseMetadataCsvWithLearning(csv, { fetchMapping });

    expect(metadata['one.jpg']).toEqual({
      description: 'Sunrise',
      classification: 'calm',
    });
  });

  it('skips ignore targets and falls back to a learned filename column', async () => {
    const fetchMapping = vi
      .fn()
      .mockResolvedValue({ Mood: 'ignore', Specimen: 'filename' });
    // No deterministic alias can identify the row key here.
    const csv =
      'Specimen,title,Mood\none.jpg,Sunrise,calm\n';

    const metadata = await parseMetadataCsvWithLearning(csv, { fetchMapping });

    expect(metadata['one.jpg']).toEqual({ title: 'Sunrise' });
  });

  it('fails open: a rejected mapping returns the deterministic parse', async () => {
    const fetchMapping = vi.fn().mockRejectedValue(new Error('503'));
    const csv = 'filename,title,Mood\none.jpg,Sunrise,calm\n';

    const metadata = await parseMetadataCsvWithLearning(csv, { fetchMapping });

    expect(metadata['one.jpg']).toEqual({ title: 'Sunrise' });
    // The failure is not cached; a later CSV with the same schema retries.
    await parseMetadataCsvWithLearning('filename,title,Mood\ntwo.jpg,Dusk,gloomy\n', {
      fetchMapping,
    });
    expect(fetchMapping).toHaveBeenCalledTimes(2);
  });

  it('skips learning for header sets beyond the server limit', async () => {
    const fetchMapping = vi.fn().mockResolvedValue({});
    const headers = ['filename', ...Array.from({ length: 40 }, (_, i) => `col${i}`)];
    const csv = `${headers.join(',')}\none.jpg,${headers
      .slice(1)
      .map(() => 'x')
      .join(',')}\n`;

    await parseMetadataCsvWithLearning(csv, { fetchMapping });

    expect(fetchMapping).not.toHaveBeenCalled();
  });
});

describe('makeApiMappingFetcher', () => {
  it('posts headers and samples to the endpoint and unwraps the mapping', async () => {
    const fetcher = vi.fn(async () =>
      Response.json({
        success: true,
        data: { mapping: { Mood: 'medium', Junk: 'ignore' } },
      })
    );
    vi.stubGlobal('fetch', fetcher);

    const mapping = await makeApiMappingFetcher('')(['Mood', 'Junk'], [
      ['calm', 'x'],
    ]);

    expect(mapping).toEqual({ Mood: 'medium', Junk: 'ignore' });
    const [url, init] = fetcher.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe('/api/public-index/metadata-map');
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({
      headers: ['Mood', 'Junk'],
      samples: [['calm', 'x']],
    });
  });

  it('honours a base URL and throws on a degraded endpoint', async () => {
    const fetcher = vi.fn(async (input: any) =>
      String(input).startsWith('https://api.example.com')
        ? Response.json(
            { success: false, error: { code: 'MAPPING_UNAVAILABLE' } },
            { status: 503 }
          )
        : Response.json({ success: true, data: { mapping: {} } })
    );
    vi.stubGlobal('fetch', fetcher);

    await expect(
      makeApiMappingFetcher('https://api.example.com')(['a'], [])
    ).rejects.toThrow(/503/);
    await expect(
      makeApiMappingFetcher('/api-base')(['a'], [])
    ).resolves.toEqual({});
    expect(String(fetcher.mock.calls[1]![0])).toBe(
      '/api-base/api/public-index/metadata-map'
    );
  });
});

describe('learned metadata reaches the job', () => {
  it('indexZip attaches learned fields to the batches it uploads', async () => {
    const api = stubIndexingApi({
      'Object Ref': 'accession_number',
      Mood: 'medium',
    });
    const file = await buildZip({
      'one.jpg': imageBytes(1),
      'meta.csv':
        'filename,title,Object Ref,Mood\none.jpg,Sunrise,1890.1,calm\n',
    });

    await indexZip(file, { collectionName: 'x', orgId: 'nga' });
    await waitFor(
      () => api.urls().includes('/api/public-index/job-42/complete'),
      'job completion'
    );

    expect(api.mappingCalls()).toHaveLength(1);
    expect(JSON.parse(String(api.forms[0]!.get('metadata')))).toEqual({
      'one.jpg': {
        title: 'Sunrise',
        accession_number: '1890.1',
        medium: 'calm',
      },
    });
  });

  it('indexFiles still indexes when the endpoint is unavailable', async () => {
    const api = stubIndexingApi({}, { status: 503 });
    const csv = new File(
      ['filename,title,Mood\none.jpg,Sunrise,calm\n'],
      'meta.csv',
      { type: 'text/csv' }
    );

    await indexFiles(
      [new File([imageBytes(1)], 'one.jpg', { type: 'image/jpeg' }), csv],
      { collectionName: 'x', orgId: 'nga' }
    );
    await waitFor(
      () => api.urls().includes('/api/public-index/job-42/complete'),
      'job completion'
    );

    // Degraded to filename-derived titles; the upload itself never failed.
    expect(JSON.parse(String(api.forms[0]!.get('metadata')))).toEqual({
      'one.jpg': { title: 'Sunrise' },
    });
  });

  it('indexFiles honours an injected fetchMapping', async () => {
    const api = stubIndexingApi();
    const fetchMapping = vi.fn().mockResolvedValue({ Mood: 'classification' });
    const csv = new File(
      ['filename,title,Mood\none.jpg,Sunrise,calm\n'],
      'meta.csv',
      { type: 'text/csv' }
    );

    await indexFiles(
      [new File([imageBytes(1)], 'one.jpg', { type: 'image/jpeg' }), csv],
      { collectionName: 'x', orgId: 'nga', fetchMapping }
    );
    await waitFor(
      () => api.urls().includes('/api/public-index/job-42/complete'),
      'job completion'
    );

    expect(fetchMapping).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(api.forms[0]!.get('metadata')))).toEqual({
      'one.jpg': { title: 'Sunrise', classification: 'calm' },
    });
  });
});
