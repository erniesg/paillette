import { Hono, type Context } from 'hono';
import { z } from 'zod';
import type { Env } from '../index';
import { requireAuthOrApiKey, type AuthPrincipal } from '../middleware/auth';
import { NGS_ORG_KEY } from '../utils/orgs';

type Variables = {
  auth: AuthPrincipal;
};

type AppBindings = {
  Bindings: Env;
  Variables: Variables;
};

type JsonRpcId = string | number | null;

const JsonRpcRequestSchema = z.object({
  jsonrpc: z.literal('2.0').optional(),
  id: z.union([z.string(), z.number(), z.null()]).optional(),
  method: z.string(),
  params: z.any().optional(),
});

const SearchArtworksArgsSchema = z.object({
  orgId: z.string().optional(),
  collection: z.string().optional(),
  query: z.string().trim().min(1),
  topK: z.number().int().min(1).max(100).optional().default(10),
  minScore: z.number().min(0).max(1).optional().default(0.3),
});

const LookupArtworkArgsSchema = z.object({
  orgId: z.string().optional(),
  collection: z.string().optional(),
  artworkId: z.string().trim().min(1),
});

const ColourSearchArgsSchema = z.object({
  orgId: z.string().optional(),
  collection: z.string().optional(),
  colors: z
    .array(z.string().regex(/^#[0-9a-f]{6}$/i))
    .min(1)
    .max(8),
  matchMode: z.enum(['any', 'all']).optional().default('any'),
  threshold: z.number().min(0).max(441.7).optional().default(18),
  limit: z.number().int().min(1).max(100).optional().default(10),
});

const TranslateTextArgsSchema = z.object({
  text: z.string().trim().min(1).max(50000),
  sourceLang: z.literal('en').optional().default('en'),
  targetLang: z.enum(['zh', 'ms', 'ta']),
});

const ListOrgsArgsSchema = z.object({
  limit: z.number().int().min(1).max(100).optional().default(20),
});

const tools = [
  {
    name: 'list_orgs',
    title: 'List orgs',
    description:
      'List available Paillette collections and their short keys for REST or MCP calls.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: {
          type: 'integer',
          minimum: 1,
          maximum: 100,
          default: 20,
        },
      },
    },
  },
  {
    name: 'search_artworks',
    title: 'Search artworks',
    description:
      'Search an art collection by natural-language intent, subject, era, style, medium, or mood.',
    inputSchema: {
      type: 'object',
      properties: {
        orgId: {
          type: 'string',
          default: NGS_ORG_KEY,
          description: 'Collection key, slug, or UUID. NGS can be `ngs`.',
        },
        collection: {
          type: 'string',
          default: NGS_ORG_KEY,
          description: 'Alias for orgId.',
        },
        query: {
          type: 'string',
          description: 'Natural-language search query.',
        },
        topK: {
          type: 'integer',
          minimum: 1,
          maximum: 100,
          default: 10,
        },
        minScore: {
          type: 'number',
          minimum: 0,
          maximum: 1,
          default: 0.3,
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'lookup_artwork',
    title: 'Look up artwork',
    description:
      'Fetch source-labelled artwork metadata, imagery, catalogue fields, and colour data.',
    inputSchema: {
      type: 'object',
      properties: {
        orgId: {
          type: 'string',
          default: NGS_ORG_KEY,
        },
        collection: {
          type: 'string',
          default: NGS_ORG_KEY,
        },
        artworkId: {
          type: 'string',
          description: 'Artwork ID returned by search_artworks.',
        },
      },
      required: ['artworkId'],
    },
  },
  {
    name: 'colour_search',
    title: 'Colour search',
    description:
      'Find artworks whose extracted palettes are near one or more target hex colours.',
    inputSchema: {
      type: 'object',
      properties: {
        orgId: {
          type: 'string',
          default: NGS_ORG_KEY,
        },
        collection: {
          type: 'string',
          default: NGS_ORG_KEY,
        },
        colors: {
          type: 'array',
          minItems: 1,
          maxItems: 8,
          items: {
            type: 'string',
            pattern: '^#[0-9a-fA-F]{6}$',
          },
        },
        matchMode: {
          type: 'string',
          enum: ['any', 'all'],
          default: 'any',
        },
        threshold: {
          type: 'number',
          minimum: 0,
          maximum: 441.7,
          default: 18,
        },
        limit: {
          type: 'integer',
          minimum: 1,
          maximum: 100,
          default: 10,
        },
      },
      required: ['colors'],
    },
  },
  {
    name: 'translate_text',
    title: 'Translate text',
    description:
      'Translate English gallery text into Chinese, Malay, or Tamil. Counts against the authenticated user lifetime translation allowance.',
    inputSchema: {
      type: 'object',
      properties: {
        text: {
          type: 'string',
          minLength: 1,
          maxLength: 50000,
        },
        sourceLang: {
          type: 'string',
          enum: ['en'],
          default: 'en',
        },
        targetLang: {
          type: 'string',
          enum: ['zh', 'ms', 'ta'],
        },
      },
      required: ['text', 'targetLang'],
    },
  },
];

const mcpRoutes = new Hono<AppBindings>();

const jsonRpcResult = (id: JsonRpcId | undefined, result: unknown) => ({
  jsonrpc: '2.0',
  id: id ?? null,
  result,
});

const jsonRpcError = (
  id: JsonRpcId | undefined,
  code: number,
  message: string,
  data?: unknown
) => ({
  jsonrpc: '2.0',
  id: id ?? null,
  error: {
    code,
    message,
    ...(data === undefined ? {} : { data }),
  },
});

const copyHeader = (source: Headers, target: Headers, name: string) => {
  const value = source.get(name);
  if (value) {
    target.set(name, value);
  }
};

const callApi = async (
  c: Context<AppBindings>,
  path: string,
  init: RequestInit = {}
) => {
  const url = new URL(`/api/v1${path}`, c.req.url);
  const headers = new Headers(init.headers);
  const incoming = c.req.raw.headers;

  copyHeader(incoming, headers, 'Authorization');
  copyHeader(incoming, headers, 'X-API-Key');
  copyHeader(incoming, headers, 'X-User-Id');
  copyHeader(incoming, headers, 'X-User-Email');
  copyHeader(incoming, headers, 'X-User-Name');

  const response = await fetch(url, {
    ...init,
    headers,
  });
  const payload = (await response.json()) as any;

  if (!response.ok || payload.success === false) {
    throw new Error(
      payload.error?.message || `API call failed: ${response.status}`
    );
  }

  return payload.data ?? payload;
};

const asToolContent = (data: unknown) => ({
  content: [
    {
      type: 'text',
      text: JSON.stringify(data, null, 2),
    },
  ],
  structuredContent: data,
});

const callTool = async (
  c: Context<AppBindings>,
  name: string,
  args: unknown
) => {
  if (name === 'list_orgs') {
    const input = ListOrgsArgsSchema.parse(args ?? {});
    const data = await callApi(c, `/orgs?limit=${input.limit}`);
    return asToolContent({ orgs: data });
  }

  if (name === 'search_artworks') {
    const input = SearchArtworksArgsSchema.parse(args ?? {});
    const collection = input.collection || input.orgId || NGS_ORG_KEY;
    const data = await callApi(
      c,
      `/orgs/${encodeURIComponent(collection)}/search/text`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: input.query,
          topK: input.topK,
          minScore: input.minScore,
        }),
      }
    );
    return asToolContent(data);
  }

  if (name === 'lookup_artwork') {
    const input = LookupArtworkArgsSchema.parse(args ?? {});
    const collection = input.collection || input.orgId || NGS_ORG_KEY;
    const data = await callApi(
      c,
      `/orgs/${encodeURIComponent(collection)}/artworks/${encodeURIComponent(
        input.artworkId
      )}`
    );
    return asToolContent(data);
  }

  if (name === 'colour_search') {
    const input = ColourSearchArgsSchema.parse(args ?? {});
    const collection = input.collection || input.orgId || NGS_ORG_KEY;
    const data = await callApi(
      c,
      `/orgs/${encodeURIComponent(collection)}/search/color`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          colors: input.colors,
          matchMode: input.matchMode,
          threshold: input.threshold,
          limit: input.limit,
        }),
      }
    );
    return asToolContent(data);
  }

  if (name === 'translate_text') {
    const input = TranslateTextArgsSchema.parse(args ?? {});
    const data = await callApi(c, '/translate/text', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    return asToolContent(data);
  }

  throw new Error(`Unknown MCP tool: ${name}`);
};

