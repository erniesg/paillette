import {
  NGS_PREPARED_SPOTLIGHT_CACHE_KEY,
  NGS_PREPARED_SPOTLIGHT_REVISION,
  NGS_PREPARED_SPOTLIGHT_DEFINITIONS,
  NGS_SEARCH_SPOTLIGHT_MAX_BYTES,
  PublicSearchSpotlightBundleSchema,
  type PublicSearchSpotlightBundle,
  type PublicSearchSpotlightArtwork,
} from '@paillette/types/public-search';
import type { Env } from '../index';
import type { ArtworkSearchResult } from '../types';
import { isNgsPublicOrg, resolveOrgSearchScope } from './orgs';

export const validateNgsPreparedBundle = (value: unknown) => {
  const bundle = PublicSearchSpotlightBundleSchema.parse(value);
  if (
    bundle.provider !== 'ngs' ||
    bundle.corpusVersion !== NGS_PREPARED_SPOTLIGHT_REVISION ||
    bundle.suggestions.length !== NGS_PREPARED_SPOTLIGHT_DEFINITIONS.length ||
    NGS_PREPARED_SPOTLIGHT_DEFINITIONS.some((definition) => {
      const suggestion = bundle.suggestions.find(
        ({ id }) => id === definition.id
      );
      return (
        !suggestion ||
        suggestion.query !== definition.query ||
        suggestion.label !== definition.label ||
        suggestion.type !== definition.type ||
        suggestion.artworks.length < 1 ||
        suggestion.artworks.some(
          (artwork) =>
            !isNgsPublicOrg(artwork.orgId) ||
            artwork.source.provider !== 'ngs' ||
            artwork.similarity < 0.2
        )
      );
    }) ||
    new TextEncoder().encode(JSON.stringify(bundle)).byteLength >
      NGS_SEARCH_SPOTLIGHT_MAX_BYTES
  )
    throw new Error(
      'NGS prepared bundle is incomplete or exceeds its size bound'
    );
  return bundle;
};

// Read-only visitor path. Missing/invalid KV never initiates retrieval or refresh.
export const readNgsPreparedBundle = async (cache: KVNamespace) => {
  try {
    const raw = await cache.get(NGS_PREPARED_SPOTLIGHT_CACHE_KEY);
    return raw ? validateNgsPreparedBundle(JSON.parse(raw)) : undefined;
  } catch (error) {
    console.warn('NGS prepared bundle unavailable', error);
    return undefined;
  }
};

const assetIdFromUrl = (value: string | null | undefined) => {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    if (
      !['paillette-api.berlayar.ai', 'paillette-api-stg.berlayar.ai'].includes(
        url.hostname
      ) ||
      url.protocol !== 'https:'
    )
      return undefined;
    return url.pathname.match(/^\/api\/v1\/assets\/([^/%]+)\/content$/)?.[1];
  } catch {
    return undefined;
  }
};

const toArtwork = (
  result: ArtworkSearchResult
): PublicSearchSpotlightArtwork => {
  const metadata = result.metadata || {};
  const text = (key: string, alias: string) => {
    const value = metadata[key] ?? metadata[alias];
    return typeof value === 'string' && value.trim() ? value.trim() : undefined;
  };
  const colours = metadata.dominantColors ?? metadata.dominant_colors;
  return {
    id: result.id,
    orgId: result.orgId || result.galleryId,
    title: result.title || '',
    ...(result.artist ? { artist: result.artist } : {}),
    ...(Number.isInteger(result.year) ? { year: result.year } : {}),
    imageUrl: result.imageUrl,
    thumbnailUrl: result.thumbnailUrl,
    similarity: result.similarity,
    source: {
      provider: 'ngs',
      institution: text('sourceInstitution', 'source_institution') || '',
      recordId: text('sourceRecordId', 'source_record_id'),
      url: text('sourceUrl', 'source_url'),
      accessionNumber: text('accessionNumber', 'accession_number'),
      rights: text('rights', 'rights'),
    },
    palette: Array.isArray(colours)
      ? [
          ...new Set(
            colours
              .filter(
                (value): value is string =>
                  typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value)
              )
              .map((value) => value.toLowerCase())
          ),
        ].slice(0, 32)
      : [],
  };
};

const bounded = async <T>(work: Promise<T>, timeoutMs: number): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error('NGS prepared refresh timed out')),
          timeoutMs
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
};

export type NgsPreparedRefreshOptions = {
  /** A subset is a pilot only: it can NEVER publish a partial bundle. */
  definitionIds?: readonly string[];
  dryRun?: boolean;
  timeoutMs?: number;
  reuseLegacyEvergreen?: boolean;
};

