import {
  json,
  type LoaderFunctionArgs,
  type MetaFunction,
} from '@remix-run/cloudflare';
import { useLoaderData } from '@remix-run/react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import {
  Check,
  ChevronRight,
  Copy,
  KeyRound,
  Loader2,
  LogIn,
  Moon,
  Play,
  RefreshCw,
  Sun,
  Trash2,
  UserPlus,
} from 'lucide-react';
import {
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { Logo } from '~/components/ui/logo';
import { UserMenu } from '~/components/user/user-menu';
import { useTheme } from '~/contexts/theme-context';
import { useUser } from '~/contexts/user-context';
import { apiClient } from '~/lib/api';
import { getApiBaseUrl, getServerEnv } from '~/lib/public-search.server';
import type { ApiResponse, SearchResponse } from '~/types';

export const meta: MetaFunction = () => {
  return [
    { title: 'API Docs - Paillette' },
    {
      name: 'description',
      content: 'Paillette API and MCP documentation for search integrations',
    },
  ];
};

type OrgDirectoryPayload = { orgs: OrgDirectoryItem[]; total: number };

const fetchOrgDirectory = async (
  apiBase: string
): Promise<OrgDirectoryPayload | null> => {
  try {
    const response = await fetch(`${apiBase}/orgs?limit=20`);
    const payload = (await response.json()) as ApiResponse<
      OrgDirectoryItem[]
    > & {
      metadata?: { total?: number };
    };

    if (response.ok && payload.success && payload.data) {
      return {
        orgs: payload.data,
        total: payload.metadata?.total ?? payload.data.length,
      };
    }
  } catch {
    return null;
  }

  return null;
};

export const loader = async ({ context }: LoaderFunctionArgs) => {
  const apiBase = getApiBaseUrl(getServerEnv(context));
  const initialOrgDirectory = await fetchOrgDirectory(apiBase);

  return json({
    apiBase,
    initialOrgDirectory,
  });
};

const NGS_ORG_ID = 'cf98791d-f3cc-4f9f-b40c-a350efadbd05';
const NGS_ORG_SLUG = 'national-gallery-singapore';
const NGS_ORG_SHORTCODE = 'ngs';

type OrgDirectoryItem = {
  key?: string | null;
  id: string;
  name: string;
  slug?: string | null;
  description?: string | null;
  website?: string | null;
};

type SchemaField = {
  name: string;
  type: string;
  required?: boolean;
  defaultValue?: string;
  description: string;
};

const fallbackOrgs: OrgDirectoryItem[] = [
  {
    id: NGS_ORG_ID,
    name: 'National Gallery Singapore',
    slug: NGS_ORG_SLUG,
    description: 'Public artwork records ingested from the NGS source corpus.',
    website: 'https://www.nationalgallery.sg',
  },
];

const endpoints = [
  {
    method: 'GET',
    path: '/orgs',
    title: 'List sources',
    body: 'Public. Returns source keys, slugs, and source metadata.',
    schema: [
      {
        name: 'limit',
        type: 'integer',
        defaultValue: '20',
        description: 'Optional query param. Range: 1-100.',
      },
    ],
  },
  {
    method: 'GET',
    path: '/orgs/slug/{slug}',
    title: 'Lookup source',
    body: `Public. NGS source slug: ${NGS_ORG_SLUG}`,
    schema: [
      {
        name: 'slug',
        type: 'string',
        required: true,
        description:
          'Path param. Source slug, for example national-gallery-singapore.',
      },
    ],
  },
  {
    method: 'POST',
    path: '/orgs/ngs/search/text',
    title: 'Text search',
    body: `{
  "query": "batik textile pattern",
  "topK": 10,
  "minScore": 0.3
}`,
    schema: [
      {
        name: 'query',
        type: 'string',
        required: true,
        description: 'Natural-language search query. 1-500 characters.',
      },
      {
        name: 'topK',
        type: 'integer',
        defaultValue: '10',
        description: 'Maximum result count. Range: 1-100.',
      },
      {
        name: 'minScore',
        type: 'number',
        defaultValue: '0.7',
        description: 'Similarity floor accepted by the API. Range: 0-1.',
      },
    ],
  },
  {
    method: 'POST',
    path: '/orgs/ngs/search/image',
    title: 'Image search',
    body: 'multipart/form-data: image, topK, minScore',
    schema: [
      {
        name: 'image',
        type: 'File',
        required: true,
        description: 'Multipart image file. Allowed: JPEG, PNG, WebP.',
      },
      {
        name: 'topK',
        type: 'integer',
        defaultValue: '10',
        description: 'Maximum result count. Range: 1-100.',
      },
      {
        name: 'minScore',
        type: 'number',
        defaultValue: '0.7',
        description: 'Similarity floor for image-vector matches. Range: 0-1.',
      },
    ],
  },
  {
    method: 'POST',
    path: '/orgs/ngs/search/color',
    title: 'Colour search',
    body: `{
  "colors": ["#cda636", "#365f9c"],
  "matchMode": "any",
  "threshold": 18,
  "limit": 10
}`,
    schema: [
      {
        name: 'colors',
        type: 'string[]',
        required: true,
        description: 'Hex colours. Pattern: #RRGGBB. Min 1, max 5.',
      },
      {
        name: 'matchMode',
        type: '"any" | "all"',
        defaultValue: 'any',
        description: 'Whether any colour or every colour must match.',
      },
      {
        name: 'threshold',
        type: 'number',
        defaultValue: '10',
        description: 'DeltaE distance threshold. Range: 0-30.',
      },
      {
        name: 'limit',
        type: 'integer',
        defaultValue: '20',
        description: 'Maximum result count. Range: 1-100.',
      },
    ],
  },
  {
    method: 'GET',
    path: '/orgs/ngs/artworks/{artworkId}',
    title: 'Artwork lookup',
    body: 'Returns source-labelled artwork metadata and imagery.',
    schema: [
      {
        name: 'artworkId',
        type: 'string',
        required: true,
        description: 'Artwork ID returned by search endpoints.',
      },
    ],
  },
  {
    method: 'POST',
    path: '/translate/text',
    title: 'Translate text',
    body: `{
  "text": "Gallery label text",
  "sourceLang": "en",
  "targetLang": "zh"
}`,
    schema: [
      {
        name: 'text',
        type: 'string',
        required: true,
        description: 'English source text. 1-50,000 characters.',
      },
      {
        name: 'sourceLang',
        type: '"en"',
        required: true,
        description: 'Only English source text is accepted.',
      },
      {
        name: 'targetLang',
        type: '"zh" | "ms" | "ta"',
        required: true,
        description: 'Chinese, Malay, or Tamil.',
      },
    ],
  },
  {
    method: 'POST',
    path: '/extract',
    title: 'Extract image',
    body: `{
  "imageUrls": ["https://example.com/artwork.tif"],
  "target": "object",
  "preserveFilenames": true,
  "preview": false
}`,
    schema: [
      {
        name: 'imageUrls',
        type: 'string[]',
        required: true,
        description:
          'Public image URLs. Each submitted URL or uploaded file counts against the free lifetime /extract allowance.',
      },
      {
        name: 'target',
        type: '"object" | "content"',
        defaultValue: 'object',
        description:
          'object preserves the visible artwork object/support. content is experimental and crops tighter.',
      },
      {
        name: 'preserveFilenames',
        type: 'boolean',
        defaultValue: 'true',
        description: 'Preserve source filenames in generated outputs.',
      },
      {
        name: 'filenamePrefix',
        type: 'string',
        defaultValue: '',
        description: 'Optional prefix when not preserving source names.',
      },
      {
        name: 'filenameSuffix',
        type: 'string',
        defaultValue: '',
        description: 'Optional suffix when not preserving source names.',
      },
      {
        name: 'preview',
        type: 'boolean',
        defaultValue: 'false',
        description: 'Request lightweight preview outputs with the job.',
      },
    ],
  },
];

const responseMetadataFields: SchemaField[] = [
  {
    name: 'results[].metadata.description',
    type: 'string',
    description:
      'Verified Roots/NHB catalogue caption selected for display when available. NGS Art+ payload descriptions are retained in source_records, not exposed as public caption text.',
  },
  {
    name: 'results[].metadata.field_sources',
    type: 'Record<string, string>',
    description:
      'Per-field source labels, for example description: roots or title: ngs.',
  },
  {
    name: 'results[].metadata.source_provenance',
    type: 'Record<string, { source, ref, type }>',
    description:
      'Source URLs used for normalized fields, including Roots/NHB refs where a Roots caption is used.',
  },
  {
    name: 'results[].metadata.source_records.ngs',
    type: 'object | null',
    description:
      'Original NGS source payload excerpt. This is useful for catalogue fields, identifiers, credit lines, and NGS image/detail refs.',
  },
  {
    name: 'results[].metadata.source_records.roots',
    type: 'object | null',
    description:
      'Verified Roots/NHB source payload excerpt. Use caption when present; it is not labelled as NGS text.',
  },
  {
    name: 'results[].metadata.generated_caption.text',
    type: 'string | null',
    description:
      'Generated visual caption used for semantic retrieval/debugging. Includes model, prompt version, generated time, and source URLs.',
  },
  {
    name: 'results[].metadata.search_sources',
    type: 'Array<{ channel, source, weight, rank, score }>',
    description:
      'Search provenance for hybrid results. Generated-caption vector hits are labelled generated_caption_embedding and source custom_metadata.generated_caption.text.',
  },
  {
    name: 'results[].metadata.classification',
    type: 'string | null',
    description:
      'Optional source catalogue classification from the ingestion DB. Treat as secondary metadata, not a universal object type.',
  },
];

const mcpTools = [
  {
    name: 'list_orgs',
    description:
      'List source organisations and their short keys before calling search tools.',
    schema: [
      {
        name: 'limit',
        type: 'integer',
        defaultValue: '20',
        description: 'Optional. Range: 1-100.',
      },
    ],
  },
  {
    name: 'search_artworks',
    description: 'Natural-language artwork search across a source.',
    schema: [
      {
        name: 'collection',
        type: 'string',
        defaultValue: 'ngs',
        description:
          'Optional alias for orgId. Use ngs for National Gallery Singapore.',
      },
      {
        name: 'query',
        type: 'string',
        required: true,
        description: 'Natural-language search query.',
      },
      {
        name: 'topK',
        type: 'integer',
        defaultValue: '10',
        description: 'Maximum result count. Range: 1-100.',
      },
      {
        name: 'minScore',
        type: 'number',
        defaultValue: '0.3',
        description: 'Similarity floor. Range: 0-1.',
      },
    ],
  },
  {
    name: 'lookup_artwork',
    description: 'Fetch one artwork by ID with public catalogue metadata.',
    schema: [
      {
        name: 'collection',
        type: 'string',
        defaultValue: 'ngs',
        description: 'Optional alias for orgId.',
      },
      {
        name: 'artworkId',
        type: 'string',
        required: true,
        description: 'Artwork ID returned by search_artworks.',
      },
    ],
  },
  {
    name: 'colour_search',
    description: 'Find artworks by extracted palette proximity.',
    schema: [
      {
        name: 'collection',
        type: 'string',
        defaultValue: 'ngs',
        description: 'Optional alias for orgId.',
      },
      {
        name: 'colors',
        type: 'string[]',
        required: true,
        description: 'Hex colours. Pattern: #RRGGBB. Min 1, max 8.',
      },
      {
        name: 'matchMode',
        type: '"any" | "all"',
        defaultValue: 'any',
        description: 'Whether any colour or every colour must match.',
      },
      {
        name: 'threshold',
        type: 'number',
        defaultValue: '18',
        description: 'Palette distance threshold. Range: 0-441.7.',
      },
      {
        name: 'limit',
        type: 'integer',
        defaultValue: '10',
        description: 'Maximum result count. Range: 1-100.',
      },
    ],
  },
  {
    name: 'translate_text',
    description: 'Translate English text to Chinese, Malay, or Tamil.',
    schema: [
      {
        name: 'text',
        type: 'string',
        required: true,
        description: 'English source text. 1-50,000 characters.',
      },
      {
        name: 'sourceLang',
        type: '"en"',
        defaultValue: 'en',
        description: 'Optional. Only English source text is accepted.',
      },
      {
        name: 'targetLang',
        type: '"zh" | "ms" | "ta"',
        required: true,
        description: 'Chinese, Malay, or Tamil.',
      },
    ],
  },
  {
    name: 'extract_images',
    description:
      'Create an /extract job from image URLs. target defaults to object. Counts against the lifetime /extract allowance.',
    schema: [
      {
        name: 'imageUrls',
        type: 'string[]',
        required: true,
        description: 'Public image URLs. Min 1, max 50.',
      },
      {
        name: 'target',
        type: '"object" | "content"',
        defaultValue: 'object',
        description: 'Use object for mounted artworks and scrolls.',
      },
      {
        name: 'preserveFilenames',
        type: 'boolean',
        defaultValue: 'true',
        description: 'Preserve source filenames in generated outputs.',
      },
      {
        name: 'returnPreview',
        type: 'boolean',
        defaultValue: 'false',
        description: 'Request preview outputs with the job.',
      },
    ],
  },
];

const primaryMcpTool =
  mcpTools.find((tool) => tool.name === 'search_artworks') ?? mcpTools[0]!;
const secondaryMcpTools = mcpTools.filter(
  (tool) => tool.name !== primaryMcpTool.name
);

const sampleSearchResponse = {
  count: 2,
  queryTime: 184,
  results: [
    {
      id: '2018-00743',
      galleryId: NGS_ORG_ID,
      title: 'Singapore',
      artist: 'John Turnbull Thomson',
      year: 1851,
      imageUrl: null,
      thumbnailUrl: null,
      similarity: 0.92,
      metadata: {
        medium: 'Oil on canvas',
        dateText: '1851',
        description:
          'Singapore is a rare detailed representation of everyday life on the river against the background of Singapore.',
        field_sources: {
          title: 'ngs',
          artist: 'ngs',
          description: 'roots',
        },
        source_provenance: {
          description: {
            source: 'roots',
            ref: 'https://www.roots.gov.sg/Collection-Landing/listing/...',
            type: 'web',
          },
        },
        source_records: {
          ngs: {
            objObjectTitleTxt: 'Singapore',
            objObjectNumberTxt: '2018-00743',
          },
          roots: {
            title: 'Singapore',
            caption:
              'Singapore is a rare detailed representation of everyday life on the river against the background of Singapore.',
          },
          ngs_detail_url:
            'https://www.nationalgallery.sg/sg/en/our-collections/...',
          roots_listing_url:
            'https://www.roots.gov.sg/Collection-Landing/listing/...',
        },
        generated_caption: {
          text: 'A 19th-century harbour scene with sailing ships, small boats, colonial buildings, and activity along the Singapore waterfront.',
          model: 'mlx-community/Qwen3-VL-30B-A3B-Instruct-4bit',
          prompt_version: 'cap-v1',
          generated_at: '2026-05-21T19:44:00.000Z',
          sources: [
            'https://www.nationalgallery.sg/sg/en/our-collections/...',
            'https://www.roots.gov.sg/Collection-Landing/listing/...',
          ],
        },
        dominantColors: ['#c89b73', '#d8c7ad', '#7a6f62', '#26303a'],
        citation: {
          format: 'chicago',
          text: 'John Turnbull Thomson. Singapore. 1851. National Gallery Singapore.',
        },
      },
    },
    {
      id: '1991-00229',
      galleryId: NGS_ORG_ID,
      title: 'Born Free',
      artist: 'Ng Yak Whee',
      imageUrl: null,
      thumbnailUrl: null,
      similarity: 0.88,
      metadata: {
        medium: 'Mixed media on canvas',
        generated_caption: {
          text: 'The artwork depicts a turbulent abstract landscape dominated by pale green, grey, and white, with dark irregular patches suggesting rocks or submerged forms.',
          model: 'mlx-community/Qwen3-VL-30B-A3B-Instruct-4bit',
          prompt_version: 'cap-v1',
        },
        dominantColors: ['#302923', '#a65b5b', '#d6a56e', '#273342'],
      },
    },
  ],
} satisfies SearchResponse;

const getCurrentReturnTo = () =>
  `${window.location.pathname}${window.location.search}${window.location.hash}`;

const maskKey = (key: string | null) => key || 'plt_stg_your_api_key';

const stringify = (value: unknown) => JSON.stringify(value, null, 2);

const defaultDailyUsage = { used: 0, quota: 100 };
const defaultTranslationUsage = { used: 0, quota: 10, remaining: 10 };
const defaultExtractUsage = { used: 0, quota: 10, remaining: 10 };
const defaultBuilderEndpointPath = '/orgs/ngs/search/text';
type EndpointDefinition = (typeof endpoints)[number];

const apiBaseByEnvironment = {
  stg: 'https://paillette-api-stg.berlayar.ai/api/v1',
  prod: 'https://paillette-api.berlayar.ai/api/v1',
};
type ApiEnvironment = keyof typeof apiBaseByEnvironment;
type LanguageTab = 'curl' | 'js' | 'python' | 'mcp';
type SectionTone = 'GET' | 'POST' | 'MCP' | 'TEXT';

const publicEndpointPaths = new Set(['/orgs', '/orgs/slug/{slug}']);

const truncateText = (value: unknown, length = 220) => {
  const text =
    typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
  return text.length > length ? `${text.slice(0, length - 1)}...` : text;
};

const getOrgKey = (org: OrgDirectoryItem) =>
  org.key || (org.id === NGS_ORG_ID ? NGS_ORG_SHORTCODE : org.slug || org.id);

const getFieldDefault = (endpoint: EndpointDefinition, field: SchemaField) => {
  const samples: Record<string, string> = {
    artworkId: '2018-00743',
    colors: '#cda636, #365f9c',
    image: '',
    query: 'batik textile pattern',
    slug: NGS_ORG_SLUG,
    targetLang: 'zh',
    text: 'Gallery label text',
    imageUrls: 'https://example.com/artwork.tif',
    preserveFilenames: 'true',
    preview: 'false',
  };

  if (endpoint.path === '/orgs' && field.name === 'limit') return '20';
  return samples[field.name] ?? field.defaultValue ?? '';
};

const getInitialEndpointValues = (endpoint: EndpointDefinition) =>
  endpoint.schema.reduce<Record<string, string>>((values, field) => {
    values[field.name] = getFieldDefault(endpoint, field);
    return values;
  }, {});

const endpointRequiresAuth = (endpoint: EndpointDefinition) =>
  !publicEndpointPaths.has(endpoint.path);

const isPathField = (endpoint: EndpointDefinition, field: SchemaField) =>
  endpoint.path.includes(`{${field.name}}`);

const getFieldLocation = (endpoint: EndpointDefinition, field: SchemaField) => {
  if (isPathField(endpoint, field)) return 'path';
  if (endpoint.method === 'GET') return 'query';
  if (field.type === 'File') return 'form';
  return endpoint.schema.some((candidate) => candidate.type === 'File')
    ? 'form'
    : 'body';
};

const coerceFieldValue = (field: SchemaField, value: string) => {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (field.type === 'string[]') {
    return trimmed
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
  }
  if (field.type === 'integer') {
    const parsed = Number.parseInt(trimmed, 10);
    return Number.isFinite(parsed) ? parsed : trimmed;
  }
  if (field.type === 'number') {
    const parsed = Number.parseFloat(trimmed);
    return Number.isFinite(parsed) ? parsed : trimmed;
  }
  if (field.type === 'boolean') {
    return ['1', 'true', 'yes', 'on'].includes(trimmed.toLowerCase());
  }
  return trimmed;
};

const shellQuote = (value: string) => `'${value.replace(/'/g, `'\"'\"'`)}'`;

const buildEndpointRequest = ({
  apiBase,
  apiKey,
  endpoint,
  files = {},
  values,
}: {
  apiBase: string;
  apiKey: string;
  endpoint: EndpointDefinition;
  files?: Record<string, File | null>;
  values: Record<string, string>;
}) => {
  const requiresAuth = endpointRequiresAuth(endpoint);
  const isMultipart = endpoint.schema.some((field) => field.type === 'File');
  const missingFiles: string[] = [];
  let path = endpoint.path.replace(/\{([^}]+)\}/g, (_, fieldName: string) => {
    const field = endpoint.schema.find(
      (candidate) => candidate.name === fieldName
    );
    const value =
      values[fieldName] || (field ? getFieldDefault(endpoint, field) : '');
    return encodeURIComponent(value || fieldName);
  });
  const url = new URL(`${apiBase}${path}`);
  const jsonBody: Record<string, unknown> = {};
  const formBody =
    isMultipart && typeof FormData !== 'undefined' ? new FormData() : null;
  const displayBody: Record<string, unknown> = {};

  endpoint.schema.forEach((field) => {
    const location = getFieldLocation(endpoint, field);
    if (location === 'path') return;

    const rawValue = values[field.name] ?? getFieldDefault(endpoint, field);
    const value = coerceFieldValue(field, rawValue);

    if (location === 'query' && value !== undefined) {
      url.searchParams.set(field.name, String(value));
      return;
    }

    if (location === 'form') {
      if (field.type === 'File') {
        const file = files[field.name];
        if (file) {
          formBody?.append(field.name, file);
          displayBody[field.name] = file.name;
        } else if (field.required) {
          missingFiles.push(field.name);
          displayBody[field.name] = '<select a file>';
        }
        return;
      }

      if (value !== undefined) {
        formBody?.append(field.name, String(value));
        displayBody[field.name] = value;
      }
      return;
    }

    if (value !== undefined) {
      jsonBody[field.name] = value;
      displayBody[field.name] = value;
    }
  });

  const headers: Record<string, string> = {};
  if (requiresAuth && apiKey) headers['X-API-Key'] = apiKey;
  if (endpoint.method !== 'GET' && !isMultipart) {
    headers['Content-Type'] = 'application/json';
  }

  const body =
    endpoint.method === 'GET'
      ? undefined
      : isMultipart
        ? (formBody ?? undefined)
        : JSON.stringify(jsonBody);
  const curlLines = [`curl -s ${url.toString()}`];
  if (requiresAuth)
    curlLines.push(`  -H "X-API-Key: ${apiKey || maskKey(null)}"`);
  if (endpoint.method !== 'GET' && isMultipart) {
    endpoint.schema.forEach((field) => {
      if (field.type === 'File') {
        curlLines.push(`  -F "${field.name}=@/path/to/image.jpg"`);
        return;
      }
      const value = values[field.name] ?? getFieldDefault(endpoint, field);
      if (value.trim()) curlLines.push(`  -F "${field.name}=${value.trim()}"`);
    });
  } else if (endpoint.method !== 'GET') {
    curlLines.push('  -H "Content-Type: application/json"');
    curlLines.push(`  -d ${shellQuote(JSON.stringify(jsonBody))}`);
  }

  path = url.pathname.replace('/api/v1', '');

  return {
    body,
    curl: curlLines.join(' \\\n'),
    displayBody,
    headers,
    isMultipart,
    missingFiles,
    path,
    requiresAuth,
    url: url.toString(),
  };
};