mcpRoutes.use('*', requireAuthOrApiKey as any);

mcpRoutes.get('/', (c) =>
  c.json({
    name: 'paillette-mcp',
    transport: 'streamable-http-json-rpc',
    endpoint: '/api/v1/mcp',
    tools: tools.map(({ name, title, description, inputSchema }) => ({
      name,
      title,
      description,
      inputSchema,
    })),
  })
);

mcpRoutes.post('/', async (c) => {
  let parsed: z.infer<typeof JsonRpcRequestSchema>;

  try {
    parsed = JsonRpcRequestSchema.parse(await c.req.json());
  } catch (error) {
    return c.json(
      jsonRpcError(null, -32700, 'Invalid JSON-RPC request', error),
      400
    );
  }

  try {
    if (parsed.method === 'initialize') {
      return c.json(
        jsonRpcResult(parsed.id, {
          protocolVersion: '2024-11-05',
          capabilities: {
            tools: {},
          },
          serverInfo: {
            name: 'paillette',
            version: '0.1.0',
          },
        })
      );
    }

    if (parsed.method === 'tools/list') {
      return c.json(jsonRpcResult(parsed.id, { tools }));
    }

    if (parsed.method === 'tools/call') {
      const params = z
        .object({
          name: z.string(),
          arguments: z.any().optional(),
        })
        .parse(parsed.params ?? {});
      return c.json(
        jsonRpcResult(
          parsed.id,
          await callTool(c, params.name, params.arguments ?? {})
        )
      );
    }

    return c.json(jsonRpcError(parsed.id, -32601, 'Method not found'), 404);
  } catch (error) {
    return c.json(
      jsonRpcError(
        parsed.id,
        -32603,
        error instanceof Error ? error.message : 'MCP tool call failed'
      ),
      500
    );
  }
});

export default mcpRoutes;