export const refreshNgsPreparedSpotlights = async (
  env: Env,
  options: NgsPreparedRefreshOptions = {}
): Promise<{
  published: boolean;
  bundle: PublicSearchSpotlightBundle;
  searchRequestCount: number;
}> => {
  const definitions = options.definitionIds
    ? NGS_PREPARED_SPOTLIGHT_DEFINITIONS.filter(({ id }) =>
        options.definitionIds!.includes(id)
      )
    : NGS_PREPARED_SPOTLIGHT_DEFINITIONS;
  if (
    !definitions.length ||
    (options.definitionIds &&
      new Set(options.definitionIds).size !== definitions.length)
  ) {
    throw new Error('Unknown or empty NGS pilot catalogue');
  }
  const { orgId } = await resolveOrgSearchScope(env.DB, 'ngs');
  if (!orgId || !isNgsPublicOrg(orgId))
    throw new Error('NGS organisation unavailable');
  // Lazy import keeps the visitor reader independent of the trusted job.
  const { searchArtworksHybrid } = await import('../routes/search');
  const legacy = options.reuseLegacyEvergreen
    ? (await import('../generated/ngs-search-spotlight-asset'))
        .NGS_SEARCH_SPOTLIGHT_BUNDLE
    : undefined;
  const suggestions: PublicSearchSpotlightBundle['suggestions'] = [];
  let searchRequestCount = 0;
  const verifiedObjects = new Map<string, string>();
  const timeoutMs = options.timeoutMs ?? 45_000;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 60_000)
    throw new Error('Invalid NGS refresh timeout');
  const deadline = Date.now() + 12 * 60_000;

  for (const definition of definitions) {
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0)
      throw new Error('NGS prepared refresh exceeded its total time bound');
    const suggestion = await bounded(
      (async () => {
        const curated = legacy?.suggestions.find(
          ({ id, query }) => id === definition.id && query === definition.query
        );
        let artworks: PublicSearchSpotlightArtwork[];
        if (curated) {
          artworks = PublicSearchSpotlightBundleSchema.parse(
            legacy
          ).suggestions.find(({ id }) => id === definition.id)!.artworks;
        } else {
          searchRequestCount++;
          const degraded = new Set<import('../types').SearchDegradedChannel>();
          const results = await searchArtworksHybrid(
            env,
            orgId,
            undefined,
            definition.query,
            30,
            undefined,
            undefined,
            degraded
          );
          if (degraded.size)
            throw new Error(`NGS retrieval degraded: ${definition.id}`);
          const ids = new Set<string>();
          const images = new Set<string>();
          artworks = results
            .filter((result) => {
              const image = assetIdFromUrl(
                result.thumbnailUrl || result.imageUrl
              );
              if (
                !isNgsPublicOrg(result.orgId || result.galleryId) ||
                !image ||
                !result.title?.trim() ||
                result.similarity < 0.2 ||
                ids.has(result.id) ||
                images.has(image)
              )
                return false;
              ids.add(result.id);
              images.add(image);
              return true;
            })
            .slice(0, 30)
            .map(toArtwork);
        }
        // Match idle-showcase's display dedupe so its four visible cards are
        // exactly the four whose backing objects are verified below.
        const displayIdentities = new Set<string>();
        const normalize = (value: string) =>
          value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
        artworks = artworks.filter((artwork) => {
          const identity =
            artwork.title && artwork.artist && Number.isFinite(artwork.year)
              ? `display:${normalize(artwork.title)}:${normalize(artwork.artist)}:${artwork.year}`
              : `id:${artwork.id}`;
          if (displayIdentities.has(identity)) return false;
          displayIdentities.add(identity);
          return true;
        });
        if (!artworks.length)
          throw new Error(
            `NGS preview needs real imageable results: ${definition.id}`
          );
        const objects = new Set<string>();
        for (const artwork of artworks.slice(0, 4)) {
          const assetId = assetIdFromUrl(
            artwork.thumbnailUrl || artwork.imageUrl
          );
          if (!assetId)
            throw new Error(
              `NGS thumbnail is not a stored asset: ${definition.id}`
            );
          let objectKey = verifiedObjects.get(assetId);
          if (!objectKey) {
            const asset = await env.DB.prepare(
              'SELECT object_key, storage_provider, org_id FROM assets WHERE id = ?'
            )
              .bind(assetId)
              .first<{
                object_key: string;
                storage_provider: string;
                org_id: string;
              }>();
            if (
              !asset ||
              asset.storage_provider !== 'r2' ||
              asset.org_id !== orgId ||
              !asset.object_key
            )
              throw new Error(
                `NGS thumbnail is not an NGS R2 asset: ${definition.id}`
              );
            const head = await env.IMAGES.head(asset.object_key);
            if (
              !head ||
              head.size <= 0 ||
              !head.httpMetadata?.contentType?.startsWith('image/')
            )
              throw new Error(
                `NGS thumbnail object missing or not an image: ${definition.id}`
              );
            objectKey = asset.object_key;
            verifiedObjects.set(assetId, objectKey);
          }
          if (objects.has(objectKey))
            throw new Error(
              `NGS preview repeats a source image: ${definition.id}`
            );
          objects.add(objectKey);
        }
        return { ...definition, artworks };
      })(),
      Math.min(timeoutMs, remainingMs)
    );
    suggestions.push(suggestion);
  }
  const bundle = PublicSearchSpotlightBundleSchema.parse({
    schemaVersion: 1,
    contractVersion: '32',
    corpusVersion: NGS_PREPARED_SPOTLIGHT_REVISION,
    provider: 'ngs',
    generatedAt: new Date().toISOString(),
    requestDefaults: { topK: 30, minScore: 0.2 },
    suggestions,
  });
  const partial =
    definitions.length !== NGS_PREPARED_SPOTLIGHT_DEFINITIONS.length;
  if (!partial) validateNgsPreparedBundle(bundle);
  if (
    new TextEncoder().encode(JSON.stringify(bundle)).byteLength >
    NGS_SEARCH_SPOTLIGHT_MAX_BYTES
  )
    throw new Error('NGS prepared bundle exceeds size bound');
  const published = !partial && !options.dryRun;
  // No expiry: failed refreshes preserve the last complete, good candidate.
  if (published)
    await env.CACHE.put(
      NGS_PREPARED_SPOTLIGHT_CACHE_KEY,
      JSON.stringify(bundle)
    );
  return { published, bundle, searchRequestCount };
};