const compactSearchResponse = (response: SearchResponse) => ({
  count: response.count,
  queryTime: response.queryTime,
  results: response.results.slice(0, 2).map((result) => {
    const metadata = (result.metadata || {}) as Record<string, any>;

    return {
      id: result.id,
      title: result.title,
      artist: result.artist,
      year: result.year ?? metadata.dateText ?? metadata.date_text ?? null,
      similarity: result.similarity,
      imageUrl: result.imageUrl ?? result.thumbnailUrl ?? null,
      metadata: {
        medium: metadata.medium ?? null,
        description: truncateText(metadata.description, 160),
        field_sources: metadata.field_sources ?? metadata.fieldSources ?? null,
        source_provenance: metadata.source_provenance
          ? {
              description: metadata.source_provenance.description ?? null,
            }
          : null,
      },
    };
  }),
});

const endpointIdByPath: Record<string, string> = {
  '/orgs': 'sources-list',
  '/orgs/slug/{slug}': 'source-lookup',
  '/orgs/ngs/search/text': 'search-text',
  '/orgs/ngs/search/image': 'search-image',
  '/orgs/ngs/search/color': 'search-colour',
  '/orgs/ngs/artworks/{artworkId}': 'artwork-lookup',
  '/translate/text': 'translate-text',
  '/extract': 'extract',
};

