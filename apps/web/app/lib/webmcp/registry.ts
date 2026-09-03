/**
 * The WebMCP bridge core.
 *
 * One job: take a list of tool definitions and put them on
 * `document.modelContext` exactly once, in a way that survives React
 * StrictMode's double-mount, route changes, and an experimental host API whose
 * teardown affordance we cannot rely on.
 *
 * Everything here is defensive on purpose:
 *  - The page must be byte-for-byte identical in a browser with no WebMCP, so
 *    every entry point feature-detects first and returns a no-op disposer.
 *  - Tool names are unique per document and re-registering one *rejects*, so
 *    registration is reference-counted by name rather than by caller.
 *  - `registerTool` may return void, a handle, or a promise of either; three
 *    different teardown paths are probed in order.
 */

import type {
  ModelContext,
  ModelContextExecuteOptions,
  ModelContextTool,
  ModelContextToolRegistration,
} from '~/types/webmcp';

export type WebMcpTool = ModelContextTool<any>;

/** Why the bridge did or did not attach. Surfaced in the debug panel. */
export type WebMcpAvailability =
  | { supported: true; via: 'document' | 'navigator' }
  | { supported: false; reason: 'no-document' | 'no-model-context' };

interface RegistryEntry {
  tool: WebMcpTool;
  /** Opaque tokens; one per live caller that asked for this tool. */
  owners: Set<object>;
  teardown: (() => void | Promise<void>) | null;
  /** Serialises register/unregister for this name so remounts cannot race. */
  queue: Promise<unknown>;
}

const entries = new Map<string, RegistryEntry>();

export interface RegisterToolsOptions {
  /**
   * Called for recoverable problems (host rejected a tool, teardown
   * unsupported). Never throws into the caller's render.
   */
  onError?: (error: Error, context: { toolName?: string }) => void;
  /** Wraps every `execute` — used to feed the on-page agent activity panel. */
  onExecute?: WebMcpExecuteObserver;
}

export interface WebMcpExecutionRecord {
  toolName: string;
  input: unknown;
  startedAt: number;
}

export interface WebMcpExecuteObserver {
  onStart: (record: WebMcpExecutionRecord) => string;
  onSettle: (
    id: string,
    outcome:
      | { status: 'ok'; result: unknown }
      | { status: 'error'; message: string }
      | { status: 'aborted' }
  ) => void;
}

const NAME_PATTERN = /^[A-Za-z0-9_.-]{1,128}$/;

/** Resolves the host object without touching it if the API is absent. */
export const getModelContext = (): ModelContext | null => {
  if (typeof document === 'undefined') return null;
  if ('modelContext' in document && document.modelContext) {
    return document.modelContext;
  }
  // Some vintages of the proposal expose it on `navigator` instead.
  if (
    typeof navigator !== 'undefined' &&
    'modelContext' in navigator &&
    navigator.modelContext
  ) {
    return navigator.modelContext;
  }
  return null;
};

export const getWebMcpAvailability = (): WebMcpAvailability => {
  if (typeof document === 'undefined') {
    return { supported: false, reason: 'no-document' };
  }
  if ('modelContext' in document && document.modelContext) {
    return { supported: true, via: 'document' };
  }
  if (
    typeof navigator !== 'undefined' &&
    'modelContext' in navigator &&
    navigator.modelContext
  ) {
    return { supported: true, via: 'navigator' };
  }
  return { supported: false, reason: 'no-model-context' };
};

export const isWebMcpAvailable = () => getWebMcpAvailability().supported;

/** Names currently held by this registry. Diagnostics + tests. */
export const getRegisteredToolNames = () => [...entries.keys()].sort();

const isAbortError = (error: unknown) =>
  typeof error === 'object' &&
  error !== null &&
  'name' in error &&
  (error as { name?: unknown }).name === 'AbortError';

const toError = (value: unknown) =>
  value instanceof Error ? value : new Error(String(value));

const hasUnregisterHandle = (
  value: unknown
): value is ModelContextToolRegistration =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as ModelContextToolRegistration).unregister === 'function';

/**
 * Wraps a tool's `execute` so that every tool gets abort handling and activity
 * reporting for free, and so a tool body can never hand the host something
 * that will not survive `JSON.stringify`.
 */
const instrument = (
  tool: WebMcpTool,
  options: RegisterToolsOptions
): WebMcpTool => ({
  ...tool,
  execute: async (input: unknown, executeOptions: ModelContextExecuteOptions) => {
    const signal = executeOptions?.signal;
    // Cheap pre-flight: the agent may have cancelled between dispatch and here.
    if (signal?.aborted) {
      throw new DOMException('Tool call aborted before it started.', 'AbortError');
    }

    const recordId = options.onExecute?.onStart({
      toolName: tool.name,
      input,
      startedAt: Date.now(),
    });

    try {
      const result = await tool.execute(input as never, {
        ...executeOptions,
        signal,
      });
      // Re-check: a long fetch can resolve after the turn was cancelled.
      if (signal?.aborted) {
        throw new DOMException('Tool call aborted.', 'AbortError');
      }
      if (recordId && options.onExecute) {
        options.onExecute.onSettle(recordId, { status: 'ok', result });
      }
      return result;
    } catch (error) {
      if (recordId && options.onExecute) {
        options.onExecute.onSettle(
          recordId,
          isAbortError(error)
            ? { status: 'aborted' }
            : { status: 'error', message: toError(error).message }
        );
      }
      throw error;
    }
  },
});

