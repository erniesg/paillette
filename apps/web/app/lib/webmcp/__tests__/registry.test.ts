import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ModelContext, ModelContextTool } from '~/types/webmcp';
import {
  __resetWebMcpRegistryForTest,
  getHostTools,
  getModelContext,
  getRegisteredToolNames,
  getWebMcpAvailability,
  isWebMcpAvailable,
  registerTools,
  waitForWebMcpRegistry,
} from '../registry';

const makeTool = (
  name: string,
  execute: ModelContextTool['execute'] = async () => ({ ok: true })
): ModelContextTool => ({
  name,
  title: name,
  description: `Test tool ${name}`,
  inputSchema: { type: 'object', properties: {} },
  annotations: { readOnlyHint: true },
  execute,
});

/** Mimics a host that rejects duplicate names, as the spec requires. */
const createHost = (
  overrides: Partial<ModelContext> = {}
): ModelContext & { registered: Map<string, ModelContextTool> } => {
  const registered = new Map<string, ModelContextTool>();
  return {
    registered,
    registerTool: vi.fn(async (tool: ModelContextTool) => {
      if (registered.has(tool.name)) {
        throw new Error(`Tool "${tool.name}" is already registered.`);
      }
      registered.set(tool.name, tool);
    }),
    unregisterTool: vi.fn(async (name: string) => {
      registered.delete(name);
    }),
    getTools: vi.fn(async () => [...registered.values()]),
    ...overrides,
  } as ModelContext & { registered: Map<string, ModelContextTool> };
};

const installHost = (host: ModelContext | null) => {
  if (host) {
    Object.defineProperty(document, 'modelContext', {
      value: host,
      configurable: true,
      writable: true,
    });
  } else {
    // Optional global; removed so the no-support path is exercised for real.
    delete (document as { modelContext?: unknown }).modelContext;
  }
};

afterEach(() => {
  __resetWebMcpRegistryForTest();
  installHost(null);
  vi.restoreAllMocks();
});

describe('feature detection', () => {
  it('reports unsupported and no-ops when document.modelContext is absent', () => {
    expect(isWebMcpAvailable()).toBe(false);
    expect(getWebMcpAvailability()).toEqual({
      supported: false,
      reason: 'no-model-context',
    });
    expect(getModelContext()).toBeNull();

    const onError = vi.fn();
    const dispose = registerTools([makeTool('search_artworks')], { onError });

    expect(getRegisteredToolNames()).toEqual([]);
    expect(onError).not.toHaveBeenCalled();
    expect(() => dispose()).not.toThrow();
  });

  it('reports supported when the host is present', () => {
    installHost(createHost());
    expect(isWebMcpAvailable()).toBe(true);
    expect(getWebMcpAvailability()).toEqual({ supported: true, via: 'document' });
  });
});