const endpointSummaryByPath: Record<string, string> = {
  '/orgs':
    'List public sources and the keys used in REST paths and MCP arguments.',
  '/orgs/slug/{slug}':
    'Resolve a source by canonical slug before building source-specific calls.',
  '/orgs/ngs/search/text':
    "Natural-language search against a source's text embeddings.",
  '/orgs/ngs/search/image':
    "Multipart image search against a source's visual embeddings.",
  '/orgs/ngs/search/color':
    'Find artworks whose extracted palettes match one or more hex colours.',
  '/orgs/ngs/artworks/{artworkId}':
    'Fetch one artwork record with source-labelled metadata and imagery.',
  '/translate/text':
    'Translate English catalogue text to Chinese, Malay, or Tamil.',
  '/extract':
    'Extract image objects from public image URLs. target=object is the default for preserving mounted artworks, scrolls, and visible supports. Live jobs use fal SAM3 when configured. Free accounts get 10 submitted inputs lifetime.',
};

const endpointNavLabelByPath: Record<string, string> = {
  '/orgs': '/orgs',
  '/orgs/slug/{slug}': '/orgs/slug/{slug}',
  '/orgs/ngs/search/text': 'text',
  '/orgs/ngs/search/image': 'image',
  '/orgs/ngs/search/color': 'colour',
  '/orgs/ngs/artworks/{artworkId}': 'by ID',
  '/translate/text': 'translate text',
  '/extract': 'extract image',
};

const baseResponseFields: SchemaField[] = [
  {
    name: 'success',
    type: 'boolean',
    description: 'Whether the request completed successfully.',
  },
  {
    name: 'data',
    type: 'object | array',
    description: 'Endpoint-specific payload returned by the API.',
  },
  {
    name: 'error',
    type: 'object | null',
    description: 'Present only when success is false.',
  },
];

const searchResponseFields: SchemaField[] = [
  {
    name: 'count',
    type: 'integer',
    description: 'Number of ranked results returned.',
  },
  {
    name: 'queryTime',
    type: 'integer',
    description: 'Server-side query time in milliseconds.',
  },
  {
    name: 'results[].similarity',
    type: 'number',
    description: 'Cosine similarity score. Higher is closer.',
  },
  ...responseMetadataFields,
];

const translationResponseFields: SchemaField[] = [
  {
    name: 'translatedText',
    type: 'string',
    description: 'Translated output in the requested target language.',
  },
  {
    name: 'provider',
    type: 'string',
    description: 'Translation provider used for the response.',
  },
  {
    name: 'cached',
    type: 'boolean',
    description: 'Whether the response came from translation cache.',
  },
  {
    name: 'usage.remaining',
    type: 'integer',
    description:
      'Free translations remaining after the request, when returned.',
  },
];

const extractResponseFields: SchemaField[] = [
  {
    name: 'id',
    type: 'string',
    description: 'Extract job ID.',
  },
  {
    name: 'status',
    type: '"pending" | "queued" | "processing" | "completed" | "failed"',
    description: 'Current job state.',
  },
  {
    name: 'target',
    type: '"object" | "content"',
    description: 'Requested extract target.',
  },
  {
    name: 'counts.inputs',
    type: 'integer',
    description: 'Number of submitted images or archive inputs.',
  },
  {
    name: 'downloadUrl',
    type: 'string | null',
    description: 'Zip download URL once the job is completed.',
  },
  {
    name: 'usage.remaining',
    type: 'integer',
    description:
      'Free /extract inputs remaining after job creation, when returned.',
  },
  {
    name: 'warnings[]',
    type: 'string',
    description:
      'Non-fatal job warnings such as a missing worker dispatch config.',
  },
];

const sourceResponseFields: SchemaField[] = [
  {
    name: 'data[].key',
    type: 'string',
    description: 'Short source key used in search paths and MCP arguments.',
  },
  {
    name: 'data[].slug',
    type: 'string',
    description: 'Canonical public source slug.',
  },
  {
    name: 'metadata.total',
    type: 'integer',
    description: 'Total number of sources available to the caller.',
  },
];

const artworkResponseFields: SchemaField[] = [
  {
    name: 'id',
    type: 'string',
    description: 'Artwork identifier returned by search endpoints.',
  },
  {
    name: 'title',
    type: 'string',
    description: 'Display title from the source record.',
  },
  {
    name: 'metadata.field_sources',
    type: 'Record<string, string>',
    description: 'Per-field source labels for normalized catalogue metadata.',
  },
  {
    name: 'metadata.source_records',
    type: 'object',
    description: 'Original source payload excerpts used during normalization.',
  },
];

type EndpointDoc = {
  endpoint: EndpointDefinition;
  id: string;
  navLabel: string;
  responseFields: SchemaField[];
  summary: string;
};

const getResponseFields = (endpoint: EndpointDefinition) => {
  if (endpoint.path.includes('/search/')) return searchResponseFields;
  if (endpoint.path === '/translate/text') return translationResponseFields;
  if (endpoint.path === '/extract')
    return extractResponseFields;
  if (endpoint.path === '/orgs') return sourceResponseFields;
  if (endpoint.path === '/orgs/slug/{slug}') return sourceResponseFields;
  if (endpoint.path.includes('/artworks/')) return artworkResponseFields;
  return baseResponseFields;
};

export const endpointDocs: EndpointDoc[] = endpoints.map((endpoint) => ({
  endpoint,
  id: endpointIdByPath[endpoint.path] ?? endpoint.path.replace(/\W+/g, '-'),
  navLabel: endpointNavLabelByPath[endpoint.path] ?? endpoint.title,
  responseFields: getResponseFields(endpoint),
  summary: endpointSummaryByPath[endpoint.path] ?? endpoint.body,
}));

const fieldToMarkdown = (field: SchemaField) =>
  `| \`${field.name}\` | \`${field.type}\` | ${
    field.required ? 'yes' : field.defaultValue ? `default ${field.defaultValue}` : ''
  } | ${field.description.replace(/\|/g, '\\|')} |`;

export const buildDocsMarkdown = (apiBase: string) => {
  const lines = [
    '# Paillette API',
    '',
    `Base URL: \`${apiBase}\``,
    '',
    '## Authentication',
    '',
    'Server-to-server calls use `X-API-Key: <key>`. Source discovery endpoints are public; search, artwork lookup, translation, and extract require a key.',
    '',
    '## Usage',
    '',
    '- Search API: daily free query quota shown on `/me/usage/today`.',
    '- Translation: 10 free lifetime translations by default.',
    '- /extract: 10 free lifetime submitted inputs by default; each URL or uploaded file counts as one input.',
    '',
    '## REST endpoints',
  ];

  for (const doc of endpointDocs) {
    const request = buildEndpointRequest({
      apiBase,
      apiKey: maskKey(null),
      endpoint: doc.endpoint,
      values: getInitialEndpointValues(doc.endpoint),
    });

    lines.push(
      '',
      `### ${doc.endpoint.method} ${displayPath(doc.endpoint)} - ${doc.endpoint.title}`,
      '',
      doc.summary,
      '',
      'Request fields:',
      '',
      '| field | type | required/default | notes |',
      '| --- | --- | --- | --- |',
      ...(doc.endpoint.schema.length
        ? doc.endpoint.schema.map(fieldToMarkdown)
        : ['| none | - | - | - |']),
      '',
      'Response fields:',
      '',
      '| field | type | required/default | notes |',
      '| --- | --- | --- | --- |',
      ...doc.responseFields.map(fieldToMarkdown),
      '',
      '```bash',
      request.curl,
      '```'
    );
  }

  lines.push('', '## MCP tools');
  for (const tool of mcpTools) {
    lines.push(
      '',
      `### ${tool.name}`,
      '',
      tool.description,
      '',
      '| argument | type | required/default | notes |',
      '| --- | --- | --- | --- |',
      ...tool.schema.map(fieldToMarkdown)
    );
  }

  lines.push(
    '',
    '## Field sources',
    '',
    'Search and artwork responses include `metadata.field_sources` and `metadata.source_provenance` so clients can distinguish Roots/NHB catalogue captions, retained NGS source records, public metadata, and generated captions.'
  );

  return `${lines.join('\n')}\n`;
};

type NavItem = {
  href: string;
  id: string;
  label: string;
  method?: SectionTone;
};

export const docsNavGroups: Array<{ title: string; items: NavItem[] }> = [
  {
    title: 'Start',
    items: [
      { href: '#overview', id: 'overview', label: 'Overview' },
      {
        href: '#authentication',
        id: 'authentication',
        label: 'Authentication',
      },
      {
        href: '#field-sources',
        id: 'field-sources',
        label: 'Field sources',
      },
    ],
  },
  {
    title: 'Sources · public',
    items: [
      {
        href: '#sources-list',
        id: 'sources-list',
        label: 'GET /orgs',
        method: 'GET',
      },
      {
        href: '#source-lookup',
        id: 'source-lookup',
        label: 'GET /orgs/slug/{slug}',
        method: 'GET',
      },
    ],
  },
  {
    title: 'Search',
    items: [
      {
        href: '#search-text',
        id: 'search-text',
        label: 'text',
        method: 'POST',
      },
      {
        href: '#search-image',
        id: 'search-image',
        label: 'image',
        method: 'POST',
      },
      {
        href: '#search-colour',
        id: 'search-colour',
        label: 'colour',
        method: 'POST',
      },
    ],
  },
  {
    title: 'Artworks',
    items: [
      {
        href: '#artwork-lookup',
        id: 'artwork-lookup',
        label: 'by ID',
        method: 'GET',
      },
    ],
  },
  {
    title: 'Translation',
    items: [
      {
        href: '#translate-text',
        id: 'translate-text',
        label: 'translate text',
        method: 'POST',
      },
    ],
  },
  {
    title: 'Tools',
    items: [
      {
        href: '#extract',
        id: 'extract',
        label: 'extract image',
        method: 'POST',
      },
    ],
  },
  {
    title: 'MCP',
    items: [
      {
        href: '#mcp-client-config',
        id: 'mcp-client-config',
        label: 'client config',
        method: 'MCP',
      },
      {
        href: '#mcp-tool-reference',
        id: 'mcp-tool-reference',
        label: 'tool reference',
        method: 'MCP',
      },
    ],
  },
  {
    title: 'Account',
    items: [
      { href: '#api-keys', id: 'api-keys', label: 'keys' },
      {
        href: '#usage-billing',
        id: 'usage-billing',
        label: 'usage & billing',
      },
    ],
  },
];

const languageTabs: Array<{ id: LanguageTab; label: string }> = [
  { id: 'curl', label: 'cURL' },
  { id: 'js', label: 'JS' },
  { id: 'python', label: 'Python' },
  { id: 'mcp', label: 'MCP' },
];

