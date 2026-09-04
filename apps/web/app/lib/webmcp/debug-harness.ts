/**
 * A stand-in for a WebMCP host, so the page's own tools are usable in an
 * ordinary browser — and, under `?webmcp-debug`, drivable from the console.
 *
 * Two separate things, and they used to be one, which is the bug.
 *
 * The **stub host** claims `document.modelContext` when nothing else has. It
 * enforces the parts of the spec we depend on — unique names, duplicate
 * registration rejects, `execute` receives an `AbortSignal` — and it is what
 * the page's own prompt bar talks to. Without it there is no host, so the
 * tools never register and the bar never renders: a visitor who arrives at
 * staging with an ordinary browser saw a search page with no agent on it and
 * no sign that the rest of the build existed. Gating that on an undocumented
 * query parameter meant the submission only worked if you knew the incantation.
 * It never shadows a genuine host, so a real WebMCP browser is unaffected.
 *
 * The **debug driver** is `window.__paillette_webmcp`, for calling a tool by
 * name with arguments from the console or from a capture script. That is a
 * developer's back door into the page and stays behind `?webmcp-debug`.
 */

import type { ModelContext, ModelContextTool } from '~/types/webmcp';

export const WEBMCP_DEBUG_PARAM = 'webmcp-debug';

export interface WebMcpToolSummary {
  name: string;
  title?: string;
  readOnly: boolean;
  required: string[];
  properties: string[];
}

export interface WebMcpDebugApi {
  /** True when this is the stub rather than a real browser implementation. */
  stubbed: boolean;
  /** What the host believes is registered, as `getTools()` reports it. */
  tools: () => Promise<WebMcpToolSummary[]>;
  /** Invokes a tool exactly as a host would, with a live AbortSignal. */
  call: (
    name: string,
    input?: Record<string, unknown>,
    options?: { timeoutMs?: number }
  ) => Promise<unknown>;
  /** Starts a call and aborts it after `afterMs` — proves cancellation works. */
  callAndAbort: (
    name: string,
    input?: Record<string, unknown>,
    afterMs?: number
  ) => Promise<{ aborted: boolean; error?: string }>;
}

declare global {
  interface Window {
    __paillette_webmcp?: WebMcpDebugApi;
  }
}

export const isWebMcpDebugRequested = (): boolean => {
  if (typeof window === 'undefined') return false;
  try {
    return new URLSearchParams(window.location.search).has(WEBMCP_DEBUG_PARAM);
  } catch {
    return false;
  }
};

const createStubHost = (): ModelContext => {
  const tools = new Map<string, ModelContextTool<any>>();
  return {
    registerTool: async (tool) => {
      if (tools.has(tool.name)) {
        // Matches the spec: a duplicate name rejects.
        throw new Error(`Tool "${tool.name}" is already registered.`);
      }
      tools.set(tool.name, tool);
    },
    unregisterTool: async (name) => {
      tools.delete(name);
    },
    getTools: async () => [...tools.values()],
  };
};

/**
 * Claim `document.modelContext` if nothing else has.
 *
 * Idempotent and never destructive: a genuine host is left exactly as it is,
 * and calling this twice is a no-op. Returns true if a real host was already
 * there, which is the only thing callers need to know.
 */
export const installModelContextStub = (): boolean => {
  if (typeof document === 'undefined') return false;
  const hadRealHost =
    'modelContext' in document && Boolean(document.modelContext);
  if (!hadRealHost) {
    Object.defineProperty(document, 'modelContext', {
      value: createStubHost(),
      configurable: true,
      writable: true,
    });
  }
  return hadRealHost;
};

/**
 * Installs the stub (if no real host exists) and the `window.__paillette_webmcp`
 * driver. Returns a disposer. Safe to call more than once.
 */
