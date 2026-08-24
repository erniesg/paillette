import { Hono, type Context } from 'hono';
import { z } from 'zod';
import type { Env } from '../index';
import {
  getAuth,
  requireAuthOrApiKey,
  type AuthPrincipal,
} from '../middleware/auth';
import { NGS_ORG_KEY } from '../utils/orgs';

type Variables = {
  auth: AuthPrincipal;
  usageEventId: string;
};

type AppBindings = {
  Bindings: Env;
  Variables: Variables;
};

type JsonRpcId = string | number | null;

const DEFAULT_LOGTO_ISSUER = 'https://m2fmae.logto.app/oidc';
const MCP_ALL_SCOPE = 'mcp:all';
const MCP_READ_SCOPE = 'mcp:read';
const MCP_WRITE_SCOPE = 'mcp:write';
const ARTWORKS_READ_SCOPE = 'artworks:read';
const ARTWORKS_WRITE_SCOPE = 'artworks:write';
const COLLECTIONS_READ_SCOPE = 'collections:read';
const COLLECTIONS_WRITE_SCOPE = 'collections:write';
const TRANSLATIONS_CREATE_SCOPE = 'translations:create';
const EXTRACT_CREATE_SCOPE = 'extract:create';
const MCP_SCOPES_SUPPORTED = [
  MCP_ALL_SCOPE,
  MCP_READ_SCOPE,
  MCP_WRITE_SCOPE,
  ARTWORKS_READ_SCOPE,
  ARTWORKS_WRITE_SCOPE,
  COLLECTIONS_READ_SCOPE,
  COLLECTIONS_WRITE_SCOPE,
  TRANSLATIONS_CREATE_SCOPE,
  EXTRACT_CREATE_SCOPE,
];

export const getMcpResourceUri = (
  requestUrl: string,
  env: Pick<Env, 'LOGTO_API_RESOURCE'>
) => {
  const url = new URL(requestUrl);
  return env.LOGTO_API_RESOURCE || url.origin;
};

export const getMcpProtectedResourceMetadataUrl = (requestUrl: string) => {
  const url = new URL(requestUrl);
  return `${url.origin}/.well-known/oauth-protected-resource`;
};

export const getMcpProtectedResourceMetadata = (
  requestUrl: string,
  env: Pick<Env, 'LOGTO_API_RESOURCE' | 'LOGTO_ISSUER'>
) => ({
  resource: getMcpResourceUri(requestUrl, env),
  resource_name: 'Paillette MCP',
  resource_documentation: 'https://paillette.berlayar.ai/docs/api#mcp',
  authorization_servers: [env.LOGTO_ISSUER || DEFAULT_LOGTO_ISSUER],
  bearer_methods_supported: ['header'],
  scopes_supported: MCP_SCOPES_SUPPORTED,
});

const getMcpAuthenticateHeader = (requestUrl: string) =>
  `Bearer resource_metadata="${getMcpProtectedResourceMetadataUrl(
    requestUrl
  )}", scope="${MCP_READ_SCOPE}"`;

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

const ExtractImagesArgsSchema = z.object({
  imageUrls: z.array(z.string().url()).min(1).max(50),
  target: z.enum(['object', 'content']).optional().default('object'),
  preserveFilenames: z.boolean().optional().default(true),
  filenamePrefix: z.string().trim().max(80).optional().default(''),
  filenameSuffix: z.string().trim().max(80).optional().default(''),
  returnPreview: z.boolean().optional().default(false),
});

const ListOrgsArgsSchema = z.object({
  limit: z.number().int().min(1).max(100).optional().default(20),
});

const ListCollectionsArgsSchema = z.object({
  orgId: z.string().optional(),
  collection: z.string().optional(),
});

const UpsertCollectionArgsSchema = z.object({
  orgId: z.string().optional(),
  collection: z.string().optional(),
  collectionId: z.string().trim().min(1).max(160).optional(),
  name: z.string().trim().min(1).max(255),
  description: z.string().max(2000).nullable().optional(),
  thumbnailArtworkId: z.string().trim().min(1).max(160).nullable().optional(),
});

