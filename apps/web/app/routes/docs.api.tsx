import {
  json,
  type LoaderFunctionArgs,
  type MetaFunction,
} from '@remix-run/cloudflare';
import { Link, useLoaderData } from '@remix-run/react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import {
  Activity,
  Check,
  Copy,
  KeyRound,
  Loader2,
  LogIn,
  Play,
  Trash2,
  UserPlus,
} from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import { Button } from '~/components/ui/button';
import { Logo } from '~/components/ui/logo';
import { UserMenu } from '~/components/user/user-menu';
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
    title: 'Translation',
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
];

const responseMetadataFields: SchemaField[] = [
  {
    name: 'results[].metadata.description',
    type: 'string',
    description:
      'Catalogue text selected for display. When NGS has no usable text and a verified Roots/NHB caption exists, this is sourced from Roots.',
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
];

const primaryMcpTool =
  mcpTools.find((tool) => tool.name === 'search_artworks') || mcpTools[0];
const secondaryMcpTools = mcpTools.filter(
  (tool) => tool.name !== primaryMcpTool.name
);

const docsNav = [
  { href: '#overview', label: 'Overview' },
  { href: '#quickstart', label: 'Quickstart' },
  { href: '#endpoints', label: 'Endpoints' },
  { href: '#keys', label: 'API keys' },
  { href: '#try-it', label: 'Try it' },
  { href: '#mcp', label: 'MCP' },
];

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

export default function ApiDocsPage() {
  const { apiBase, initialOrgDirectory } = useLoaderData<typeof loader>();
  const { user, isLoading, login, signup, getAccessToken } = useUser();
  const queryClient = useQueryClient();
  const [keyName, setKeyName] = useState('Agent integration');
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [copiedValue, setCopiedValue] = useState<string | null>(null);
  const [testQuery, setTestQuery] = useState('batik textile pattern');
  const [testLimit, setTestLimit] = useState(6);
  const [testOrgId, setTestOrgId] = useState(NGS_ORG_SHORTCODE);
  const [testApiKey, setTestApiKey] = useState('');
  const [testResponse, setTestResponse] = useState<SearchResponse | null>(null);
  const [orgsExecutedAt, setOrgsExecutedAt] = useState<string | null>(null);

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

  const createApiKeyMutation = useMutation({
    mutationFn: () =>
      apiClient.createApiKey(getAccessToken, keyName || 'Agent integration'),
    onSuccess: (created) => {
      setCreatedKey(created.key);
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

  const testSearchMutation = useMutation({
    mutationFn: async () => {
      const liveKey = (testApiKey.trim() || createdKey || '').trim();

      if (!liveKey) {
        throw new Error('Paste an API key to run a live request.');
      }

      const orgId = (testOrgId.trim() || NGS_ORG_SHORTCODE).trim();
      const response = await fetch(
        `${apiBase}/orgs/${encodeURIComponent(orgId)}/search/text`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-API-Key': liveKey,
          },
          body: JSON.stringify({
            query: testQuery,
            topK: testLimit,
            minScore: 0.3,
          }),
        }
      );
      const payload = (await response.json()) as ApiResponse<SearchResponse>;

      if (!response.ok || !payload.success || !payload.data) {
        throw new Error(
          payload.error?.message || `Request failed (${response.status})`
        );
      }

      return payload.data;
    },
    onSuccess: (response) => {
      setTestResponse(response);
      void queryClient.invalidateQueries({ queryKey: ['api-usage-today'] });
      void queryClient.invalidateQueries({ queryKey: ['api-keys'] });
    },
  });

  const keys = apiKeysQuery.data?.keys ?? [];
  const activeKey = keys.find((key) => key.status === 'active');
  const dailyUsage = usageQuery.data ?? defaultDailyUsage;
  const translationUsage =
    translationUsageQuery.data ?? defaultTranslationUsage;
  const dailyPercent =
    dailyUsage.quota > 0
      ? Math.min((dailyUsage.used / dailyUsage.quota) * 100, 100)
      : 0;
  const translationPercent =
    translationUsage.quota > 0
      ? Math.min((translationUsage.used / translationUsage.quota) * 100, 100)
      : 0;
  const dailyUsageValue = !user
    ? 'Sign in'
    : usageQuery.isLoading
      ? 'Checking...'
      : usageQuery.isError
        ? 'Needs refresh'
        : `${dailyUsage.used} / ${dailyUsage.quota}`;
  const translationUsageValue = !user
    ? 'Sign in'
    : translationUsageQuery.isLoading
      ? 'Checking...'
      : translationUsageQuery.isError
        ? 'Needs refresh'
        : `${translationUsage.remaining} left`;
  const hasUsageError = Boolean(
    user && (usageQuery.isError || translationUsageQuery.isError)
  );
  const usageErrorMessage =
    usageQuery.error instanceof Error
      ? usageQuery.error.message
      : translationUsageQuery.error instanceof Error
        ? translationUsageQuery.error.message
        : 'Token check failed';
  const retryUsageChecks = () => {
    void queryClient.invalidateQueries({ queryKey: ['api-usage-today'] });
    void queryClient.invalidateQueries({
      queryKey: ['translation-usage', user?.id],
    });
    void queryClient.invalidateQueries({ queryKey: ['api-keys'] });
  };
  const executeOrgList = async () => {
    const result = await orgsQuery.refetch();

    if (result.data) {
      setOrgsExecutedAt(
        new Date().toLocaleTimeString([], {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        })
      );
    }
  };

  const shownApiKey = (testApiKey.trim() || createdKey || maskKey(null)).trim();
  const selectedOrgId = (testOrgId.trim() || NGS_ORG_SHORTCODE).trim();
  const apiKeyHeader = `X-API-Key: ${shownApiKey}`;
  const orgDirectory = orgsQuery.data?.orgs?.length
    ? orgsQuery.data.orgs
    : fallbackOrgs;
  const orgListResponse = {
    success: true,
    data: orgDirectory.map(({ key, id, name, slug, description, website }) => ({
      key: key || (id === NGS_ORG_ID ? NGS_ORG_SHORTCODE : slug || id),
      name,
      slug,
      description,
      website,
    })),
    metadata: {
      total: orgsQuery.data?.total ?? orgDirectory.length,
    },
  };
  const mcpConfig = useMemo(
    () =>
      stringify({
        mcpServers: {
          paillette: {
            url: `${apiBase}/mcp`,
            headers: {
              'X-API-Key': shownApiKey,
            },
          },
        },
      }),
    [apiBase, shownApiKey]
  );
  const orgListCurl = `curl -s ${apiBase}/orgs?limit=20`;
  const curlSample = `curl -s ${apiBase}/orgs/${encodeURIComponent(selectedOrgId)}/search/text \\
  -H "${apiKeyHeader}" \\
  -H "Content-Type: application/json" \\
  -d '${JSON.stringify({
    query: testQuery || 'batik textile pattern',
    topK: testLimit,
    minScore: 0.3,
  })}'`;
  const canRunLiveSearch =
    Boolean((testApiKey.trim() || createdKey || '').trim()) &&
    Boolean(testQuery.trim()) &&
    Boolean(selectedOrgId);
  const shownResponse = testResponse ?? sampleSearchResponse;
  const orgListStatus = orgsQuery.isFetching
    ? 'Fetching live /orgs'
    : orgsQuery.isError
      ? 'Request failed'
      : orgsExecutedAt
        ? `Executed at ${orgsExecutedAt}`
        : 'Loaded from /orgs';

  const copyText = async (id: string, value: string) => {
    await navigator.clipboard.writeText(value);
    setCopiedValue(id);
    window.setTimeout(() => setCopiedValue(null), 1500);
  };

  return (
    <div className="themeable-surface min-h-screen overflow-x-hidden bg-[#08080b] text-white">
      <header className="sticky top-0 z-40 border-b border-white/[0.08] bg-[#08080b]/90 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-[1500px] items-center justify-between px-5 lg:px-8">
          <Link to="/" className="transition-opacity hover:opacity-80">
            <Logo size="sm" framed />
          </Link>
          <nav className="flex items-center gap-3 text-sm">
            <Link to="/ngs/search" className="text-white/60 hover:text-white">
              Search
            </Link>
            <Link to="/translate" className="text-white/60 hover:text-white">
              Translate
            </Link>
            {user ? (
              <UserMenu />
            ) : (
              <button
                type="button"
                onClick={() => void login({ returnTo: getCurrentReturnTo() })}
                disabled={isLoading}
                className="inline-flex h-8 items-center gap-2 rounded-md border border-white/10 bg-white/[0.05] px-3 text-xs text-white/75 hover:bg-white/[0.1] disabled:opacity-50"
              >
                {isLoading ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <LogIn className="h-3.5 w-3.5" />
                )}
                {isLoading ? 'Checking' : 'Log in'}
              </button>
            )}
          </nav>
        </div>
      </header>

      <main className="mx-auto grid max-w-[1500px] gap-6 px-4 py-6 lg:grid-cols-[180px_minmax(0,1fr)] lg:px-8">
        <aside className="min-w-0 lg:sticky lg:top-20 lg:self-start">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-white/36">
            Docs
          </p>
          <nav
            aria-label="API documentation"
            className="mt-3 flex gap-1 overflow-x-auto border-b border-white/[0.08] pb-3 lg:flex-col lg:overflow-visible lg:border-b-0 lg:pb-0"
          >
            {docsNav.map((item) => (
              <a
                key={item.href}
                href={item.href}
                className="whitespace-nowrap rounded-md px-2 py-1.5 text-sm text-white/58 transition-colors hover:bg-white/[0.06] hover:text-white"
              >
                {item.label}
              </a>
            ))}
          </nav>
        </aside>

        <div className="min-w-0">
          <motion.section
            id="overview"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            className="scroll-mt-24 border-b border-white/[0.08] pb-6"
          >
            <p className="text-sm text-cyan-200/70">Developer API</p>
            <h1 className="mt-2 max-w-4xl font-display text-4xl font-semibold leading-tight text-white lg:text-[3.25rem]">
              Paillette API
            </h1>
            <p className="mt-3 max-w-3xl text-base leading-7 text-white/62">
              Search source-backed artwork records over REST or MCP. Public
              samples use source keys; live search calls use a personal API key.
            </p>
            <div className="mt-5 grid gap-3 text-sm sm:grid-cols-3">
              <OverviewFact label="Base URL" value={apiBase} />
              <OverviewFact label="Auth header" value="X-API-Key" />
              <OverviewFact label="Current source" value="ngs" />
            </div>
          </motion.section>

          <DocSection
            id="quickstart"
            eyebrow="No key needed"
            title="Quickstart"
            description="Resolve the source key first, then use it in REST and MCP calls."
          >
            <div className="grid gap-4 xl:grid-cols-[minmax(0,0.8fr)_minmax(0,1fr)]">
              <div className="space-y-3">
                <div className="flex flex-col gap-3 border-y border-white/[0.08] py-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <p className="font-mono text-xs text-cyan-100">GET /orgs</p>
                    <p className="mt-1 text-sm leading-6 text-white/58">
                      Use <code>ngs</code> for the National Gallery Singapore
                      source.
                      <span className="ml-2 text-white/36">
                        {orgListStatus}
                      </span>
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => void executeOrgList()}
                    disabled={orgsQuery.isFetching}
                    className="shrink-0 justify-center"
                  >
                    {orgsQuery.isFetching ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Play className="h-4 w-4" />
                    )}
                    Execute
                  </Button>
                </div>
                <CodeBlock
                  id="org-list-curl"
                  label="curl"
                  copied={copiedValue === 'org-list-curl'}
                  value={orgListCurl}
                  onCopy={copyText}
                />
              </div>
              <CodeBlock
                id="org-list-response"
                label="Live /orgs response"
                copied={copiedValue === 'org-list-response'}
                value={
                  orgsQuery.isError
                    ? stringify({
                        success: false,
                        error: {
                          message:
                            orgsQuery.error instanceof Error
                              ? orgsQuery.error.message
                              : 'Could not load /orgs',
                        },
                      })
                    : stringify(orgListResponse)
                }
                onCopy={copyText}
              />
            </div>
          </DocSection>

          <DocSection
            id="endpoints"
            title="REST Endpoints"
            description="Authenticated calls accept `X-API-Key` or `Authorization: Bearer`."
          >
            <div className="divide-y divide-white/[0.08] border-y border-white/[0.08]">
              {endpoints.map((endpoint) => (
                <div
                  key={endpoint.path}
                  className="grid gap-3 px-1 py-4 md:grid-cols-[76px_minmax(170px,0.35fr)_minmax(0,1fr)] md:items-start"
                >
                  <span
                    className={`inline-flex w-fit rounded-md px-2 py-1 text-xs font-semibold ${
                      endpoint.method === 'GET'
                        ? 'bg-emerald-300/15 text-emerald-100'
                        : 'bg-fuchsia-300/15 text-fuchsia-100'
                    }`}
                  >
                    {endpoint.method}
                  </span>
                  <h2 className="pt-0.5 text-base font-semibold text-white">
                    {endpoint.title}
                  </h2>
                  <div className="min-w-0">
                    <code className="block overflow-x-auto whitespace-pre-wrap break-words rounded-md bg-black/35 px-3 py-2 text-sm text-cyan-100">
                      {endpoint.path}
                    </code>
                    <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-words rounded-md bg-black/25 px-3 py-2 text-xs leading-5 text-white/62">
                      {endpoint.body}
                    </pre>
                    <SchemaList title="Schema" fields={endpoint.schema} />
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-5">
              <SchemaList
                title="Search response metadata"
                fields={responseMetadataFields}
              />
            </div>
          </DocSection>

          <DocSection
            id="keys"
            title="API keys"
            description={
              isLoading
                ? 'Checking sign-in'
                : user
                  ? `Signed in as ${user.email || user.name}`
                  : 'Sign in to create keys and run live requests.'
            }
          >
            {isLoading ? (
              <div className="flex items-center gap-2 border-y border-white/[0.08] py-4 text-sm text-white/55">
                <Loader2 className="h-4 w-4 animate-spin text-cyan-100" />
                Checking sign-in state
              </div>
            ) : !user ? (
              <div className="flex flex-col gap-4 border-y border-white/[0.08] py-4 md:flex-row md:items-center md:justify-between">
                <div className="min-w-0">
                  <h3 className="text-base font-semibold text-white">
                    Sign in required
                  </h3>
                  <p className="mt-1 max-w-2xl text-sm leading-6 text-white/55">
                    Sign in to view usage, create a personal API key, and run
                    live requests.
                  </p>
                </div>
                <div className="flex flex-col gap-2 sm:flex-row md:shrink-0">
                  <Button
                    type="button"
                    onClick={() =>
                      void signup({ returnTo: getCurrentReturnTo() })
                    }
                  >
                    <UserPlus className="h-4 w-4" />
                    Create account
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() =>
                      void login({ returnTo: getCurrentReturnTo() })
                    }
                  >
                    <LogIn className="h-4 w-4" />
                    Log in
                  </Button>
                </div>
              </div>
            ) : (
              <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1fr)]">
                <div className="space-y-4 border-y border-white/[0.08] py-4">
                  <UsageMeter
                    icon={<Activity className="h-4 w-4 text-cyan-200" />}
                    label="Search API today"
                    value={dailyUsageValue}
                    percent={dailyPercent}
                  />
                  <UsageMeter
                    icon={<KeyRound className="h-4 w-4 text-amber-200" />}
                    label="Free translations"
                    value={translationUsageValue}
                    percent={translationPercent}
                  />
                  {hasUsageError && (
                    <div className="border-y border-amber-300/20 bg-amber-300/10 py-3 text-sm text-amber-100">
                      <p>Token check failed. Refresh your sign-in.</p>
                      <p className="mt-1 truncate font-mono text-xs text-amber-100/60">
                        {usageErrorMessage}
                      </p>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={retryUsageChecks}
                        >
                          Retry
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          onClick={() =>
                            void login({ returnTo: getCurrentReturnTo() })
                          }
                        >
                          <LogIn className="h-4 w-4" />
                          Reconnect
                        </Button>
                      </div>
                    </div>
                  )}
                </div>

                <div className="min-w-0 border-y border-white/[0.08] py-4">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <div>
                      <h3 className="text-sm font-semibold text-white">
                        Personal key
                      </h3>
                      <p className="mt-1 text-xs text-white/45">
                        One active key works for REST and MCP.
                      </p>
                    </div>
                    {apiKeysQuery.isLoading && (
                      <Loader2 className="h-4 w-4 animate-spin text-white/35" />
                    )}
                  </div>
                  <div className="grid gap-2">
                    <label
                      htmlFor="api-key-name"
                      className="text-xs text-white/55"
                    >
                      Key name
                    </label>
                    <input
                      id="api-key-name"
                      value={keyName}
                      onChange={(event) => setKeyName(event.target.value)}
                      disabled={
                        Boolean(activeKey) || createApiKeyMutation.isPending
                      }
                      className="h-10 rounded-md border border-white/10 bg-black/30 px-3 text-sm text-white outline-none focus:border-cyan-200 disabled:opacity-50"
                    />
                  </div>
                  <Button
                    type="button"
                    onClick={() => createApiKeyMutation.mutate()}
                    disabled={
                      Boolean(activeKey) || createApiKeyMutation.isPending
                    }
                    className="mt-3 w-full"
                  >
                    {createApiKeyMutation.isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <KeyRound className="h-4 w-4" />
                    )}
                    Create API key
                  </Button>

                  {apiKeysQuery.isError && (
                    <p className="mt-3 border-y border-amber-300/20 bg-amber-300/10 py-3 text-sm text-amber-100">
                      Key check failed. Reconnect sign-in.
                    </p>
                  )}

                  {createApiKeyMutation.isError && (
                    <p className="mt-3 border-y border-red-400/20 bg-red-400/10 py-3 text-sm text-red-200">
                      {createApiKeyMutation.error instanceof Error
                        ? createApiKeyMutation.error.message
                        : 'Failed to create API key'}
                    </p>
                  )}

                  {createdKey && (
                    <div className="mt-3 border-y border-amber-300/25 bg-amber-300/10 py-3">
                      <div className="mb-2 flex items-center justify-between gap-2">
                        <p className="text-sm font-medium text-amber-100">
                          New key
                        </p>
                        <CopyButton
                          copied={copiedValue === 'created-key'}
                          onClick={() => copyText('created-key', createdKey)}
                        />
                      </div>
                      <code className="block overflow-x-auto rounded-md bg-black/45 p-3 text-xs text-amber-100">
                        {createdKey}
                      </code>
                      <button
                        type="button"
                        onClick={() => setTestApiKey(createdKey)}
                        className="mt-3 inline-flex h-8 items-center rounded-md border border-amber-200/20 px-3 text-xs font-medium text-amber-100 hover:bg-amber-200/10"
                      >
                        Use in tester
                      </button>
                    </div>
                  )}

                  <div className="mt-3 divide-y divide-white/[0.08]">
                    {keys.length
                      ? keys.map((key) => (
                          <div
                            key={key.id}
                            className="flex items-center justify-between gap-3 py-3"
                          >
                            <div className="min-w-0">
                              <p className="truncate text-sm font-medium text-white">
                                {key.name}
                              </p>
                              <p className="mt-1 font-mono text-xs text-white/40">
                                {key.key_prefix}...
                              </p>
                            </div>
                            {key.status === 'active' && (
                              <button
                                type="button"
                                onClick={() =>
                                  revokeApiKeyMutation.mutate(key.id)
                                }
                                disabled={revokeApiKeyMutation.isPending}
                                className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-red-300/20 text-red-200 hover:bg-red-300/10 disabled:opacity-50"
                                aria-label="Revoke API key"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            )}
                          </div>
                        ))
                      : !apiKeysQuery.isLoading && (
                          <p className="py-3 text-sm text-white/45">
                            No API keys yet.
                          </p>
                        )}
                  </div>
                </div>
              </div>
            )}
          </DocSection>

          <DocSection
            id="try-it"
            title="Try it"
            description="Paste a key and run a live text search against the selected source."
          >
            <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,0.72fr)_minmax(0,1fr)]">
              <div className="space-y-4">
                <div className="grid gap-2">
                  <label
                    htmlFor="test-org-id"
                    className="text-sm text-white/70"
                  >
                    Source key
                  </label>
                  <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
                    <input
                      id="test-org-id"
                      value={testOrgId}
                      onChange={(event) => setTestOrgId(event.target.value)}
                      spellCheck={false}
                      className="h-11 rounded-md border border-white/10 bg-black/30 px-3 font-mono text-xs text-white outline-none focus:border-cyan-200"
                    />
                    <button
                      type="button"
                      onClick={() => setTestOrgId(NGS_ORG_SHORTCODE)}
                      className="h-11 rounded-md border border-white/10 px-3 text-sm text-white/65 hover:bg-white/[0.06] hover:text-white"
                    >
                      NGS
                    </button>
                  </div>
                </div>
                <div className="grid gap-2">
                  <label
                    htmlFor="test-api-key"
                    className="text-sm text-white/70"
                  >
                    API key
                  </label>
                  <input
                    id="test-api-key"
                    type="password"
                    value={testApiKey}
                    onChange={(event) => setTestApiKey(event.target.value)}
                    placeholder="plt_stg_..."
                    autoComplete="off"
                    spellCheck={false}
                    className="h-11 rounded-md border border-white/10 bg-black/30 px-3 font-mono text-sm text-white outline-none focus:border-cyan-200"
                  />
                </div>
                <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_110px]">
                  <label className="grid gap-2">
                    <span className="text-sm text-white/70">Query</span>
                    <input
                      value={testQuery}
                      onChange={(event) => setTestQuery(event.target.value)}
                      className="h-11 rounded-md border border-white/10 bg-black/30 px-3 text-sm text-white outline-none focus:border-cyan-200"
                    />
                  </label>
                  <label className="grid gap-2">
                    <span className="text-sm text-white/70">topK</span>
                    <input
                      type="number"
                      min={1}
                      max={20}
                      value={testLimit}
                      onChange={(event) =>
                        setTestLimit(
                          Math.min(20, Math.max(1, Number(event.target.value)))
                        )
                      }
                      className="h-11 rounded-md border border-white/10 bg-black/30 px-3 text-sm text-white outline-none focus:border-cyan-200"
                    />
                  </label>
                </div>
                <SchemaList
                  title="Request body"
                  fields={
                    endpoints.find(
                      (endpoint) => endpoint.path === '/orgs/ngs/search/text'
                    )?.schema || []
                  }
                  compact
                />
                <Button
                  type="button"
                  disabled={!canRunLiveSearch || testSearchMutation.isPending}
                  onClick={() => testSearchMutation.mutate()}
                >
                  {testSearchMutation.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Play className="h-4 w-4" />
                  )}
                  Run with API key
                </Button>
                {testSearchMutation.isError && (
                  <p className="border-y border-red-400/20 bg-red-400/10 py-3 text-sm text-red-200">
                    {testSearchMutation.error instanceof Error
                      ? testSearchMutation.error.message
                      : 'Search failed'}
                  </p>
                )}
                <CodeBlock
                  id="curl"
                  copied={copiedValue === 'curl'}
                  value={curlSample}
                  onCopy={copyText}
                />
              </div>
              <pre className="max-h-[560px] overflow-auto whitespace-pre-wrap break-words rounded-lg border border-white/[0.08] bg-black/40 p-4 text-xs leading-5 text-white/70">
                {stringify({
                  count: shownResponse.count,
                  queryTime: shownResponse.queryTime,
                  results: shownResponse.results.slice(0, 3),
                })}
              </pre>
            </div>
          </DocSection>

          <DocSection
            id="mcp"
            title="MCP"
            description='Point an MCP client at `/api/v1/mcp`; use `collection: "ngs"`.'
          >
            <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1fr)]">
              <div className="space-y-4">
                <CodeBlock
                  id="mcp-config"
                  copied={copiedValue === 'mcp-config'}
                  value={mcpConfig}
                  onCopy={copyText}
                />
                <div className="border-y border-white/[0.08] py-4">
                  <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-white/35">
                    Call builder
                  </p>
                  <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <h2 className="font-mono text-base text-cyan-100">
                        {primaryMcpTool.name}
                      </h2>
                      <p className="mt-1 max-w-2xl text-sm leading-6 text-white/62">
                        {primaryMcpTool.description}
                      </p>
                    </div>
                    <code className="w-fit rounded-md bg-black/35 px-2 py-1 font-mono text-xs text-white/55">
                      tools/call
                    </code>
                  </div>
                  <SchemaList
                    title="Arguments"
                    fields={primaryMcpTool.schema}
                    compact
                  />
                </div>
                <div className="border-y border-white/[0.08] py-3">
                  <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-white/35">
                    Other MCP tools
                  </p>
                  <div className="mt-2 divide-y divide-white/[0.06]">
                    {secondaryMcpTools.map((tool) => (
                      <div
                        key={tool.name}
                        className="grid gap-2 py-3 text-sm sm:grid-cols-[minmax(180px,0.35fr)_minmax(0,1fr)]"
                      >
                        <code className="break-words font-mono text-cyan-100">
                          {tool.name}
                        </code>
                        <p className="leading-6 text-white/58">
                          {tool.description}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
              <CodeBlock
                id="mcp-call"
                copied={copiedValue === 'mcp-call'}
                value={`curl -s ${apiBase}/mcp \\
  -H "${apiKeyHeader}" \\
  -H "Content-Type: application/json" \\
  -d '${stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: {
      name: 'search_artworks',
      arguments: {
        collection: NGS_ORG_SHORTCODE,
        query: 'serene kampong landscape',
        topK: 5,
      },
    },
  })}'`}
                onCopy={copyText}
              />
            </div>
          </DocSection>
        </div>
      </main>
    </div>
  );
}

function OverviewFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-y border-white/[0.08] py-3">
      <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-white/35">
        {label}
      </p>
      <code className="mt-1 block break-all text-sm text-cyan-100/75">
        {value}
      </code>
    </div>
  );
}