const displayPath = (endpoint: EndpointDefinition, includeBase = true) => {
  const sourceParamPath = endpoint.path.replace('/orgs/ngs', '/orgs/{orgKey}');
  return `${includeBase ? '/api/v1' : ''}${sourceParamPath}`;
};

const getEndpointPathFields = (endpoint: EndpointDefinition): SchemaField[] => {
  const fields: SchemaField[] = [];

  if (endpoint.path.includes('/orgs/ngs')) {
    fields.push({
      name: 'orgKey',
      type: 'string',
      required: true,
      description:
        'Source key from GET /orgs. Use ngs for National Gallery Singapore.',
    });
  }

  endpoint.schema.forEach((field) => {
    if (isPathField(endpoint, field)) fields.push(field);
  });

  return fields;
};

const getEndpointBodyFields = (endpoint: EndpointDefinition) =>
  endpoint.schema.filter((field) => !isPathField(endpoint, field));

const findNavItem = (id: string) => {
  for (const group of docsNavGroups) {
    const item = group.items.find((candidate) => candidate.id === id);
    if (item) return { group: group.title, item };
  }

  return null;
};

const detectApiEnvironment = (apiBase: string): ApiEnvironment =>
  apiBase.includes('paillette-api.berlayar.ai') &&
  !apiBase.includes('paillette-api-stg')
    ? 'prod'
    : 'stg';

const methodTone = (method: SectionTone) => {
  if (method === 'GET') {
    return {
      background: 'color-mix(in srgb, #047857 10%, transparent)',
      borderColor: 'color-mix(in srgb, #047857 28%, transparent)',
      color: 'color-mix(in srgb, #047857 82%, var(--app-text))',
    };
  }

  if (method === 'MCP') {
    return {
      background: 'color-mix(in srgb, #0e7490 10%, transparent)',
      borderColor: 'color-mix(in srgb, #0e7490 28%, transparent)',
      color: 'color-mix(in srgb, #0e7490 82%, var(--app-text))',
    };
  }

  if (method === 'TEXT') {
    return {
      background: 'var(--app-control)',
      borderColor: 'var(--app-line)',
      color: 'var(--app-muted-strong)',
    };
  }

  return {
    background: 'color-mix(in srgb, #86198f 10%, transparent)',
    borderColor: 'color-mix(in srgb, #86198f 28%, transparent)',
    color: 'color-mix(in srgb, #86198f 82%, var(--app-text))',
  };
};

const monoStyle = {
  fontFamily: '"IBM Plex Mono", "SFMono-Regular", Menlo, monospace',
};

const displayStyle = {
  fontFamily: '"EB Garamond", Georgia, serif',
};

const docsThemeStyle = {
  '--docs-code': 'color-mix(in srgb, #0e7490 78%, var(--app-text))',
  '--docs-code-strong': 'color-mix(in srgb, #075985 82%, var(--app-text))',
  '--docs-accent': 'color-mix(in srgb, #7e22ce 78%, var(--app-text))',
  '--docs-accent-strong': 'color-mix(in srgb, #86198f 86%, var(--app-text))',
  '--docs-success': 'color-mix(in srgb, #047857 82%, var(--app-text))',
  '--docs-code-panel':
    'color-mix(in srgb, var(--app-text) 5%, var(--app-control))',
  '--docs-code-panel-strong':
    'color-mix(in srgb, var(--app-text) 8%, var(--app-control))',
  '--docs-brand-gradient':
    'linear-gradient(135deg, #6d28d9 0%, #a21caf 52%, #be185d 100%)',
} as CSSProperties & Record<string, string>;

const brandGradient =
  'linear-gradient(135deg, #6d28d9 0%, #a21caf 52%, #be185d 100%)';

type BuiltEndpointRequest = ReturnType<typeof buildEndpointRequest>;
type RailRunResult = {
  durationMs: number;
  endpointPath: string;
  payload: unknown;
  status: number;
  statusText: string;
};

const buildJavaScriptSample = (
  request: BuiltEndpointRequest,
  endpoint: EndpointDefinition
) => {
  const headers = stringify(request.headers);

  if (request.isMultipart) {
    return `const form = new FormData();
form.set("image", imageFile);
${Object.entries(request.displayBody)
  .filter(([name]) => name !== 'image')
  .map(([name, value]) => `form.set("${name}", "${String(value)}");`)
  .join('\n')}

const response = await fetch("${request.url}", {
  method: "${endpoint.method}",
  headers: ${headers},
  body: form,
});
const payload = await response.json();`;
  }

  const body =
    endpoint.method === 'GET'
      ? ''
      : `,
  body: JSON.stringify(${stringify(request.displayBody)}),`;

  return `const response = await fetch("${request.url}", {
  method: "${endpoint.method}",
  headers: ${headers}${body}
});
const payload = await response.json();`;
};

const buildPythonSample = (
  request: BuiltEndpointRequest,
  endpoint: EndpointDefinition
) => {
  if (request.isMultipart) {
    return `import requests

with open("image.jpg", "rb") as image:
    response = requests.post(
        "${request.url}",
        headers=${stringify(request.headers)},
        files={"image": image},
        data=${stringify(request.displayBody)},
    )

payload = response.json()`;
  }

  const method = endpoint.method === 'GET' ? 'get' : 'post';
  const body =
    endpoint.method === 'GET'
      ? ''
      : `,
        json=${stringify(request.displayBody)},`;

  return `import requests

response = requests.${method}(
    "${request.url}",
    headers=${stringify(request.headers)}${body}
)

payload = response.json()`;
};

const buildMcpSample = (
  apiBase: string,
  apiKey: string,
  endpoint: EndpointDefinition,
  values: Record<string, string>
) => {
  const args = endpoint.schema.reduce<Record<string, unknown>>(
    (argumentsByName, field) => {
      const value = coerceFieldValue(
        field,
        values[field.name] ?? getFieldDefault(endpoint, field)
      );
      if (value !== undefined) argumentsByName[field.name] = value;
      return argumentsByName;
    },
    {}
  );

  if (endpoint.path === '/orgs') {
    return stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: {
        name: 'list_orgs',
        arguments: args,
      },
    });
  }

  if (endpoint.path === '/orgs/ngs/search/text') {
    return stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: {
        name: 'search_artworks',
        arguments: {
          collection: NGS_ORG_SHORTCODE,
          ...args,
        },
      },
    });
  }

  if (endpoint.path === '/orgs/ngs/search/color') {
    return stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: {
        name: 'colour_search',
        arguments: {
          collection: NGS_ORG_SHORTCODE,
          ...args,
        },
      },
    });
  }

  if (endpoint.path === '/orgs/ngs/artworks/{artworkId}') {
    return stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: {
        name: 'lookup_artwork',
        arguments: {
          collection: NGS_ORG_SHORTCODE,
          ...args,
        },
      },
    });
  }

  if (endpoint.path === '/translate/text') {
    return stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: {
        name: 'translate_text',
        arguments: args,
      },
    });
  }

  if (endpoint.path === '/extract') {
    const { preview, ...rest } = args;
    return stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: {
        name: 'extract_images',
        arguments: {
          ...rest,
          returnPreview: preview ?? false,
        },
      },
    });
  }

  return stringify({
    mcpServers: {
      paillette: {
        url: `${apiBase}/mcp`,
        headers: {
          'X-API-Key': apiKey,
        },
      },
    },
    note:
      endpoint.path === '/orgs/ngs/search/image'
        ? 'Image search is REST-only; MCP tools cover text, colour, lookup, and translation.'
        : 'No direct MCP tool maps to this REST endpoint.',
  });
};

const buildLanguageSample = ({
  activeLanguage,
  apiBase,
  apiKey,
  endpoint,
  request,
  values,
}: {
  activeLanguage: LanguageTab;
  apiBase: string;
  apiKey: string;
  endpoint: EndpointDefinition;
  request: BuiltEndpointRequest;
  values: Record<string, string>;
}) => {
  if (activeLanguage === 'js') return buildJavaScriptSample(request, endpoint);
  if (activeLanguage === 'python') return buildPythonSample(request, endpoint);
  if (activeLanguage === 'mcp')
    return buildMcpSample(apiBase, apiKey, endpoint, values);
  return request.curl;
};

const buildExampleResponse = (
  endpoint: EndpointDefinition,
  orgListResponse: unknown
) => {
  if (endpoint.path === '/orgs') return orgListResponse;
  if (endpoint.path === '/orgs/slug/{slug}') {
    return {
      success: true,
      data: {
        key: NGS_ORG_SHORTCODE,
        id: NGS_ORG_ID,
        name: 'National Gallery Singapore',
        slug: NGS_ORG_SLUG,
      },
    };
  }
  if (endpoint.path === '/orgs/ngs/search/color') {
    return {
      results: [
        {
          artworkId: '2018-00743',
          title: 'Singapore',
          matchedColors: [{ searchColor: '#cda636', distance: 12.8 }],
          averageDistance: 13.4,
        },
      ],
      query: {
        colors: ['#cda636', '#365f9c'],
        matchMode: 'any',
        threshold: 18,
      },
      totalResults: 1,
      took: 94,
    };
  }
  if (endpoint.path.includes('/search/')) {
    return compactSearchResponse(sampleSearchResponse);
  }
  if (endpoint.path.includes('/artworks/')) {
    return {
      id: '2018-00743',
      title: 'Singapore',
      artist: 'John Turnbull Thomson',
      year: 1851,
      metadata: {
        medium: 'Oil on canvas',
        field_sources: { title: 'ngs', description: 'roots' },
      },
    };
  }
  if (endpoint.path === '/translate/text') {
    return {
      translatedText: '画廊标签文本',
      provider: 'google',
      cached: false,
      usage: { used: 2, quota: 10, remaining: 8 },
    };
  }
  if (endpoint.path === '/extract') {
    return {
      id: 'imgx_01hxyz',
      status: 'queued',
      target: 'object',
      preserveFilenames: true,
      counts: { inputs: 1, processed: 0, items: 1 },
      warnings: [],
      downloadUrl: null,
      usage: { used: 1, quota: 10, remaining: 9 },
    };
  }
  return { success: true };
};

