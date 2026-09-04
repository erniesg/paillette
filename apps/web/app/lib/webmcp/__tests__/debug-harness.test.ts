import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  __resetWebMcpDebugHarnessForTest,
  ensureWebMcpDebugHarness,
  installWebMcpDebugHarness,
  isWebMcpDebugRequested,
  WEBMCP_DEBUG_PARAM,
} from '../debug-harness';

const setSearch = (search: string) => {
  window.history.replaceState({}, '', `/nga/search${search}`);
};

const clearHost = () => {
  delete (document as { modelContext?: unknown }).modelContext;
  delete window.__paillette_webmcp;
};

beforeEach(() => {
  __resetWebMcpDebugHarnessForTest();
  clearHost();
  setSearch('');
});

afterEach(() => {
  clearHost();
});

describe('isWebMcpDebugRequested', () => {
  it('is false on an ordinary visit', () => {
    expect(isWebMcpDebugRequested()).toBe(false);
  });

  it('is true for the bare flag, which is how links are written', () => {
    setSearch(`?${WEBMCP_DEBUG_PARAM}`);
    expect(isWebMcpDebugRequested()).toBe(true);
  });

  it('is true for the empty-valued form a URL round-trip produces', () => {
    // `searchParams.set(name, '')` renders as `?webmcp-debug=`; the capture
    // harness builds its URL that way.
    setSearch(`?${WEBMCP_DEBUG_PARAM}=`);
    expect(isWebMcpDebugRequested()).toBe(true);
  });

  it('survives an existing query string', () => {
    setSearch(`?q=estuary&${WEBMCP_DEBUG_PARAM}=`);
    expect(isWebMcpDebugRequested()).toBe(true);
  });
});

describe('ensureWebMcpDebugHarness', () => {
  it('installs a host synchronously, before any effect could run', () => {
    setSearch(`?${WEBMCP_DEBUG_PARAM}`);
    expect(document.modelContext).toBeUndefined();

    ensureWebMcpDebugHarness();

    expect(document.modelContext).toBeDefined();
    expect(window.__paillette_webmcp?.stubbed).toBe(true);
  });

  it('stays inert without the flag, so a normal visit is untouched', () => {
    ensureWebMcpDebugHarness();

    expect(document.modelContext).toBeUndefined();
    expect(window.__paillette_webmcp).toBeUndefined();
  });

  it('is idempotent — a second call does not replace the host', () => {
    setSearch(`?${WEBMCP_DEBUG_PARAM}`);
    ensureWebMcpDebugHarness();
    const first = document.modelContext;

    ensureWebMcpDebugHarness();

    expect(document.modelContext).toBe(first);
  });

  it('does not shadow a real host', () => {
    setSearch(`?${WEBMCP_DEBUG_PARAM}`);
    const real = {
      registerTool: vi.fn(async () => {}),
      unregisterTool: vi.fn(async () => {}),
      getTools: vi.fn(async () => []),
    };
    Object.defineProperty(document, 'modelContext', {
      value: real,
      configurable: true,
      writable: true,
    });

    ensureWebMcpDebugHarness();

    expect(document.modelContext).toBe(real);
    expect(window.__paillette_webmcp?.stubbed).toBe(false);
  });
});

describe('the driver window.__paillette_webmcp', () => {
  beforeEach(() => {
    setSearch(`?${WEBMCP_DEBUG_PARAM}`);
    ensureWebMcpDebugHarness();
  });

  const register = (name: string, execute: (input: unknown) => unknown) =>
    document.modelContext!.registerTool({
      name,
      description: name,
      inputSchema: { type: 'object', properties: { id: { type: 'string' } } },
      execute: async (input: unknown) => execute(input),
    } as never);

  it('reports the tools the host holds', async () => {
    await register('show_artwork', () => ({ ok: true }));

    const tools = await window.__paillette_webmcp!.tools();

    expect(tools.map((tool) => tool.name)).toEqual(['show_artwork']);
    expect(tools[0]?.properties).toEqual(['id']);
  });

  it('calls a tool and returns its result', async () => {
    await register('list_collections', () => ({ collections: ['nga'] }));

    const result = await window.__paillette_webmcp!.call('list_collections');

    expect(result).toEqual({ collections: ['nga'] });
  });

  it('names what is registered when a tool is missing', async () => {
    await register('redeal', () => ({}));

    await expect(window.__paillette_webmcp!.call('nope')).rejects.toThrow(
      /No tool "nope"\. Registered: redeal/
    );
  });

  it('says "(none)" rather than trailing off when nothing is registered', async () => {
    await expect(window.__paillette_webmcp!.call('nope')).rejects.toThrow(
      /Registered: \(none\)/
    );
  });

  it('rejects a duplicate registration, as the spec requires', async () => {
    await register('flag_artworks', () => ({}));

    await expect(register('flag_artworks', () => ({}))).rejects.toThrow(
      /already registered/
    );
  });

  it('hands execute a live AbortSignal', async () => {
    let seen: AbortSignal | null = null;
    await document.modelContext!.registerTool({
      name: 'slow',
      description: 'slow',
      inputSchema: { type: 'object', properties: {} },
      execute: async (_input: unknown, options: { signal: AbortSignal }) => {
        seen = options.signal;
        return {};
      },
    } as never);

    await window.__paillette_webmcp!.call('slow');

    expect(seen).toBeInstanceOf(AbortSignal);
    expect(seen!.aborted).toBe(false);
  });

  it('reports an abort as aborted rather than as a failure', async () => {
    await document.modelContext!.registerTool({
      name: 'hangs',
      description: 'hangs',
      inputSchema: { type: 'object', properties: {} },
      execute: (_input: unknown, options: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          options.signal.addEventListener('abort', () => {
            const error = new Error('aborted');
            error.name = 'AbortError';
            reject(error);
          });
        }),
    } as never);

    const outcome = await window.__paillette_webmcp!.callAndAbort('hangs', {}, 1);

    expect(outcome.aborted).toBe(true);
  });
});

describe('installWebMcpDebugHarness disposal', () => {
  /*
   * The disposer takes down the driver and leaves the host standing.
   *
   * Removing the stub too was right while the stub only ever existed under
   * `?webmcp-debug`. It is the page's own host now — the in-page prompt bar
   * talks to it on every visit — so tearing it down when a component unmounts
   * would take the agent off the page under someone's hands. The back door
   * closes; the room stays.
   */
  it('takes down the driver and leaves the host standing', () => {
    const dispose = installWebMcpDebugHarness();
    expect(document.modelContext).toBeDefined();
    expect(window.__paillette_webmcp).toBeDefined();

    dispose();

    expect(document.modelContext).toBeDefined();
    expect(window.__paillette_webmcp).toBeUndefined();
  });

  it('leaves a real host in place on disposal', () => {
    const real = {
      registerTool: vi.fn(async () => {}),
      unregisterTool: vi.fn(async () => {}),
      getTools: vi.fn(async () => []),
    };
    Object.defineProperty(document, 'modelContext', {
      value: real,
      configurable: true,
      writable: true,
    });

    installWebMcpDebugHarness()();

    expect(document.modelContext).toBe(real);
  });
});
