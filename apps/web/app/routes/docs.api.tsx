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
  Search,
  Server,
  Trash2,
  UserPlus,
} from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import { Button } from '~/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '~/components/ui/card';
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

export const loader = ({ context }: LoaderFunctionArgs) =>
  json({
    apiBase: getApiBaseUrl(getServerEnv(context)),
  });

const NGS_ORG_ID = '00000000-0000-4000-8000-000000000101';
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

const fallbackOrgs: OrgDirectoryItem[] = [
  {
    id: NGS_ORG_ID,
    name: 'National Gallery Singapore',
    slug: NGS_ORG_SLUG,
    description:
      'Public collection records ingested from the NGS source corpus.',
    website: 'https://www.nationalgallery.sg',
  },
];

const endpoints = [
  {
    method: 'GET',
    path: '/orgs',
    title: 'List collections',
    body: 'Public. Returns collection keys, UUIDs, slugs, and source metadata.',
  },
  {
    method: 'GET',
    path: '/orgs/slug/{slug}',
    title: 'Lookup collection',
    body: `Public. NGS slug: ${NGS_ORG_SLUG}`,
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
  },
  {
    method: 'POST',
    path: '/orgs/ngs/search/image',
    title: 'Image search',
    body: 'multipart/form-data: image, topK, minScore',
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
  },
  {
    method: 'GET',
    path: '/orgs/ngs/artworks/{artworkId}',
    title: 'Artwork lookup',
    body: 'Returns source-labelled artwork metadata and imagery.',
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
  },
];

const mcpTools = [
  {
    name: 'list_orgs',
    description:
      'List collections and their short keys before calling search tools.',
    input: '{ limit? }',
  },
  {
    name: 'search_artworks',
    description: 'Natural-language artwork search across a collection.',
    input: '{ collection?, query, topK?, minScore? }',
  },
  {
    name: 'lookup_artwork',
    description: 'Fetch one artwork by ID with public catalogue metadata.',
    input: '{ collection?, artworkId }',
  },
  {
    name: 'colour_search',
    description: 'Find artworks by extracted palette proximity.',
    input: '{ collection?, colors, matchMode?, threshold?, limit? }',
  },
  {
    name: 'translate_text',
    description: 'Translate English text to Chinese, Malay, or Tamil.',
    input: '{ text, sourceLang?, targetLang }',
  },
];

