import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PUBLIC_SEARCH_CONTRACT_VERSION } from '@paillette/types/public-search';
import {
  generateNgaSpotlightBundle,
  type NgaSpotlightSearchRequest,
} from '../apps/web/app/lib/nga-spotlight-generator.server';
import {
  createNgaOfflineSpotlightSearch,
  type NgaOfflineCorpusRecord,
} from '../apps/web/app/lib/nga-spotlight-offline-search.server';
import type {
  ApiResponse,
  ArtworkSearchResult,
  SearchResponse,
} from '../apps/web/app/types';

const getArgument = (name: string) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1]?.trim() : undefined;
};

const apiBaseUrl = getArgument('--api-base-url')?.replace(/\/+$/, '');
const offlineCorpusPath = getArgument('--offline-corpus');
const offlineEnrichmentDirectory = getArgument('--offline-enrichment-dir');
const offlineOrgId = getArgument('--org-id');
const corpusVersion = getArgument('--corpus-version');
const allowSearchRequests = process.argv.includes('--allow-search-requests');

if (
  !corpusVersion ||
  (offlineCorpusPath
    ? Boolean(apiBaseUrl || allowSearchRequests)
    : !apiBaseUrl || !allowSearchRequests)
) {
  throw new Error(
    'Usage: pnpm --filter @paillette/web spotlights:nga -- (--offline-corpus <dry-run.json> [--offline-enrichment-dir <dir>] [--org-id <id>] | --api-base-url <url>/api/v1 --allow-search-requests) --corpus-version <version>'
  );
}

const apiKey = process.env.PAILLETTE_PUBLIC_SEARCH_API_KEY;

const networkSearch = async ({
  provider,
  definitionId: _definitionId,
  ...request
}: NgaSpotlightSearchRequest): Promise<SearchResponse> => {
  const headers = new Headers({ 'Content-Type': 'application/json' });
  if (apiKey) {
    headers.set('X-API-Key', apiKey);
  } else {
    headers.set('X-User-Id', 'nga-spotlight-generator');
    headers.set('X-User-Email', 'nga-spotlight-generator@paillette.local');
    headers.set('X-User-Name', 'NGA Spotlight Generator');
  }

  const searchUrl = apiBaseUrl!.endsWith('/api/public-search')
    ? `${apiBaseUrl}/${encodeURIComponent(provider)}/text`
    : `${apiBaseUrl}/orgs/${encodeURIComponent(provider)}/search/text`;
  const response = await fetch(searchUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify(request),
  });
  const payload = (await response.json()) as ApiResponse<SearchResponse>;
  if (!response.ok || !payload.success || !payload.data) {
    throw new Error(
      `NGA spotlight search failed (${response.status}): ${payload.error?.message || 'unknown error'}`
    );
  }

  return payload.data;
};

const getSearchResults = (value: unknown): ArtworkSearchResult[] => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  const payload = value as Record<string, unknown>;
  const data =
    payload.data &&
    typeof payload.data === 'object' &&
    !Array.isArray(payload.data)
      ? (payload.data as Record<string, unknown>)
      : payload;
  return Array.isArray(data.results)
    ? (data.results as ArtworkSearchResult[])
    : [];
};

const loadOfflineEnrichments = async (directory: string | undefined) => {
  if (!directory) return [];

  const entries = await readdir(directory, { withFileTypes: true });
  const enrichments: ArtworkSearchResult[] = [];
  for (const entry of entries
    .filter(
      (candidate) => candidate.isFile() && candidate.name.endsWith('.json')
    )
    .sort((left, right) => left.name.localeCompare(right.name))) {
    const path = resolve(directory, entry.name);
    enrichments.push(
      ...getSearchResults(JSON.parse(await readFile(path, 'utf8')))
    );
  }
  return enrichments;
};

const loadOfflineSearch = async (path: string) => {
  const parsed = JSON.parse(await readFile(path, 'utf8')) as {
    providers?: { nga?: { normalizedSamples?: unknown } };
  };
  const records = parsed.providers?.nga?.normalizedSamples;
  if (!Array.isArray(records)) {
    throw new Error(
      `Offline corpus ${path} has no providers.nga.normalizedSamples array`
    );
  }

  const enrichments = await loadOfflineEnrichments(offlineEnrichmentDirectory);
  const firstNgaEnrichment = enrichments.find(
    (artwork) => artwork.metadata?.provider === 'nga'
  );
  const orgId =
    offlineOrgId ||
    firstNgaEnrichment?.orgId ||
    firstNgaEnrichment?.galleryId ||
    'nga';

  return createNgaOfflineSpotlightSearch({
    orgId,
    records: records as NgaOfflineCorpusRecord[],
    enrichments,
  });
};

const main = async () => {
  const search = offlineCorpusPath
    ? await loadOfflineSearch(offlineCorpusPath)
    : networkSearch;
  const { bundle, searchRequestCount } = await generateNgaSpotlightBundle({
    corpusVersion,
    search,
  });
  const serializedBundle = `${JSON.stringify(bundle)}\n`;
  const assetRevision = createHash('sha256')
    .update(serializedBundle)
    .digest('hex');

  const scriptDirectory = dirname(fileURLToPath(import.meta.url));
  const outputPath = resolve(
    scriptDirectory,
    '..',
    'apps',
    'web',
    'public',
    'search-spotlights',
    'nga',
    `v${PUBLIC_SEARCH_CONTRACT_VERSION}-${assetRevision}.json`
  );
  const assetPath = `/search-spotlights/nga/v${PUBLIC_SEARCH_CONTRACT_VERSION}-${assetRevision}.json`;
  const registryPath = resolve(
    scriptDirectory,
    '..',
    'apps',
    'web',
    'app',
    'lib',
    'generated-search-spotlight-assets.ts'
  );
  const temporaryPath = `${outputPath}.tmp`;
  const temporaryRegistryPath = `${registryPath}.tmp`;
  const registrySource = `// Generated by scripts/generate-nga-search-spotlights.ts.\n// The content hash keeps the immutable CDN URL safe to cache indefinitely.\nexport const NGA_SEARCH_SPOTLIGHT_ASSET_PATH =\n  '${assetPath}' as const;\n`;

  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(temporaryPath, serializedBundle, 'utf8');
  await writeFile(temporaryRegistryPath, registrySource, 'utf8');
  await rename(temporaryPath, outputPath);
  await rename(temporaryRegistryPath, registryPath);

  process.stdout.write(
    offlineCorpusPath
      ? `Wrote ${outputPath} after ${searchRequestCount} offline corpus searches (zero network calls).\n`
      : `Wrote ${outputPath} after ${searchRequestCount} explicit search requests.\n`
  );
};

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