function DocSection({
  id,
  eyebrow,
  title,
  description,
  children,
}: {
  id: string;
  eyebrow?: string;
  title: string;
  description?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-24 border-b border-white/[0.08] py-6">
      {eyebrow && (
        <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-cyan-100/55">
          {eyebrow}
        </p>
      )}
      <div className="mb-4 max-w-3xl">
        <h2 className="font-display text-2xl font-semibold leading-tight text-white">
          {title}
        </h2>
        {description && (
          <p className="mt-2 text-sm leading-6 text-white/55">{description}</p>
        )}
      </div>
      {children}
    </section>
  );
}

function SchemaList({
  title,
  fields,
  compact = false,
}: {
  title: string;
  fields: SchemaField[];
  compact?: boolean;
}) {
  if (!fields.length) return null;

  return (
    <div className={compact ? 'mt-3' : 'mt-4'}>
      <div className="mb-2 flex items-center justify-between gap-3">
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-white/35">
          {title}
        </p>
        <p className="font-mono text-[10px] text-white/30">
          {fields.length} {fields.length === 1 ? 'field' : 'fields'}
        </p>
      </div>
      <div className="divide-y divide-white/[0.06] border-y border-white/[0.08]">
        {fields.map((field) => (
          <div
            key={field.name}
            className={`grid min-w-0 gap-3 text-sm md:grid-cols-[minmax(180px,0.34fr)_minmax(0,1fr)] ${
              compact ? 'py-2.5' : 'py-3'
            }`}
          >
            <div className="min-w-0 space-y-1">
              <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1">
                <code className="break-all font-mono text-cyan-100">
                  {field.name}
                </code>
                <span
                  className={`text-[10px] uppercase tracking-[0.12em] ${
                    field.required ? 'text-amber-100/80' : 'text-white/35'
                  }`}
                >
                  {field.required ? 'required' : 'optional'}
                </span>
              </div>
              <div className="flex min-w-0 flex-wrap gap-x-2 gap-y-1 font-mono text-xs text-white/52">
                <span className="break-words">{field.type}</span>
                {field.defaultValue && (
                  <span className="text-white/35">
                    default {field.defaultValue}
                  </span>
                )}
              </div>
            </div>
            <p className="min-w-0 max-w-[72ch] leading-6 text-white/55">
              {field.description}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

function UsageMeter({
  icon,
  label,
  value,
  percent,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  percent: number;
}) {
  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-3 text-sm">
        <span className="flex items-center gap-2 text-white/70">
          {icon}
          {label}
        </span>
        <span className="text-white">{value}</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-white/10">
        <div
          className="h-full rounded-full bg-gradient-to-r from-cyan-200 via-fuchsia-300 to-amber-200"
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
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
      className="inline-flex h-8 items-center gap-1.5 rounded-md border border-white/10 bg-white/[0.04] px-2.5 text-xs text-white/65 hover:bg-white/[0.08] hover:text-white"
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

function CodeBlock({
  id,
  label,
  copied,
  value,
  onCopy,
}: {
  id: string;
  label?: string;
  copied: boolean;
  value: string;
  onCopy: (id: string, value: string) => void;
}) {
  return (
    <div className="min-w-0 max-w-full overflow-hidden border-y border-white/[0.08] bg-black/25 py-3">
      <div className="mb-2 flex items-center justify-between gap-3 px-1">
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-white/35">
          {label}
        </p>
        <CopyButton copied={copied} onClick={() => onCopy(id, value)} />
      </div>
      <pre className="max-w-full overflow-x-auto whitespace-pre-wrap break-words px-1 text-xs leading-5 text-white/68">
        {value}
      </pre>
    </div>
  );
}