export default function ApiDocsPage() {
  const { apiBase, initialOrgDirectory } = useLoaderData<typeof loader>();
  const { user, isLoading, login, signup, getAccessToken } = useUser();
  const { theme, toggleTheme } = useTheme();
  const queryClient = useQueryClient();
  const [keyName, setKeyName] = useState('Agent integration');
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [copiedValue, setCopiedValue] = useState<string | null>(null);
  const [testApiKey, setTestApiKey] = useState('');
  const [apiEnvironment, setApiEnvironment] = useState<ApiEnvironment>(() =>
    detectApiEnvironment(apiBase)
  );
  const [activeLanguage, setActiveLanguage] = useState<LanguageTab>('curl');
  const [activeSectionId, setActiveSectionId] = useState('overview');
  const [activeEndpointId, setActiveEndpointId] = useState(
    endpointIdByPath[defaultBuilderEndpointPath] ?? endpointDocs[0]!.id
  );
  const [railResponses, setRailResponses] = useState<
    Record<string, RailRunResult>
  >({});

  const orgsQuery = useQuery({
    queryKey: ['api-docs-orgs', apiBase],
    queryFn: async () => {
      const response = await fetch('/api/docs/orgs', {
        headers: { Accept: 'application/json' },
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as {
          message?: string;
        } | null;
        throw new Error(
          payload?.message || `Request failed (${response.status})`
        );
      }

      return (await response.json()) as OrgDirectoryPayload;
    },
    initialData: initialOrgDirectory ?? undefined,
    staleTime: 5 * 60 * 1000,
    retry: false,
  });

  const apiKeysQuery = useQuery({
    queryKey: ['api-keys'],
    queryFn: () => apiClient.listApiKeys(getAccessToken),
    enabled: Boolean(user),
    retry: false,
  });

  const usageQuery = useQuery({
    queryKey: ['api-usage-today'],
    queryFn: () => apiClient.getTodayUsage(getAccessToken),
    enabled: Boolean(user),
    retry: false,
  });

  const translationUsageQuery = useQuery({
    queryKey: ['translation-usage', user?.id],
    queryFn: () => apiClient.getTranslationUsage(getAccessToken),
    enabled: Boolean(user),
    retry: false,
  });

  const extractUsageQuery = useQuery({
    queryKey: ['extract-usage', user?.id],
    queryFn: () => apiClient.getExtractUsage(getAccessToken),
    enabled: Boolean(user),
    retry: false,
  });

  const keys = apiKeysQuery.data?.keys ?? [];
  const activeKey = keys.find((key) => key.status === 'active');
  const liveApiKey = testApiKey.trim();
  const shownApiKey = liveApiKey || maskKey(null);
  const selectedApiBase = apiBaseByEnvironment[apiEnvironment];
  const dailyUsage = usageQuery.data ?? defaultDailyUsage;
  const translationUsage =
    translationUsageQuery.data ?? defaultTranslationUsage;
  const extractUsage =
    extractUsageQuery.data ?? defaultExtractUsage;
  const dailyPercent =
    dailyUsage.quota > 0
      ? Math.min((dailyUsage.used / dailyUsage.quota) * 100, 100)
      : 0;
  const translationPercent =
    translationUsage.quota > 0
      ? Math.min((translationUsage.used / translationUsage.quota) * 100, 100)
      : 0;
  const extractPercent =
    extractUsage.quota > 0
      ? Math.min(
          (extractUsage.used / extractUsage.quota) * 100,
          100
        )
      : 0;
  const dailyUsageValue = !user
    ? 'Sign in'
    : usageQuery.isLoading
      ? 'Checking'
      : usageQuery.isError
        ? 'Refresh'
        : `${dailyUsage.used}/${dailyUsage.quota}`;
  const translationUsageValue = !user
    ? 'Sign in'
    : translationUsageQuery.isLoading
      ? 'Checking'
      : translationUsageQuery.isError
        ? 'Refresh'
        : `${translationUsage.remaining} left`;
  const extractUsageValue = !user
    ? 'Sign in'
    : extractUsageQuery.isLoading
      ? 'Checking'
      : extractUsageQuery.isError
        ? 'Refresh'
        : `${extractUsage.remaining} left`;
  const hasUsageError = Boolean(
    user &&
      (usageQuery.isError ||
        translationUsageQuery.isError ||
        extractUsageQuery.isError)
  );
  const usageErrorMessage =
    usageQuery.error instanceof Error
      ? usageQuery.error.message
      : translationUsageQuery.error instanceof Error
        ? translationUsageQuery.error.message
        : extractUsageQuery.error instanceof Error
          ? extractUsageQuery.error.message
          : 'Token check failed';
  const orgDirectory = orgsQuery.data?.orgs?.length
    ? orgsQuery.data.orgs
    : fallbackOrgs;
  const orgListResponse = {
    success: true,
    data: orgDirectory.map(({ key, id, name, slug, description, website }) => ({
      key: key || getOrgKey({ id, name, slug }),
      name,
      slug,
      description,
      website,
    })),
    metadata: {
      total: orgsQuery.data?.total ?? orgDirectory.length,
    },
  };
  const activeEndpointDoc =
    endpointDocs.find((doc) => doc.id === activeEndpointId) ??
    endpointDocs.find(
      (doc) => doc.endpoint.path === defaultBuilderEndpointPath
    ) ??
    endpointDocs[0]!;
  const activeEndpointValues = useMemo(
    () => getInitialEndpointValues(activeEndpointDoc.endpoint),
    [activeEndpointDoc.endpoint]
  );
  const activeRequest = useMemo(
    () =>
      buildEndpointRequest({
        apiBase: selectedApiBase,
        apiKey: shownApiKey,
        endpoint: activeEndpointDoc.endpoint,
        values: activeEndpointValues,
      }),
    [
      activeEndpointDoc.endpoint,
      activeEndpointValues,
      selectedApiBase,
      shownApiKey,
    ]
  );
  const activeRailResponse = railResponses[activeEndpointDoc.endpoint.path];
  const railResponsePayload =
    activeRailResponse?.payload ??
    buildExampleResponse(activeEndpointDoc.endpoint, orgListResponse);
  const railStatus = activeRailResponse
    ? `${activeRailResponse.status} · ${activeRailResponse.durationMs} ms`
    : activeEndpointDoc.endpoint.path.includes('/search/')
      ? '200 · 184 ms'
      : 'example';
  const activeSample = buildLanguageSample({
    activeLanguage,
    apiBase: selectedApiBase,
    apiKey: shownApiKey,
    endpoint: activeEndpointDoc.endpoint,
    request: activeRequest,
    values: activeEndpointValues,
  });
  const activeNav = findNavItem(activeSectionId);
  const showCodeRail = endpointDocs.some((doc) => doc.id === activeSectionId);
  const mcpConfig = useMemo(
    () =>
      stringify({
        mcpServers: {
          paillette: {
            url: `${selectedApiBase}/mcp`,
            headers: {
              'X-API-Key': shownApiKey,
            },
          },
        },
      }),
    [selectedApiBase, shownApiKey]
  );
  const docsMarkdown = useMemo(
    () => buildDocsMarkdown(selectedApiBase),
    [selectedApiBase]
  );

  const createApiKeyMutation = useMutation({
    mutationFn: () =>
      apiClient.createApiKey(getAccessToken, keyName || 'Agent integration'),
    onSuccess: (created) => {
      setCreatedKey(created.key);
      setTestApiKey(created.key);
      void queryClient.invalidateQueries({ queryKey: ['api-keys'] });
    },
  });

  const revokeApiKeyMutation = useMutation({
    mutationFn: (keyId: string) =>
      apiClient.revokeApiKey(getAccessToken, keyId),
    onSuccess: () => {
      setCreatedKey(null);
      void queryClient.invalidateQueries({ queryKey: ['api-keys'] });
    },
  });

  const railRunMutation = useMutation({
    mutationFn: async () => {
      const endpoint = activeEndpointDoc.endpoint;
      const request = buildEndpointRequest({
        apiBase: selectedApiBase,
        apiKey: liveApiKey,
        endpoint,
        values: activeEndpointValues,
      });

      if (request.requiresAuth && !liveApiKey) {
        throw new Error('Paste an API key in the top bar to run this request.');
      }

      if (request.missingFiles.length) {
        throw new Error(
          `This endpoint needs ${request.missingFiles.join(', ')}; use the generated sample.`
        );
      }

      const startedAt = performance.now();
      const response = await fetch('/api/docs/proxy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          apiEnv: apiEnvironment,
          apiKey: liveApiKey,
          endpointPath: endpoint.path,
          values: activeEndpointValues,
        }),
      });
      const contentType = response.headers.get('content-type') ?? '';
      const payload = contentType.includes('application/json')
        ? await response.json()
        : await response.text();
      const apiPayload = payload as ApiResponse<unknown>;

      if (
        !response.ok ||
        (typeof apiPayload === 'object' &&
          apiPayload !== null &&
          'success' in apiPayload &&
          apiPayload.success === false)
      ) {
        throw new Error(
          apiPayload.error?.message || `Request failed (${response.status})`
        );
      }

      return {
        durationMs: Math.max(1, Math.round(performance.now() - startedAt)),
        endpointPath: endpoint.path,
        payload,
        status: response.status,
        statusText: response.statusText || 'OK',
      } satisfies RailRunResult;
    },
    onSuccess: (result) => {
      setRailResponses((previous) => ({
        ...previous,
        [result.endpointPath]: result,
      }));
      void queryClient.invalidateQueries({ queryKey: ['api-usage-today'] });
      void queryClient.invalidateQueries({
        queryKey: ['extract-usage', user?.id],
      });
      void queryClient.invalidateQueries({ queryKey: ['api-keys'] });
    },
  });

  useEffect(() => {
    const sections = Array.from(
      document.querySelectorAll<HTMLElement>('[data-doc-section]')
    );
    if (!sections.length) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        const id = visible?.target.id;
        if (id) setActiveSectionId(id);
      },
      { rootMargin: '-64px 0px -60% 0px', threshold: [0.1, 0.35, 0.6] }
    );

    sections.forEach((section) => observer.observe(section));
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const endpointSections = Array.from(
      document.querySelectorAll<HTMLElement>('[data-endpoint-section]')
    );
    if (!endpointSections.length) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        const id = visible?.target.id;
        if (id) setActiveEndpointId(id);
      },
      { rootMargin: '-72px 0px -48% 0px', threshold: [0.1, 0.35, 0.6] }
    );

    endpointSections.forEach((section) => observer.observe(section));
    return () => observer.disconnect();
  }, []);

  const retryUsageChecks = () => {
    void queryClient.invalidateQueries({ queryKey: ['api-usage-today'] });
    void queryClient.invalidateQueries({
      queryKey: ['translation-usage', user?.id],
    });
    void queryClient.invalidateQueries({
      queryKey: ['extract-usage', user?.id],
    });
    void queryClient.invalidateQueries({ queryKey: ['api-keys'] });
  };

  const copyText = async (id: string, value: string) => {
    let didCopy = false;

    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value);
        didCopy = true;
      }
    } catch {
      didCopy = false;
    }

    if (!didCopy) {
      const textArea = document.createElement('textarea');
      textArea.value = value;
      textArea.setAttribute('readonly', '');
      textArea.style.position = 'fixed';
      textArea.style.left = '-9999px';
      textArea.style.top = '0';
      document.body.appendChild(textArea);
      textArea.focus();
      textArea.select();
      textArea.setSelectionRange(0, value.length);
      didCopy = document.execCommand('copy');
      document.body.removeChild(textArea);
    }

    if (!didCopy) return;

    setCopiedValue(id);
    window.setTimeout(() => setCopiedValue(null), 1500);
  };

  return (
    <div
      className="themeable-surface min-h-screen overflow-x-hidden bg-[var(--app-bg)] text-[var(--app-text)]"
      style={docsThemeStyle}
    >
      <header className="sticky top-0 z-50 grid min-h-[52px] grid-cols-[240px_minmax(0,1fr)_auto] items-center gap-4 border-b border-[var(--app-line)] bg-[color-mix(in_srgb,var(--app-bg)_91%,transparent)] px-4 backdrop-blur-xl max-[1280px]:grid-cols-[220px_minmax(0,1fr)_auto] max-[900px]:grid-cols-[minmax(88px,1fr)_auto] max-[520px]:gap-2 max-[520px]:px-3">
        <div className="min-w-max">
          <Logo
            size="sm"
            framed
            linkToHome
            className="whitespace-nowrap max-[520px]:text-lg"
          />
        </div>

        <div className="flex min-w-0 items-center gap-2 text-xs text-[var(--app-muted)] max-[900px]:hidden">
          <span>Reference</span>
          <span className="text-[var(--app-faint)]">/</span>
          <span>{activeNav?.group ?? 'Search'}</span>
          <span className="text-[var(--app-faint)]">/</span>
          <code
            className="truncate text-[var(--docs-code)]"
            style={monoStyle}
            title={
              activeNav?.item.label ?? displayPath(activeEndpointDoc.endpoint)
            }
          >
            {activeEndpointDoc.id === activeSectionId
              ? `${activeEndpointDoc.endpoint.method} ${displayPath(
                  activeEndpointDoc.endpoint,
                  false
                )}`
              : activeNav?.item.label}
          </code>
        </div>

        <div className="flex min-w-0 items-center justify-end gap-2 max-[520px]:gap-1.5">
          <div className="hidden items-center gap-1.5 min-[680px]:flex">
            <UsageChip
              label="SEARCH"
              value={dailyUsageValue}
              percent={dailyPercent}
            />
            <UsageChip
              label="TRANSL"
              value={translationUsageValue}
              percent={translationPercent}
            />
            <UsageChip
              label="EXTRACT"
              value={extractUsageValue}
              percent={extractPercent}
            />
          </div>
          <label className="flex h-9 min-w-0 items-center gap-2 rounded-md border border-[var(--app-line)] bg-[var(--app-control)] px-2.5 max-[520px]:px-2">
            <span
              className="text-[10px] uppercase tracking-[0.16em] text-[var(--app-faint)] max-[1120px]:hidden"
              style={monoStyle}
            >
              key
            </span>
            <input
              type="password"
              value={testApiKey}
              onChange={(event) => setTestApiKey(event.target.value)}
              placeholder="plt_stg_..."
              autoComplete="off"
              spellCheck={false}
              className="h-7 w-[18ch] min-w-0 bg-transparent text-xs text-[var(--app-text)] outline-none placeholder:text-[var(--app-faint)] max-[1120px]:w-[12ch] max-[520px]:w-[7ch]"
              style={monoStyle}
              aria-label="API key"
            />
            <span
              className="h-1.5 w-1.5 shrink-0 rounded-full"
              style={{
                background: liveApiKey
                  ? 'var(--docs-success)'
                  : 'var(--app-faint)',
              }}
              aria-hidden="true"
            />
          </label>
          <select
            value={apiEnvironment}
            onChange={(event) =>
              setApiEnvironment(event.target.value as ApiEnvironment)
            }
            className="h-9 rounded-md border border-[var(--app-line)] bg-[var(--app-control)] px-2 text-xs text-[var(--app-muted-strong)] outline-none max-[520px]:px-1.5"
            style={monoStyle}
            aria-label="API environment"
          >
            <option value="stg">stg</option>
            <option value="prod">prod</option>
          </select>
          <button
            type="button"
            onClick={() => void copyText('docs-markdown', docsMarkdown)}
            className="inline-flex h-9 items-center justify-center gap-1.5 rounded-md border border-[var(--app-line)] bg-[var(--app-control)] px-2.5 text-xs text-[var(--app-muted-strong)] transition hover:border-[var(--app-line-strong)] hover:text-[var(--app-text)] max-[620px]:px-2"
            aria-label="Copy API docs as Markdown"
            title="Copy API docs as Markdown"
          >
            {copiedValue === 'docs-markdown' ? (
              <Check className="h-3.5 w-3.5" />
            ) : (
              <Copy className="h-3.5 w-3.5" />
            )}
            <span className="max-[1080px]:hidden">
              {copiedValue === 'docs-markdown' ? 'Copied' : 'Copy MD'}
            </span>
          </button>
          <button
            type="button"
            onClick={toggleTheme}
            className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-[var(--app-line)] bg-[var(--app-control)] text-[var(--app-muted-strong)] transition hover:border-[var(--app-line-strong)] hover:text-[var(--app-text)] max-[520px]:h-8 max-[520px]:w-8"
            aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
            title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
          >
            {theme === 'dark' ? (
              <Sun className="h-4 w-4" />
            ) : (
              <Moon className="h-4 w-4" />
            )}
          </button>
          <UserMenu />
        </div>
      </header>

      <div
        className={`grid min-h-[calc(100vh-52px)] ${
          showCodeRail
            ? 'grid-cols-[240px_minmax(0,1fr)_480px] max-[1280px]:grid-cols-[220px_minmax(0,1fr)_420px]'
            : 'grid-cols-[240px_minmax(0,1fr)] max-[1280px]:grid-cols-[220px_minmax(0,1fr)]'
        } max-[900px]:grid-cols-1`}
      >
        <DocsNav activeSectionId={activeSectionId} />

        <main className="min-w-0 px-8 py-6 max-[1080px]:px-5 max-[900px]:px-4">
          <StartSections
            copiedValue={copiedValue}
            docsMarkdown={docsMarkdown}
            onCopy={copyText}
            selectedApiBase={selectedApiBase}
          />

          {endpointDocs.map((doc) => (
            <EndpointSection key={doc.id} doc={doc} />
          ))}

          <McpSections
            copiedValue={copiedValue}
            mcpConfig={mcpConfig}
            onCopy={copyText}
          />

          <AccountSections
            activeKey={activeKey}
            apiKeysLoading={apiKeysQuery.isLoading}
            apiKeysError={apiKeysQuery.isError}
            copiedValue={copiedValue}
            createApiKeyMutation={createApiKeyMutation}
            createdKey={createdKey}
            dailyPercent={dailyPercent}
            dailyUsageValue={dailyUsageValue}
            hasUsageError={hasUsageError}
            extractPercent={extractPercent}
            extractUsageValue={extractUsageValue}
            isLoading={isLoading}
            keyName={keyName}
            keys={keys}
            onCopy={copyText}
            onKeyNameChange={setKeyName}
            onLogin={login}
            onRetryUsage={retryUsageChecks}
            onSignup={signup}
            revokeApiKeyMutation={revokeApiKeyMutation}
            setTestApiKey={setTestApiKey}
            translationPercent={translationPercent}
            translationUsageValue={translationUsageValue}
            usageErrorMessage={usageErrorMessage}
            user={user}
          />
        </main>

        {showCodeRail && (
          <CodeRail
            activeLanguage={activeLanguage}
            copied={copiedValue === 'rail-sample'}
            endpointDoc={activeEndpointDoc}
            error={
              railRunMutation.error instanceof Error
                ? railRunMutation.error.message
                : null
            }
            isRunning={railRunMutation.isPending}
            onCopy={() => copyText('rail-sample', activeSample)}
            onLanguageChange={setActiveLanguage}
            onRun={() => railRunMutation.mutate()}
            request={activeRequest}
            responsePayload={railResponsePayload}
            sample={activeSample}
            status={railStatus}
            canRun={
              !railRunMutation.isPending &&
              (!activeRequest.requiresAuth || Boolean(liveApiKey)) &&
              !activeRequest.missingFiles.length
            }
          />
        )}
      </div>
    </div>
  );
}

