/**
 * Ambient types for the WebMCP browser API.
 *
 * WebMCP (`document.modelContext`) lets a page hand a browser-resident agent a
 * set of first-class, schema-described tools instead of making it guess at the
 * DOM. It is experimental and ships in ChatGPT's in-app browser and in Chrome
 * 149+ behind `chrome://flags/#enable-webmcp-testing`, so it is absent from
 * `@types/*` and from every browser we can test in CI. These declarations are
 * the contract Paillette codes against; the runtime bridge in
 * `~/lib/webmcp/registry.ts` feature-detects before touching any of it.
 *
 * Deliberately permissive in three places, because the API is still moving:
 *  - `registerTool` may return nothing, a registration handle, or a promise of
 *    either, depending on implementation vintage.
 *  - `unregisterTool` and `provideContext` are optional; the registry probes
 *    for whichever teardown path the host actually offers.
 *  - `getTools` may be sync or async.
 */

/** JSON Schema (draft 2020-12 subset) describing a tool's `input` argument. */
export interface ModelContextJSONSchema {
  type?: string | string[];
  title?: string;
  description?: string;
  properties?: Record<string, ModelContextJSONSchema>;
  items?: ModelContextJSONSchema;
  required?: string[];
  enum?: unknown[];
  const?: unknown;
  default?: unknown;
  examples?: unknown[];
  format?: string;
  pattern?: string;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  minItems?: number;
  maxItems?: number;
  additionalProperties?: boolean | ModelContextJSONSchema;
  [keyword: string]: unknown;
}

/**
 * MCP tool annotations. `readOnlyHint` is the one that matters most here: it
 * tells the agent (and the human's client UI) whether calling the tool can
 * change state, which is what drives confirmation prompts.
 */
export interface ModelContextToolAnnotations {
  /** True when `execute` cannot modify anything the user would care about. */
  readOnlyHint?: boolean;
  /** True when a non-read-only tool may perform irreversible/destructive work. */
  destructiveHint?: boolean;
  /** True when repeating the same call with the same input is a no-op. */
  idempotentHint?: boolean;
  /** True when the tool may touch entities outside this page's own data. */
  openWorldHint?: boolean;
  [annotation: string]: unknown;
}

export interface ModelContextExecuteOptions {
  /**
   * Aborted when the agent (or the user) cancels the turn. Every Paillette
   * tool threads this into its `fetch` and re-checks it after awaiting.
   */
  signal?: AbortSignal;
}

export interface ModelContextTool<Input = Record<string, unknown>> {
  /** Unique per document. 1-128 chars from [A-Za-z0-9_-.]. Re-registering rejects. */
  name: string;
  /** Human-readable label shown in agent UIs. */
  title?: string;
  /** What the tool does and when the agent should reach for it. */
  description: string;
  /** JSON Schema for `input`. */
  inputSchema: ModelContextJSONSchema;
  annotations?: ModelContextToolAnnotations;
  /** Result is JSON-serialised by the host: return plain data, never DOM nodes. */
  execute: (
    input: Input,
    options: ModelContextExecuteOptions
  ) => unknown | Promise<unknown>;
}

/** Handle returned by some implementations of `registerTool`. */
export interface ModelContextToolRegistration {
  unregister: () => void | Promise<void>;
}

export interface ModelContext {
  registerTool: (
    tool: ModelContextTool<any>
  ) =>
    | void
    | ModelContextToolRegistration
    | Promise<void | ModelContextToolRegistration>;
  unregisterTool?: (name: string) => void | Promise<void>;
  getTools?: () =>
    | ModelContextTool<any>[]
    | Promise<ModelContextTool<any>[]>;
  /** Older/alternate shape: replace the whole tool set in one call. */
  provideContext?: (context: {
    tools: ModelContextTool<any>[];
  }) => void | Promise<void>;
}

declare global {
  interface Document {
    modelContext?: ModelContext;
  }
  interface Navigator {
    modelContext?: ModelContext;
  }
}