const resolveTeardown = (
  context: ModelContext,
  name: string,
  registrationResult: unknown,
  options: RegisterToolsOptions
): (() => void | Promise<void>) | null => {
  // 1. Preferred: the host handed us an explicit handle.
  if (hasUnregisterHandle(registrationResult)) {
    return () => registrationResult.unregister();
  }
  // 2. Next: an imperative unregister by name.
  if (typeof context.unregisterTool === 'function') {
    return () => context.unregisterTool!(name);
  }
  // 3. Last resort: re-declare the whole surviving tool set.
  if (typeof context.provideContext === 'function') {
    return () =>
      context.provideContext!({
        tools: [...entries.values()]
          .filter((entry) => entry.tool.name !== name)
          .map((entry) => entry.tool),
      });
  }
  options.onError?.(
    new Error(
      `WebMCP host exposes no way to unregister "${name}"; it will stay registered for the life of the document.`
    ),
    { toolName: name }
  );
  return null;
};

/**
 * Registers `tools` and returns a disposer.
 *
 * Safe to call repeatedly with overlapping tool sets: a name already held is
 * reference-counted, not re-registered (which the spec says would reject).
 * The disposer releases only this caller's claim.
 */
export const registerTools = (
  tools: readonly WebMcpTool[],
  options: RegisterToolsOptions = {}
): (() => void) => {
  const context = getModelContext();
  if (!context) {
    // No WebMCP in this browser. The page behaves exactly as it always has.
    return () => {};
  }

  const owner = {};
  const claimed: string[] = [];

  for (const tool of tools) {
    if (!NAME_PATTERN.test(tool.name)) {
      options.onError?.(
        new Error(
          `Invalid WebMCP tool name "${tool.name}": must be 1-128 chars of [A-Za-z0-9_.-].`
        ),
        { toolName: tool.name }
      );
      continue;
    }

    const existing = entries.get(tool.name);
    if (existing) {
      // Already live — StrictMode remount, or two routes wanting the same
      // tool. Claim it; do not re-register (the host would reject).
      existing.owners.add(owner);
      claimed.push(tool.name);
      continue;
    }

    const entry: RegistryEntry = {
      tool: instrument(tool, options),
      owners: new Set([owner]),
      teardown: null,
      queue: Promise.resolve(),
    };
    entries.set(tool.name, entry);
    claimed.push(tool.name);

    entry.queue = entry.queue
      .then(() => context.registerTool(entry.tool))
      .then((registrationResult) => {
        entry.teardown = resolveTeardown(
          context,
          tool.name,
          registrationResult,
          options
        );
      })
      .catch((error) => {
        // Host refused. Drop the entry so a later mount can retry cleanly.
        entries.delete(tool.name);
        options.onError?.(toError(error), { toolName: tool.name });
      });
  }

  let disposed = false;
  return () => {
    if (disposed) return;
    disposed = true;

    for (const name of claimed) {
      const entry = entries.get(name);
      if (!entry) continue;
      entry.owners.delete(owner);
      if (entry.owners.size > 0) continue;

      entries.delete(name);
      entry.queue = entry.queue
        .then(() => entry.teardown?.())
        .catch((error) => {
          options.onError?.(toError(error), { toolName: name });
        });
    }
  };
};

/**
 * Asks the host which tools it believes are registered. This is what a human
 * runs in the console at Gate 1 (`await document.modelContext.getTools()`), so
 * the bridge exposes the same thing programmatically for the debug harness.
 */
/**
 * Invoke a registered tool from inside the page.
 *
 * `getTools()` on a real host returns *descriptors* — Chrome 152 with
 * `--enable-features=WebMCPTesting` hands back all 17 of ours with no `execute`
 * on any of them, because executing is the host's job, not the page's. Anything
 * page-side that wants to run a tool (the in-page agent, the debug harness)
 * therefore cannot go through `getTools()`; it has to reach the function this
 * page registered, which is right here.
 *
 * Returns null when no such tool is registered, so a caller can say so rather
 * than throwing something opaque.
 */
export const invokeRegisteredTool = async (
  name: string,
  input: Record<string, unknown>,
  options: { signal?: AbortSignal } = {}
): Promise<unknown | null> => {
  const entry = entries.get(name);
  if (!entry) return null;
  const controller = options.signal ? null : new AbortController();
  return entry.tool.execute(input, {
    signal: options.signal ?? controller!.signal,
  });
};

/** Tool descriptors this page registered, execute included. */
export const getRegisteredTools = (): WebMcpTool[] =>
  [...entries.values()].map((entry) => entry.tool);

export const getHostTools = async (): Promise<WebMcpTool[]> => {
  const context = getModelContext();
  if (!context || typeof context.getTools !== 'function') return [];
  return (await context.getTools()) ?? [];
};

/** Flushes pending register/unregister work. Tests and the debug harness only. */
export const waitForWebMcpRegistry = async () => {
  await Promise.all([...entries.values()].map((entry) => entry.queue));
};

/** Test-only: drops all bookkeeping without calling the host. */
export const __resetWebMcpRegistryForTest = () => {
  entries.clear();
};