const UpsertArtworkRecordArgsSchema = z.object({
  orgId: z.string().optional(),
  collection: z.string().optional(),
  id: z.string().trim().min(1).max(160).optional(),
  collectionId: z.string().trim().min(1).max(160).nullable().optional(),
  title: z.string().trim().min(1).max(500).optional(),
  artist: z.string().max(255).nullable().optional(),
  year: z.number().int().min(0).max(9999).nullable().optional(),
  medium: z.string().max(255).nullable().optional(),
  description: z.string().max(5000).nullable().optional(),
  accessionNumber: z.string().max(255).nullable().optional(),
  sourceInstitution: z.string().max(255).nullable().optional(),
  sourceCollection: z.string().max(255).nullable().optional(),
  sourceRecordId: z.string().max(255).nullable().optional(),
  sourceUrl: z.string().url().nullable().optional(),
  imageUrl: z.string().url().nullable().optional(),
  thumbnailUrl: z.string().url().nullable().optional(),
  fieldSources: z.record(z.any()).optional(),
  customMetadata: z.record(z.any()).optional(),
});

const CollectionArtworkArgsSchema = z.object({
  orgId: z.string().optional(),
  collection: z.string().optional(),
  collectionId: z.string().trim().min(1).max(160),
  artworkId: z.string().trim().min(1).max(160),
  position: z.number().int().min(0).optional().default(0),
});

const tools = [
  {
    name: 'list_orgs',
    title: 'List orgs',
    requiredScopeGroups: [[MCP_READ_SCOPE], [ARTWORKS_READ_SCOPE]],
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
    requiredScopeGroups: [[MCP_READ_SCOPE], [ARTWORKS_READ_SCOPE]],
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
    requiredScopeGroups: [[MCP_READ_SCOPE], [ARTWORKS_READ_SCOPE]],
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
    requiredScopeGroups: [[MCP_READ_SCOPE], [ARTWORKS_READ_SCOPE]],
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
    name: 'list_collections',
    title: 'List collections',
    requiredScopeGroups: [[MCP_READ_SCOPE], [COLLECTIONS_READ_SCOPE]],
    description:
      'List collections for a Paillette org, gallery, or public collection key.',
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
          description: 'Alias for orgId.',
        },
      },
    },
  },
  {
    name: 'upsert_collection',
    title: 'Upsert collection',
    requiredScopeGroups: [[MCP_WRITE_SCOPE], [COLLECTIONS_WRITE_SCOPE]],
    description:
      'Create or update a collection inside an org. Provide collectionId to make the operation idempotent.',
    inputSchema: {
      type: 'object',
      properties: {
        orgId: { type: 'string', default: NGS_ORG_KEY },
        collection: {
          type: 'string',
          default: NGS_ORG_KEY,
          description: 'Alias for orgId.',
        },
        collectionId: { type: 'string' },
        name: { type: 'string' },
        description: { type: ['string', 'null'] },
        thumbnailArtworkId: { type: ['string', 'null'] },
      },
      required: ['name'],
    },
  },
  {
    name: 'upsert_artwork_record',
    title: 'Upsert artwork record',
    requiredScopeGroups: [[MCP_WRITE_SCOPE], [ARTWORKS_WRITE_SCOPE]],
    description:
      'Create or update an artwork metadata record by id, source record id, or accession number.',
    inputSchema: {
      type: 'object',
      properties: {
        orgId: { type: 'string', default: NGS_ORG_KEY },
        collection: {
          type: 'string',
          default: NGS_ORG_KEY,
          description: 'Alias for orgId.',
        },
        id: { type: 'string' },
        collectionId: { type: ['string', 'null'] },
        title: { type: 'string' },
        artist: { type: ['string', 'null'] },
        year: { type: ['integer', 'null'] },
        medium: { type: ['string', 'null'] },
        description: { type: ['string', 'null'] },
        accessionNumber: { type: ['string', 'null'] },
        sourceInstitution: { type: ['string', 'null'] },
        sourceCollection: { type: ['string', 'null'] },
        sourceRecordId: { type: ['string', 'null'] },
        sourceUrl: { type: ['string', 'null'] },
        imageUrl: { type: ['string', 'null'] },
        thumbnailUrl: { type: ['string', 'null'] },
        fieldSources: { type: 'object' },
        customMetadata: { type: 'object' },
      },
    },
  },
  {
    name: 'add_artwork_to_collection',
    title: 'Add artwork to collection',
    requiredScopeGroups: [[MCP_WRITE_SCOPE], [COLLECTIONS_WRITE_SCOPE]],
    description:
      'Attach an artwork record to a collection within the same org.',
    inputSchema: {
      type: 'object',
      properties: {
        orgId: { type: 'string', default: NGS_ORG_KEY },
        collection: {
          type: 'string',
          default: NGS_ORG_KEY,
          description: 'Alias for orgId.',
        },
        collectionId: { type: 'string' },
        artworkId: { type: 'string' },
        position: { type: 'integer', minimum: 0, default: 0 },
      },
      required: ['collectionId', 'artworkId'],
    },
  },
  {
    name: 'remove_artwork_from_collection',
    title: 'Remove artwork from collection',
    requiredScopeGroups: [[MCP_WRITE_SCOPE], [COLLECTIONS_WRITE_SCOPE]],
    description:
      'Detach an artwork record from a collection within the same org.',
    inputSchema: {
      type: 'object',
      properties: {
        orgId: { type: 'string', default: NGS_ORG_KEY },
        collection: {
          type: 'string',
          default: NGS_ORG_KEY,
          description: 'Alias for orgId.',
        },
        collectionId: { type: 'string' },
        artworkId: { type: 'string' },
      },
      required: ['collectionId', 'artworkId'],
    },
  },
  {
    name: 'translate_text',
    title: 'Translate text',
    requiredScopeGroups: [[MCP_WRITE_SCOPE], [TRANSLATIONS_CREATE_SCOPE]],
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
  {
    name: 'extract_images',
    title: 'Extract images',
    requiredScopeGroups: [[MCP_WRITE_SCOPE], [EXTRACT_CREATE_SCOPE]],
    description:
      'Create an extract job from image URLs. Defaults to target=object so mounted artwork objects, scrolls, and visible supports are preserved. Counts against the authenticated user lifetime extract allowance.',
    inputSchema: {
      type: 'object',
      properties: {
        imageUrls: {
          type: 'array',
          minItems: 1,
          maxItems: 50,
          items: { type: 'string', format: 'uri' },
          description: 'Public image URLs for the /extract job.',
        },
        target: {
          type: 'string',
          enum: ['object', 'content'],
          default: 'object',
          description:
            'object preserves the visible artwork object/support; content is experimental and may crop tighter.',
        },
        preserveFilenames: {
          type: 'boolean',
          default: true,
        },
        filenamePrefix: {
          type: 'string',
          default: '',
        },
        filenameSuffix: {
          type: 'string',
          default: '',
        },
        returnPreview: {
          type: 'boolean',
          default: false,
        },
      },
      required: ['imageUrls'],
    },
  },
];