function StartSections({
  copiedValue,
  docsMarkdown,
  onCopy,
  selectedApiBase,
}: {
  copiedValue: string | null;
  docsMarkdown: string;
  onCopy: (id: string, value: string) => void;
  selectedApiBase: string;
}) {
  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
      <section
        id="overview"
        data-doc-section
        className="scroll-mt-20 border-b border-[var(--app-line)] pb-6"
      >
        <h1
          className="text-[2.15rem] font-semibold leading-none text-[var(--app-text-strong)]"
          style={displayStyle}
        >
          Paillette API
        </h1>
        <p className="mt-3 text-sm leading-6 text-[var(--app-muted)]">
          Resolve a source, search or translate through REST, and keep
          provenance fields with every displayed catalogue value.
        </p>
        <div className="mt-4 flex min-w-0 flex-wrap items-center gap-2 text-xs text-[var(--app-muted)]">
          <button
            type="button"
            onClick={() => onCopy('docs-markdown', docsMarkdown)}
            className="inline-flex h-9 items-center justify-center gap-1.5 rounded-md border border-[var(--app-line-strong)] bg-[var(--app-control-strong)] px-3 text-sm font-medium text-[var(--app-text)] transition hover:border-[var(--docs-code)]"
            aria-label="Copy API docs as Markdown"
          >
            {copiedValue === 'docs-markdown' ? (
              <Check className="h-3.5 w-3.5" />
            ) : (
              <Copy className="h-3.5 w-3.5" />
            )}
            {copiedValue === 'docs-markdown' ? 'Copied' : 'Copy MD'}
          </button>
          <InlineDatum label="Base" value={selectedApiBase} />
          <InlineDatum label="Auth" value="X-API-Key" />
          <InlineDatum label="Source" value={NGS_ORG_SHORTCODE} />
        </div>
      </section>

      <section
        id="authentication"
        data-doc-section
        className="scroll-mt-20 border-b border-[var(--app-line)] py-6"
      >
        <SectionHeading title="Authentication" />
        <p className="text-sm leading-6 text-[var(--app-muted)]">
          Server-to-server calls use <CodeText>X-API-Key</CodeText>. Public
          source discovery works without a key; search, artwork lookup, and
          translation require one.
        </p>
      </section>

      <section
        id="field-sources"
        data-doc-section
        className="scroll-mt-20 border-b border-[var(--app-line)] py-6"
      >
        <SectionHeading title="Field sources" />
        <p className="mb-3 text-sm leading-6 text-[var(--app-muted)]">
          Search results include normalized metadata plus source labels. Check
          these fields before displaying catalogue text or citations.
        </p>
        <SchemaRows fields={responseMetadataFields.slice(0, 4)} />
      </section>
    </motion.div>
  );
}

function DocsNav({ activeSectionId }: { activeSectionId: string }) {
  return (
    <aside className="sticky top-[52px] h-[calc(100vh-52px)] overflow-y-auto border-r border-[var(--app-line)] px-3 py-4 [scrollbar-width:thin] max-[900px]:relative max-[900px]:top-0 max-[900px]:h-auto max-[900px]:border-b max-[900px]:border-r-0 max-[900px]:py-3">
      <nav
        aria-label="API documentation"
        className="flex flex-col gap-4 max-[900px]:flex-row max-[900px]:gap-3 max-[900px]:overflow-x-auto"
      >
        {docsNavGroups.map((group) => (
          <div key={group.title} className="min-w-[190px]">
            <p
              className="px-2 text-[10px] uppercase tracking-[0.2em] text-[var(--app-faint)]"
              style={monoStyle}
            >
              {group.title}
            </p>
            <div className="mt-1 grid gap-0.5">
              {group.items.map((item) => (
                <a
                  key={item.href}
                  href={item.href}
                  className="flex min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-sm text-[var(--app-muted)] transition hover:bg-[var(--app-control)] hover:text-[var(--app-text)]"
                  style={
                    activeSectionId === item.id
                      ? {
                          background: 'var(--app-control-strong)',
                          color: 'var(--app-text)',
                        }
                      : undefined
                  }
                >
                  {item.method && <MethodTag method={item.method} />}
                  <span className="truncate">{item.label}</span>
                </a>
              ))}
            </div>
          </div>
        ))}
      </nav>
    </aside>
  );
}

function EndpointSection({ doc }: { doc: EndpointDoc }) {
  const endpoint = doc.endpoint;
  const pathFields = getEndpointPathFields(endpoint);
  const bodyFields = getEndpointBodyFields(endpoint);

  return (
    <section
      id={doc.id}
      data-doc-section
      data-endpoint-section
      className="scroll-mt-20 border-b border-[var(--app-line)] py-6"
    >
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <MethodTag method={endpoint.method as SectionTone} />
        <code
          className="min-w-0 break-words text-sm text-[var(--docs-code)]"
          style={monoStyle}
        >
          {displayPath(endpoint)}
        </code>
        <span
          className="rounded-full border border-[var(--app-line)] px-2 py-0.5 text-[10px] uppercase tracking-[0.12em] text-[var(--app-faint)]"
          style={monoStyle}
        >
          {endpointRequiresAuth(endpoint) ? 'requires key' : 'public'}
        </span>
      </div>
      <h2
        className="mt-2 text-[1.5rem] font-semibold leading-tight text-[var(--app-text-strong)]"
        style={displayStyle}
      >
        {endpoint.title}
      </h2>
      <p className="mt-1 text-sm leading-6 text-[var(--app-muted)]">
        {doc.summary}
      </p>

      <div className="mt-4">
        <SchemaDisclosure title="Path" fields={pathFields} defaultOpen />
        <SchemaDisclosure title="Body" fields={bodyFields} defaultOpen />
        <SchemaDisclosure title="Response" fields={doc.responseFields} />
      </div>
    </section>
  );
}