export const installWebMcpDebugHarness = (): (() => void) => {
  if (typeof document === 'undefined') return () => {};

  const hadRealHost = installModelContextStub();

  const context = document.modelContext;
  const findTool = async (name: string) => {
    const tools = (await context?.getTools?.()) ?? [];
    const tool = tools.find((candidate) => candidate.name === name);
    if (!tool) {
      throw new Error(
        `No tool "${name}". Registered: ${tools.map((t) => t.name).join(', ') || '(none)'}`
      );
    }
    return tool;
  };

  const api: WebMcpDebugApi = {
    stubbed: !hadRealHost,
    tools: async () => {
      const tools = (await context?.getTools?.()) ?? [];
      return tools.map((tool) => ({
        name: tool.name,
        ...(tool.title ? { title: tool.title } : {}),
        readOnly: tool.annotations?.readOnlyHint === true,
        required: (tool.inputSchema?.required as string[] | undefined) ?? [],
        properties: Object.keys(tool.inputSchema?.properties ?? {}),
      }));
    },
    call: async (name, input = {}, options = {}) => {
      const tool = await findTool(name);
      const controller = new AbortController();
      const timeout = options.timeoutMs
        ? setTimeout(() => controller.abort(), options.timeoutMs)
        : null;
      try {
        return await tool.execute(input, { signal: controller.signal });
      } finally {
        if (timeout) clearTimeout(timeout);
      }
    },
    callAndAbort: async (name, input = {}, afterMs = 5) => {
      const tool = await findTool(name);
      const controller = new AbortController();
      setTimeout(() => controller.abort(), afterMs);
      try {
        await tool.execute(input, { signal: controller.signal });
        return { aborted: false };
      } catch (error) {
        return {
          aborted: (error as { name?: string })?.name === 'AbortError',
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
  };

  window.__paillette_webmcp = api;

  // Only the driver is taken down. The host stays: it is the page's own, the
  // prompt bar is talking to it, and pulling it out from under a live bar was
  // the sort of teardown that only ever shows up on camera.
  return () => {
    if (window.__paillette_webmcp === api) {
      delete window.__paillette_webmcp;
    }
  };
};

/**
 * Claim `document.modelContext` as this module loads, rather than waiting for
 * a component to mount.
 *
 * A genuine host is present before a single line of the page's script runs, so
 * anything that asks "is there a host?" during mount must find the same answer
 * with the stub as it would with Chrome. It did not: the bridge installed the
 * stub from an effect, effects run child-first, and the in-page prompt bar —
 * which checks once on mount and renders nothing if there is no host — had
 * already decided there was none. The result was a page with the whole tool
 * surface registered and no way to talk to it.
 *
 * Unconditional, because the host is not a debugging aid: it is what the
 * page's own agent runs on, and a visitor who arrives without a WebMCP browser
 * is the common case rather than the exception. `?webmcp-debug` still gates
 * `window.__paillette_webmcp`, which is a back door and stays one.
 */
installModelContextStub();

let ensured = false;

/**
 * The debug driver, installed at module-evaluation time rather than from an
 * effect. `night/review`'s fix for the mount-order race, kept whole.
 *
 * Ordering is the whole point. React runs a route subtree's effects *before*
 * those of a later sibling in the tree, and `WebMcpBridge` is rendered after
 * `<Outlet />` in `root.tsx`, so anything that reads `document.modelContext`
 * from its own mount effect looked before the bridge's effect had installed
 * anything, found nothing, and latched off for the lifetime of the page.
 *
 * The host half of that race is gone — the stub is claimed above, on every
 * visit — but a capture script reaching for `window.__paillette_webmcp` on
 * load hits the same ordering problem, so the driver is installed the same
 * way. Still gated on the query parameter, and still a no-op on the server.
 */
export const ensureWebMcpDebugHarness = (): void => {
  if (ensured || !isWebMcpDebugRequested()) return;
  ensured = true;
  installWebMcpDebugHarness();
};

export const __resetWebMcpDebugHarnessForTest = () => {
  ensured = false;
};

ensureWebMcpDebugHarness();