describe('registration', () => {
  it('registers each tool on the host once', async () => {
    const host = createHost();
    installHost(host);

    registerTools([makeTool('search_artworks'), makeTool('get_search_quota')]);
    await waitForWebMcpRegistry();

    expect(host.registerTool).toHaveBeenCalledTimes(2);
    expect(getRegisteredToolNames()).toEqual([
      'get_search_quota',
      'search_artworks',
    ]);
    await expect(getHostTools()).resolves.toHaveLength(2);
  });

  it('does not re-register a live name (StrictMode double-mount)', async () => {
    const host = createHost();
    installHost(host);
    const onError = vi.fn();

    const disposeA = registerTools([makeTool('search_artworks')], { onError });
    const disposeB = registerTools([makeTool('search_artworks')], { onError });
    await waitForWebMcpRegistry();

    expect(host.registerTool).toHaveBeenCalledTimes(1);
    expect(onError).not.toHaveBeenCalled();

    // First owner leaving must not strip the tool from the second owner.
    disposeA();
    await waitForWebMcpRegistry();
    expect(host.registered.has('search_artworks')).toBe(true);

    disposeB();
    await waitForWebMcpRegistry();
    expect(host.registered.has('search_artworks')).toBe(false);
    expect(getRegisteredToolNames()).toEqual([]);
  });

  it('survives a full unmount/remount cycle', async () => {
    const host = createHost();
    installHost(host);

    const dispose = registerTools([makeTool('browse_collection')]);
    await waitForWebMcpRegistry();
    dispose();
    await waitForWebMcpRegistry();

    registerTools([makeTool('browse_collection')]);
    await waitForWebMcpRegistry();

    expect(host.registered.has('browse_collection')).toBe(true);
    expect(host.registerTool).toHaveBeenCalledTimes(2);
  });

  it('is safe to dispose twice', async () => {
    const host = createHost();
    installHost(host);
    const dispose = registerTools([makeTool('list_collections')]);
    await waitForWebMcpRegistry();

    dispose();
    dispose();
    await waitForWebMcpRegistry();

    expect(host.unregisterTool).toHaveBeenCalledTimes(1);
  });

  it('rejects malformed tool names without touching the host', () => {
    const host = createHost();
    installHost(host);
    const onError = vi.fn();

    registerTools([makeTool('not a valid name!')], { onError });

    expect(host.registerTool).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining('Invalid WebMCP tool name'),
      }),
      { toolName: 'not a valid name!' }
    );
  });

  it('reports a host rejection and lets a later mount retry', async () => {
    const host = createHost();
    installHost(host);
    const onError = vi.fn();

    // Something outside the registry already claimed the name.
    host.registered.set('search_artworks', makeTool('search_artworks'));

    registerTools([makeTool('search_artworks')], { onError });
    await waitForWebMcpRegistry();

    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining('already registered') }),
      { toolName: 'search_artworks' }
    );
    expect(getRegisteredToolNames()).toEqual([]);
  });

  it('falls back to an unregister handle when the host returns one', async () => {
    const unregister = vi.fn();
    const host = createHost({
      registerTool: vi.fn(async () => ({ unregister })),
      unregisterTool: undefined,
    });
    installHost(host);

    const dispose = registerTools([makeTool('show_artwork')]);
    await waitForWebMcpRegistry();
    dispose();
    await waitForWebMcpRegistry();

    expect(unregister).toHaveBeenCalledTimes(1);
  });

  it('falls back to provideContext when no per-tool teardown exists', async () => {
    const provideContext = vi.fn();
    const host = createHost({
      registerTool: vi.fn(async () => undefined),
      unregisterTool: undefined,
      provideContext,
    });
    installHost(host);

    const disposeA = registerTools([makeTool('a')]);
    registerTools([makeTool('b')]);
    await waitForWebMcpRegistry();

    disposeA();
    await waitForWebMcpRegistry();

    expect(provideContext).toHaveBeenCalledTimes(1);
    const survivors = provideContext.mock.calls[0]?.[0] as {
      tools: ModelContextTool[];
    };
    expect(survivors.tools.map((tool) => tool.name)).toEqual(['b']);
  });
});

describe('execute wrapper', () => {
  it('refuses to run when the signal is already aborted', async () => {
    const host = createHost();
    installHost(host);
    const body = vi.fn(async () => ({ ok: true }));

    registerTools([makeTool('search_artworks', body)]);
    await waitForWebMcpRegistry();

    const controller = new AbortController();
    controller.abort();

    await expect(
      host.registered.get('search_artworks')!.execute({}, { signal: controller.signal })
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(body).not.toHaveBeenCalled();
  });

  it('passes the signal through to the tool body', async () => {
    const host = createHost();
    installHost(host);
    let seen: AbortSignal | undefined;

    registerTools([
      makeTool('search_artworks', async (_input, options) => {
        seen = options.signal;
        return { ok: true };
      }),
    ]);
    await waitForWebMcpRegistry();

    const controller = new AbortController();
    await host.registered
      .get('search_artworks')!
      .execute({}, { signal: controller.signal });

    expect(seen).toBe(controller.signal);
  });

  it('aborts a result that resolves after cancellation', async () => {
    const host = createHost();
    installHost(host);
    const controller = new AbortController();

    registerTools([
      makeTool('search_artworks', async () => {
        controller.abort();
        return { results: [] };
      }),
    ]);
    await waitForWebMcpRegistry();

    await expect(
      host.registered.get('search_artworks')!.execute({}, { signal: controller.signal })
    ).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('reports each call to the activity observer', async () => {
    const host = createHost();
    installHost(host);
    const onStart = vi.fn(() => 'record-1');
    const onSettle = vi.fn();

    registerTools([makeTool('search_artworks', async () => ({ count: 3 }))], {
      onExecute: { onStart, onSettle },
    });
    await waitForWebMcpRegistry();

    await host.registered
      .get('search_artworks')!
      .execute({ query: 'storm' }, {});

    expect(onStart).toHaveBeenCalledWith(
      expect.objectContaining({ toolName: 'search_artworks', input: { query: 'storm' } })
    );
    expect(onSettle).toHaveBeenCalledWith('record-1', {
      status: 'ok',
      result: { count: 3 },
    });
  });

  it('reports failures to the activity observer and rethrows', async () => {
    const host = createHost();
    installHost(host);
    const onSettle = vi.fn();

    registerTools([
      makeTool('search_artworks', async () => {
        throw new Error('upstream exploded');
      }),
    ], { onExecute: { onStart: () => 'record-1', onSettle } });
    await waitForWebMcpRegistry();

    await expect(
      host.registered.get('search_artworks')!.execute({}, {})
    ).rejects.toThrow('upstream exploded');
    expect(onSettle).toHaveBeenCalledWith('record-1', {
      status: 'error',
      message: 'upstream exploded',
    });
  });
});