function McpSections({
  copiedValue,
  mcpConfig,
  onCopy,
}: {
  copiedValue: string | null;
  mcpConfig: string;
  onCopy: (id: string, value: string) => void;
}) {
  return (
    <>
      <section
        id="mcp-client-config"
        data-doc-section
        className="scroll-mt-20 border-b border-[var(--app-line)] py-6"
      >
        <SectionHeading title="MCP client config" />
        <p className="mb-4 text-sm leading-6 text-[var(--app-muted)]">
          Point the client at <CodeText>/api/v1/mcp</CodeText> and send the same
          API key used for REST calls.
        </p>
        <CodePanel
          id="mcp-config"
          copied={copiedValue === 'mcp-config'}
          label="mcpServers"
          onCopy={onCopy}
          value={mcpConfig}
        />
      </section>

      <section
        id="mcp-tool-reference"
        data-doc-section
        className="scroll-mt-20 border-b border-[var(--app-line)] py-6"
      >
        <SectionHeading title="MCP tool reference" />
        <div className="mt-2 divide-y divide-[var(--app-line)] border-y border-[var(--app-line)]">
          {[primaryMcpTool, ...secondaryMcpTools].map((tool) => (
            <details key={tool.name} className="group py-3">
              <summary className="flex cursor-pointer list-none items-start justify-between gap-3">
                <div className="min-w-0">
                  <code
                    className="break-words text-sm text-[var(--docs-code)]"
                    style={monoStyle}
                  >
                    {tool.name}
                  </code>
                  <p className="mt-1 text-sm leading-6 text-[var(--app-muted)]">
                    {tool.description}
                  </p>
                </div>
                <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-[var(--app-faint)] transition group-open:rotate-90" />
              </summary>
              <div className="mt-3">
                <SchemaRows fields={tool.schema} />
              </div>
            </details>
          ))}
        </div>
      </section>
    </>
  );
}

