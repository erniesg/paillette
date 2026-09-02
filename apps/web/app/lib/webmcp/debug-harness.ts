/**
 * A dev-only stand-in for a WebMCP host, so the tool surface can be exercised
 * end-to-end in an ordinary browser.
 *
 * We cannot run ChatGPT's in-app browser from CI or from a script, and Chrome
 * 149's flag needs a restart. Without something like this the first time the
 * tools ever ran would be on camera. Activating `?webmcp-debug` installs a
 * `document.modelContext` that enforces the parts of the spec we depend on —
 * unique names, duplicate registration rejects, `execute` receives an
 * `AbortSignal` — and exposes `window.__paillette_webmcp` for driving each tool
 * against the real endpoints.
 *
 * It is inert unless that query parameter is present, so it cannot affect a
 * normal visit or shadow a genuine host.
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
 * Installs the stub (if no real host exists) and the `window.__paillette_webmcp`
 * driver. Returns a disposer. Safe to call more than once.
 */
export const installWebMcpDebugHarness = (): (() => void) => {
  if (typeof document === 'undefined') return () => {};

  const hadRealHost = 'modelContext' in document && Boolean(document.modelContext);
  if (!hadRealHost) {
    Object.defineProperty(document, 'modelContext', {
      value: createStubHost(),
      configurable: true,
      writable: true,
    });
  }

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

  return () => {
    if (window.__paillette_webmcp === api) {
      delete window.__paillette_webmcp;
    }
    if (!hadRealHost) {
      delete (document as { modelContext?: unknown }).modelContext;
    }
  };
};
