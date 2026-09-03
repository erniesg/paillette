/**
 * The anonymous "try it" flow, driven end to end through the real indexing
 * client. Only the `/api/public-index/*` boundary is stubbed, so zip reading,
 * the preflight, batching, polling and search all run for real.
 *
 * Caveat this file cannot cover, and the reason the PR carries a live run:
 * these stubs never touch Jina, R2 or Vectorize. Two production-breaking bugs
 * on this exact path were invisible to a green suite.
 */

import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComponentProps } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import JSZip from 'jszip';

vi.mock('@remix-run/react', () => ({
  Link: ({ to, ...props }: ComponentProps<'a'> & { to: string }) => (
    <a href={to} {...props} />
  ),
}));

import TryPaillette from '../try';
import {
  __resetWebMcpStateForTest,
  getWebMcpState,
} from '~/lib/webmcp/store';

const MANIFEST_PATH = '/samples/manifest.json';
const DEMO_PATH = '/samples/demo-a.zip';

const MANIFEST = {
  version: 1,
  collections: [
    {
      id: 'demo-a',
      name: 'Demo A',
      source: 'Museum A',
      path: DEMO_PATH,
      imageCount: 25,
      hasMetadata: false,
      licence: 'CC0',
      bytes: 7_000_000,
    },
    {
      id: 'demo-b',
      name: 'Demo B',
      source: 'Museum B',
      path: '/samples/demo-b.zip',
      imageCount: 100,
      hasMetadata: true,
      licence: 'CC0',
    },
  ],
};

const imageBytes = (fill: number, length = 512) =>
  new Uint8Array(new ArrayBuffer(length)).fill(fill);

const buildZip = async (entries: Record<string, Uint8Array | string>) => {
  const zip = new JSZip();
  for (const [name, content] of Object.entries(entries)) zip.file(name, content);
  return (await zip.generateAsync({ type: 'arraybuffer' })) as ArrayBuffer;
};

const FIXTURE_ENTRIES = {
  'photos/wave-01.jpg': imageBytes(1),
  'photos/wave-02.png': imageBytes(2),
  'photos/readme.txt': 'not an image',
};

type Stub = {
  jobBody: any;
  itemsCalls: number;
  statusCalls: number;
  searchBody: any;
  /** Flips the job to complete once the client has pushed a batch. */
  processed: number;
  suggestionsCalls: number;
};

const DEFAULT_SUGGESTIONS = {
  grounded: false,
  suggestions: [
    {
      id: 'content:a-wave',
      label: 'A wave',
      query: 'a wave',
      source: 'content',
      count: 1,
    },
  ],
};