const docsNav = [
  { href: '#overview', label: 'Overview' },
  { href: '#quickstart', label: 'Quickstart' },
  { href: '#collections', label: 'Collections' },
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
      id: 'sample-batik-001',
      galleryId: NGS_ORG_ID,
      title: 'Memburu Gajah di Hutan Batik',
      artist: 'Tumadi B. Patri',
      year: 1988,
      imageUrl: null,
      thumbnailUrl: null,
      similarity: 0.92,
      metadata: {
        medium: 'Mixed media on board',
        classification: 'Paintings',
        dominantColors: ['#c89b73', '#d8c7ad', '#7a6f62', '#26303a'],
        citation: {
          format: 'chicago',
          text: 'Tumadi B. Patri. Memburu Gajah di Hutan Batik. 1988. National Gallery Singapore.',
        },
      },
    },
    {
      id: 'sample-batik-002',
      galleryId: NGS_ORG_ID,
      title: 'Batik - Artifek 3',
      artist: 'Mahmud Romli',
      imageUrl: null,
      thumbnailUrl: null,
      similarity: 0.88,
      metadata: {
        medium: 'Mixed media on canvas',
        classification: 'Paintings',
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
  const { apiBase } = useLoaderData<typeof loader>();
  const { user, isAuthenticated, isLoading, login, signup, getAccessToken } =
    useUser();
  const queryClient = useQueryClient();
  const [keyName, setKeyName] = useState('Agent integration');
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [copiedValue, setCopiedValue] = useState<string | null>(null);
  const [testQuery, setTestQuery] = useState('batik textile pattern');
  const [testLimit, setTestLimit] = useState(6);
  const [testOrgId, setTestOrgId] = useState(NGS_ORG_SHORTCODE);
  const [testApiKey, setTestApiKey] = useState('');
  const [testResponse, setTestResponse] = useState<SearchResponse | null>(null);

  const orgsQuery = useQuery({
    queryKey: ['api-docs-orgs', apiBase],
    queryFn: async () => {
      const response = await fetch(`${apiBase}/orgs?limit=20`);
      const payload = (await response.json()) as ApiResponse<
        OrgDirectoryItem[]
      > & {
        metadata?: { total?: number };
      };

      if (!response.ok || !payload.success || !payload.data) {
        throw new Error(
          payload.error?.message || `Request failed (${response.status})`
        );
      }

      return {
        orgs: payload.data,
        total: payload.metadata?.total ?? payload.data.length,
      };
    },
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
      id,
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

  const copyText = async (id: string, value: string) => {
    await navigator.clipboard.writeText(value);
    setCopiedValue(id);
    window.setTimeout(() => setCopiedValue(null), 1500);
  };

  return (
    <div className="themeable-surface min-h-screen bg-[#08080b] text-white">
      <header className="sticky top-0 z-40 border-b border-white/[0.08] bg-[#08080b]/90 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-5 lg:px-8">
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
            {isAuthenticated ? (
              <UserMenu />
            ) : (
              <button
                type="button"
                onClick={() => void login({ returnTo: getCurrentReturnTo() })}
                className="inline-flex h-8 items-center gap-2 rounded-md border border-white/10 bg-white/[0.05] px-3 text-xs text-white/75 hover:bg-white/[0.1]"
              >
                <LogIn className="h-3.5 w-3.5" />
                Log in
              </button>
            )}
          </nav>
        </div>
      </header>

      <main className="mx-auto grid max-w-7xl gap-7 px-5 py-7 lg:grid-cols-[170px_minmax(0,1fr)] lg:px-8">
        <aside className="min-w-0 lg:sticky lg:top-20 lg:self-start">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-white/36">
            Docs
          </p>
          <nav
            aria-label="API documentation"
            className="mt-3 flex gap-1 overflow-x-auto pb-1 lg:flex-col lg:overflow-visible lg:pb-0"
          >
            {docsNav.map((item) => (
              <a
                key={item.href}
                href={item.href}
                className="whitespace-nowrap rounded-md px-2.5 py-2 text-sm text-white/58 transition-colors hover:bg-white/[0.06] hover:text-white"
              >
                {item.label}
              </a>
            ))}
          </nav>
          <div className="mt-6 hidden space-y-2 text-xs leading-5 text-white/40 lg:block">
            <p className="font-semibold uppercase tracking-[0.16em] text-white/30">
              Base
            </p>
            <code className="block break-all text-cyan-100/70">{apiBase}</code>
            <p className="pt-2 font-semibold uppercase tracking-[0.16em] text-white/30">
              Auth
            </p>
            <code>X-API-Key</code>
          </div>
        </aside>

        <div className="min-w-0 space-y-7">
          <motion.section
            id="overview"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            className="scroll-mt-24 grid gap-6 lg:grid-cols-[minmax(0,0.9fr)_minmax(360px,0.55fr)] lg:items-start"
          >
            <div>
              <p className="text-sm text-cyan-200/70">Developer API</p>
              <h1 className="mt-2 max-w-4xl font-display text-5xl font-semibold leading-tight text-white lg:text-6xl">
                Paillette API
              </h1>
              <p className="mt-4 max-w-2xl text-base leading-7 text-white/62">
                Search artworks over REST or MCP. Samples are public; live calls
                need an API key.
              </p>
            </div>

            <Card
              id="keys"
              className="min-w-0 scroll-mt-24 border-white/10 bg-white/[0.045]"
            >
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-xl">
                  <Server className="h-5 w-5 text-cyan-200" />
                  Account
                </CardTitle>
                <CardDescription>
                  {isLoading
                    ? 'Checking sign-in'
                    : user
                      ? `Signed in as ${user.email || user.name}`
                      : 'Sign in to create keys and run live requests'}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {!user && (
                  <div className="flex flex-col gap-2 sm:flex-row">
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
                )}

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
                  <div className="rounded-lg border border-amber-300/20 bg-amber-300/10 p-3 text-sm text-amber-100">
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

                <div className="border-t border-white/[0.08] pt-4">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <div>
                      <h2 className="text-sm font-semibold text-white">
                        API key
                      </h2>
                      <p className="mt-1 text-xs text-white/45">
                        One active personal key for REST and MCP.
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
                        !user ||
                        Boolean(activeKey) ||
                        createApiKeyMutation.isPending
                      }
                      className="h-10 rounded-md border border-white/10 bg-black/30 px-3 text-sm text-white outline-none focus:border-cyan-200 disabled:opacity-50"
                    />
                  </div>
                  <Button
                    type="button"
                    onClick={() => createApiKeyMutation.mutate()}
                    disabled={
                      !user ||
                      Boolean(activeKey) ||
                      createApiKeyMutation.isPending
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

                  {apiKeysQuery.isError && user && (
                    <p className="mt-3 rounded-md border border-amber-300/20 bg-amber-300/10 p-3 text-sm text-amber-100">
                      Key check failed. Reconnect sign-in.
                    </p>
                  )}

                  {createApiKeyMutation.isError && (
                    <p className="mt-3 rounded-md border border-red-400/20 bg-red-400/10 p-3 text-sm text-red-200">
                      {createApiKeyMutation.error instanceof Error
                        ? createApiKeyMutation.error.message
                        : 'Failed to create API key'}
                    </p>
                  )}

                  {createdKey && (
                    <div className="mt-3 rounded-lg border border-amber-300/25 bg-amber-300/10 p-3">
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

                  <div className="mt-3 space-y-2">
                    {keys.length
                      ? keys.map((key) => (
                          <div
                            key={key.id}
                            className="flex items-center justify-between gap-3 rounded-md border border-white/[0.08] bg-black/25 p-3"
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
                          <p className="text-sm text-white/45">
                            No API keys yet.
                          </p>
                        )}
                  </div>
                </div>
              </CardContent>
            </Card>
          </motion.section>

          <section
            id="quickstart"
            className="scroll-mt-24 grid items-start gap-5 lg:grid-cols-[minmax(0,0.56fr)_minmax(0,0.64fr)]"
          >
            <Card className="min-w-0 border-white/10 bg-[#101016]">
              <CardHeader>
                <div className="mb-2 flex items-center gap-2">
                  <span className="rounded-full border border-cyan-200/20 bg-cyan-200/10 px-2.5 py-1 text-xs font-medium text-cyan-100">
                    No key needed
                  </span>
                </div>
                <CardTitle>Start with the collection key</CardTitle>
                <CardDescription>
                  Use `ngs` for National Gallery Singapore; `/orgs` lists every
                  available collection.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => void orgsQuery.refetch()}
                  disabled={orgsQuery.isFetching}
                  className="w-full justify-center"
                >
                  {orgsQuery.isFetching ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Play className="h-4 w-4" />
                  )}
                  Execute GET /orgs
                </Button>
                <CodeBlock
                  id="org-list-curl"
                  copied={copiedValue === 'org-list-curl'}
                  value={orgListCurl}
                  onCopy={copyText}
                />
              </CardContent>
            </Card>

            <Card className="min-w-0 border-white/10 bg-[#101016]">
              <CardHeader>
                <CardTitle>Collection Response</CardTitle>
                <CardDescription>
                  NGS is the current public collection.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <CodeBlock
                  id="org-list-response"
                  copied={copiedValue === 'org-list-response'}
                  value={stringify(orgListResponse)}
                  onCopy={copyText}
                />
              </CardContent>
            </Card>
          </section>

          <section id="collections" className="scroll-mt-24">
            <Card className="min-w-0 border-white/10 bg-[#111116]">
              <CardHeader>
                <CardTitle>Collections</CardTitle>
                <CardDescription>
                  Use the short key in REST and MCP calls. UUIDs remain
                  available for compatibility.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {orgsQuery.isLoading && (
                  <p className="text-sm text-white/45">Loading `/orgs`...</p>
                )}
                {orgsQuery.isError && (
                  <p className="rounded-md border border-amber-300/20 bg-amber-300/10 p-3 text-sm text-amber-100">
                    Could not load `/orgs`; showing the known NGS collection
                    key.
                  </p>
                )}
                <div className="overflow-hidden rounded-lg border border-white/[0.08]">
                  <div className="grid gap-3 border-b border-white/[0.08] bg-white/[0.035] px-4 py-3 text-xs font-semibold uppercase tracking-[0.16em] text-white/36 md:grid-cols-[minmax(180px,1fr)_120px_minmax(0,1.1fr)_96px]">
                    <span>Collection</span>
                    <span>Key</span>
                    <span>UUID</span>
                    <span className="hidden md:block">Use</span>
                  </div>
                  {orgDirectory.map((org) => {
                    const collectionKey =
                      org.key ||
                      (org.id === NGS_ORG_ID
                        ? NGS_ORG_SHORTCODE
                        : org.slug || org.id);

                    return (
                      <div
                        key={org.id}
                        className="grid gap-3 border-b border-white/[0.06] px-4 py-4 last:border-b-0 md:grid-cols-[minmax(180px,1fr)_120px_minmax(0,1.1fr)_96px] md:items-center"
                      >
                        <div className="min-w-0">
                          <p className="font-medium text-white">{org.name}</p>
                          <p className="mt-1 text-xs text-white/42">
                            slug: <code>{org.slug || NGS_ORG_SLUG}</code>
                          </p>
                        </div>
                        <code className="rounded-md bg-black/32 px-3 py-2 text-sm text-cyan-100">
                          {collectionKey}
                        </code>
                        <div className="flex min-w-0 items-center gap-2">
                          <code className="min-w-0 flex-1 overflow-x-auto rounded-md bg-black/32 px-3 py-2 text-xs text-cyan-100">
                            {org.id}
                          </code>
                          <CopyButton
                            copied={copiedValue === `org-${org.id}`}
                            onClick={() => copyText(`org-${org.id}`, org.id)}
                          />
                        </div>
                        <button
                          type="button"
                          onClick={() => setTestOrgId(collectionKey)}
                          className="h-9 rounded-md border border-white/10 px-3 text-sm text-white/65 hover:bg-white/[0.06] hover:text-white"
                        >
                          Use
                        </button>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          </section>

          <section id="endpoints" className="scroll-mt-24">
            <Card className="min-w-0 border-white/10 bg-[#111116]">
              <CardHeader>
                <CardTitle>REST Endpoints</CardTitle>
                <CardDescription>
                  Authenticated calls accept `X-API-Key` or `Authorization:
                  Bearer`.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {endpoints.map((endpoint) => (
                  <div
                    key={endpoint.path}
                    className="grid gap-3 rounded-lg border border-white/[0.08] bg-black/20 p-4 md:grid-cols-[180px_minmax(0,1fr)]"
                  >
                    <div>
                      <span
                        className={`inline-flex rounded-md px-2 py-1 text-xs font-semibold ${
                          endpoint.method === 'GET'
                            ? 'bg-emerald-300/15 text-emerald-100'
                            : 'bg-fuchsia-300/15 text-fuchsia-100'
                        }`}
                      >
                        {endpoint.method}
                      </span>
                      <h2 className="mt-3 text-base font-semibold text-white">
                        {endpoint.title}
                      </h2>
                    </div>
                    <div className="min-w-0">
                      <code className="block overflow-x-auto rounded-md bg-black/35 p-3 text-sm text-cyan-100">
                        {endpoint.path}
                      </code>
                      <pre className="mt-2 overflow-x-auto rounded-md bg-black/35 p-3 text-xs leading-5 text-white/62">
                        {endpoint.body}
                      </pre>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          </section>

          <section
            id="try-it"
            className="scroll-mt-24 grid items-start gap-5 lg:grid-cols-[minmax(0,0.58fr)_minmax(0,0.62fr)]"
          >
            <Card className="min-w-0 border-white/10 bg-[#101016]">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Search className="h-5 w-5 text-cyan-200" />
                  Try Search
                </CardTitle>
                <CardDescription>
                  Use `ngs`, paste a key, and run a live text search.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-2">
                  <label
                    htmlFor="test-org-id"
                    className="text-sm text-white/70"
                  >
                    Collection
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
                  <p className="text-xs leading-5 text-white/42">
                    Use <code>ngs</code>, the slug, or the UUID.
                  </p>
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
                <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_90px]">
                  <input
                    value={testQuery}
                    onChange={(event) => setTestQuery(event.target.value)}
                    className="h-11 rounded-md border border-white/10 bg-black/30 px-3 text-sm text-white outline-none focus:border-cyan-200"
                  />
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
                    aria-label="Result limit"
                  />
                </div>
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
                  <p className="rounded-md border border-red-400/20 bg-red-400/10 p-3 text-sm text-red-200">
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
              </CardContent>
            </Card>

            <Card className="min-w-0 border-white/10 bg-[#101016]">
              <CardHeader>
                <CardTitle>
                  {testResponse ? 'Live Response' : 'Sample Response'}
                </CardTitle>
                <CardDescription>
                  {testResponse
                    ? 'Returned by the API key request above.'
                    : 'Visible without an API key.'}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <pre className="max-h-[460px] overflow-auto rounded-lg border border-white/[0.08] bg-black/40 p-4 text-xs leading-5 text-white/70">
                  {stringify({
                    count: shownResponse.count,
                    queryTime: shownResponse.queryTime,
                    results: shownResponse.results.slice(0, 3),
                  })}
                </pre>
              </CardContent>
            </Card>
          </section>

          <section
            id="mcp"
            className="scroll-mt-24 grid items-start gap-5 lg:grid-cols-[minmax(0,0.62fr)_minmax(0,0.58fr)]"
          >
            <Card className="min-w-0 border-white/10 bg-[#111116]">
              <CardHeader>
                <CardTitle>MCP Server</CardTitle>
                <CardDescription>
                  Point an MCP client at `/api/v1/mcp`; use `collection: "ngs"`.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <CodeBlock
                  id="mcp-config"
                  copied={copiedValue === 'mcp-config'}
                  value={mcpConfig}
                  onCopy={copyText}
                />
                <div className="grid gap-3 sm:grid-cols-2">
                  {mcpTools.map((tool) => (
                    <div
                      key={tool.name}
                      className="rounded-lg border border-white/[0.08] bg-black/24 p-4"
                    >
                      <h2 className="font-mono text-sm text-cyan-100">
                        {tool.name}
                      </h2>
                      <p className="mt-2 text-sm leading-6 text-white/62">
                        {tool.description}
                      </p>
                      <code className="mt-3 block rounded-md bg-black/35 p-2 text-xs text-white/45">
                        {tool.input}
                      </code>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            <Card className="min-w-0 border-white/10 bg-[#111116]">
              <CardHeader>
                <CardTitle>JSON-RPC Example</CardTitle>
                <CardDescription>
                  Calls return MCP `content` plus structured JSON.
                </CardDescription>
              </CardHeader>
              <CardContent>
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
              </CardContent>
            </Card>
          </section>
        </div>
      </main>
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
  copied,
  value,
  onCopy,
}: {
  id: string;
  copied: boolean;
  value: string;
  onCopy: (id: string, value: string) => void;
}) {
  return (
    <div className="min-w-0 rounded-lg border border-white/[0.08] bg-black/35">
      <div className="flex items-center justify-end border-b border-white/[0.08] px-3 py-2">
        <CopyButton copied={copied} onClick={() => onCopy(id, value)} />
      </div>
      <pre className="overflow-x-auto p-4 text-xs leading-5 text-white/68">
        {value}
      </pre>
    </div>
  );
}