function AccountSections({
  activeKey,
  apiKeysError,
  apiKeysLoading,
  copiedValue,
  createApiKeyMutation,
  createdKey,
  dailyPercent,
  dailyUsageValue,
  hasUsageError,
  extractPercent,
  extractUsageValue,
  isLoading,
  keyName,
  keys,
  onCopy,
  onKeyNameChange,
  onLogin,
  onRetryUsage,
  onSignup,
  revokeApiKeyMutation,
  setTestApiKey,
  translationPercent,
  translationUsageValue,
  usageErrorMessage,
  user,
}: {
  activeKey:
    | { id: string; key_prefix: string; name: string; status: string }
    | undefined;
  apiKeysError: boolean;
  apiKeysLoading: boolean;
  copiedValue: string | null;
  createApiKeyMutation: ReturnType<
    typeof useMutation<
      Awaited<ReturnType<typeof apiClient.createApiKey>>,
      Error,
      void
    >
  >;
  createdKey: string | null;
  dailyPercent: number;
  dailyUsageValue: string;
  hasUsageError: boolean;
  extractPercent: number;
  extractUsageValue: string;
  isLoading: boolean;
  keyName: string;
  keys: Array<{ id: string; key_prefix: string; name: string; status: string }>;
  onCopy: (id: string, value: string) => void;
  onKeyNameChange: (value: string) => void;
  onLogin: (options?: { returnTo?: string }) => Promise<void>;
  onRetryUsage: () => void;
  onSignup: (options?: { returnTo?: string }) => Promise<void>;
  revokeApiKeyMutation: ReturnType<typeof useMutation<void, Error, string>>;
  setTestApiKey: (value: string) => void;
  translationPercent: number;
  translationUsageValue: string;
  usageErrorMessage: string;
  user: { email?: string; name: string } | null;
}) {
  return (
    <>
      <section
        id="api-keys"
        data-doc-section
        className="scroll-mt-20 border-b border-[var(--app-line)] py-6"
      >
        <SectionHeading
          title="API keys"
          description={
            isLoading
              ? 'Checking sign-in state.'
              : user
                ? `Signed in as ${user.email || user.name}.`
                : 'Sign in to create keys and run live requests.'
          }
        />

        {isLoading ? (
          <InlineStatus>
            <Loader2 className="h-4 w-4 animate-spin" />
            Checking sign-in state
          </InlineStatus>
        ) : !user ? (
          <div className="flex flex-col gap-4 border-y border-[var(--app-line)] py-4 md:flex-row md:items-center md:justify-between">
            <p className="text-sm leading-6 text-[var(--app-muted)]">
              Key management is tied to your Paillette account. The top-bar key
              input stays available for pasted keys.
            </p>
            <div className="flex flex-wrap gap-2">
              <ActionButton
                onClick={() =>
                  void onSignup({ returnTo: getCurrentReturnTo() })
                }
              >
                <UserPlus className="h-4 w-4" />
                Create account
              </ActionButton>
              <ActionButton
                variant="ghost"
                onClick={() => void onLogin({ returnTo: getCurrentReturnTo() })}
              >
                <LogIn className="h-4 w-4" />
                Log in
              </ActionButton>
            </div>
          </div>
        ) : (
          <div className="grid gap-5 border-y border-[var(--app-line)] py-4 xl:grid-cols-[minmax(0,0.74fr)_minmax(0,1fr)]">
            <div className="min-w-0">
              <label className="grid gap-2">
                <span className="text-xs text-[var(--app-muted)]">
                  Key name
                </span>
                <input
                  value={keyName}
                  onChange={(event) => onKeyNameChange(event.target.value)}
                  disabled={
                    Boolean(activeKey) || createApiKeyMutation.isPending
                  }
                  className="h-10 rounded-md border border-[var(--app-line)] bg-[var(--app-control)] px-3 text-sm text-[var(--app-text)] outline-none transition focus:border-[var(--docs-code)] disabled:opacity-50"
                />
              </label>
              <ActionButton
                className="mt-3 w-full justify-center"
                disabled={Boolean(activeKey) || createApiKeyMutation.isPending}
                onClick={() => createApiKeyMutation.mutate()}
              >
                {createApiKeyMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <KeyRound className="h-4 w-4" />
                )}
                Create API key
              </ActionButton>

              {apiKeysError && (
                <Notice tone="warn">
                  Key check failed. Reconnect sign-in.
                </Notice>
              )}
              {createApiKeyMutation.isError && (
                <Notice tone="error">
                  {createApiKeyMutation.error instanceof Error
                    ? createApiKeyMutation.error.message
                    : 'Failed to create API key'}
                </Notice>
              )}
              {createdKey && (
                <div className="mt-4 border-y border-[color-mix(in_srgb,#86198f_26%,transparent)] py-3">
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <p className="text-sm font-medium text-[var(--app-text)]">
                      New key
                    </p>
                    <CopyButton
                      copied={copiedValue === 'created-key'}
                      onClick={() => onCopy('created-key', createdKey)}
                    />
                  </div>
                  <code
                    className="block overflow-x-auto rounded-md bg-[var(--app-control)] p-3 text-xs text-[var(--docs-code)]"
                    style={monoStyle}
                  >
                    {createdKey}
                  </code>
                  <ActionButton
                    className="mt-3"
                    variant="ghost"
                    onClick={() => setTestApiKey(createdKey)}
                  >
                    Use in top bar
                  </ActionButton>
                </div>
              )}
            </div>

            <div className="min-w-0 divide-y divide-[var(--app-line)]">
              {apiKeysLoading && (
                <InlineStatus>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Loading keys
                </InlineStatus>
              )}
              {keys.length
                ? keys.map((key) => (
                    <div
                      key={key.id}
                      className="flex items-center justify-between gap-3 py-3"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-[var(--app-text)]">
                          {key.name}
                        </p>
                        <p
                          className="mt-1 text-xs text-[var(--app-faint)]"
                          style={monoStyle}
                        >
                          {key.key_prefix}...
                        </p>
                      </div>
                      {key.status === 'active' && (
                        <button
                          type="button"
                          onClick={() => revokeApiKeyMutation.mutate(key.id)}
                          disabled={revokeApiKeyMutation.isPending}
                          className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-[color-mix(in_srgb,#f87171_30%,transparent)] text-[color-mix(in_srgb,#f87171_84%,var(--app-text))] transition hover:bg-[color-mix(in_srgb,#f87171_12%,transparent)] disabled:opacity-50"
                          aria-label="Revoke API key"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  ))
                : !apiKeysLoading && (
                    <p className="py-3 text-sm text-[var(--app-muted)]">
                      No API keys yet.
                    </p>
                  )}
            </div>
          </div>
        )}
      </section>

      <section
        id="usage-billing"
        data-doc-section
        className="scroll-mt-20 border-b border-[var(--app-line)] py-6"
      >
        <SectionHeading title="Usage & billing" />
        <div className="grid gap-5 border-y border-[var(--app-line)] py-4 md:grid-cols-3">
          <UsageMeter
            label="Search API today"
            percent={dailyPercent}
            value={dailyUsageValue}
          />
          <UsageMeter
            label="Free translations"
            percent={translationPercent}
            value={translationUsageValue}
          />
          <UsageMeter
            label="Free /extract"
            percent={extractPercent}
            value={extractUsageValue}
          />
        </div>
        {hasUsageError && (
          <Notice tone="warn">
            <span>Token check failed. Refresh your sign-in.</span>
            <code
              className="mt-1 block truncate text-xs text-[var(--app-faint)]"
              style={monoStyle}
            >
              {usageErrorMessage}
            </code>
            <ActionButton
              className="mt-3"
              variant="ghost"
              onClick={onRetryUsage}
            >
              <RefreshCw className="h-4 w-4" />
              Retry
            </ActionButton>
          </Notice>
        )}
      </section>
    </>
  );
}

function CodeRail({
  activeLanguage,
  canRun,
  copied,
  endpointDoc,
  error,
  isRunning,
  onCopy,
  onLanguageChange,
  onRun,
  request,
  responsePayload,
  sample,
  status,
}: {
  activeLanguage: LanguageTab;
  canRun: boolean;
  copied: boolean;
  endpointDoc: EndpointDoc;
  error: string | null;
  isRunning: boolean;
  onCopy: () => void;
  onLanguageChange: (language: LanguageTab) => void;
  onRun: () => void;
  request: BuiltEndpointRequest;
  responsePayload: unknown;
  sample: string;
  status: string;
}) {
  return (
    <aside className="sticky top-[52px] h-[calc(100vh-52px)] min-w-0 overflow-y-auto border-l border-[var(--app-line)] bg-[color-mix(in_srgb,var(--app-bg-soft)_62%,transparent)] px-5 py-4 [scrollbar-width:thin] max-[900px]:relative max-[900px]:top-0 max-[900px]:h-auto max-[900px]:border-l-0 max-[900px]:border-t">
      <div
        className="flex min-w-0 items-center justify-between gap-3 text-[10px] uppercase tracking-[0.14em] text-[var(--app-faint)]"
        style={monoStyle}
      >
        <span className="truncate">
          {endpointDoc.endpoint.method}{' '}
          {displayPath(endpointDoc.endpoint, false)}
        </span>
        <span className="shrink-0 text-[var(--docs-success)]">{status}</span>
      </div>

      <div className="mt-3 flex rounded-md border border-[var(--app-line)] bg-[var(--app-control)] p-1">
        {languageTabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => onLanguageChange(tab.id)}
            className="flex-1 rounded px-2 py-1.5 text-xs text-[var(--app-muted)] transition hover:text-[var(--app-text)]"
            style={{
              ...monoStyle,
              ...(activeLanguage === tab.id
                ? {
                    background: 'var(--app-control-strong)',
                    color: 'var(--app-text)',
                  }
                : {}),
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <CodePanel
        className="mt-3"
        id="rail-request"
        maxHeight="280px"
        value={sample}
      />

      <div className="mt-3 grid grid-cols-[minmax(0,1fr)_auto] gap-2">
        <ActionButton
          disabled={!canRun}
          onClick={onRun}
          title={
            request.missingFiles.length
              ? 'This endpoint requires a file.'
              : request.requiresAuth && !canRun
                ? 'Paste an API key in the top bar.'
                : undefined
          }
        >
          {isRunning ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Play className="h-4 w-4" />
          )}
          Run
        </ActionButton>
        <ActionButton variant="ghost" onClick={onCopy}>
          {copied ? (
            <Check className="h-4 w-4" />
          ) : (
            <Copy className="h-4 w-4" />
          )}
          Copy
        </ActionButton>
      </div>

      {error && <Notice tone="error">{error}</Notice>}

      <div
        className="mt-4 flex items-center gap-2 text-xs text-[var(--app-muted)]"
        style={monoStyle}
      >
        <span className="h-2 w-2 rounded-full bg-[var(--docs-success)]" />
        Response
      </div>
      <CodePanel
        className="mt-2"
        id="rail-response"
        maxHeight="420px"
        value={stringify(responsePayload)}
        highlighted
      />
    </aside>
  );
}

function SchemaDisclosure({
  defaultOpen = false,
  fields,
  title,
}: {
  defaultOpen?: boolean;
  fields: SchemaField[];
  title: string;
}) {
  return (
    <details
      className="group border-t border-[var(--app-line)]"
      open={defaultOpen}
    >
      <summary className="flex cursor-pointer list-none items-center gap-2 py-3 text-xs uppercase tracking-[0.12em] text-[var(--app-muted-strong)]">
        <ChevronRight className="h-3.5 w-3.5 text-[var(--app-faint)] transition group-open:rotate-90" />
        <span style={monoStyle}>{title}</span>
        <span
          className="ml-auto text-[10px] normal-case tracking-normal text-[var(--app-faint)]"
          style={monoStyle}
        >
          {fields.length} {fields.length === 1 ? 'field' : 'fields'}
        </span>
      </summary>
      <SchemaRows
        fields={fields}
        emptyLabel={`No ${title.toLowerCase()} fields.`}
      />
    </details>
  );
}

function SchemaRows({
  emptyLabel = 'No fields.',
  fields,
}: {
  emptyLabel?: string;
  fields: SchemaField[];
}) {
  if (!fields.length) {
    return (
      <p className="pb-3 text-sm leading-6 text-[var(--app-faint)]">
        {emptyLabel}
      </p>
    );
  }

  return (
    <div className="divide-y divide-[var(--app-line)] border-y border-[var(--app-line)]">
      {fields.map((field) => (
        <div
          key={field.name}
          className="grid min-w-0 gap-4 py-3 text-sm md:grid-cols-[minmax(240px,340px)_minmax(0,1fr)] xl:grid-cols-[minmax(300px,460px)_minmax(0,1fr)]"
        >
          <div className="min-w-0">
            <code
              className="break-all text-sm text-[var(--docs-code)]"
              style={monoStyle}
            >
              {field.name}
            </code>
            <div
              className="mt-1 flex flex-wrap gap-x-2 gap-y-1 text-[11px] text-[var(--app-faint)]"
              style={monoStyle}
            >
              <span className="break-words">{field.type}</span>
              <span>
                {field.required
                  ? 'required'
                  : field.defaultValue
                    ? 'default'
                    : 'optional'}
              </span>
              {field.defaultValue && <span>{field.defaultValue}</span>}
            </div>
          </div>
          <p className="min-w-0 leading-6 text-[var(--app-muted)]">
            {field.description}
          </p>
        </div>
      ))}
    </div>
  );
}

function UsageChip({
  label,
  percent,
  value,
}: {
  label: string;
  percent: number;
  value: string;
}) {
  return (
    <span className="inline-flex h-9 items-center gap-2 rounded-md border border-[var(--app-line)] bg-[var(--app-control)] px-2.5 text-xs text-[var(--app-muted-strong)]">
      <span
        className="text-[10px] uppercase tracking-[0.14em] max-[1180px]:hidden"
        style={monoStyle}
      >
        {label}
      </span>
      <span className="whitespace-nowrap" style={monoStyle}>
        {value}
      </span>
      <span className="h-1 w-10 overflow-hidden rounded-full bg-[var(--app-control-strong)] max-[1180px]:hidden">
        <span
          className="block h-full rounded-full bg-[image:var(--docs-brand-gradient)]"
          style={{ width: `${Math.max(0, Math.min(percent, 100))}%` }}
        />
      </span>
    </span>
  );
}

function UsageMeter({
  label,
  percent,
  value,
}: {
  label: string;
  percent: number;
  value: string;
}) {
  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-3 text-sm">
        <span className="text-[var(--app-muted)]">{label}</span>
        <span className="text-[var(--app-text)]" style={monoStyle}>
          {value}
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-[var(--app-control-strong)]">
        <div
          className="h-full rounded-full bg-[image:var(--docs-brand-gradient)]"
          style={{ width: `${Math.max(0, Math.min(percent, 100))}%` }}
        />
      </div>
    </div>
  );
}

function InlineDatum({ label, value }: { label: string; value: string }) {
  return (
    <span className="inline-flex min-w-0 items-center gap-2 border-r border-[var(--app-line)] pr-3 last:border-r-0">
      <span
        className="shrink-0 text-[10px] uppercase tracking-[0.16em] text-[var(--app-faint)]"
        style={monoStyle}
      >
        {label}
      </span>
      <code
        className="min-w-0 truncate text-[var(--docs-code)]"
        style={monoStyle}
        title={value}
      >
        {value}
      </code>
    </span>
  );
}

function SectionHeading({
  description,
  title,
}: {
  description?: ReactNode;
  title: string;
}) {
  return (
    <div className="mb-3">
      <h2
        className="text-[1.5rem] font-semibold leading-tight text-[var(--app-text-strong)]"
        style={displayStyle}
      >
        {title}
      </h2>
      {description && (
        <p className="mt-1 text-sm leading-6 text-[var(--app-muted)]">
          {description}
        </p>
      )}
    </div>
  );
}

function MethodTag({ method }: { method: SectionTone }) {
  return (
    <span
      className="inline-flex h-5 shrink-0 items-center rounded border px-1.5 text-[10px] font-semibold uppercase tracking-[0.06em]"
      style={{ ...monoStyle, ...methodTone(method) }}
    >
      {method}
    </span>
  );
}

function CodeText({ children }: { children: ReactNode }) {
  return (
    <code className="text-[var(--docs-code)]" style={monoStyle}>
      {children}
    </code>
  );
}

function InlineStatus({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-center gap-2 border-y border-[var(--app-line)] py-4 text-sm text-[var(--app-muted)]">
      {children}
    </div>
  );
}

function Notice({
  children,
  tone,
}: {
  children: ReactNode;
  tone: 'error' | 'warn';
}) {
  return (
    <div
      className="mt-3 border-y py-3 text-sm leading-6"
      style={{
        background:
          tone === 'error'
            ? 'color-mix(in srgb, #f87171 10%, transparent)'
            : 'color-mix(in srgb, #86198f 10%, transparent)',
        borderColor:
          tone === 'error'
            ? 'color-mix(in srgb, #f87171 24%, transparent)'
            : 'color-mix(in srgb, #86198f 24%, transparent)',
        color:
          tone === 'error'
            ? 'color-mix(in srgb, #f87171 84%, var(--app-text))'
            : 'var(--app-muted-strong)',
      }}
    >
      {children}
    </div>
  );
}

function ActionButton({
  children,
  className = '',
  disabled,
  onClick,
  title,
  variant = 'primary',
}: {
  children: ReactNode;
  className?: string;
  disabled?: boolean;
  onClick?: () => void;
  title?: string;
  variant?: 'primary' | 'ghost';
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      title={title}
      className={`inline-flex h-9 items-center justify-center gap-2 rounded-md border px-3 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-45 ${className}`}
      style={
        disabled
          ? {
              background: 'var(--app-control-strong)',
              borderColor: 'var(--app-line)',
              color: 'var(--app-muted)',
            }
          : variant === 'primary'
            ? {
                background: brandGradient,
                borderColor: 'transparent',
                color: '#ffffff',
              }
            : {
                background: 'var(--app-control)',
                borderColor: 'var(--app-line)',
                color: 'var(--app-muted-strong)',
              }
      }
    >
      {children}
    </button>
  );
}

function CopyButton({
  copied,
  onClick,
}: {
  copied: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--app-line)] bg-[var(--app-control)] px-2.5 text-xs text-[var(--app-muted-strong)] transition hover:border-[var(--app-line-strong)] hover:text-[var(--app-text)]"
    >
      {copied ? (
        <Check className="h-3.5 w-3.5" />
      ) : (
        <Copy className="h-3.5 w-3.5" />
      )}
      {copied ? 'Copied' : 'Copy'}
    </button>
  );
}

function CodePanel({
  className = '',
  copied,
  highlighted = false,
  id,
  label,
  maxHeight = '520px',
  onCopy,
  value,
}: {
  className?: string;
  copied?: boolean;
  highlighted?: boolean;
  id: string;
  label?: string;
  maxHeight?: string;
  onCopy?: (id: string, value: string) => void;
  value: string;
}) {
  return (
    <div
      className={`min-w-0 max-w-full overflow-hidden border-y border-[var(--app-line)] py-3 ${className}`}
      style={{
        background: highlighted
          ? 'var(--docs-code-panel-strong)'
          : 'var(--docs-code-panel)',
      }}
    >
      {(label || onCopy) && (
        <div className="mb-2 flex items-center justify-between gap-3 px-1">
          {label ? (
            <p
              className="text-[10px] uppercase tracking-[0.18em] text-[var(--app-faint)]"
              style={monoStyle}
            >
              {label}
            </p>
          ) : (
            <span aria-hidden="true" />
          )}
          {onCopy && (
            <CopyButton
              copied={Boolean(copied)}
              onClick={() => onCopy(id, value)}
            />
          )}
        </div>
      )}
      <pre
        className="max-w-full overflow-auto whitespace-pre-wrap break-words px-1 text-xs leading-5 text-[var(--app-text)]"
        style={{ ...monoStyle, maxHeight }}
      >
        {highlighted ? renderHighlightedJson(value) : value}
      </pre>
    </div>
  );
}

function renderHighlightedJson(value: string) {
  const tokenPattern =
    /("(?:\\.|[^"\\])*"(?=\s*:)|"(?:\\.|[^"\\])*"|\btrue\b|\bfalse\b|\bnull\b|-?\d+(?:\.\d+)?)/g;
  const nodes: ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = tokenPattern.exec(value))) {
    if (match.index > lastIndex) {
      nodes.push(value.slice(lastIndex, match.index));
    }

    const token = match[0];
    const isKey =
      token.startsWith('"') &&
      /^\s*:/.test(value.slice(tokenPattern.lastIndex));
    const color = isKey
      ? 'var(--docs-code-strong)'
      : token.startsWith('"')
        ? 'var(--docs-accent-strong)'
        : token === 'true' || token === 'false' || token === 'null'
          ? 'var(--docs-success)'
          : 'var(--app-text)';

    nodes.push(
      <span key={`${match.index}-${token}`} style={{ color }}>
        {token}
      </span>
    );
    lastIndex = tokenPattern.lastIndex;
  }

  if (lastIndex < value.length) nodes.push(value.slice(lastIndex));
  return nodes;
}