const stubApi = (options: {
  searchResults?: unknown[];
  zipBytes: ArrayBuffer;
  /** Omit the manifest to exercise the bundled fallback. */
  manifest?: unknown | null;
  /** Hold the job in flight, so partial-result copy can be asserted. */
  stayRunning?: boolean;
  /** Omit to use a single generic suggestion; pass null to disable entirely. */
  suggestions?: typeof DEFAULT_SUGGESTIONS | null;
}) => {
  const stub: Stub = {
    jobBody: null,
    itemsCalls: 0,
    statusCalls: 0,
    searchBody: null,
    processed: 0,
    suggestionsCalls: 0,
  };

  vi.mocked(fetch).mockImplementation((async (
    input: RequestInfo | URL,
    init: RequestInit = {}
  ) => {
    const url = String(input);

    if (url === MANIFEST_PATH) {
      if (options.manifest === null) return new Response('', { status: 404 });
      return Response.json(options.manifest ?? MANIFEST);
    }

    if (url.startsWith('/samples/') && url.endsWith('.zip')) {
      return new Response(options.zipBytes, {
        headers: { 'Content-Type': 'application/zip' },
      });
    }

    if (url === '/api/public-index/jobs') {
      stub.jobBody = JSON.parse(String(init.body));
      return Response.json({
        success: true,
        data: {
          jobId: 'job-42',
          collectionId: 'collection-42',
          accepted: stub.jobBody.files
            .filter((entry: { name: string }) => !entry.name.endsWith('.txt'))
            .map((entry: { name: string }) => entry.name),
          batchSize: 4,
        },
      });
    }

    if (url.endsWith('/items')) {
      stub.itemsCalls += 1;
      stub.processed = 2;
      return Response.json({
        success: true,
        data: {
          jobId: 'job-42',
          state: 'running',
          processed: 2,
          total: 2,
          collectionId: 'collection-42',
          errors: [],
        },
      });
    }

    if (url.endsWith('/complete')) {
      return Response.json({ success: true, data: {} });
    }

    if (url.endsWith('/status')) {
      stub.statusCalls += 1;
      return Response.json({
        success: true,
        data: {
          jobId: 'job-42',
          state:
            stub.processed > 0 && !options.stayRunning ? 'complete' : 'running',
          processed: stub.processed,
          total: 2,
          collectionId: 'collection-42',
          collectionName: 'Demo',
          errors: [{ file: 'readme.txt', message: 'Not an indexable image' }],
          notice: null,
          searchable: stub.processed > 0,
        },
      });
    }

    if (url.endsWith('/search')) {
      stub.searchBody = JSON.parse(String(init.body));
      return Response.json({
        success: true,
        data: {
          collectionId: 'collection-42',
          results: options.searchResults ?? [],
        },
      });
    }

    if (url.endsWith('/suggestions')) {
      stub.suggestionsCalls += 1;
      if (options.suggestions === null) {
        return Response.json({
          success: true,
          data: { ready: false, state: 'running' },
        });
      }
      const chosen = options.suggestions ?? DEFAULT_SUGGESTIONS;
      return Response.json({
        success: true,
        data: {
          ready: true,
          jobId: 'job-42',
          collectionId: 'collection-42',
          grounded: chosen.grounded,
          suggestions: chosen.suggestions,
        },
      });
    }

    throw new Error(`unexpected fetch: ${url}`);
  }) as unknown as typeof fetch);

  return stub;
};

const renderTry = () => render(<TryPaillette />);

const SEARCH_HIT = {
  id: 'artwork-1',
  similarity: 0.42,
  title: 'wave 01',
  artist: null,
  year: null,
  medium: null,
  classification: null,
  description: null,
  original_filename: 'wave-01.jpg',
  imageUrl: '/api/public-index/assets/asset-1',
};

const EMPTY_ZIP = new ArrayBuffer(0);

