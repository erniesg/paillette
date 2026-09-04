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
  invokeRegisteredTool,
} from '../registry';
import {
  createPailletteTools,
  PAILLETTE_TOOL_COUNT,
  PAILLETTE_TOOL_NAMES,
} from '../tools';

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

  it('re-registers immediately after a dispose, without waiting for it to land', async () => {
    // React tears down and re-runs an effect in the same tick, so the new
    // registerTool is queued while the old unregisterTool is still in flight.
    // When the two were not serialised the host rejected the duplicate, the
    // unregister then completed, and the page ended up with the tool surface
    // gone and every name reported as already registered.
    const host = createHost();
    installHost(host);
    const onError = vi.fn();

    // No await anywhere in here: React runs mount, cleanup and mount again in
    // one synchronous commit, so the first registration has not even reached
    // the host by the time the second one is queued.
    const dispose = registerTools([makeTool('browse_collection')], { onError });
    dispose();
    registerTools([makeTool('browse_collection')], { onError });
    await waitForWebMcpRegistry();

    expect(onError).not.toHaveBeenCalled();
    expect(host.registered.has('browse_collection')).toBe(true);
    expect(getRegisteredToolNames()).toEqual(['browse_collection']);
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

describe('invoking a registered tool from the page', () => {
  /**
   * On a real host `getTools()` returns descriptors with no `execute` — Chrome
   * 152 with --enable-features=WebMCPTesting hands back all seventeen of ours
   * that way, because executing belongs to the host. Anything page-side that
   * runs a tool has to reach the function this page registered instead.
   */
  it('runs the registered implementation and passes a signal', async () => {
    installHost(createHost());
    const execute = vi.fn(
      async (
        _input: Record<string, unknown>,
        _options: { signal: AbortSignal }
      ) => ({ ok: true })
    ) as unknown as ModelContextTool['execute'] & {
      mock: { calls: [Record<string, unknown>, { signal: AbortSignal }][] };
    };
    registerTools([makeTool('page_side_tool', execute)]);
    await waitForWebMcpRegistry();

    const result = await invokeRegisteredTool('page_side_tool', { a: 1 });

    expect(result).toEqual({ ok: true });
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute.mock.calls[0]![0]).toEqual({ a: 1 });
    expect(execute.mock.calls[0]![1].signal).toBeInstanceOf(AbortSignal);
  });

  it('returns null for a tool this page never registered', async () => {
    installHost(createHost());
    registerTools([makeTool('search_artworks')]);
    await waitForWebMcpRegistry();

    expect(await invokeRegisteredTool('not_a_tool', {})).toBeNull();
  });
});

/**
 * The number in the README, the devpost copy and the submission pack.
 *
 * It has been wrong twice — 17 when it was 21, then 21 when the exhibition
 * tools took it to 25 — because it lives in five documents and was computed in
 * none of them. This is what makes a stale number a failing test rather than a
 * line somebody has to notice.
 */
describe('the tool surface a judge can count', () => {
  it('registers exactly the tools it says it does', () => {
    const built = createPailletteTools({
      navigate: () => {},
      getPageContext: () => ({
        pathname: '/nga/search',
        search: '',
        collectionId: 'nga',
        query: '',
        facet: null,
        colour: null,
      }),
    });

    expect(built.map((tool) => tool.name)).toEqual([...PAILLETTE_TOOL_NAMES]);
    expect(PAILLETTE_TOOL_COUNT).toBe(25);
  });
});

describe('remount', () => {
  it('survives StrictMode mount → cleanup → mount without losing the host', async () => {
    // The exact sequence React runs in development, with no await between the
    // phases — which is the point. The teardown's `unregisterTool` is still in
    // flight when the second mount calls `registerTool`.
    const host = createHost();
    installHost(host);

    const disposeFirst = registerTools([makeTool('get_view_context')]);
    disposeFirst();
    const disposeSecond = registerTools([makeTool('get_view_context')]);

    await waitForWebMcpRegistry();

    expect(getRegisteredToolNames()).toEqual(['get_view_context']);
    expect([...host.registered.keys()]).toEqual(['get_view_context']);
    expect(await getHostTools()).toHaveLength(1);

    disposeSecond();
    await waitForWebMcpRegistry();
    expect([...host.registered.keys()]).toEqual([]);
  });

  it('reports no duplicate-registration error across a remount', async () => {
    const host = createHost();
    installHost(host);
    const onError = vi.fn();

    registerTools([makeTool('redeal')], { onError })();
    registerTools([makeTool('redeal')], { onError });
    await waitForWebMcpRegistry();

    expect(onError).not.toHaveBeenCalled();
    expect([...host.registered.keys()]).toEqual(['redeal']);
  });

  it('holds the whole surface through a remount, not just one tool', async () => {
    const host = createHost();
    installHost(host);
    const surface = ['flag_artworks', 'redeal', 'search_by_exemplars'];

    registerTools(surface.map((name) => makeTool(name)))();
    registerTools(surface.map((name) => makeTool(name)));
    await waitForWebMcpRegistry();

    expect([...host.registered.keys()].sort()).toEqual([...surface].sort());
  });
});