const mcpRoutes = new Hono<AppBindings>();

class McpAuthorizationError extends Error {
  constructor(readonly requiredScopeGroups: string[][]) {
    super(
      `Missing required MCP scope: ${requiredScopeGroups
        .map((group) => group.join(' '))
        .join(' or ')}`
    );
  }
}

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

const serializeTool = ({
  name,
  title,
  description,
  inputSchema,
}: (typeof tools)[number]) => ({
  name,
  title,
  description,
  inputSchema,
});

const hasMcpScopes = (auth: AuthPrincipal, requiredScopeGroups: string[][]) => {
  if (auth.kind === 'api_key' || auth.scopes.includes('dev')) {
    return true;
  }

  if (auth.scopes.includes(MCP_ALL_SCOPE)) {
    return true;
  }

  return requiredScopeGroups.some((group) =>
    group.every((scope) => auth.scopes.includes(scope))
  );
};

const getAvailableTools = (auth: AuthPrincipal) =>
  tools
    .filter((tool) => hasMcpScopes(auth, tool.requiredScopeGroups))
    .map(serializeTool);

const requireMcpScopes = (
  c: Context<AppBindings>,
  requiredScopeGroups: string[][]
) => {
  const auth = getAuth(c);

  if (!hasMcpScopes(auth, requiredScopeGroups)) {
    throw new McpAuthorizationError(requiredScopeGroups);
  }
};