describe('/try — anonymous indexing flow', () => {
  beforeEach(() => {
    __resetWebMcpStateForTest();
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('states the anonymous caps before anything is uploaded', () => {
    stubApi({ zipBytes: EMPTY_ZIP });
    renderTry();

    const caps = screen.getByText(/Anonymous limits:/i).textContent ?? '';
    expect(caps).toContain('100 images');
    expect(caps).toContain('8 MB per image');
    expect(caps).toContain('120 MB per job');
    expect(caps).toContain('6 jobs per hour');
    // No upload has happened, so nothing claims a collection exists yet.
    expect(screen.queryByText(/images indexed/i)).not.toBeInTheDocument();
  });

  it('offers every collection in the manifest, with its honest cost', async () => {
    stubApi({ zipBytes: EMPTY_ZIP });
    renderTry();

    expect(
      await screen.findByRole('button', { name: /index demo a/i })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /index demo b/i })
    ).toBeInTheDocument();

    // Provenance, metadata and the time it will take, before the click.
    expect(screen.getByText('Museum A')).toBeInTheDocument();
    expect(
      screen.getByText(/25 images · about 2 min to index/i)
    ).toBeInTheDocument();
    expect(
      screen.getByText(/100 images · about 6 min to index/i)
    ).toBeInTheDocument();
    expect(screen.getByText(/with catalogue metadata/i)).toBeInTheDocument();
  });

  it('falls back to the bundled archive when the manifest is missing', async () => {
    stubApi({ zipBytes: EMPTY_ZIP, manifest: null });
    renderTry();

    expect(
      await screen.findByRole('button', { name: /index 25 works, no metadata/i })
    ).toBeInTheDocument();
  });

  it('takes a visitor from a demo collection to real search results', async () => {
    const user = userEvent.setup();
    const stub = stubApi({
      zipBytes: await buildZip(FIXTURE_ENTRIES),
      searchResults: [SEARCH_HIT],
    });

    renderTry();
    await user.click(
      await screen.findByRole('button', { name: /index demo a/i })
    );

    // The job was created from the archive the page fetched for them: images
    // declared, the stray .txt declared too so the server can account for it.
    await waitFor(() => expect(stub.jobBody).not.toBeNull());
    expect(stub.jobBody.orgId).toBe('webmcp-index');
    expect(stub.jobBody.source).toBe('zip');
    expect(stub.jobBody.collectionName).toContain('Demo A');
    expect(
      stub.jobBody.files.map((entry: { name: string }) => entry.name)
    ).toEqual(['wave-01.jpg', 'wave-02.png', 'readme.txt']);

    // Progress is visible, and so is the skipped entry.
    await waitFor(() =>
      expect(screen.getByText(/2 of 2 images indexed/i)).toBeInTheDocument()
    );
    expect(screen.getByText(/elapsed/i)).toBeInTheDocument();
    expect(screen.getByText(/1 file skipped or failed/i)).toBeInTheDocument();

    const box = await screen.findByLabelText(/search this collection/i);
    await waitFor(() => expect(box).toBeEnabled());
    await user.type(box, 'a wave');
    await user.click(screen.getByRole('button', { name: /^search$/i }));

    await waitFor(() => expect(stub.searchBody).not.toBeNull());
    expect(stub.searchBody.query).toBe('a wave');

    expect(await screen.findByText('wave 01')).toBeInTheDocument();
    expect(screen.getByText(/1 result for/i)).toBeInTheDocument();
  });

  it('offers a collection-specific suggested search once indexing finishes, and searches it on click', async () => {
    const user = userEvent.setup();
    const stub = stubApi({
      zipBytes: await buildZip(FIXTURE_ENTRIES),
      searchResults: [SEARCH_HIT],
    });

    renderTry();
    await user.click(
      await screen.findByRole('button', { name: /index demo a/i })
    );

    await waitFor(
      () => expect(screen.getByText(/2 of 2 images indexed/i)).toBeInTheDocument(),
      { timeout: 5000 }
    );

    const chip = await screen.findByRole(
      'button',
      { name: /a wave/i },
      { timeout: 5000 }
    );
    expect(
      screen.getByText(/not enough catalogue metadata.*broad starter/i)
    ).toBeInTheDocument();
    expect(stub.suggestionsCalls).toBeGreaterThan(0);

    await user.click(chip);

    await waitFor(() => expect(stub.searchBody).not.toBeNull());
    expect(stub.searchBody.query).toBe('a wave');
    expect(await screen.findByText('wave 01')).toBeInTheDocument();
  });

  it('tells the visitor when suggestions came from the archive’s own catalogue metadata', async () => {
    const user = userEvent.setup();
    stubApi({
      zipBytes: await buildZip(FIXTURE_ENTRIES),
      searchResults: [SEARCH_HIT],
      suggestions: {
        grounded: true,
        suggestions: [
          {
            id: 'artist:jane-doe',
            label: 'Works by Jane Doe',
            query: 'Jane Doe',
            source: 'metadata',
            count: 3,
          },
        ],
      },
    });

    renderTry();
    await user.click(
      await screen.findByRole('button', { name: /index demo a/i })
    );

    await waitFor(
      () => expect(screen.getByText(/2 of 2 images indexed/i)).toBeInTheDocument(),
      { timeout: 5000 }
    );

    expect(
      await screen.findByRole(
        'button',
        { name: /works by jane doe/i },
        { timeout: 5000 }
      )
    ).toBeInTheDocument();
    expect(
      screen.getByText(/from this collection.s own catalogue metadata/i)
    ).toBeInTheDocument();
  });

  it('never asks for suggestions while a job is still running', async () => {
    const user = userEvent.setup();
    const stub = stubApi({
      zipBytes: await buildZip(FIXTURE_ENTRIES),
      searchResults: [],
      stayRunning: true,
    });

    renderTry();
    await user.click(
      await screen.findByRole('button', { name: /index demo a/i })
    );

    await waitFor(() =>
      expect(screen.getByText(/2 of 2 images indexed/i)).toBeInTheDocument()
    );
    expect(stub.suggestionsCalls).toBe(0);
  });

  it('blames the vector index lag, not the query, when a running job returns nothing', async () => {
    // Live on staging: `searchable: true` lands ~15s before Vectorize will
    // return the vectors it refers to. Telling a visitor mid-job to "try a
    // broader description" would be blaming them for a propagation delay.
    const user = userEvent.setup();
    stubApi({
      zipBytes: await buildZip(FIXTURE_ENTRIES),
      searchResults: [],
      stayRunning: true,
    });

    renderTry();
    await user.click(
      await screen.findByRole('button', { name: /index demo a/i })
    );

    const box = await screen.findByLabelText(/search this collection/i);
    await waitFor(() => expect(box).toBeEnabled(), { timeout: 5000 });
    await user.type(box, 'a wave');
    await user.click(screen.getByRole('button', { name: /^search$/i }));

    expect(
      await screen.findByText(/search again in a moment/i)
    ).toBeInTheDocument();
    expect(screen.queryByText(/try a broader description/i)).toBeNull();
  });

  it('publishes the job and its results onto the shared canvas for the agent', async () => {
    const user = userEvent.setup();
    stubApi({
      zipBytes: await buildZip(FIXTURE_ENTRIES),
      searchResults: [SEARCH_HIT],
    });

    renderTry();
    await user.click(
      await screen.findByRole('button', { name: /index demo a/i })
    );

    await waitFor(() =>
      expect(getWebMcpState().indexJob).toMatchObject({
        jobId: 'job-42',
        collectionId: 'collection-42',
        origin: 'human',
        source: 'zip',
      })
    );

    const box = await screen.findByLabelText(/search this collection/i);
    await waitFor(() => expect(box).toBeEnabled());
    await user.type(box, 'a wave');
    await user.click(screen.getByRole('button', { name: /^search$/i }));

    await waitFor(() => {
      const human = getWebMcpState().humanResults;
      expect(human?.origin).toBe('human');
      expect(human?.items.map((item) => item.id)).toEqual(['artwork-1']);
    });
  });

  it('indexes a zip the visitor picks themselves', async () => {
    const user = userEvent.setup();
    const stub = stubApi({ zipBytes: EMPTY_ZIP });

    renderTry();
    const input = screen.getByLabelText(/upload a zip archive of images/i);
    await user.upload(
      input,
      new File([await buildZip(FIXTURE_ENTRIES)], 'my-scans.zip', {
        type: 'application/zip',
      })
    );

    await waitFor(() => expect(stub.jobBody).not.toBeNull());
    expect(stub.jobBody.collectionName).toContain('my-scans');
    expect(
      stub.jobBody.files.map((entry: { name: string }) => entry.name)
    ).toContain('wave-01.jpg');
  });

  it('refuses an archive with no indexable images instead of uploading it', async () => {
    const user = userEvent.setup();
    const stub = stubApi({ zipBytes: EMPTY_ZIP });

    renderTry();
    await user.upload(
      screen.getByLabelText(/upload a zip archive of images/i),
      new File([await buildZip({ 'notes.txt': 'nothing here' })], 'empty.zip', {
        type: 'application/zip',
      })
    );

    const alert = await screen.findByRole('alert');
    expect(within(alert).getByText(/No indexable images/i)).toBeInTheDocument();
    expect(stub.jobBody).toBeNull();
  });

  it('reports a file that is not a zip without creating a job', async () => {
    const user = userEvent.setup();
    const stub = stubApi({ zipBytes: EMPTY_ZIP });

    renderTry();
    await user.upload(
      screen.getByLabelText(/upload a zip archive of images/i),
      new File([imageBytes(7)], 'not-a-zip.zip', { type: 'application/zip' })
    );

    const alert = await screen.findByRole('alert');
    expect(
      within(alert).getByText(/could not be read as a zip archive/i)
    ).toBeInTheDocument();
    expect(stub.jobBody).toBeNull();
  });

  it('says so when a demo archive cannot be fetched, without creating a job', async () => {
    const user = userEvent.setup();
    const stub = stubApi({ zipBytes: EMPTY_ZIP });
    renderTry();

    const button = await screen.findByRole('button', { name: /index demo a/i });
    // The zip 404s while the manifest still lists it.
    vi.mocked(fetch).mockImplementation((async (input: RequestInfo | URL) => {
      if (String(input) === DEMO_PATH) return new Response('', { status: 404 });
      return Response.json(MANIFEST);
    }) as unknown as typeof fetch);

    await user.click(button);

    const alert = await screen.findByRole('alert');
    expect(within(alert).getByText(/HTTP 404/i)).toBeInTheDocument();
    expect(stub.jobBody).toBeNull();
  });
});