const callTool = async (
  c: Context<AppBindings>,
  name: string,
  args: unknown
) => {
  const tool = tools.find((candidate) => candidate.name === name);

  if (!tool) {
    throw new Error(`Unknown MCP tool: ${name}`);
  }

  requireMcpScopes(c, tool.requiredScopeGroups);

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

  if (name === 'list_collections') {
    const input = ListCollectionsArgsSchema.parse(args ?? {});
    const collection = input.collection || input.orgId || NGS_ORG_KEY;
    const data = await callApi(
      c,
      `/orgs/${encodeURIComponent(collection)}/collections`
    );
    return asToolContent({ collections: data });
  }

  if (name === 'upsert_collection') {
    const input = UpsertCollectionArgsSchema.parse(args ?? {});
    const collection = input.collection || input.orgId || NGS_ORG_KEY;
    const data = await callApi(
      c,
      `/orgs/${encodeURIComponent(collection)}/collections/upsert`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: input.collectionId,
          name: input.name,
          description: input.description,
          thumbnail_artwork_id: input.thumbnailArtworkId,
        }),
      }
    );
    return asToolContent(data);
  }

  if (name === 'upsert_artwork_record') {
    const input = UpsertArtworkRecordArgsSchema.parse(args ?? {});
    const collection = input.collection || input.orgId || NGS_ORG_KEY;
    const data = await callApi(
      c,
      `/orgs/${encodeURIComponent(collection)}/artworks/upsert`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: input.id,
          collection_id: input.collectionId,
          title: input.title,
          artist: input.artist,
          year: input.year,
          medium: input.medium,
          description: input.description,
          accession_number: input.accessionNumber,
          source_institution: input.sourceInstitution,
          source_collection: input.sourceCollection,
          source_record_id: input.sourceRecordId,
          source_url: input.sourceUrl,
          image_url: input.imageUrl,
          thumbnail_url: input.thumbnailUrl,
          field_sources: input.fieldSources,
          custom_metadata: input.customMetadata,
        }),
      }
    );
    return asToolContent(data);
  }

  if (name === 'add_artwork_to_collection') {
    const input = CollectionArtworkArgsSchema.parse(args ?? {});
    const collection = input.collection || input.orgId || NGS_ORG_KEY;
    const data = await callApi(
      c,
      `/orgs/${encodeURIComponent(collection)}/collections/${encodeURIComponent(
        input.collectionId
      )}/artworks`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          artwork_id: input.artworkId,
          position: input.position,
        }),
      }
    );
    return asToolContent(data);
  }

  if (name === 'remove_artwork_from_collection') {
    const input = CollectionArtworkArgsSchema.parse(args ?? {});
    const collection = input.collection || input.orgId || NGS_ORG_KEY;
    const data = await callApi(
      c,
      `/orgs/${encodeURIComponent(collection)}/collections/${encodeURIComponent(
        input.collectionId
      )}/artworks/${encodeURIComponent(input.artworkId)}`,
      {
        method: 'DELETE',
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

  if (name === 'extract_images') {
    const input = ExtractImagesArgsSchema.parse(args ?? {});
    const data = await callApi(c, '/extract', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        imageUrls: input.imageUrls,
        target: input.target,
        preserveFilenames: input.preserveFilenames,
        filenamePrefix: input.filenamePrefix,
        filenameSuffix: input.filenameSuffix,
        preview: input.returnPreview,
      }),
    });
    return asToolContent(data);
  }

  throw new Error(`Unknown MCP tool: ${name}`);
};

mcpRoutes.use('*', async (c, next) => {
  await next();

  if (c.res.status === 401 || c.res.status === 403) {
    c.res.headers.set('WWW-Authenticate', getMcpAuthenticateHeader(c.req.url));
  }
});

mcpRoutes.use('*', requireAuthOrApiKey as any);

mcpRoutes.get('/', (c) =>
  c.json({
    name: 'paillette-mcp',
    transport: 'streamable-http-json-rpc',
    endpoint: '/api/v1/mcp',
    oauth: getMcpProtectedResourceMetadata(c.req.url, c.env),
    tools: getAvailableTools(getAuth(c)),
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
      return c.json(
        jsonRpcResult(parsed.id, { tools: getAvailableTools(getAuth(c)) })
      );
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
    if (error instanceof McpAuthorizationError) {
      return c.json(
        jsonRpcError(parsed.id, -32001, error.message, {
          requiredScopeGroups: error.requiredScopeGroups,
        }),
        403
      );
    }

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
