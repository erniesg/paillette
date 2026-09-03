import type { LoaderFunctionArgs, MetaFunction } from '@remix-run/cloudflare';
import {
  Link,
  useLoaderData,
  useLocation,
  useSearchParams,
} from '@remix-run/react';
import {
  forwardRef,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent,
} from 'react';
import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { PUBLIC_SEARCH_CONTRACT_VERSION } from '@paillette/types/public-search-core';
import { useDropzone } from 'react-dropzone';
import * as Dialog from '@radix-ui/react-dialog';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import {
  Camera,
  ChevronDown,
  Clock,
  ExternalLink,
  Frame,
  Image as ImageIcon,
  LayoutGrid,
  ListFilter,
  Network,
  Palette,
  Search,
  SlidersHorizontal,
  Table2,
  X,
  type LucideIcon,
} from 'lucide-react';
import { CaptionSourceToggle } from '~/components/artwork/caption-source-toggle';
import { CitationPanel } from '~/components/artwork/citation-panel';
import {
  ImageReuseNotice,
  RequestImageUseLink,
} from '~/components/artwork/image-rights-notice';
import { MetadataSourceToggle } from '~/components/artwork/metadata-source-toggle';
import { NoImagePlaceholder } from '~/components/artwork/no-image-placeholder';
import {
  PublicSiteFooter,
  PublicSiteHeader,
} from '~/components/site/public-shell';
import {
  getGeneratedCaptionDetails,
  getGeneratedCaptionText,
  getGeographicAssociation,
  getNgsUrl,
  getPublicAccession,
  getPublicCatalogueRowGroups,
  getPublicDateText,
  getPublicDescriptionDetailList,
  getPublicImageUrl,
  getPublicThumbnailUrl,
  getPublicArtist,
  getPublicTitle,
  getRootsUrl,
} from '~/lib/public-artwork-metadata';
import { ImageWithFallback } from '~/components/artwork/image-with-fallback';
import { AgentPrompt } from '~/components/webmcp/agent-prompt';
import { useWebMcpState } from '~/components/webmcp/use-webmcp-state';
import { recallArtwork, recallArtworks } from '~/lib/webmcp/artwork-index';
import { SpeakButton } from '~/components/artwork/speak-button';
import { getAuthenticatedAssetUrl } from '~/lib/public-asset-url';
import { loadPublicSearchPage } from '~/lib/public-route-loaders.server';
import {
  buildSuggestionPool,
  getSuggestionKey,
  normalizeSearchQuery,
  type EvalSuggestion,
} from '~/lib/search-suggestions';
import {
  CHUNG_CHENG_STATUE_MASK_IMAGE_URL,
  getChungChengFeaturedArtwork,
  isChungChengArtwork,
  isChungChengFeatureSuggestion,
} from '~/lib/featured-showcase';
import {
  buildZhongZhengAsciiParticles,
  buildZhongZhengMaskParticles,
  type ZhongZhengAsciiParticle,
} from '~/lib/zhongzheng-ascii';
import { buildSearchResultSections } from '~/lib/search-result-sections';
import { buildPublicTextSearchPlan } from '~/lib/public-text-search-plan';
import {
  buildPublicImageSearchPlan,
  type PublicImageSearchPlan,
} from '~/lib/public-image-search-plan';
import {
  DEFAULT_PUBLIC_SEARCH_MIN_SCORE,
  beginSearchIntent,
  buildImageQueryExecution,
  createImagePreviewOwnership,
  createSearchIntentGate,
  deriveDisplayedSearchError,
  deriveImageDraftConstraints,
  getEditorModeUpdate,
  getInterpretationChips,
  getSearchEmptyState,
  getSearchUrlStateKey,
  getConstraintChips,
  getPublicSearchErrorCopy,
  getSearchPresentation,
  getSubmittedConstraintChips,
  getSubmittedSearchSummary,
  getVisibleImagePreview,
  removeConstraintChip,
  settleLatestSearchIntent,
  snapshotAcceptedConstraints,
  supersedeSearchIntent,
  teardownImageSearch,
  transitionImagePreviewOwnership,
  validateImageSelection,
  type EditorMode,
  type SearchFacet,
  type SubmittedSearch,
} from '~/lib/public-search-composer';
import type { PublicSearchConstraints } from '@paillette/types/public-search-core';
import {
  getCachedCandidatePaletteColourDistance,
  rankByPaletteColour,
} from '~/lib/local-colour-refinement';
import {
  getSpotlightArtworks,
  getSpotlightSearchPlaceholder,
  getSpotlightSearchSubmissionOptions,
  loadSearchSpotlightBundle,
} from '~/lib/search-spotlights';
import { selectIdleShowcaseArtworks } from '~/lib/idle-showcase';
import { apiClient } from '~/lib/api';
import {
  canRetryNgaSearch,
  formatNgaSearchQuota,
  getNgaSearchQuotaQueryKey,
  getNgaSearchQuotaFromError,
  isNgaSearchQuotaExhausted,
  NGA_SEARCH_QUOTA_QUERY_OPTIONS,
  reconcileNgaSearchQuota,
  withNgaSearchQuotaFromHeaders,
} from '~/lib/nga-search-quota';
import {
  trackPublicUsageEvent,
  type PublicArtworkInteractionType,
} from '~/lib/usage-events';
import type {
  ApiResponse,
  Artwork,
  ArtworkSearchResult,
  SearchImageRequest,
  SearchResponse,
  SearchTextRequest,
} from '~/types';
import { useUser } from '~/contexts/user-context';

const SEARCH_DISPLAY_INCREMENT = 30;
const BROWSE_PAGE_SIZE = 60;
const MIN_BROWSE_PAGE_SIZE = 12;
const MAX_BROWSE_PAGE_SIZE = 100;
const MAX_SEARCH_RESULTS = 100;
const PUBLIC_SEARCH_QUERY_STALE_TIME = Infinity;
const PUBLIC_SEARCH_QUERY_GC_TIME = Infinity;
const MASONRY_COLUMN_END_ROOT_MARGIN = '1200px 0px 1600px';
let nextUrlDrivenTextSearchExecutionId = 0;

const allocateUrlDrivenTextSearchExecutionId = () => {
  nextUrlDrivenTextSearchExecutionId += 1;
  return nextUrlDrivenTextSearchExecutionId;
};

export const getNextUrlDrivenTextSearchExecutionId = (
  currentExecutionId: number,
  allocatedExecutionId: number
) => Math.max(currentExecutionId + 1, allocatedExecutionId);

export const MASONRY_IMAGE_CLASS_NAME =
  'h-full w-full object-contain transition-opacity duration-300 group-hover:opacity-90';
export const IMAGE_SEARCH_COMPOSER_CLASS_NAME = 'mx-auto max-w-2xl space-y-2';
export const IMAGE_SEARCH_PREVIEW_CLASS_NAME =
  'flex flex-col gap-3 sm:flex-row sm:items-center';

export const meta: MetaFunction = () => {
  return [
    { title: 'Search Artworks - Paillette' },
    {
      name: 'description',
      content:
        'Search and discover artworks using AI-powered multimodal search',
    },
  ];
};

export async function loader({ params, request }: LoaderFunctionArgs) {
  const { galleryId } = params;
  return loadPublicSearchPage({
    request,
    requestedOrgId: galleryId || '',
    routeScope: 'org',
  });
}

type PublicSearchUsageContext = {
  mode?: 'text' | 'colour';
  colours?: string[];
  facet?: SearchFacet;
  source?: string;
  auto?: boolean;
};
type ViewMode = 'masonry' | 'salon' | 'atlas' | 'table';
type ActiveSearchSummary = {
  type: string;
  label: string;
  detail?: string;
  dot: string;
};
type BrowseCollectionResponse = {
  results: ArtworkSearchResult[];
  count: number;
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
};
type SortMode =
  | 'relevance'
  | 'colour'
  | 'time-desc'
  | 'time-asc'
  | 'artist'
  | 'artist-desc'
  | 'title'
  | 'title-desc'
  | 'medium'
  | 'medium-desc'
  | 'place'
  | 'place-desc'
  | 'source'
  | 'source-desc';
type SortControlId = 'relevance' | 'colour' | 'time' | 'artist' | 'title';

export const shouldObserveMasonryColumnEnds = ({
  hasMoreResults,
  isBrowsingCollection,
  isFetchingNextPage,
  isLoading,
  view,
}: {
  hasMoreResults: boolean;
  isBrowsingCollection: boolean;
  isFetchingNextPage: boolean;
  isLoading: boolean;
  view: ViewMode;
}) =>
  view === 'masonry' &&
  isBrowsingCollection &&
  hasMoreResults &&
  !isLoading &&
  !isFetchingNextPage;

const COLOURS = [
  { id: 'navy', hex: '#1a2f52', name: 'Navy' },
  { id: 'cobalt', hex: '#365f9c', name: 'Cobalt' },
  { id: 'steel', hex: '#6e8ea8', name: 'Steel' },
  { id: 'sage', hex: '#8a9a7a', name: 'Sage' },
  { id: 'olive', hex: '#6a6a3a', name: 'Olive' },
  { id: 'gold', hex: '#cda636', name: 'Gold' },
  { id: 'amber', hex: '#d2853a', name: 'Amber' },
  { id: 'rust', hex: '#bf5631', name: 'Rust' },
  { id: 'umber', hex: '#6a5238', name: 'Umber' },
  { id: 'bone', hex: '#cdbfa2', name: 'Bone' },
  { id: 'charcoal', hex: '#221e1a', name: 'Charcoal' },
];

const COLOUR_SEARCH_TERMS: Record<string, string> = {
  navy: 'dark navy blue',
  cobalt: 'cobalt blue',
  steel: 'cool steel blue grey',
  sage: 'muted sage green',
  olive: 'olive green',
  gold: 'golden ochre yellow',
  amber: 'warm amber orange',
  rust: 'rust red orange',
  umber: 'warm earth-tone browns',
  bone: 'warm bone beige',
  charcoal: 'near-black high-contrast monochrome',
};

const SORT_OPTIONS: { id: SortControlId; label: string; icon: LucideIcon }[] = [
  { id: 'relevance', label: 'Relevance', icon: ListFilter },
  { id: 'colour', label: 'Colour', icon: Palette },
  { id: 'time', label: 'Time', icon: Clock },
  { id: 'artist', label: 'Artist', icon: ListFilter },
  { id: 'title', label: 'Title', icon: ListFilter },
];

const VIEW_OPTIONS: { id: ViewMode; label: string; icon: LucideIcon }[] = [
  { id: 'masonry', label: 'Masonry', icon: LayoutGrid },
  { id: 'salon', label: 'Salon', icon: Frame },
  { id: 'atlas', label: 'Atlas', icon: Network },
  { id: 'table', label: 'Table', icon: Table2 },
];

type TableSortColumn =
  | 'title'
  | 'artist'
  | 'time'
  | 'place'
  | 'medium'
  | 'source'
  | 'colour'
  | 'score';

const SORT_DESC: Partial<Record<SortMode, SortMode>> = {
  title: 'title-desc',
  artist: 'artist-desc',
  medium: 'medium-desc',
  place: 'place-desc',
  source: 'source-desc',
};

const SORT_ASC: Partial<Record<SortMode, SortMode>> = {
  'title-desc': 'title',
  'artist-desc': 'artist',
  'medium-desc': 'medium',
  'place-desc': 'place',
  'source-desc': 'source',
};

const tableColumnSortMode = (
  column: TableSortColumn,
  current: SortMode
): SortMode => {
  if (column === 'colour') return 'colour';
  if (column === 'score') return 'relevance';
  if (column === 'time')
    return current === 'time-asc' ? 'time-desc' : 'time-asc';

  const mode = column;
  if (current === mode) return SORT_DESC[current] || mode;
  if (SORT_ASC[current] === mode) return mode;
  return mode;
};

const tableSortDirection = (column: TableSortColumn, current: SortMode) => {
  if (column === 'colour') return current === 'colour' ? 'best' : null;
  if (column === 'score') return current === 'relevance' ? 'desc' : null;
  if (column === 'time') {
    if (current === 'time-asc') return 'asc';
    if (current === 'time-desc') return 'desc';
    return null;
  }

  if (current === column) return 'asc';
  if (SORT_ASC[current] === column) return 'desc';
  return null;
};

const hashString = (value: string) => {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) | 0;
  }
  return Math.abs(hash);
};

const hexToRgb = (hex: string): [number, number, number] | null => {
  const clean = hex.trim().replace('#', '');
  if (!/^[0-9a-f]{6}$/i.test(clean)) return null;

  return [
    parseInt(clean.slice(0, 2), 16),
    parseInt(clean.slice(2, 4), 16),
    parseInt(clean.slice(4, 6), 16),
  ];
};

const rgbDistance = (a: string, b: string) => {
  const rgbA = hexToRgb(a);
  const rgbB = hexToRgb(b);
  if (!rgbA || !rgbB) return Infinity;

  return Math.sqrt(
    (rgbA[0] - rgbB[0]) ** 2 +
      (rgbA[1] - rgbB[1]) ** 2 +
      (rgbA[2] - rgbB[2]) ** 2
  );
};

const getSelectedColour = (selection: string) => {
  if (selection.startsWith('custom:')) {
    const hex = selection.slice('custom:'.length);
    if (hexToRgb(hex)) {
      return {
        id: selection,
        hex,
        name: hex.toUpperCase(),
      };
    }
  }

  return COLOURS.find((colour) => colour.id === selection) || null;
};

const getSearchColour = (value: string | null) =>
  value && getSelectedColour(value) ? value : null;

const getColourSearchText = (selection: string) => {
  const colour = getSelectedColour(selection);
  if (!colour) return '';

  if (selection.startsWith('custom:')) {
    return `${colour.hex} colour`;
  }

  return (
    COLOUR_SEARCH_TERMS[selection] || `${colour.name.toLowerCase()} colour`
  );
};

const asText = (value: unknown) =>
  typeof value === 'string' && value.trim() ? value.trim() : null;

const SEARCH_FACETS = new Set<SearchFacet>(['artist', 'classification']);
const getSearchFacet = (value: string | null): SearchFacet | null =>
  value && SEARCH_FACETS.has(value as SearchFacet)
    ? (value as SearchFacet)
    : null;

const normalizeArtistSearchQuery = (value: string) =>
  normalizeSearchQuery(
    value
      .replace(/\([^)]*(?:\d{3,4}|born|died|b\.|d\.)[^)]*\)/gi, ' ')
      .replace(/\b(?:b|d)\.?\s*\d{3,4}\b/gi, ' ')
  );

export const getSearchParamsForQuery = (
  query: string,
  facet: SearchFacet | null = null,
  colour: string | null = null
) => {
  const params: Record<string, string> = {};
  if (query) {
    params.q = query;
  }
  if (facet) {
    params.field = facet;
  }
  if (colour) {
    params.colour = colour;
  }
  return params;
};

const asNumber = (value: unknown) => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

const getMeta = (result: ArtworkSearchResult) => result.metadata || {};

const getYear = (result: ArtworkSearchResult) =>
  asNumber(result.year) || asNumber(getMeta(result).year);

const getDateText = (result: ArtworkSearchResult) =>
  getPublicDateText(result) || String(getYear(result) || '');

const getMedium = (result: ArtworkSearchResult) =>
  asText(getMeta(result).medium) || asText(getMeta(result).classification);

const getAccession = (result: ArtworkSearchResult) =>
  getPublicAccession(result);

const getDisplayTitle = (result: ArtworkSearchResult) => getPublicTitle(result);

const getDisplayArtist = (result: ArtworkSearchResult) =>
  getPublicArtist(result) || 'Unknown artist';

const getSourceName = (result: ArtworkSearchResult) =>
  getNgsUrl(result)
    ? asText(getMeta(result).sourceInstitution) ||
      asText(getMeta(result).source_institution) ||
      'National Gallery Singapore'
    : getRootsUrl(result)
      ? 'Roots NHB'
      : asText(getMeta(result).sourceInstitution) ||
        asText(getMeta(result).source_institution) ||
        'National Gallery Singapore';

const getPlace = (result: ArtworkSearchResult) =>
  getGeographicAssociation(result);

const getSourceUrl = (result: ArtworkSearchResult) =>
  getNgsUrl(result) || getRootsUrl(result);

const clickableCatalogueLabels = new Set([
  'artist',
  'date',
  'medium',
  'geographic association',
  'credit line',
]);

const getCatalogueRowSearchQuery = (label: string, value: string) => {
  if (!clickableCatalogueLabels.has(label.toLowerCase())) return null;
  return value.trim() || null;
};

const getCatalogueRowSearchFacet = (label: string): SearchFacet | null =>
  label.toLowerCase() === 'artist' || label.toLowerCase() === 'creator'
    ? 'artist'
    : null;

type MetadataFacet = {
  value: string;
  query: string;
};

const getMetadataFacets = (result: ArtworkSearchResult): MetadataFacet[] => {
  const candidates = [
    getDateText(result),
    getMedium(result),
    asText(getMeta(result).classification),
    getPlace(result),
  ].filter(Boolean) as string[];
  const seen = new Set<string>();

  return candidates.flatMap((value) => {
    const normalized = value.trim();
    const key = normalized.toLowerCase();
    if (!normalized || key === '-' || seen.has(key)) return [];

    seen.add(key);
    return {
      value: normalized,
      query: normalized,
    };
  });
};

const hasPaletteWeight = (item: Record<string, unknown>) => {
  const percentage = asNumber(
    item.percentage ?? item.percent ?? item.weight ?? item.ratio
  );
  return percentage === null || percentage > 0;
};

const paletteByResult = new WeakMap<ArtworkSearchResult, string[]>();

export const collectPalette = (result: ArtworkSearchResult): string[] => {
  const cached = paletteByResult.get(result);
  if (cached) return cached;

  const meta = getMeta(result);
  const candidates = [
    meta.dominantColors,
    meta.dominant_colors,
    meta.colorPalette,
    meta.color_palette,
    meta.colour_palette,
  ];
  const colours: string[] = [];

  for (const candidate of candidates) {
    if (!candidate) continue;

    if (Array.isArray(candidate)) {
      for (const item of candidate) {
        if (typeof item === 'string' && hexToRgb(item)) colours.push(item);
        if (item && typeof item === 'object') {
          const record = item as Record<string, unknown>;
          const color = asText(record.color);
          if (color && hexToRgb(color) && hasPaletteWeight(record)) {
            colours.push(color);
          }
        }
      }
    }

    if (candidate && typeof candidate === 'object' && 'colors' in candidate) {
      const paletteRecord = candidate as {
        colors?: unknown;
        percentages?: unknown;
      };
      const colorList = paletteRecord.colors;
      const percentages = Array.isArray(paletteRecord.percentages)
        ? paletteRecord.percentages
        : [];
      if (Array.isArray(colorList)) {
        for (const [index, color] of colorList.entries()) {
          const percentage = asNumber(percentages[index]);
          if (percentage !== null && percentage <= 0) continue;
          if (typeof color === 'string' && hexToRgb(color)) colours.push(color);
        }
      }
    }
  }

  const palette = [...new Set(colours)];
  paletteByResult.set(result, palette);
  return palette;
};

const colourScore = (result: ArtworkSearchResult, selected: string[]) => {
  const palette = collectPalette(result);
  if (!selected.length) return 0;
  if (!palette.length) return Infinity;

  const selectedHexColours = selected.flatMap((colourId) => {
    const selectedColour = getSelectedColour(colourId);
    return selectedColour ? [selectedColour.hex] : [];
  });

  return getCachedCandidatePaletteColourDistance(
    result,
    selectedHexColours,
    palette
  );
};

const colourMatchPercent = (
  result: ArtworkSearchResult,
  selected: string[]
) => {
  const distance = colourScore(result, selected);
  if (!Number.isFinite(distance)) return null;

  const maxUsefulDistance = 100;
  return Math.max(
    0,
    Math.round(
      100 - (Math.min(distance, maxUsefulDistance) / maxUsefulDistance) * 100
    )
  );
};

const formatColourMatch = (result: ArtworkSearchResult, selected: string[]) => {
  const match = colourMatchPercent(result, selected);
  return match === null ? 'No palette' : `${match}%`;
};

const getColourMatchTitle = (
  result: ArtworkSearchResult,
  selected: string[]
) => {
  const distance = colourScore(result, selected);
  if (!Number.isFinite(distance)) {
    return 'No palette available for this artwork';
  }

  return `Nearest palette distance: ${Math.round(distance)}. Lower distance is closer.`;
};

const clampNumber = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

const getMasonryColumnCount = (width: number) => {
  if (width >= 1280) return 4;
  if (width >= 1024) return 3;
  if (width >= 640) return 2;
  return 1;
};

const useMasonryColumnCount = () => {
  const [columnCount, setColumnCount] = useState(4);

  useEffect(() => {
    const updateColumnCount = () => {
      setColumnCount(getMasonryColumnCount(window.innerWidth));
    };

    updateColumnCount();
    window.addEventListener('resize', updateColumnCount);
    return () => window.removeEventListener('resize', updateColumnCount);
  }, []);

  return columnCount;
};

const getMasonryImageRatio = (result: ArtworkSearchResult) => {
  const dimensions = getMeta(result).dimensions;
  const width = asNumber(dimensions?.width);
  const height = asNumber(dimensions?.height);

  if (width && height) {
    return clampNumber(height / width, 0.45, 2.25);
  }

  return 0.82 + (hashString(result.id) % 88) / 100;
};

export const getMasonryImageFrameStyle = (
  result: ArtworkSearchResult
): CSSProperties => ({
  aspectRatio: `1 / ${getMasonryImageRatio(result)}`,
});

const estimateMasonryCardHeight = (result: ArtworkSearchResult) => {
  const titleLength = getDisplayTitle(result).length;
  const titleWeight = Math.min(0.42, titleLength / 150);
  const metadataWeight = getMetadataFacets(result).length ? 0.34 : 0.18;

  return getMasonryImageRatio(result) + 0.64 + titleWeight + metadataWeight;
};

const distributeMasonryResults = (
  results: ArtworkSearchResult[],
  columnCount: number
) => {
  const safeColumnCount = Math.max(1, columnCount);
  const columns: Array<Array<{ result: ArtworkSearchResult; index: number }>> =
    Array.from({ length: safeColumnCount }, () => []);
  const heights = Array.from({ length: safeColumnCount }, () => 0);

  results.forEach((result, index) => {
    let targetColumn = 0;

    for (let columnIndex = 1; columnIndex < safeColumnCount; columnIndex += 1) {
      if (heights[columnIndex]! < heights[targetColumn]!) {
        targetColumn = columnIndex;
      }
    }

    columns[targetColumn]!.push({ result, index });
    heights[targetColumn]! += estimateMasonryCardHeight(result);
  });

  return columns;
};

const paletteBandSortKey = (result: ArtworkSearchResult) => {
  const [dominantColour] = collectPalette(result);
  if (!dominantColour) {
    return { band: Infinity, distance: Infinity };
  }

  return COLOURS.reduce(
    (best, colour, index) => {
      const distance = rgbDistance(dominantColour, colour.hex);
      if (distance < best.distance) {
        return { band: index, distance };
      }
      return best;
    },
    { band: Infinity, distance: Infinity }
  );
};

const getPaletteBandLabel = (result: ArtworkSearchResult) => {
  const [dominantColour] = collectPalette(result);
  if (!dominantColour) return 'No palette';
  const fallbackColour = COLOURS[0];
  if (!fallbackColour) return 'No palette';

  const nearest = COLOURS.reduce(
    (best, colour) => {
      const distance = rgbDistance(dominantColour, colour.hex);
      return distance < best.distance ? { colour, distance } : best;
    },
    { colour: fallbackColour, distance: Infinity }
  );

  return nearest.colour.name;
};

const sortResults = (
  results: ArtworkSearchResult[],
  sortMode: SortMode,
  selectedColours: string[]
) => {
  if (sortMode === 'colour' && selectedColours.length) {
    const selectedHexColours = selectedColours.flatMap((selection) => {
      const colour = getSelectedColour(selection);
      return colour ? [colour.hex] : [];
    });

    if (selectedHexColours.length) {
      return rankByPaletteColour(results, selectedHexColours, collectPalette);
    }
  }

  const sorted = [...results];
  const textCompare = (
    a: ArtworkSearchResult,
    b: ArtworkSearchResult,
    getter: (result: ArtworkSearchResult) => string | null | undefined,
    direction: 'asc' | 'desc' = 'asc'
  ) => {
    const valueA = getter(a) || '';
    const valueB = getter(b) || '';
    const delta = valueA.localeCompare(valueB, undefined, {
      numeric: true,
      sensitivity: 'base',
    });
    return direction === 'desc' ? -delta : delta;
  };

  sorted.sort((a, b) => {
    if (sortMode === 'colour') {
      if (!selectedColours.length) {
        const paletteA = paletteBandSortKey(a);
        const paletteB = paletteBandSortKey(b);
        const bandDelta = paletteA.band - paletteB.band;
        if (Number.isFinite(bandDelta) && bandDelta !== 0) return bandDelta;

        const distanceDelta = paletteA.distance - paletteB.distance;
        if (Number.isFinite(distanceDelta) && distanceDelta !== 0)
          return distanceDelta;
      }
    }

    if (sortMode === 'time-desc') {
      return (getYear(b) || -Infinity) - (getYear(a) || -Infinity);
    }

    if (sortMode === 'time-asc') {
      return (getYear(a) || Infinity) - (getYear(b) || Infinity);
    }

    if (sortMode === 'artist') {
      return textCompare(a, b, getPublicArtist) || b.similarity - a.similarity;
    }

    if (sortMode === 'artist-desc') {
      return (
        textCompare(a, b, getPublicArtist, 'desc') ||
        b.similarity - a.similarity
      );
    }

    if (sortMode === 'title') {
      return textCompare(a, b, getPublicTitle) || b.similarity - a.similarity;
    }

    if (sortMode === 'title-desc') {
      return (
        textCompare(a, b, getPublicTitle, 'desc') || b.similarity - a.similarity
      );
    }

    if (sortMode === 'medium') {
      return textCompare(a, b, getMedium) || b.similarity - a.similarity;
    }

    if (sortMode === 'medium-desc') {
      return (
        textCompare(a, b, getMedium, 'desc') || b.similarity - a.similarity
      );
    }

    if (sortMode === 'place') {
      return textCompare(a, b, getPlace) || b.similarity - a.similarity;
    }

    if (sortMode === 'place-desc') {
      return textCompare(a, b, getPlace, 'desc') || b.similarity - a.similarity;
    }

    if (sortMode === 'source') {
      return textCompare(a, b, getSourceName) || b.similarity - a.similarity;
    }

    if (sortMode === 'source-desc') {
      return (
        textCompare(a, b, getSourceName, 'desc') || b.similarity - a.similarity
      );
    }

    return b.similarity - a.similarity;
  });

  return sorted;
};

const readSearchResponse = async (response: Response) => {
  const payload = (await response.json()) as ApiResponse<SearchResponse>;
  if (!payload.success || !payload.data) {
    const details = withNgaSearchQuotaFromHeaders(
      payload.error?.details && typeof payload.error.details === 'object'
        ? payload.error.details
        : undefined,
      response.headers
    );
    throw new PublicSearchRequestError(
      payload.error?.message || 'Search failed',
      response.status,
      payload.error?.code,
      details
    );
  }

  return payload.data;
};

class PublicSearchRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
    readonly details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'PublicSearchRequestError';
  }
}

const publicSearchText = async (
  orgId: string,
  request: SearchTextRequest,
  usageContext?: PublicSearchUsageContext,
  signal?: AbortSignal
): Promise<SearchResponse> => {
  const response = await fetch(
    `/api/public-search/${encodeURIComponent(orgId)}/text`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        ...request,
        usageContext,
      }),
      signal,
    }
  );

  return readSearchResponse(response);
};

const publicSearchImage = async (
  orgId: string,
  request: SearchImageRequest,
  signal?: AbortSignal
): Promise<SearchResponse> => {
  const body = new FormData();
  body.set('image', request.image);
  if (request.topK !== undefined) body.set('topK', String(request.topK));
  if (request.minScore !== undefined)
    body.set('minScore', String(request.minScore));
  if (request.constraints !== undefined) {
    body.set('constraints', JSON.stringify(request.constraints));
  }

  const response = await fetch(
    `/api/public-search/${encodeURIComponent(orgId)}/image`,
    {
      method: 'POST',
      body,
      signal,
    }
  );

  return readSearchResponse(response);
};

const readBrowseResponse = async (response: Response) => {
  const payload =
    (await response.json()) as ApiResponse<BrowseCollectionResponse>;
  if (!payload.success || !payload.data) {
    throw new Error(payload.error?.message || 'Failed to browse collection');
  }

  return payload.data;
};

const publicBrowseCollection = async (
  orgId: string,
  request: {
    limit: number;
    offset: number;
    sortBy: 'title' | 'artist' | 'year' | 'created_at' | 'updated_at';
    sortOrder: 'asc' | 'desc';
  }
): Promise<BrowseCollectionResponse> => {
  const params = new URLSearchParams({
    limit: String(request.limit),
    offset: String(request.offset),
    sort_by: request.sortBy,
    sort_order: request.sortOrder,
  });
  const response = await fetch(
    `/api/public-search/${encodeURIComponent(orgId)}/browse?${params.toString()}`
  );

  return readBrowseResponse(response);
};

const authenticatedBrowseCollection = async (
  orgId: string,
  request: {
    limit: number;
    offset: number;
    sortBy: 'title' | 'artist' | 'year' | 'created_at' | 'updated_at';
    sortOrder: 'asc' | 'desc';
  }
): Promise<BrowseCollectionResponse> => {
  const { artworks, total } = await apiClient.listArtworks(orgId, request);
  const results = artworks.map(
    (artwork: Artwork): ArtworkSearchResult => ({
      id: artwork.id,
      orgId: artwork.orgId || artwork.galleryId || orgId,
      galleryId: artwork.galleryId || artwork.orgId || orgId,
      title: artwork.title,
      artist: artwork.artist,
      year: artwork.year,
      imageUrl: artwork.imageUrl || artwork.image_url || null,
      thumbnailUrl: artwork.thumbnailUrl || artwork.thumbnail_url || null,
      similarity: 1,
      metadata: artwork.metadata || {},
    })
  );
  return {
    results,
    count: results.length,
    total,
    limit: request.limit,
    offset: request.offset,
    hasMore: request.offset + results.length < total,
  };
};

const getBrowseSort = (
  sortMode: SortMode
): {
  sortBy: 'title' | 'artist' | 'year' | 'created_at' | 'updated_at';
  sortOrder: 'asc' | 'desc';
} => {
  if (sortMode === 'time-desc') return { sortBy: 'year', sortOrder: 'desc' };
  if (sortMode === 'time-asc') return { sortBy: 'year', sortOrder: 'asc' };
  if (sortMode === 'artist-desc')
    return { sortBy: 'artist', sortOrder: 'desc' };
  if (sortMode === 'artist') return { sortBy: 'artist', sortOrder: 'asc' };
  if (sortMode === 'title-desc') return { sortBy: 'title', sortOrder: 'desc' };
  if (sortMode === 'title') return { sortBy: 'title', sortOrder: 'asc' };

  return { sortBy: 'title', sortOrder: 'asc' };
};

export default function SearchPage() {
  const {
    gallery,
    galleryId,
    publicSearchOrgId = galleryId,
    preferredRouteId,
    publicRouteBasePath = `/${preferredRouteId}`,
    holidaySuggestions = [],
  } = useLoaderData<typeof loader>();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const { isAuthenticated, login, signup, getAccessToken, searchAccess } =
    useUser();
  const queryClient = useQueryClient();
  const isNgsSearch = preferredRouteId === 'ngs';
  const isNgaSearch = preferredRouteId === 'nga';
  const isNgsSearchLocked = isNgsSearch && searchAccess !== 'approved';
  const urlQuery = searchParams.get('q') || '';
  const normalizedUrlQuery = normalizeSearchQuery(urlQuery);
  const urlSearchFacet = getSearchFacet(searchParams.get('field'));
  const urlSearchColour = getSearchColour(searchParams.get('colour'));

  const [editorMode, setEditorMode] = useState<EditorMode>(
    urlSearchColour ? 'colour' : 'text'
  );
  const [textQuery, setTextQuery] = useState(normalizedUrlQuery);
  const [committedTextQuery, setCommittedTextQuery] =
    useState(normalizedUrlQuery);
  const [searchFacet, setSearchFacet] = useState<SearchFacet | null>(
    urlSearchFacet
  );
  const [submittedSearch, setSubmittedSearch] =
    useState<SubmittedSearch | null>(() => {
      if (urlSearchColour) {
        return {
          kind: 'colour',
          query: normalizedUrlQuery || getColourSearchText(urlSearchColour),
          facet: urlSearchFacet,
          colour: urlSearchColour,
          refinement: 'local-palette',
        };
      }
      return normalizedUrlQuery
        ? { kind: 'text', query: normalizedUrlQuery, facet: urlSearchFacet }
        : null;
    });
  const [imagePreviewOwnership, setImagePreviewOwnership] = useState(
    createImagePreviewOwnership
  );
  const [imageDraftConstraints, setImageDraftConstraints] = useState<
    PublicSearchConstraints | undefined
  >(undefined);
  const [submittedImagePlan, setSubmittedImagePlan] =
    useState<PublicImageSearchPlan | null>(null);
  const [imageExecutionId, setImageExecutionId] = useState(0);
  const [isPreparingImage, setIsPreparingImage] = useState(false);
  const [textSearchExecutionId, setTextSearchExecutionId] = useState(() =>
    normalizedUrlQuery || urlSearchColour
      ? allocateUrlDrivenTextSearchExecutionId()
      : 0
  );
  const [imageUploadError, setImageUploadError] = useState<string | null>(null);
  const [searchColours, setSearchColours] = useState<string[]>(
    urlSearchColour ? [urlSearchColour] : []
  );
  const [sortColours, setSortColours] = useState<string[]>(
    urlSearchColour ? [urlSearchColour] : []
  );
  const [customColour, setCustomColour] = useState('#cda636');
  const [sortMode, setSortMode] = useState<SortMode>(
    urlSearchColour ? 'colour' : 'relevance'
  );
  const [view, setView] = useState<ViewMode>('masonry');

  /**
   * `set_view` lets the agent choose the layout, because presentation is part
   * of its answer — a cross-section drawn from four different searches reads as
   * a constellation in atlas and as a list in table. The human's own choice
   * still wins the moment they touch the control; this only follows the agent
   * when the agent has actually asked.
   */
  const webmcpState = useWebMcpState();
  const agentView = webmcpState.view;
  useEffect(() => {
    if (agentView) setView(agentView);
  }, [agentView]);

  /**
   * A board the agent assembled takes over this canvas.
   *
   * `set_results` with explicit ids is the agent's answer to a goal rather than
   * a query — a cross-section drawn from several different searches, which this
   * page could otherwise never show, because its own grid only ever holds the
   * results of the last search run. Without this the board lived in the
   * activity panel while the canvas behind it sat on the idle showcase.
   *
   * The records come out of the session index rather than being re-fetched:
   * every pinned id was returned to this page by a search it already ran.
   */
  const agentBoardResults = useMemo(() => {
    const board = webmcpState.agentResults;
    if (!board || board.origin !== 'agent' || board.items.length === 0) {
      return null;
    }
    const { found } = recallArtworks(board.items.map((item) => item.id));
    return found.length > 0 ? found : null;
  }, [webmcpState.agentResults]);
  const agentBoardNote = agentBoardResults
    ? (webmcpState.agentResults?.note ?? webmcpState.agentResults?.label ?? null)
    : null;

  /**
   * `show_artwork` is how an agent points at one work — "look at this one". It
   * writes the focused artwork to the shared store, and `/try` renders it, but
   * this page ignored it entirely: the call succeeded and nothing happened on
   * screen. Open the page's own detail dialog instead of building a second one,
   * so an agent pointing at a work lands exactly where a click would.
   */
  const focusedByAgent = webmcpState.focused;
  useEffect(() => {
    if (!focusedByAgent) return;
    const artwork = recallArtwork(focusedByAgent.artwork.id);
    if (artwork) setSelectedArtwork(artwork);
  }, [focusedByAgent]);
  const [topK, setTopK] = useState(30);
  const [minScore, setMinScore] = useState(DEFAULT_PUBLIC_SEARCH_MIN_SCORE);
  const [browsePageSize, setBrowsePageSize] = useState(BROWSE_PAGE_SIZE);
  const [isBrowsingCollection, setIsBrowsingCollection] = useState(false);
  const [visibleCount, setVisibleCount] = useState(SEARCH_DISPLAY_INCREMENT);
  const [shouldSearch, setShouldSearch] = useState(
    Boolean(normalizedUrlQuery || urlSearchColour)
  );
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [selectedArtwork, setSelectedArtwork] =
    useState<ArtworkSearchResult | null>(null);
  const [hasMounted, setHasMounted] = useState(false);
  const loadMoreRef = useRef<HTMLDivElement | null>(null);
  const colourRailRef = useRef<HTMLDivElement | null>(null);
  const uploaderActionRef = useRef<HTMLButtonElement | null>(null);
  const imagePreviewOwnershipRef = useRef(imagePreviewOwnership);
  const searchPanelRef = useRef<HTMLElement | null>(null);
  const idleShowcaseRef = useRef<HTMLDivElement | null>(null);
  const resultsAreaRef = useRef<HTMLElement | null>(null);
  const searchIntentGateRef = useRef(createSearchIntentGate());
  const previousUrlSearchStateRef = useRef(
    getSearchUrlStateKey(normalizedUrlQuery, urlSearchFacet, urlSearchColour)
  );
  const searchReturnPath = `${location.pathname}${location.search}${location.hash}`;
  const searchRoutePath = `${publicRouteBasePath}/search`;
  const [idleSuggestion, setIdleSuggestion] = useState<EvalSuggestion | null>(
    null
  );
  const [displayIdleSuggestion, setDisplayIdleSuggestion] =
    useState<EvalSuggestion | null>(null);
  const normalizedTextQuery = normalizeSearchQuery(textQuery);
  const normalizedCommittedTextQuery = normalizeSearchQuery(committedTextQuery);
  const visibleImagePreview = getVisibleImagePreview(imagePreviewOwnership);
  const imageFile = visibleImagePreview?.file || null;
  const imagePreview = visibleImagePreview?.url || null;
  const activeSearchColour =
    submittedSearch?.kind === 'colour' ? submittedSearch.colour : null;
  const activeColourQuery = activeSearchColour
    ? getColourSearchText(activeSearchColour)
    : '';
  const submittedTextOwner =
    submittedSearch?.kind === 'text' || submittedSearch?.kind === 'colour'
      ? submittedSearch
      : null;
  const textSearchPlan = useMemo(
    () =>
      buildPublicTextSearchPlan({
        orgId: publicSearchOrgId,
        facet: submittedTextOwner?.facet || null,
        committedTextQuery: submittedTextOwner?.query || '',
        colourQuery: activeColourQuery,
        topK,
        minScore,
        constraints: submittedTextOwner?.explicitConstraints,
      }),
    [activeColourQuery, minScore, publicSearchOrgId, submittedTextOwner, topK]
  );
  const canSubmitTextSearch = normalizedTextQuery.length > 0;
  const hasUncommittedInitialText =
    editorMode === 'text' &&
    normalizedTextQuery.length > 0 &&
    normalizedCommittedTextQuery.length === 0;
  const searchPresentation = getSearchPresentation({
    editorMode,
    submittedSearch,
    isBrowsingCollection,
    imageDraftConstraints,
    ...(sortColours[0]
      ? {
          paletteOrder: {
            colour: sortColours[0],
            refinement: 'local-palette' as const,
          },
        }
      : {}),
  });

  const suggestionPool = useMemo(
    () =>
      buildSuggestionPool(holidaySuggestions, {
        routeId: preferredRouteId,
        source: gallery.settings?.source,
        institutionName: gallery.name,
      }),
    [
      gallery.name,
      gallery.settings?.source,
      holidaySuggestions,
      preferredRouteId,
    ]
  );

  useEffect(() => {
    if (suggestionPool.length) return;

    setIdleSuggestion(null);
    setDisplayIdleSuggestion(null);
  }, [suggestionPool.length]);

  // An agent board counts as an active search: the canvas has something on it,
  // so the idle showcase must give way.
  const hasActiveSearch =
    searchPresentation.hasActiveSearch || Boolean(agentBoardResults);
  const activeSearchSummary = useMemo<ActiveSearchSummary | null>(() => {
    if (isBrowsingCollection) {
      if (shouldSearch && normalizedCommittedTextQuery) {
        return {
          type: searchFacet ? `${searchFacet} browse` : 'browse',
          label: committedTextQuery,
          detail: 'ranked + infinite browse',
          dot: '#d946ef',
        };
      }

      return {
        type: 'browse',
        label: 'collection',
        detail: 'all works',
        dot: '#8b8d96',
      };
    }

    const summary = getSubmittedSearchSummary(submittedSearch);
    if (!summary) return null;
    const orderedColour = sortColours[0];
    const palette = orderedColour ? getSelectedColour(orderedColour) : null;
    return {
      ...summary,
      ...(orderedColour
        ? { detail: `Palette order: ${palette?.name || orderedColour}` }
        : {}),
      dot:
        submittedSearch?.kind === 'image'
          ? '#7dd3fc'
          : palette?.hex || '#d946ef',
    };
  }, [
    isBrowsingCollection,
    shouldSearch,
    searchFacet,
    committedTextQuery,
    normalizedCommittedTextQuery,
    sortColours,
    submittedSearch,
  ]);
  const getCurrentReturnTo = () =>
    `${window.location.pathname}${window.location.search}${window.location.hash}`;

  const revealColourRail = useCallback(() => {
    window.requestAnimationFrame(() => {
      colourRailRef.current?.scrollIntoView({
        block: 'center',
        behavior: 'smooth',
      });
    });
  }, []);

  const applyImagePreviewTransition = useCallback(
    (
      event: Parameters<typeof transitionImagePreviewOwnership>[1],
      updateReactState = true
    ) => {
      const transition = transitionImagePreviewOwnership(
        imagePreviewOwnershipRef.current,
        event
      );
      imagePreviewOwnershipRef.current = transition.state;
      if (updateReactState) setImagePreviewOwnership(transition.state);
      for (const url of transition.revoke) URL.revokeObjectURL(url);
      return transition.state;
    },
    []
  );

  const stageImagePreviewCandidate = useCallback(
    (file: File) => {
      const url = URL.createObjectURL(file);
      applyImagePreviewTransition({
        type: 'stage',
        preview: { file, url },
      });
    },
    [applyImagePreviewTransition]
  );

  const clearOwnedImagePreviews = useCallback(() => {
    applyImagePreviewTransition({ type: 'clear' });
  }, [applyImagePreviewTransition]);

  const supersedePendingSearchIntent = useCallback(() => {
    supersedeSearchIntent(searchIntentGateRef.current);
    applyImagePreviewTransition({ type: 'cancel-candidate' });
    setIsPreparingImage(false);
  }, [applyImagePreviewTransition]);

  const updateSearchUrl = useCallback(
    (
      query: string,
      facet: SearchFacet | null = null,
      colour: string | null = null,
      options?: { replace?: boolean }
    ) => {
      previousUrlSearchStateRef.current = getSearchUrlStateKey(
        query,
        facet,
        colour
      );
      setSearchParams(getSearchParamsForQuery(query, facet, colour), options);
    },
    [setSearchParams]
  );

  useEffect(() => {
    setHasMounted(true);
  }, []);

  const spotlightProvider =
    preferredRouteId === 'nga' || preferredRouteId === 'ngs'
      ? preferredRouteId
      : null;
  const shouldLoadSpotlights =
    hasMounted &&
    Boolean(spotlightProvider) &&
    (spotlightProvider !== 'ngs' || searchAccess === 'approved');
  const spotlightBundleQuery = useQuery({
    queryKey: [
      'search-spotlights',
      PUBLIC_SEARCH_CONTRACT_VERSION,
      spotlightProvider,
    ] as const,
    queryFn: ({ signal }) => {
      if (!spotlightProvider) return null;
      return loadSearchSpotlightBundle(spotlightProvider, {
        ...(spotlightProvider === 'ngs' ? { getAccessToken } : {}),
        signal,
      });
    },
    enabled: shouldLoadSpotlights,
    staleTime: PUBLIC_SEARCH_QUERY_STALE_TIME,
    gcTime: PUBLIC_SEARCH_QUERY_GC_TIME,
    retry: false,
  });
  const spotlightBundle = isNgsSearchLocked ? null : spotlightBundleQuery.data;

  const ngaSearchQuotaQuery = useQuery({
    queryKey: getNgaSearchQuotaQueryKey(),
    queryFn: ({ signal }) => apiClient.getNgaPublicSearchQuota(signal),
    enabled: hasMounted && isNgaSearch,
    ...NGA_SEARCH_QUOTA_QUERY_OPTIONS,
    gcTime: PUBLIC_SEARCH_QUERY_GC_TIME,
    retry: false,
  });
  const ngaSearchQuota = isNgaSearch ? ngaSearchQuotaQuery.data ?? null : null;
  const hasExhaustedNgaSearchQuota =
    isNgaSearch && ngaSearchQuota?.remaining === 0;
  const isSearchDisabled = isNgsSearchLocked || hasExhaustedNgaSearchQuota;
  const canSearchOnPage = !isSearchDisabled;

  const spotlightSearchPlaceholder = useMemo(
    () =>
      textSearchPlan
        ? getSpotlightSearchPlaceholder(spotlightBundle, {
            query: textSearchPlan.request.query,
            facet: submittedTextOwner?.facet,
            colourId:
              submittedSearch?.kind === 'colour'
                ? submittedSearch.colour
                : null,
            topK,
            minScore,
          })
        : undefined,
    [
      minScore,
      spotlightBundle,
      submittedSearch,
      submittedTextOwner,
      textSearchPlan,
      topK,
    ]
  );

  useEffect(() => {
    if (urlQuery && normalizedUrlQuery !== urlQuery) {
      setSearchParams(
        getSearchParamsForQuery(
          normalizedUrlQuery,
          urlSearchFacet,
          urlSearchColour
        ),
        { replace: true }
      );
    }

    const urlSearchState = getSearchUrlStateKey(
      normalizedUrlQuery,
      urlSearchFacet,
      urlSearchColour
    );
    if (previousUrlSearchStateRef.current === urlSearchState) return;

    supersedePendingSearchIntent();
    previousUrlSearchStateRef.current = urlSearchState;
    if (normalizedUrlQuery || urlSearchColour) {
      const allocatedExecutionId = allocateUrlDrivenTextSearchExecutionId();
      setTextSearchExecutionId((currentExecutionId) =>
        getNextUrlDrivenTextSearchExecutionId(
          currentExecutionId,
          allocatedExecutionId
        )
      );
    }
    setSelectedArtwork(null);
    setTextQuery(normalizedUrlQuery);
    setCommittedTextQuery(normalizedUrlQuery);
    setSearchFacet(urlSearchFacet);
    setSearchColours(urlSearchColour ? [urlSearchColour] : []);
    setSortColours(urlSearchColour ? [urlSearchColour] : []);
    setEditorMode(urlSearchColour ? 'colour' : 'text');
    setSortMode(urlSearchColour ? 'colour' : 'relevance');
    setShouldSearch(Boolean(normalizedUrlQuery || urlSearchColour));
    setIsBrowsingCollection(false);
    setSubmittedImagePlan(null);
    clearOwnedImagePreviews();
    setSubmittedSearch(
      urlSearchColour
        ? {
            kind: 'colour',
            query: normalizedUrlQuery || getColourSearchText(urlSearchColour),
            facet: urlSearchFacet,
            colour: urlSearchColour,
            refinement: 'local-palette',
          }
        : normalizedUrlQuery
          ? {
              kind: 'text',
              query: normalizedUrlQuery,
              facet: urlSearchFacet,
            }
          : null
    );

    if (!normalizedUrlQuery && !urlSearchColour) {
      setSearchColours([]);
      setSortColours([]);
      setEditorMode('text');
      setSortMode('relevance');
      setSearchFacet(null);
    }
  }, [
    normalizedUrlQuery,
    clearOwnedImagePreviews,
    setSearchParams,
    supersedePendingSearchIntent,
    urlQuery,
    urlSearchColour,
    urlSearchFacet,
  ]);

  useEffect(
    () => () => {
      imagePreviewOwnershipRef.current = teardownImageSearch({
        gate: searchIntentGateRef.current,
        ownership: imagePreviewOwnershipRef.current,
        revokeObjectUrl: (url) => URL.revokeObjectURL(url),
      });
    },
    []
  );

  const textSearchQuery = useQuery({
    queryKey: canSearchOnPage
      ? [
          ...(textSearchPlan?.queryKey || [
            'search',
            'text',
            'disabled',
            publicSearchOrgId,
          ]),
          textSearchExecutionId,
        ]
      : (['search', 'text', 'locked', publicSearchOrgId] as const),
    queryFn: async ({ signal }) => {
      if (!textSearchPlan) return null;
      return preferredRouteId === 'ngs'
        ? apiClient.searchText(
            publicSearchOrgId,
            textSearchPlan.request,
            getAccessToken,
            signal
          )
        : publicSearchText(
            publicSearchOrgId,
            textSearchPlan.request,
            {
              mode: submittedSearch?.kind === 'colour' ? 'colour' : 'text',
              colours: searchColours,
              facet: submittedTextOwner?.facet || undefined,
            },
            signal
          );
    },
    enabled:
      hasMounted &&
      (submittedSearch?.kind === 'text' ||
        submittedSearch?.kind === 'colour') &&
      Boolean(textSearchPlan) &&
      canSearchOnPage,
    retry: false,
    staleTime: isNgsSearch ? 0 : PUBLIC_SEARCH_QUERY_STALE_TIME,
    gcTime: PUBLIC_SEARCH_QUERY_GC_TIME,
    ...getSpotlightSearchSubmissionOptions(spotlightSearchPlaceholder),
    refetchOnMount: Boolean(submittedSearch),
  });

  const imageQueryExecution = buildImageQueryExecution({
    orgId: publicSearchOrgId,
    canonicalQueryKey: submittedImagePlan?.queryKey,
    executionId: imageExecutionId,
    hasMounted,
    canSearchOnPage,
    submittedKind: submittedSearch?.kind || null,
  });
  const imageSearchQuery = useQuery({
    queryKey: imageQueryExecution.queryKey,
    queryFn: async ({ signal }) => {
      if (!submittedImagePlan) return null;
      return isNgsSearch
        ? apiClient.searchImage(
            publicSearchOrgId,
            submittedImagePlan.request,
            getAccessToken
          )
        : publicSearchImage(
            publicSearchOrgId,
            submittedImagePlan.request,
            signal
          );
    },
    enabled: imageQueryExecution.enabled,
    retry: false,
    staleTime: imageQueryExecution.staleTime,
    gcTime: imageQueryExecution.gcTime,
    refetchOnMount: imageQueryExecution.refetchOnMount,
    refetchOnWindowFocus: imageQueryExecution.refetchOnWindowFocus,
    refetchOnReconnect: imageQueryExecution.refetchOnReconnect,
  });

  const browseSort = useMemo(() => getBrowseSort(sortMode), [sortMode]);
  const browseQuery = useInfiniteQuery({
    queryKey: canSearchOnPage
      ? [
          'browse',
          publicSearchOrgId,
          browsePageSize,
          browseSort.sortBy,
          browseSort.sortOrder,
        ]
      : (['browse', 'locked', publicSearchOrgId] as const),
    initialPageParam: 0,
    queryFn: ({ pageParam }) => {
      const request = {
        limit: browsePageSize,
        offset: Number(pageParam),
        sortBy: browseSort.sortBy,
        sortOrder: browseSort.sortOrder,
      };
      return isNgsSearch
        ? authenticatedBrowseCollection(publicSearchOrgId, request)
        : publicBrowseCollection(publicSearchOrgId, request);
    },
    getNextPageParam: (lastPage) =>
      lastPage.hasMore ? lastPage.offset + lastPage.limit : undefined,
    enabled: hasMounted && isBrowsingCollection && canSearchOnPage,
  });

  const activeIdleSuggestion = idleSuggestion || suggestionPool[0] || null;
  const currentQuery =
    submittedSearch?.kind === 'image' ? imageSearchQuery : textSearchQuery;
  const rankedRawResults = currentQuery.data?.results || [];
  const browseRawResults =
    browseQuery.data?.pages.flatMap((page) => page.results) || [];
  const rankedResults = useMemo(
    () => sortResults(rankedRawResults, sortMode, sortColours),
    [rankedRawResults, sortColours, sortMode]
  );
  const sortedBrowseResults = useMemo(
    () => sortResults(browseRawResults, sortMode, sortColours),
    [browseRawResults, sortColours, sortMode]
  );
  const resultSections = useMemo(
    () =>
      buildSearchResultSections({
        isBrowsingCollection,
        rankedResults: isBrowsingCollection
          ? shouldSearch
            ? rankedResults
            : []
          : rankedResults,
        browseResults: sortedBrowseResults,
      }),
    [isBrowsingCollection, rankedResults, shouldSearch, sortedBrowseResults]
  );
  const results = agentBoardResults ?? resultSections.combinedResults;
  const activeSortColours = sortMode === 'colour' ? sortColours : [];
  const visibleRankedResults = resultSections.rankedResults;
  const visibleBrowseResults = isBrowsingCollection
    ? resultSections.browseResults
    : resultSections.browseResults.slice(0, visibleCount);
  const visibleResults =
    agentBoardResults ??
    (isBrowsingCollection
      ? [...visibleRankedResults, ...visibleBrowseResults]
      : visibleBrowseResults);
  const totalBrowseResults =
    browseQuery.data?.pages[0]?.total ?? resultSections.browseResults.length;
  const isLoading =
    hasMounted &&
    (isBrowsingCollection
      ? browseQuery.isLoading && results.length === 0
      : currentQuery.isLoading ||
        (currentQuery.isFetching && !currentQuery.data));
  const displayedSearchError = deriveDisplayedSearchError({
    isBrowsingCollection,
    shouldShowRankedSearch: shouldSearch,
    submittedKind: submittedSearch?.kind || null,
    browseError: browseQuery.error,
    rankedError: currentQuery.error,
  });
  const error = displayedSearchError?.error || null;
  const isNgaQuotaError = isNgaSearchQuotaExhausted(error);
  useEffect(() => {
    if (!isNgaSearch) return;
    const quota = currentQuery.data?.quota;
    if (quota) {
      void reconcileNgaSearchQuota(queryClient, quota);
    }
  }, [currentQuery.data?.quota, isNgaSearch, queryClient]);
  useEffect(() => {
    if (!isNgaSearch) return;
    const quota = getNgaSearchQuotaFromError(error);
    if (quota) {
      void reconcileNgaSearchQuota(queryClient, quota);
    }
  }, [error, isNgaSearch, queryClient]);
  const hasMoreResults = isBrowsingCollection
    ? Boolean(browseQuery.hasNextPage)
    : visibleCount < results.length;
  const shouldWatchMasonryColumnEnds = shouldObserveMasonryColumnEnds({
    hasMoreResults,
    isBrowsingCollection,
    isFetchingNextPage: Boolean(browseQuery.isFetchingNextPage),
    isLoading,
    view,
  });
  const activeSpotlightSuggestionId = useMemo(() => {
    if (!activeIdleSuggestion) return null;

    const spotlightId = activeIdleSuggestion.spotlightId;
    return spotlightId &&
      spotlightBundle?.suggestions.some(
        (suggestion) => suggestion.id === spotlightId
      )
      ? spotlightId
      : null;
  }, [activeIdleSuggestion, spotlightBundle?.suggestions]);
  const idleShowcaseResults = useMemo(
    () =>
      activeSpotlightSuggestionId
        ? selectIdleShowcaseArtworks(
            getSpotlightArtworks(spotlightBundle, activeSpotlightSuggestionId)
          )
        : [],
    [activeSpotlightSuggestionId, spotlightBundle]
  );
  const isIdleShowcaseLoading =
    shouldLoadSpotlights && spotlightBundleQuery.isLoading;
  const visibleIdleSuggestion = displayIdleSuggestion || activeIdleSuggestion;
  const isChungChengFeatureActive =
    !hasActiveSearch && isChungChengFeatureSuggestion(visibleIdleSuggestion);

  useEffect(() => {
    if (!hasMounted) return undefined;

    let context: { revert: () => void } | undefined;
    let cancelled = false;

    void import('gsap').then(({ gsap }) => {
      if (cancelled) return;

      const reduceMotion = window.matchMedia(
        '(prefers-reduced-motion: reduce)'
      ).matches;
      context = gsap.context(() => {
        if (reduceMotion) {
          gsap.set([searchPanelRef.current, idleShowcaseRef.current], {
            clearProps: 'all',
          });
          return;
        }

        const timeline = gsap.timeline({
          defaults: { duration: 0.45, ease: 'power3.out', overwrite: 'auto' },
        });

        timeline.fromTo(
          searchPanelRef.current,
          {
            y: hasActiveSearch ? 16 : -8,
            scale: hasActiveSearch ? 1.015 : 0.99,
          },
          { y: 0, scale: 1 },
          0
        );

        if (hasActiveSearch) {
          timeline.fromTo(
            resultsAreaRef.current,
            { autoAlpha: 0, y: 24 },
            { autoAlpha: 1, y: 0 },
            0.08
          );
        } else {
          timeline.fromTo(
            idleShowcaseRef.current,
            { autoAlpha: 0, y: 28 },
            { autoAlpha: 1, y: 0 },
            0.08
          );
        }
      }, searchPanelRef);
    });

    return () => {
      cancelled = true;
      context?.revert();
    };
  }, [hasActiveSearch, hasMounted]);

  const loadMoreResults = useCallback(() => {
    if (isNgsSearchLocked) return;

    if (isBrowsingCollection) {
      if (browseQuery.hasNextPage && !browseQuery.isFetchingNextPage) {
        void browseQuery.fetchNextPage();
      }
      return;
    }

    setVisibleCount((count) =>
      Math.min(count + SEARCH_DISPLAY_INCREMENT, results.length)
    );
  }, [browseQuery, isBrowsingCollection, isNgsSearchLocked, results.length]);
  const loadMoreMasonryColumnResults = useCallback(() => {
    if (!shouldWatchMasonryColumnEnds) return;

    loadMoreResults();
  }, [loadMoreResults, shouldWatchMasonryColumnEnds]);

  useEffect(() => {
    setVisibleCount(SEARCH_DISPLAY_INCREMENT);
  }, [
    galleryId,
    submittedSearch?.kind === 'image' ? submittedSearch.digest : null,
    minScore,
    sortMode,
    sortColours,
    committedTextQuery,
    searchFacet,
    topK,
    isBrowsingCollection,
  ]);

  useEffect(() => {
    const node = loadMoreRef.current;
    if (
      !node ||
      !hasMoreResults ||
      isLoading ||
      (isBrowsingCollection && browseQuery.isFetchingNextPage)
    ) {
      return undefined;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          loadMoreResults();
        }
      },
      { rootMargin: '600px 0px' }
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [
    browseQuery.isFetchingNextPage,
    hasMoreResults,
    isBrowsingCollection,
    isLoading,
    loadMoreResults,
  ]);

  const rejectImageSelection = useCallback((message: string) => {
    setImageUploadError(message);
    window.requestAnimationFrame(() => uploaderActionRef.current?.focus());
  }, []);

  const onDrop = useCallback(
    async (acceptedFiles: File[]) => {
      if (isSearchDisabled || isPreparingImage) return;
      const validation = validateImageSelection(acceptedFiles);
      if (!validation.ok) {
        rejectImageSelection(validation.message);
        return;
      }

      const file = validation.file;
      const intentToken = beginSearchIntent(searchIntentGateRef.current);
      setImageUploadError(null);
      setIsPreparingImage(true);
      try {
        stageImagePreviewCandidate(file);
      } catch {
        setIsPreparingImage(false);
        rejectImageSelection(
          'The image preview could not be prepared. Choose the file again or try another image.'
        );
        return;
      }

      await settleLatestSearchIntent({
        gate: searchIntentGateRef.current,
        token: intentToken,
        task: buildPublicImageSearchPlan({
          orgId: publicSearchOrgId,
          image: file,
          topK,
          minScore,
          constraints: snapshotAcceptedConstraints(imageDraftConstraints),
        }),
        onSuccess: (plan) => {
          applyImagePreviewTransition({ type: 'promote-candidate' });
          setSelectedArtwork(null);
          setSubmittedImagePlan(plan);
          setImageExecutionId(intentToken);
          setSubmittedSearch({
            kind: 'image',
            file,
            digest: plan.digest,
            constraints: snapshotAcceptedConstraints(plan.request.constraints),
            displayName: file.name || 'uploaded image',
          });
          setEditorMode('image');
          setSearchColours([]);
          setSortColours([]);
          setSortMode('relevance');
          setIsBrowsingCollection(false);
          setShouldSearch(true);
          updateSearchUrl('', null, null, { replace: true });
        },
        onError: () => {
          applyImagePreviewTransition({ type: 'cancel-candidate' });
          rejectImageSelection(
            'The image could not be read. Choose the file again or try another image.'
          );
        },
        onSettled: () => setIsPreparingImage(false),
      });
    },
    [
      applyImagePreviewTransition,
      imageDraftConstraints,
      isSearchDisabled,
      isPreparingImage,
      minScore,
      publicSearchOrgId,
      rejectImageSelection,
      stageImagePreviewCandidate,
      submittedSearch,
      topK,
      updateSearchUrl,
    ]
  );

  const {
    getRootProps,
    getInputProps,
    isDragActive,
    open: openImagePicker,
  } = useDropzone({
    onDrop,
    onDropRejected: (rejections) => {
      const code = rejections[0]?.errors[0]?.code;
      if (code === 'too-many-files') {
        rejectImageSelection('Choose exactly one image.');
      } else if (code === 'file-too-large') {
        rejectImageSelection('Image must be 10 MiB or smaller.');
      } else {
        rejectImageSelection('Image must be a JPEG, PNG, or WebP file.');
      }
    },
    disabled: isSearchDisabled || isPreparingImage,
    accept: {
      'image/jpeg': ['.jpg', '.jpeg'],
      'image/png': ['.png'],
      'image/webp': ['.webp'],
    },
    maxFiles: 1,
    maxSize: 10 * 1024 * 1024,
    multiple: false,
    noClick: true,
  });

  const runTextSearch = (
    query = textQuery,
    facet: SearchFacet | null = null
  ) => {
    if (isSearchDisabled) return;

    const trimmed = query.trim();
    if (!trimmed) return;
    const normalized =
      facet === 'artist'
        ? normalizeArtistSearchQuery(trimmed)
        : normalizeSearchQuery(trimmed);
    if (!normalized) return;

    supersedePendingSearchIntent();
    setSelectedArtwork(null);
    clearOwnedImagePreviews();
    setIsBrowsingCollection(false);
    setEditorMode('text');
    setSearchColours([]);
    setTextQuery(normalized);
    setCommittedTextQuery(normalized);
    setSearchFacet(facet);
    setSubmittedSearch({
      kind: 'text',
      query: normalized,
      facet,
    });
    setSubmittedImagePlan(null);
    setTextSearchExecutionId((value) => value + 1);
    setShouldSearch(true);
    updateSearchUrl(normalized, facet);
  };

  const clearSearch = () => {
    supersedePendingSearchIntent();
    setSelectedArtwork(null);
    clearOwnedImagePreviews();
    setTextQuery('');
    setCommittedTextQuery('');
    setSearchFacet(null);
    setShouldSearch(false);
    setIsBrowsingCollection(false);
    setSubmittedSearch(null);
    setSubmittedImagePlan(null);
    updateSearchUrl('', null, null, { replace: true });
  };

  const removeInterpretationConstraint = (
    key: keyof PublicSearchConstraints
  ) => {
    const interpretation = textSearchQuery.data?.interpretation;
    if (!interpretation) return;
    supersedePendingSearchIntent();
    const nextConstraints = { ...interpretation.constraints };
    delete nextConstraints[key];
    const nextQuery = interpretation.semanticQuery || 'art';
    setTextQuery(nextQuery);
    setCommittedTextQuery(nextQuery);
    setSubmittedSearch({
      kind: 'text',
      query: nextQuery,
      facet: searchFacet,
      explicitConstraints: nextConstraints,
    });
    setShouldSearch(true);
    updateSearchUrl(nextQuery, searchFacet);
  };

  const updateTextDraft = (value: string) => {
    setTextQuery(value);
    setSearchFacet(null);
  };

  const resetSearchHome = () => {
    clearSearch();
    setEditorMode('text');
    setImageDraftConstraints(undefined);
    setImageUploadError(null);
    setSearchColours([]);
    setSortColours([]);
    setSortMode('relevance');
  };

  const clearImage = () => {
    supersedePendingSearchIntent();
    setSelectedArtwork(null);
    clearOwnedImagePreviews();
    setImageUploadError(null);
    setSearchFacet(null);
    setIsBrowsingCollection(false);
    if (submittedSearch?.kind === 'image') {
      setSubmittedSearch(null);
      setSubmittedImagePlan(null);
      setShouldSearch(false);
    }
  };

  const selectColourSearch = (selection: string) => {
    if (isSearchDisabled) return;
    if (!getColourSearchText(selection)) return;

    supersedePendingSearchIntent();
    setSelectedArtwork(null);
    setEditorMode('colour');
    setSearchColours([selection]);
    setSortColours([selection]);
    setSortMode('colour');
    if (submittedSearch || isBrowsingCollection) return;

    const query =
      normalizedCommittedTextQuery || getColourSearchText(selection);
    setTextQuery(query);
    setCommittedTextQuery(query);
    setSubmittedSearch({
      kind: 'colour',
      query,
      facet: searchFacet,
      colour: selection,
      refinement: 'local-palette',
    });
    setShouldSearch(true);
    setTextSearchExecutionId((value) => value + 1);
    updateSearchUrl(normalizedCommittedTextQuery, searchFacet, selection);
  };

  const clearColourSearch = () => {
    supersedePendingSearchIntent();
    setSearchColours([]);
    setSortColours([]);
    setSortMode('relevance');
    setEditorMode(submittedSearch?.kind === 'image' ? 'image' : 'text');

    if (submittedSearch && submittedSearch.kind !== 'colour') return;

    if (normalizedCommittedTextQuery) {
      setSelectedArtwork(null);
      setShouldSearch(true);
      updateSearchUrl(normalizedCommittedTextQuery, searchFacet, null, {
        replace: true,
      });
      return;
    }

    clearSearch();
  };

  const clearColourSort = () => {
    supersedePendingSearchIntent();
    setSortColours([]);
    if (sortMode === 'colour') {
      setSortMode('relevance');
    }
  };

  const clearColourSortTarget = () => {
    supersedePendingSearchIntent();
    setSortColours([]);
  };

  const changeSortMode = (nextSortMode: SortMode) => {
    supersedePendingSearchIntent();
    setSortMode(nextSortMode);
  };

  const runColourSearch = (selection: string) => {
    if (isSearchDisabled) return;
    const active = editorMode === 'colour' && searchColours.includes(selection);
    if (active) {
      clearColourSearch();
      return;
    }

    selectColourSearch(selection);
  };

  const runTargetColourSort = (selection: string) => {
    supersedePendingSearchIntent();
    if (sortMode === 'colour' && sortColours.includes(selection)) {
      setSortColours([]);
      return;
    }

    setSortMode('colour');
    setSortColours([selection]);
  };

  const updateSortCustomColour = (hex: string) => {
    supersedePendingSearchIntent();
    setCustomColour(hex);
    setSortMode('colour');
    setSortColours([`custom:${hex}`]);
  };

  const updateCustomColour = (hex: string) => {
    setCustomColour(hex);
    if (editorMode === 'colour') {
      selectColourSearch(`custom:${hex}`);
    }
  };

  const useArtworkPaletteColour = (hex: string) => {
    if (editorMode === 'colour') {
      updateCustomColour(hex);
      revealColourRail();
      return;
    }

    updateSortCustomColour(hex);
    revealColourRail();
  };

  const showColourRail = editorMode === 'colour' || sortMode === 'colour';
  const colourRailIsSearch = editorMode === 'colour';

  const runEvalSearch = (suggestion: EvalSuggestion) => {
    if (isSearchDisabled) return;

    const suggestionFacet = suggestion.facet || null;
    const suggestionColour =
      suggestion.type === 'colour'
        ? suggestion.colourId || `custom:${suggestion.dot}`
        : null;
    const active =
      committedTextQuery.trim().toLowerCase() ===
        suggestion.query.toLowerCase() &&
      searchFacet === suggestionFacet &&
      (!suggestionColour ||
        (editorMode === 'colour' && searchColours.includes(suggestionColour)));
    if (active) {
      clearSearch();
      if (suggestion.type === 'colour') {
        setSearchColours([]);
        setSortColours([]);
        setSortMode('relevance');
      }
      return;
    }

    if (suggestionColour) {
      const normalized = normalizeSearchQuery(suggestion.query);
      if (!normalized || !getColourSearchText(suggestionColour)) return;

      supersedePendingSearchIntent();
      setSelectedArtwork(null);
      setIsBrowsingCollection(false);
      setEditorMode('colour');
      setSearchColours([suggestionColour]);
      setSortColours([suggestionColour]);
      setSortMode('colour');
      setTextQuery(normalized);
      setCommittedTextQuery(normalized);
      setSearchFacet(suggestionFacet);
      setSubmittedSearch({
        kind: 'colour',
        query: normalized,
        facet: suggestionFacet,
        colour: suggestionColour,
        refinement: 'local-palette',
      });
      setShouldSearch(true);
      setTextSearchExecutionId((value) => value + 1);
      updateSearchUrl(normalized, suggestionFacet, suggestionColour);
      return;
    }

    runTextSearch(suggestion.query, suggestionFacet);
  };

  const rebuildSubmittedImagePlan = async (
    nextTopK: number,
    nextMinScore: number
  ) => {
    if (
      submittedSearch?.kind !== 'image' ||
      isPreparingImage ||
      isSearchDisabled
    )
      return;
    const intentToken = beginSearchIntent(searchIntentGateRef.current);
    setIsPreparingImage(true);
    setImageUploadError(null);
    await settleLatestSearchIntent({
      gate: searchIntentGateRef.current,
      token: intentToken,
      task: buildPublicImageSearchPlan({
        orgId: publicSearchOrgId,
        image: submittedSearch.file,
        topK: nextTopK,
        minScore: nextMinScore,
        constraints: submittedSearch.constraints,
      }),
      onSuccess: (plan) => {
        setSubmittedImagePlan(plan);
        setImageExecutionId(intentToken);
        setTopK(nextTopK);
        setMinScore(nextMinScore);
      },
      onError: () =>
        setImageUploadError(
          'The image could not be read. Choose the file again or try another image.'
        ),
      onSettled: () => setIsPreparingImage(false),
    });
  };

  const updateTopK = (value: number) => {
    if (!Number.isFinite(value)) return;
    const nextTopK = Math.min(
      MAX_SEARCH_RESULTS,
      Math.max(1, Math.round(value))
    );
    if (submittedSearch?.kind === 'image') {
      void rebuildSubmittedImagePlan(nextTopK, minScore);
      return;
    }
    supersedePendingSearchIntent();
    setTopK(nextTopK);
  };

  const updateBrowsePageSize = (value: number) => {
    if (!Number.isFinite(value)) return;
    supersedePendingSearchIntent();
    setBrowsePageSize(
      Math.min(
        MAX_BROWSE_PAGE_SIZE,
        Math.max(MIN_BROWSE_PAGE_SIZE, Math.round(value))
      )
    );
  };

  const updateMinScorePercent = (value: number) => {
    if (!Number.isFinite(value)) return;
    const nextMinScore = Math.min(1, Math.max(0, value / 100));
    if (submittedSearch?.kind === 'image') {
      void rebuildSubmittedImagePlan(topK, nextMinScore);
      return;
    }
    supersedePendingSearchIntent();
    setMinScore(nextMinScore);
  };

  const getSearchInteractionMetadata = useCallback(
    () => ({
      mode: isBrowsingCollection ? 'browse' : submittedSearch?.kind || null,
      query:
        submittedSearch?.kind === 'text' || submittedSearch?.kind === 'colour'
          ? submittedSearch.query
          : null,
      facet:
        submittedSearch?.kind === 'text' || submittedSearch?.kind === 'colour'
          ? submittedSearch.facet
          : null,
      colours: sortColours,
      sortMode,
      view,
      topK,
      minScore,
      pagePath: `${location.pathname}${location.search}${location.hash}`,
    }),
    [
      isBrowsingCollection,
      location.hash,
      location.pathname,
      location.search,
      minScore,
      sortMode,
      sortColours,
      submittedSearch,
      topK,
      view,
    ]
  );

  const getArtworkRank = useCallback(
    (artwork: ArtworkSearchResult) => {
      const index = results.findIndex((result) => result.id === artwork.id);
      return index >= 0 ? index + 1 : null;
    },
    [results]
  );

  const trackArtworkInteraction = useCallback(
    (
      artwork: ArtworkSearchResult,
      type: PublicArtworkInteractionType,
      action: string,
      metadata: Record<string, unknown> = {}
    ) => {
      trackPublicUsageEvent(preferredRouteId, {
        queryType:
          type === 'citation_copy'
            ? 'public_citation_copy'
            : 'public_artwork_interaction',
        orgId: galleryId,
        search: getSearchInteractionMetadata(),
        interaction: {
          type,
          action,
          artworkId: artwork.id,
          orgId: artwork.orgId || artwork.galleryId || galleryId,
          rank: getArtworkRank(artwork),
          score: artwork.similarity,
          metadata: {
            title: getDisplayTitle(artwork),
            artist: getPublicArtist(artwork),
            accessionNumber: getAccession(artwork),
            sourceUrl: getSourceUrl(artwork),
            ...metadata,
          },
        },
        metadata: {
          routeOrgId: preferredRouteId,
          surface: 'search',
        },
      });
    },
    [galleryId, getArtworkRank, getSearchInteractionMetadata, preferredRouteId]
  );

  const selectArtwork = useCallback(
    (artwork: ArtworkSearchResult) => {
      trackArtworkInteraction(artwork, 'click', 'artwork_preview_open');
      setSelectedArtwork(artwork);
    },
    [trackArtworkInteraction]
  );
  const ownershipNotice = searchPresentation.ownershipNotice;
  const interpretation = textSearchQuery.data?.interpretation;
  const interpretationChips = isNgaSearch
    ? getInterpretationChips(interpretation)
    : [];
  const searchEmptyState = getSearchEmptyState(
    isNgaSearch ? interpretation : undefined
  );
  const imageDraftChips = getConstraintChips(imageDraftConstraints);
  const submittedConstraintChips = getSubmittedConstraintChips(submittedSearch);
  const selectedPalette = sortColours[0]
    ? getSelectedColour(sortColours[0])
    : null;
  const retryCurrentSearch = () => {
    if (!canRetryNgaSearch(hasExhaustedNgaSearchQuota)) return;
    const retryTarget = displayedSearchError?.retryTarget || null;
    if (retryTarget === 'browse') {
      void browseQuery.refetch();
    } else if (retryTarget === 'image') {
      void imageSearchQuery.refetch();
    } else if (retryTarget === 'text') {
      void textSearchQuery.refetch();
    }
  };
  const chooseReplacementImage = () => {
    supersedePendingSearchIntent();
    setEditorMode(getEditorModeUpdate('image').editorMode);
    window.requestAnimationFrame(openImagePicker);
  };
  const lowerImageThreshold = async () => {
    if (submittedSearch?.kind !== 'image' || isPreparingImage) return;
    const nextMinScore = Math.max(0, Math.round((minScore - 0.1) * 100) / 100);
    await rebuildSubmittedImagePlan(topK, nextMinScore);
  };

  return (
    // Charcoal, not black. A black page makes the dark passages of a painting
    // dissolve into the background and leaves every work floating in nothing;
    // charcoal gives them an edge to sit against. The token flips with the
    // theme, so this no longer needs the light-mode class overrides that the
    // hard-coded `bg-[#0b0b0e]` did.
    <div className="themeable-surface lt-ground min-h-screen">
      <PublicSiteHeader
        active="search"
        searchHref={searchRoutePath}
        isAuthenticated={isAuthenticated}
        onLogoClick={resetSearchHome}
        onLogin={() => void login({ returnTo: getCurrentReturnTo() })}
        onSignup={() => void signup({ returnTo: getCurrentReturnTo() })}
      />

      <main className="mx-auto max-w-7xl px-5 pb-14 pt-10 lg:px-8">
        <section
          ref={searchPanelRef}
          className={
            hasActiveSearch
              ? 'mx-auto max-w-6xl'
              : 'relative -mx-5 -mt-10 flex min-h-[calc(100vh-3.5rem)] items-center overflow-hidden border-b border-white/[0.08] px-5 py-16 lg:-mx-8 lg:px-8'
          }
        >
          {!hasActiveSearch && hasMounted && (
            <IdleShowcaseBackdrop
              ref={idleShowcaseRef}
              artworks={idleShowcaseResults}
              isLoading={isIdleShowcaseLoading}
              suggestion={activeIdleSuggestion}
              onCommittedSuggestionChange={setDisplayIdleSuggestion}
              onSelectArtwork={selectArtwork}
            />
          )}

          <div
            className={
              hasActiveSearch
                ? 'relative z-10 w-full'
                : `relative z-10 mx-auto w-full max-w-5xl ${
                    isChungChengFeatureActive ? 'py-4 sm:py-6' : 'py-12'
                  }`
            }
          >
            {isChungChengFeatureActive && (
              <ZhongZhengAsciiFeature
                artwork={getChungChengFeaturedArtwork(idleShowcaseResults)}
                isVisible
                onSelectArtwork={selectArtwork}
              />
            )}

            <div className="mb-4 flex flex-wrap items-center justify-center gap-2 font-mono text-[10px] uppercase tracking-[0.3em] text-white/35">
              <span>{gallery.name}</span>
              <span>/</span>
              <span>collection search</span>
              {hasActiveSearch &&
                currentQuery.data?.queryTime !== undefined && (
                  <>
                    <span>/</span>
                    <span>{Math.round(currentQuery.data.queryTime)}ms</span>
                  </>
                )}
            </div>

            <div className="space-y-4">
              {isNgsSearchLocked ? (
                <div className="rounded-lg border border-fuchsia-300/30 bg-fuchsia-300/10 px-4 py-3 text-center">
                  <p className="text-sm font-medium text-fuchsia-100">
                    {searchAccess === 'pending'
                      ? 'NGS search access is pending.'
                      : 'NGS search is private.'}
                  </p>
                  <p className="mt-1 text-xs text-white/70">
                    {searchAccess === 'pending'
                      ? 'Your account is signed in but awaiting approval. No search requests are being sent.'
                      : 'Sign in to access National Gallery Singapore collections.'}
                  </p>
                  {searchAccess === 'anonymous' ? (
                    <button
                      type="button"
                      onClick={() =>
                        void login({ returnTo: getCurrentReturnTo() })
                      }
                      className="mt-2 inline-flex h-8 items-center rounded-md border border-white/20 bg-white/10 px-3 text-xs font-medium text-white transition-colors hover:bg-white/20"
                    >
                      Log in to continue
                    </button>
                  ) : null}
                </div>
              ) : null}

              {isNgaSearch && ngaSearchQuota ? (
                <div
                  role="status"
                  aria-live="polite"
                  className="mx-auto w-fit rounded-full border border-fuchsia-300/25 bg-fuchsia-300/10 px-3 py-1 font-mono text-[10px] uppercase tracking-[0.16em] text-fuchsia-100"
                >
                  {formatNgaSearchQuota(ngaSearchQuota)}
                </div>
              ) : null}
              {hasExhaustedNgaSearchQuota ? (
                <p role="alert" className="text-center text-sm text-amber-100">
                  No free searches remain. This allowance does not reset
                  automatically.
                </p>
              ) : null}

              <div className="flex justify-center">
                <div className="lt-rail items-center gap-1 p-1">
                  <ModeButton
                    active={editorMode === 'text'}
                    icon={Search}
                    label="Text"
                    disabled={isSearchDisabled}
                    onClick={() => {
                      supersedePendingSearchIntent();
                      setEditorMode(getEditorModeUpdate('text').editorMode);
                    }}
                  />
                  <ModeButton
                    active={editorMode === 'image'}
                    icon={ImageIcon}
                    label="Image"
                    disabled={isSearchDisabled}
                    onClick={() => {
                      supersedePendingSearchIntent();
                      setEditorMode(getEditorModeUpdate('image').editorMode);
                      setImageUploadError(null);
                      setImageDraftConstraints(
                        deriveImageDraftConstraints(
                          submittedSearch,
                          textSearchQuery.isSuccess &&
                            !textSearchQuery.isFetching
                            ? textSearchQuery.data?.interpretation
                            : undefined
                        )
                      );
                    }}
                  />
                  <ModeButton
                    active={editorMode === 'colour'}
                    icon={Palette}
                    label="Colour"
                    disabled={isSearchDisabled}
                    onClick={() => {
                      supersedePendingSearchIntent();
                      setEditorMode(getEditorModeUpdate('colour').editorMode);
                      revealColourRail();
                    }}
                  />
                </div>
              </div>

              {editorMode === 'text' && (
                <form
                  className="relative"
                  onSubmit={(event) => {
                    event.preventDefault();
                    runTextSearch();
                  }}
                >
                  <Search
                    className="absolute left-0 top-1/2 h-6 w-6 -translate-y-1/2"
                    style={{ color: 'var(--ink-human-faint)' }}
                  />
                  <input
                    value={textQuery}
                    onChange={(event) => updateTextDraft(event.target.value)}
                    autoFocus
                    placeholder="search by feeling, era, subject..."
                    disabled={isSearchDisabled}
                    className="lt-search-field w-full py-5 pl-10 pr-20 font-wall text-3xl italic sm:pr-36 lg:text-5xl disabled:cursor-not-allowed disabled:opacity-45"
                  />
                  <button
                    type="submit"
                    disabled={isSearchDisabled || !canSubmitTextSearch}
                    className="lt-seg lt-focusable absolute right-0 top-1/2 -translate-y-1/2 justify-center px-3 sm:px-4"
                    data-boxed=""
                    data-catalogue=""
                    aria-label="Search text"
                  >
                    <Search className="h-3.5 w-3.5" />
                    <span className="hidden sm:inline">Search</span>
                  </button>
                </form>
              )}

              {editorMode === 'image' && (
                <div className={IMAGE_SEARCH_COMPOSER_CLASS_NAME}>
                  {ownershipNotice && (
                    <p className="text-center text-xs text-sky-100/75">
                      {ownershipNotice}
                    </p>
                  )}
                  {imageDraftChips.length > 0 &&
                    submittedSearch?.kind !== 'image' && (
                      <div className="flex flex-wrap items-center justify-center gap-2">
                        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-white/40">
                          Filters kept for image search
                        </span>
                        {imageDraftChips.map((chip) => (
                          <button
                            key={`${chip.key}-${chip.label}`}
                            type="button"
                            aria-label={chip.removeLabel}
                            onClick={() => {
                              supersedePendingSearchIntent();
                              setImageDraftConstraints((constraints) =>
                                removeConstraintChip(constraints, chip)
                              );
                            }}
                            className="rounded-full border border-sky-300/25 bg-sky-300/10 px-2.5 py-1 font-mono text-[10px] text-sky-100 transition-colors hover:bg-sky-300/20"
                          >
                            {chip.label} ×
                          </button>
                        ))}
                      </div>
                    )}
                  <div
                    {...getRootProps({
                      role: 'region',
                      'aria-label': 'Image search composer',
                      'aria-describedby': 'image-upload-guidance',
                    })}
                    aria-busy={isPreparingImage}
                    className={`rounded-lg border border-dashed transition-colors ${
                      imagePreview ? 'px-3 py-3' : 'px-5 py-5'
                    } ${
                      isDragActive
                        ? 'border-fuchsia-300 bg-fuchsia-300/10'
                        : isSearchDisabled
                          ? 'border-white/10 bg-white/[0.015] opacity-45'
                          : 'border-white/15 bg-white/[0.025] hover:border-white/30'
                    }`}
                  >
                    <input
                      {...getInputProps({
                        'aria-label': 'Image for visual artwork search',
                        'aria-describedby': 'image-upload-guidance',
                      })}
                    />
                    {imagePreview ? (
                      <div className={IMAGE_SEARCH_PREVIEW_CLASS_NAME}>
                        <img
                          src={imagePreview}
                          alt="Selected image preview"
                          className="h-24 w-24 shrink-0 rounded-md bg-black/25 object-contain"
                        />
                        <div className="min-w-0 flex-1">
                          <p className="break-words text-sm font-medium text-white/80">
                            {imageFile?.name || 'Selected image'}
                          </p>
                          <p className="mt-1 text-xs text-white/45">
                            {isPreparingImage
                              ? 'Preparing visual search…'
                              : imageSearchQuery.isFetching
                                ? 'Finding visually similar works…'
                                : 'Ready for visual matching'}
                          </p>
                        </div>
                        <div className="flex flex-wrap gap-2 sm:justify-end">
                          <button
                            ref={uploaderActionRef}
                            type="button"
                            disabled={isPreparingImage || isSearchDisabled}
                            onClick={openImagePicker}
                            aria-label="Replace image"
                            className="inline-flex h-9 items-center rounded-md border border-white/15 bg-white/[0.06] px-3 text-xs font-medium text-white/70 transition-colors hover:bg-white/[0.12] hover:text-white disabled:cursor-wait disabled:opacity-45"
                          >
                            Replace
                          </button>
                          <button
                            type="button"
                            disabled={isPreparingImage}
                            onClick={clearImage}
                            aria-label="Remove image"
                            className="inline-flex h-9 items-center gap-1.5 rounded-md px-3 text-xs font-medium text-white/50 transition-colors hover:bg-white/[0.08] hover:text-white disabled:cursor-wait disabled:opacity-45"
                          >
                            <X className="h-3.5 w-3.5" /> Remove
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="text-center">
                        <Camera className="mx-auto h-8 w-8 text-white/45" />
                        <button
                          ref={uploaderActionRef}
                          type="button"
                          disabled={isPreparingImage || isSearchDisabled}
                          onClick={openImagePicker}
                          className="mt-3 inline-flex h-10 items-center rounded-md border border-fuchsia-300/30 bg-fuchsia-300/10 px-4 text-sm font-medium text-fuchsia-100 transition-colors hover:bg-fuchsia-300/20 disabled:cursor-not-allowed disabled:opacity-45"
                        >
                          Choose image
                        </button>
                        <p className="mt-2 text-sm text-white/55">
                          or drag and drop one image here
                        </p>
                      </div>
                    )}
                    <p
                      id="image-upload-guidance"
                      className={`${imagePreview ? 'mt-3 text-left sm:ml-28' : 'mt-1 text-center'} font-mono text-[10px] uppercase tracking-[0.18em] text-white/35`}
                    >
                      JPEG, PNG, or WebP · 10 MiB maximum
                    </p>
                  </div>
                  {isPreparingImage && (
                    <p
                      role="status"
                      aria-live="polite"
                      className="text-center text-xs text-white/55"
                    >
                      Preparing image and building its private search digest…
                    </p>
                  )}
                  {imageUploadError && (
                    <p
                      role="alert"
                      className="text-center text-sm text-red-300"
                    >
                      {imageUploadError}
                    </p>
                  )}
                </div>
              )}
            </div>

            {editorMode !== 'image' && (
              <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
                {!hasUncommittedInitialText && editorMode === 'text' && (
                  <SuggestionPicker
                    suggestions={suggestionPool}
                    currentQuery={textQuery}
                    activeSearch={activeSearchSummary}
                    displaySuggestion={displayIdleSuggestion}
                    onSelect={runEvalSearch}
                    onPreviewChange={setIdleSuggestion}
                    disabled={isSearchDisabled}
                  />
                )}
                {!hasActiveSearch && editorMode === 'colour' && (
                  <div ref={colourRailRef} className="w-full">
                    <ColourRail
                      intent="search"
                      selected={searchColours}
                      activeSort={sortMode === 'colour'}
                      customColour={customColour}
                      disabled={isSearchDisabled}
                      onSelect={runColourSearch}
                      onCustomChange={updateCustomColour}
                      onClear={clearColourSearch}
                    />
                  </div>
                )}
              </div>
            )}
          </div>
        </section>

        {/* An agent for visitors who did not bring one. It drives the same
            tools an external WebMCP host would, so the refinement loop —
            "something calm", then "warmer" — is visible without ChatGPT. */}
        <AgentPrompt
          className="mx-auto mt-6 max-w-3xl"
          placeholder="Ask the agent — “something warm for above the sofa”"
        />

        {/* The agent's note is a wall label above the board, not a chat bubble:
            set in the serif, in the agent's ink, with a single rule down the
            side. It says who wrote it by its colour, so it does not have to
            say so in words twice. */}
        {agentBoardNote && (
          <p
            className="lt-wall-label mx-auto mt-6 max-w-3xl border-l pl-4"
            data-hand="agent"
            style={{ borderColor: 'var(--ink-agent)', color: 'var(--ink-agent)' }}
          >
            <span className="lt-catalogue mr-2 block pb-1">
              assembled by the agent
            </span>
            {agentBoardNote}
          </p>
        )}

        {hasActiveSearch && (
          <section
            ref={resultsAreaRef}
            className="mt-8"
            aria-busy={isLoading || isPreparingImage}
          >
            {/* Chrome reduced to hairlines: one rule under the bar, none above,
                and the ground showing through it. */}
            <div
              className="sticky top-14 z-30 -mx-5 border-b px-5 py-3 backdrop-blur-md lg:-mx-8 lg:px-8"
              style={{
                borderColor: 'var(--lt-rule)',
                background:
                  'color-mix(in srgb, var(--lt-ground) 88%, transparent)',
              }}
            >
              <div className="mx-auto max-w-7xl">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="lt-catalogue">
                    {isBrowsingCollection
                      ? isLoading && !results.length
                        ? 'Loading collection'
                        : visibleRankedResults.length
                          ? `${visibleRankedResults.length} ranked + ${visibleBrowseResults.length} / ${totalBrowseResults} browse works`
                          : `${visibleBrowseResults.length} / ${totalBrowseResults} works`
                      : isLoading
                        ? 'Searching'
                        : results.length
                          ? `${visibleResults.length} / ${results.length} works`
                          : hasMounted && shouldSearch
                            ? 'No works'
                            : 'Ready'}
                    {(submittedSearch?.kind === 'text' ||
                      submittedSearch?.kind === 'colour') && (
                      // The human's own words, set in the same serif italic
                      // they were typed in. Wherever an utterance surfaces on
                      // this page it wears the same face, so the eye can tell
                      // what was said from what was counted.
                      <span
                        className="ml-2 font-wall text-[15px] italic normal-case tracking-normal"
                        style={{ color: 'var(--ink-human)' }}
                      >
                        “{submittedSearch.query}”
                      </span>
                    )}
                    {isBrowsingCollection && (
                      <span className="ml-2 normal-case tracking-normal text-white/70">
                        infinite browse
                      </span>
                    )}
                  </p>
                  {(submittedSearch?.kind === 'text' ||
                    submittedSearch?.kind === 'colour') &&
                    interpretation &&
                    (Object.keys(interpretation.constraints).length > 0 ||
                      interpretation.corrections.length > 0 ||
                      interpretationChips.length > 0) && (
                      <div className="flex flex-1 flex-wrap items-center gap-1.5">
                        {interpretation.constraints.dateRange && (
                          <button
                            type="button"
                            aria-label={`Remove date filter ${interpretation.constraints.dateRange.startYear} to ${interpretation.constraints.dateRange.endYear}`}
                            onClick={() =>
                              removeInterpretationConstraint('dateRange')
                            }
                            className="rounded-full border border-amber-300/25 bg-amber-300/10 px-2.5 py-1 font-mono text-[10px] text-amber-100 transition hover:bg-amber-300/20"
                          >
                            {interpretation.constraints.dateRange.startYear ===
                            interpretation.constraints.dateRange.endYear
                              ? interpretation.constraints.dateRange.startYear
                              : `${interpretation.constraints.dateRange.startYear}-${interpretation.constraints.dateRange.endYear}`}{' '}
                            ×
                          </button>
                        )}
                        {interpretation.constraints.classifications?.map(
                          (classification) => (
                            <button
                              key={`classification-${classification}`}
                              type="button"
                              aria-label={`Remove classification filter ${classification}`}
                              onClick={() =>
                                removeInterpretationConstraint(
                                  'classifications'
                                )
                              }
                              className="rounded-full border border-sky-300/25 bg-sky-300/10 px-2.5 py-1 font-mono text-[10px] text-sky-100 transition hover:bg-sky-300/20"
                            >
                              {classification} ×
                            </button>
                          )
                        )}
                        {interpretation.constraints.mediumFamilies?.map(
                          (medium) => (
                            <button
                              key={`medium-${medium}`}
                              type="button"
                              aria-label={`Remove medium filter ${medium}`}
                              onClick={() =>
                                removeInterpretationConstraint('mediumFamilies')
                              }
                              className="rounded-full border border-emerald-300/25 bg-emerald-300/10 px-2.5 py-1 font-mono text-[10px] text-emerald-100 transition hover:bg-emerald-300/20"
                            >
                              {medium} ×
                            </button>
                          )
                        )}
                        {interpretation.constraints.artistIds?.map((artist) => (
                          <button
                            key={`artist-${artist}`}
                            type="button"
                            aria-label={`Remove artist filter ${artist}`}
                            onClick={() =>
                              removeInterpretationConstraint('artistIds')
                            }
                            className="rounded-full border border-violet-300/25 bg-violet-300/10 px-2.5 py-1 font-mono text-[10px] text-violet-100 transition hover:bg-violet-300/20"
                          >
                            {artist} ×
                          </button>
                        ))}
                        {interpretation.corrections.length > 0 && (
                          <span className="font-mono text-[9px] text-white/45">
                            Interpreted{' '}
                            {interpretation.corrections
                              .map(({ from, to }) => `${from} as ${to}`)
                              .join(', ')}
                          </span>
                        )}
                        {interpretationChips.map((chip) => (
                          <span
                            key={chip.key}
                            className="rounded-full border border-violet-300/25 bg-violet-300/10 px-2.5 py-1 font-mono text-[10px] text-violet-100"
                          >
                            {chip.label}
                          </span>
                        ))}
                      </div>
                    )}
                  {submittedSearch?.kind === 'image' &&
                    submittedConstraintChips.length > 0 && (
                      <div
                        className="flex flex-1 flex-wrap items-center gap-1.5"
                        aria-label="Image search filters"
                      >
                        {submittedConstraintChips.map((chip) => (
                          <span
                            key={`${chip.key}-${chip.label}`}
                            className="rounded-full border border-sky-300/25 bg-sky-300/10 px-2.5 py-1 font-mono text-[10px] text-sky-100"
                          >
                            {chip.label}
                          </span>
                        ))}
                      </div>
                    )}
                  {sortColours[0] && (
                    <span className="rounded-full border border-fuchsia-300/25 bg-fuchsia-300/10 px-2.5 py-1 font-mono text-[10px] text-fuchsia-100">
                      Palette order: {selectedPalette?.name || sortColours[0]}
                    </span>
                  )}
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="lt-rail">
                      <span className="lt-rail-legend lt-catalogue">Sort</span>
                      <div className="flex min-w-0 flex-1 items-center gap-1 p-1">
                        {SORT_OPTIONS.map((option) => {
                          const Icon = option.icon;
                          const active =
                            option.id === 'time'
                              ? sortMode === 'time-desc' ||
                                sortMode === 'time-asc'
                              : sortMode === option.id ||
                                SORT_ASC[sortMode] === option.id;
                          const label =
                            option.id === 'time'
                              ? sortMode === 'time-asc'
                                ? 'Oldest'
                                : 'Newest'
                              : option.label;
                          return (
                            <button
                              key={option.id}
                              type="button"
                              disabled={isNgsSearchLocked}
                              onClick={() => {
                                if (isNgsSearchLocked) return;
                                if (option.id === 'time') {
                                  changeSortMode(
                                    sortMode === 'time-desc'
                                      ? 'time-asc'
                                      : 'time-desc'
                                  );
                                  return;
                                }

                                if (option.id === 'colour') {
                                  if (sortMode === 'colour') {
                                    clearColourSort();
                                    return;
                                  }

                                  changeSortMode('colour');
                                  revealColourRail();
                                  return;
                                }

                                if (
                                  sortMode === option.id ||
                                  SORT_ASC[sortMode] === option.id
                                ) {
                                  changeSortMode('relevance');
                                  return;
                                }

                                changeSortMode(option.id);
                              }}
                              title={
                                option.id === 'time'
                                  ? 'Toggle newest or oldest'
                                  : `Sort by ${option.label.toLowerCase()}`
                              }
                              className="lt-seg lt-focusable"
                              data-active={active ? '' : undefined}
                            >
                              <Icon className="h-3.5 w-3.5" />
                              <span className="hidden md:inline">{label}</span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                    <div className="lt-rail">
                      <span className="lt-rail-legend lt-catalogue">View</span>
                      <div className="flex min-w-0 flex-1 items-center gap-1 p-1">
                        {VIEW_OPTIONS.map((option) => {
                          const Icon = option.icon;
                          return (
                            <button
                              key={option.id}
                              type="button"
                              disabled={isNgsSearchLocked}
                              onClick={() => {
                                if (isNgsSearchLocked) return;
                                setView(option.id);
                              }}
                              title={option.label}
                              className="lt-seg lt-focusable"
                              data-active={view === option.id ? '' : undefined}
                            >
                              <Icon className="h-3.5 w-3.5" />
                              <span className="hidden sm:inline">
                                {option.label}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                    <button
                      type="button"
                      disabled={isNgsSearchLocked}
                      onClick={() => {
                        if (isNgsSearchLocked) return;
                        setIsSettingsOpen((value) => !value);
                      }}
                      aria-expanded={isSettingsOpen}
                      aria-label="Search settings"
                      className="lt-seg lt-focusable px-3"
                      data-boxed=""
                      data-active={isSettingsOpen ? '' : undefined}
                    >
                      <SlidersHorizontal className="h-3.5 w-3.5" />
                      <span>Settings</span>
                      {/* The counts are catalogue data, so they are set in the
                          mono face like every other number on the page. */}
                      <span className="lt-catalogue">
                        {isBrowsingCollection
                          ? `${browsePageSize} / infinite`
                          : `${topK} / ${Math.round(minScore * 100)}`}
                      </span>
                    </button>
                  </div>
                </div>

                {isSettingsOpen && (
                  <div className="mt-3 grid gap-4 rounded-lg border border-white/10 bg-black/35 p-3 md:grid-cols-2">
                    <div className="md:col-span-2">
                      <button
                        type="button"
                        disabled={isNgsSearchLocked}
                        onClick={() => {
                          if (isNgsSearchLocked) return;
                          supersedePendingSearchIntent();
                          setIsBrowsingCollection((value) => !value);
                        }}
                        className={`flex w-full items-center justify-between rounded-md border px-3 py-2 text-left transition-colors ${
                          isBrowsingCollection
                            ? 'border-fuchsia-300/35 bg-fuchsia-300/10 text-white'
                            : 'border-white/10 bg-white/[0.035] text-white/65 hover:bg-white/[0.07] hover:text-white'
                        }${isNgsSearchLocked ? ' cursor-not-allowed opacity-45' : ''}`}
                      >
                        <span>
                          <span className="block text-sm font-medium">
                            Infinite browse
                          </span>
                          <span className="mt-0.5 block text-xs text-white/40">
                            Show the full source-backed collection. Ranked
                            matches stay pinned above browse.
                          </span>
                        </span>
                        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-white/45">
                          {isBrowsingCollection ? 'Infinite' : 'Off'}
                        </span>
                      </button>
                    </div>
                    <label className="grid gap-2">
                      <span className="flex items-center justify-between font-mono text-[10px] uppercase tracking-[0.18em] text-white/45">
                        {isBrowsingCollection
                          ? 'Browse page size'
                          : 'Ranked search cap'}
                        <input
                          type="number"
                          min={isBrowsingCollection ? MIN_BROWSE_PAGE_SIZE : 1}
                          max={
                            isBrowsingCollection
                              ? MAX_BROWSE_PAGE_SIZE
                              : MAX_SEARCH_RESULTS
                          }
                          value={isBrowsingCollection ? browsePageSize : topK}
                          disabled={isNgsSearchLocked || isPreparingImage}
                          onChange={(event) =>
                            isBrowsingCollection
                              ? updateBrowsePageSize(Number(event.target.value))
                              : updateTopK(Number(event.target.value))
                          }
                          className={`h-8 w-16 rounded-md border border-white/10 bg-black/20 px-2 text-sm text-white outline-none focus:border-fuchsia-300 ${
                            isNgsSearchLocked || isBrowsingCollection
                              ? 'cursor-not-allowed opacity-45'
                              : ''
                          }`}
                        />
                      </span>
                      <input
                        type="range"
                        min={isBrowsingCollection ? MIN_BROWSE_PAGE_SIZE : 1}
                        max={
                          isBrowsingCollection
                            ? MAX_BROWSE_PAGE_SIZE
                            : MAX_SEARCH_RESULTS
                        }
                        value={isBrowsingCollection ? browsePageSize : topK}
                        onChange={(event) =>
                          isBrowsingCollection
                            ? updateBrowsePageSize(Number(event.target.value))
                            : updateTopK(Number(event.target.value))
                        }
                        disabled={isNgsSearchLocked || isPreparingImage}
                        className="w-full accent-fuchsia-300"
                      />
                    </label>
                    <label
                      className={`grid gap-2 ${isBrowsingCollection ? 'opacity-45' : ''}`}
                    >
                      <span className="flex items-center justify-between font-mono text-[10px] uppercase tracking-[0.18em] text-white/45">
                        Minimum score
                        <input
                          type="number"
                          min={0}
                          max={100}
                          step={5}
                          value={Math.round(minScore * 100)}
                          disabled={
                            isNgsSearchLocked ||
                            isBrowsingCollection ||
                            isPreparingImage
                          }
                          onChange={(event) =>
                            updateMinScorePercent(Number(event.target.value))
                          }
                          className={`h-8 w-16 rounded-md border border-white/10 bg-black/20 px-2 text-sm text-white outline-none focus:border-fuchsia-300 ${
                            isNgsSearchLocked || isBrowsingCollection
                              ? 'cursor-not-allowed opacity-45'
                              : ''
                          }`}
                        />
                      </span>
                      <input
                        type="range"
                        min={0}
                        max={100}
                        step={5}
                        value={Math.round(minScore * 100)}
                        onChange={(event) =>
                          updateMinScorePercent(Number(event.target.value))
                        }
                        disabled={
                          isNgsSearchLocked ||
                          isBrowsingCollection ||
                          isPreparingImage
                        }
                        className="w-full accent-fuchsia-300"
                      />
                    </label>
                  </div>
                )}
              </div>
            </div>

            {showColourRail && (
              <div ref={colourRailRef} className="mt-3">
                <ColourRail
                  intent={colourRailIsSearch ? 'search' : 'sort'}
                  selected={colourRailIsSearch ? searchColours : sortColours}
                  activeSort={sortMode === 'colour'}
                  customColour={customColour}
                  disabled={isSearchDisabled}
                  onSelect={
                    colourRailIsSearch ? runColourSearch : runTargetColourSort
                  }
                  onCustomChange={
                    colourRailIsSearch
                      ? updateCustomColour
                      : updateSortCustomColour
                  }
                  onClear={
                    colourRailIsSearch
                      ? clearColourSearch
                      : clearColourSortTarget
                  }
                />
              </div>
            )}

            {isLoading && (
              <div
                role="status"
                aria-live="polite"
                className="py-16 text-center text-sm text-white/45"
              >
                {submittedSearch?.kind === 'image'
                  ? 'Finding visually similar works…'
                  : 'Searching artworks…'}
              </div>
            )}

            {error && (
              <div role="alert" className="py-16 text-center">
                <p className="text-sm font-medium text-red-300">
                  {isNgaQuotaError
                    ? 'No free searches remain. This allowance does not reset automatically.'
                    : getPublicSearchErrorCopy(
                        error,
                        displayedSearchError?.source === 'ranked' &&
                          submittedSearch?.kind === 'image'
                          ? 'image'
                          : 'text'
                      )}
                </p>
                {!isNgaQuotaError &&
                  canRetryNgaSearch(hasExhaustedNgaSearchQuota) && (
                    <div className="mt-3 flex flex-wrap justify-center gap-2">
                      <button
                        type="button"
                        onClick={retryCurrentSearch}
                        className="inline-flex h-9 items-center rounded-md border border-white/15 bg-white/[0.06] px-3 text-xs font-medium text-white/70 transition-colors hover:bg-white/[0.12] hover:text-white"
                      >
                        Try again
                      </button>
                      {submittedSearch?.kind === 'image' && (
                        <button
                          type="button"
                          onClick={chooseReplacementImage}
                          className="inline-flex h-9 items-center rounded-md px-3 text-xs font-medium text-white/55 transition-colors hover:bg-white/[0.08] hover:text-white"
                        >
                          Replace image
                        </button>
                      )}
                    </div>
                  )}
              </div>
            )}

            {!isLoading && !error && results.length > 0 && (
              <>
                {isBrowsingCollection && visibleRankedResults.length > 0 ? (
                  <>
                    <ResultsView
                      view={view}
                      results={visibleRankedResults}
                      selectedColours={activeSortColours}
                      sortMode={sortMode}
                      showSimilarity
                      onSortModeChange={changeSortMode}
                      onFacetSearch={runTextSearch}
                      onPaletteColourSelect={useArtworkPaletteColour}
                      onSelectArtwork={selectArtwork}
                    />
                    {resultSections.hasBrowseDivider && (
                      <div className="my-6 rounded-lg border border-fuchsia-300/25 bg-fuchsia-300/[0.07] px-4 py-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div>
                            <p className="text-sm font-semibold text-white">
                              Infinite browse begins
                            </p>
                            <p className="mt-0.5 text-xs text-white/45">
                              Ranked search matches stay above this divider.
                            </p>
                          </div>
                          <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-white/40">
                            {visibleBrowseResults.length} / {totalBrowseResults}{' '}
                            browse works
                          </span>
                        </div>
                      </div>
                    )}
                    {visibleBrowseResults.length > 0 && (
                      <ResultsView
                        view={view}
                        results={visibleBrowseResults}
                        selectedColours={activeSortColours}
                        sortMode={sortMode}
                        showSimilarity={false}
                        onMasonryColumnEndVisible={
                          shouldWatchMasonryColumnEnds
                            ? loadMoreMasonryColumnResults
                            : undefined
                        }
                        onSortModeChange={changeSortMode}
                        onFacetSearch={runTextSearch}
                        onPaletteColourSelect={useArtworkPaletteColour}
                        onSelectArtwork={selectArtwork}
                      />
                    )}
                  </>
                ) : (
                  <ResultsView
                    view={view}
                    results={visibleResults}
                    selectedColours={activeSortColours}
                    sortMode={sortMode}
                    showSimilarity={!isBrowsingCollection}
                    onMasonryColumnEndVisible={
                      shouldWatchMasonryColumnEnds
                        ? loadMoreMasonryColumnResults
                        : undefined
                    }
                    onSortModeChange={changeSortMode}
                    onFacetSearch={runTextSearch}
                    onPaletteColourSelect={useArtworkPaletteColour}
                    onSelectArtwork={selectArtwork}
                  />
                )}
                <div ref={loadMoreRef} className="flex justify-center py-8">
                  {hasMoreResults ? (
                    <button
                      type="button"
                      onClick={loadMoreResults}
                      disabled={
                        isNgsSearchLocked ||
                        (isBrowsingCollection && browseQuery.isFetchingNextPage)
                      }
                      className="inline-flex h-10 items-center rounded-md border border-white/10 bg-white/[0.04] px-4 text-xs font-medium text-white/65 transition-colors hover:bg-white/[0.08] hover:text-white disabled:cursor-wait disabled:opacity-50"
                    >
                      {isBrowsingCollection && browseQuery.isFetchingNextPage
                        ? 'Loading more works'
                        : 'Load more works'}
                    </button>
                  ) : (
                    <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-white/30">
                      End of results
                    </p>
                  )}
                </div>
              </>
            )}

            {!isLoading &&
              !error &&
              hasMounted &&
              shouldSearch &&
              results.length === 0 && (
                <div className="py-16 text-center">
                  {isNgsSearchLocked ? (
                    <p className="text-white/55">
                      Sign in to browse and search NGS works.
                    </p>
                  ) : (
                    <>
                      {submittedSearch?.kind === 'image' ? (
                        <>
                          <p className="text-white/55">
                            No visual matches above {Math.round(minScore * 100)}
                            %.
                          </p>
                          <p className="mt-1 text-sm text-white/35">
                            Try another image or lower the similarity threshold.
                          </p>
                          <div className="mt-3 flex flex-wrap justify-center gap-2">
                            <button
                              type="button"
                              onClick={() => void lowerImageThreshold()}
                              disabled={minScore === 0 || isPreparingImage}
                              className="inline-flex h-9 items-center rounded-md border border-white/15 bg-white/[0.06] px-3 text-xs font-medium text-white/70 transition-colors hover:bg-white/[0.12] hover:text-white disabled:opacity-40"
                            >
                              Lower threshold
                            </button>
                            <button
                              type="button"
                              onClick={chooseReplacementImage}
                              className="inline-flex h-9 items-center rounded-md px-3 text-xs font-medium text-white/55 transition-colors hover:bg-white/[0.08] hover:text-white"
                            >
                              Replace image
                            </button>
                          </div>
                        </>
                      ) : (
                        <>
                          <p className="text-white/55">
                            {searchEmptyState.title}
                          </p>
                          <p className="mt-1 text-sm text-white/35">
                            {searchEmptyState.detail}
                          </p>
                        </>
                      )}
                    </>
                  )}
                </div>
              )}
          </section>
        )}
        <PublicSiteFooter separated={hasActiveSearch} />
      </main>
      <SearchArtworkDialog
        artwork={selectedArtwork}
        routeBasePath={publicRouteBasePath}
        returnTo={searchReturnPath}
        onTrackArtworkInteraction={trackArtworkInteraction}
        onSearch={runTextSearch}
        onClose={() => setSelectedArtwork(null)}
      />
    </div>
  );
}

function SuggestionPicker({
  suggestions,
  currentQuery,
  activeSearch,
  displaySuggestion,
  onSelect,
  onPreviewChange,
  disabled = false,
}: {
  suggestions: EvalSuggestion[];
  currentQuery: string;
  activeSearch?: ActiveSearchSummary | null;
  displaySuggestion?: EvalSuggestion | null;
  onSelect: (suggestion: EvalSuggestion) => void;
  onPreviewChange?: (suggestion: EvalSuggestion) => void;
  disabled?: boolean;
}) {
  const [index, setIndex] = useState(0);
  const [open, setOpen] = useState(false);
  const [paused, setPaused] = useState(false);
  const suggestion = suggestions[index] ?? suggestions[0] ?? null;
  const visibleSuggestion = activeSearch
    ? null
    : displaySuggestion || suggestion;

  useEffect(() => {
    if (!suggestions.length) return;
    setIndex((value) => value % suggestions.length);
  }, [suggestions.length]);

  useEffect(() => {
    if (activeSearch || open || paused || suggestions.length < 2) {
      return undefined;
    }

    const handle = window.setInterval(() => {
      setIndex((value) => (value + 1) % suggestions.length);
    }, 9000);

    return () => window.clearInterval(handle);
  }, [activeSearch, open, paused, suggestions.length]);

  useEffect(() => {
    if (activeSearch) return;
    if (suggestion) {
      onPreviewChange?.(suggestion);
    }
  }, [activeSearch, onPreviewChange, suggestion]);

  if (!visibleSuggestion && !activeSearch) return null;

  const activeQuery = currentQuery.trim().toLowerCase();
  const activeLabel = activeSearch?.label.trim();
  const activeStatusLabel = activeSearch
    ? `Current ${activeSearch.type} search: ${activeSearch.label}`
    : undefined;

  return (
    <div
      className="flex min-w-0 items-center overflow-hidden rounded-full border border-white/10 bg-white/[0.04]"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      <span className="shrink-0 border-r border-white/10 px-3 font-mono text-[10px] uppercase tracking-[0.18em] text-white/30">
        {activeSearch ? 'Search' : 'Try'}
      </span>
      {activeSearch ? (
        <div
          className="inline-flex min-w-0 items-center gap-2 bg-white/[0.08] px-3 py-1.5 text-left text-xs text-white transition-colors"
          role="status"
          aria-label={activeStatusLabel}
          aria-live="polite"
        >
          <span
            className="h-2 w-2 shrink-0 rounded-full"
            style={{ background: activeSearch.dot }}
          />
          <span className="shrink-0 font-mono text-[9px] uppercase tracking-[0.14em] text-white/35">
            {activeSearch.type}
          </span>
          <span className="truncate">{activeLabel}</span>
          {activeSearch.detail && (
            <span className="hidden shrink-0 font-mono text-[9px] uppercase tracking-[0.12em] text-white/35 sm:inline">
              {activeSearch.detail}
            </span>
          )}
        </div>
      ) : (
        <button
          type="button"
          data-suggestion-query={visibleSuggestion?.query || ''}
          disabled={disabled}
          onClick={() => {
            if (disabled || !visibleSuggestion) return;
            onSelect(visibleSuggestion);
          }}
          className={`inline-flex min-w-0 items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors ${
            visibleSuggestion &&
            activeQuery === visibleSuggestion.query.toLowerCase()
              ? 'bg-white/[0.12] text-white'
              : 'text-white/70 hover:bg-white/[0.08] hover:text-white'
          }${disabled ? ' cursor-not-allowed opacity-45' : ''}`}
        >
          {visibleSuggestion && (
            <>
              <span
                className="h-2 w-2 shrink-0 rounded-full"
                style={{ background: visibleSuggestion.dot }}
              />
              <span className="shrink-0 font-mono text-[9px] uppercase tracking-[0.14em] text-white/35">
                {visibleSuggestion.type}
              </span>
              <span className="truncate">{visibleSuggestion.label}</span>
              {visibleSuggestion.detail && (
                <span className="hidden shrink-0 font-mono text-[9px] uppercase tracking-[0.12em] text-white/35 sm:inline">
                  {visibleSuggestion.detail}
                </span>
              )}
            </>
          )}
        </button>
      )}
      <DropdownMenu.Root
        open={disabled ? false : open}
        onOpenChange={(nextOpen) => {
          if (disabled) return;
          setOpen(nextOpen);
        }}
      >
        <DropdownMenu.Trigger asChild>
          <button
            type="button"
            disabled={disabled}
            className={`inline-flex h-8 w-8 shrink-0 items-center justify-center border-l border-white/10 text-white/45 transition-colors hover:bg-white/[0.08] hover:text-white ${
              disabled ? 'cursor-not-allowed opacity-45' : ''
            }`}
            aria-label="Choose another suggestion"
          >
            <ChevronDown className="h-3.5 w-3.5" />
          </button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            align="end"
            sideOffset={8}
            className="z-50 max-h-[min(440px,calc(100vh-96px))] w-80 overflow-y-auto rounded-lg border border-white/10 bg-[#151519] p-1.5 shadow-2xl"
          >
            {suggestions.map((option, optionIndex) => (
              <DropdownMenu.Item
                key={getSuggestionKey(option)}
                disabled={disabled}
                onSelect={() => {
                  if (disabled) return;
                  setIndex(optionIndex);
                  onSelect(option);
                }}
                className="flex cursor-pointer items-center gap-2 rounded-md px-2.5 py-2 text-xs text-white/70 outline-none transition-colors focus:bg-white/[0.08] focus:text-white"
              >
                <span
                  className="h-2 w-2 shrink-0 rounded-full"
                  style={{ background: option.dot }}
                />
                <span className="w-16 shrink-0 font-mono text-[9px] uppercase tracking-[0.14em] text-white/35">
                  {option.type}
                </span>
                <span className="min-w-0 flex-1 truncate">{option.label}</span>
                {option.detail && (
                  <span className="shrink-0 font-mono text-[9px] uppercase tracking-[0.12em] text-white/35">
                    {option.detail}
                  </span>
                )}
              </DropdownMenu.Item>
            ))}
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    </div>
  );
}

type ArtworkImageRole = 'thumbnail' | 'large';

const NGS_ARTWORK_ORG_IDS = new Set([
  'ngs',
  'national-gallery-singapore',
  'cf98791d-f3cc-4f9f-b40c-a350efadbd05',
]);

const getImageUrlForArtwork = (
  artwork: ArtworkSearchResult,
  value: string | null | undefined
) =>
  NGS_ARTWORK_ORG_IDS.has(
    String(artwork.orgId || artwork.galleryId || '').toLowerCase()
  )
    ? getAuthenticatedAssetUrl(value)
    : value || null;

const getArtworkImageSources = (
  artwork: ArtworkSearchResult,
  role: ArtworkImageRole
) => {
  const asset = artwork as ArtworkSearchResult & {
    image_url?: string | null;
    thumbnail_url?: string | null;
  };
  const imageUrl = getImageUrlForArtwork(artwork, getPublicImageUrl(asset));
  const thumbnailUrl = getImageUrlForArtwork(
    artwork,
    getPublicThumbnailUrl(asset)
  );

  if (role === 'large') {
    return {
      src: imageUrl || thumbnailUrl,
      fallbackSrc: imageUrl && thumbnailUrl ? thumbnailUrl : null,
    };
  }

  return {
    src: thumbnailUrl || imageUrl,
    fallbackSrc: thumbnailUrl && imageUrl ? imageUrl : null,
  };
};

const getArtworkImageUrl = (
  artwork: ArtworkSearchResult,
  role: ArtworkImageRole
) => getArtworkImageSources(artwork, role).src;

const getShowcaseImageUrl = (artwork?: ArtworkSearchResult | null) =>
  artwork ? getArtworkImageUrl(artwork, 'thumbnail') : null;

const SHOWCASE_TRANSITION_MS = 420;

const preloadShowcaseImage = (src: string) =>
  new Promise<void>((resolve) => {
    const image = new Image();
    let settled = false;

    const finish = () => {
      if (settled) return;
      settled = true;
      resolve();
    };

    const decodeThenFinish = () => {
      if (typeof image.decode === 'function') {
        void image
          .decode()
          .catch(() => undefined)
          .finally(finish);
        return;
      }

      finish();
    };

    image.decoding = 'async';
    image.onload = decodeThenFinish;
    image.onerror = finish;
    image.src = src;

    if (image.complete) {
      decodeThenFinish();
    }
  });

type ShowcaseLayerModel = {
  key: string;
  works: ArtworkSearchResult[];
  suggestion: EvalSuggestion | null;
};

const getShowcaseItems = (works: ArtworkSearchResult[]) =>
  Array.from({ length: 4 }, (_, index) => works[index] ?? null);

type ShowcaseLayoutItem = {
  top?: string;
  right?: string;
  bottom?: string;
  left?: string;
  width: string;
  rotate: number;
  mobile: boolean;
};

const SHOWCASE_LAYOUT: ShowcaseLayoutItem[] = [
  {
    top: '8%',
    left: '7%',
    width: 'clamp(9rem, 15vw, 18rem)',
    rotate: -2,
    mobile: true,
  },
  {
    top: '8%',
    right: '8%',
    width: 'clamp(9rem, 15vw, 18rem)',
    rotate: 2,
    mobile: true,
  },
  {
    bottom: '8%',
    left: '10%',
    width: 'clamp(8rem, 13vw, 16rem)',
    rotate: 1.5,
    mobile: false,
  },
  {
    bottom: '8%',
    right: '11%',
    width: 'clamp(8rem, 13vw, 16rem)',
    rotate: -1.5,
    mobile: false,
  },
];

const IdleShowcaseBackdrop = forwardRef<
  HTMLDivElement,
  {
    artworks: ArtworkSearchResult[];
    isLoading: boolean;
    suggestion: EvalSuggestion | null;
    onCommittedSuggestionChange?: (suggestion: EvalSuggestion | null) => void;
    onSelectArtwork: (artwork: ArtworkSearchResult) => void;
  }
>(function IdleShowcaseBackdrop(
  {
    artworks,
    isLoading,
    suggestion,
    onCommittedSuggestionChange,
    onSelectArtwork,
  },
  ref
) {
  const transitionRunRef = useRef(0);
  const previewWorks = useMemo(() => {
    const imageableWorks = artworks.filter((artwork) =>
      getShowcaseImageUrl(artwork)
    );

    if (isChungChengFeatureSuggestion(suggestion)) {
      return [
        getChungChengFeaturedArtwork(artworks),
        ...imageableWorks
          .filter((artwork) => !isChungChengArtwork(artwork))
          .slice(0, 3),
      ];
    }

    return imageableWorks.slice(0, 4);
  }, [artworks, suggestion]);
  const previewSuggestionKey = suggestion ? getSuggestionKey(suggestion) : '';
  const previewKey = useMemo(() => {
    const artworkKey = previewWorks
      .map((artwork) => `${artwork.id}:${getShowcaseImageUrl(artwork)}`)
      .join('|');
    return `${previewSuggestionKey}::${artworkKey}`;
  }, [previewSuggestionKey, previewWorks]);
  const committedKeyRef = useRef(previewKey);
  const [committedLayer, setCommittedLayer] = useState<ShowcaseLayerModel>(
    () => ({ key: previewKey, works: previewWorks, suggestion })
  );
  const [incomingLayer, setIncomingLayer] = useState<ShowcaseLayerModel | null>(
    null
  );
  const [isCrossfading, setIsCrossfading] = useState(false);
  const [suppressCommittedTransition, setSuppressCommittedTransition] =
    useState(false);

  useEffect(() => {
    onCommittedSuggestionChange?.(committedLayer.suggestion);
  }, [committedLayer.suggestion, onCommittedSuggestionChange]);

  useEffect(() => {
    if (!previewWorks.length) {
      transitionRunRef.current += 1;
      setIncomingLayer(null);
      setIsCrossfading(false);

      if (isLoading) return undefined;

      committedKeyRef.current = '';
      setCommittedLayer({ key: '', works: [], suggestion });
      return undefined;
    }

    if (previewKey === committedKeyRef.current) return undefined;

    let cancelled = false;
    let revealFrame = 0;
    let promoteTimeout = 0;
    let restoreTransitionFrame = 0;
    let restoreTransitionFrameAfterPaint = 0;
    const runId = transitionRunRef.current + 1;
    transitionRunRef.current = runId;

    const transitionToBufferedWorks = async () => {
      setIncomingLayer(null);
      setIsCrossfading(false);
      setSuppressCommittedTransition(false);

      await Promise.allSettled(
        previewWorks
          .map(getShowcaseImageUrl)
          .filter((src): src is string => Boolean(src))
          .map(preloadShowcaseImage)
      );

      if (cancelled || runId !== transitionRunRef.current) return;

      const reduceMotion = window.matchMedia(
        '(prefers-reduced-motion: reduce)'
      ).matches;
      const nextLayer = { key: previewKey, works: previewWorks, suggestion };

      if (reduceMotion) {
        committedKeyRef.current = previewKey;
        setCommittedLayer(nextLayer);
        setIncomingLayer(null);
        setIsCrossfading(false);
        return;
      }

      setIncomingLayer(nextLayer);
      revealFrame = window.requestAnimationFrame(() => {
        if (cancelled || runId !== transitionRunRef.current) return;

        setIsCrossfading(true);
        promoteTimeout = window.setTimeout(() => {
          if (cancelled || runId !== transitionRunRef.current) return;

          committedKeyRef.current = previewKey;
          setSuppressCommittedTransition(true);
          setCommittedLayer(nextLayer);
          setIncomingLayer(null);
          setIsCrossfading(false);
          restoreTransitionFrame = window.requestAnimationFrame(() => {
            if (cancelled || runId !== transitionRunRef.current) return;

            restoreTransitionFrameAfterPaint = window.requestAnimationFrame(
              () => {
                if (cancelled || runId !== transitionRunRef.current) return;

                setSuppressCommittedTransition(false);
              }
            );
          });
        }, SHOWCASE_TRANSITION_MS);
      });
    };

    void transitionToBufferedWorks();

    return () => {
      cancelled = true;
      window.cancelAnimationFrame(revealFrame);
      window.cancelAnimationFrame(restoreTransitionFrame);
      window.cancelAnimationFrame(restoreTransitionFrameAfterPaint);
      window.clearTimeout(promoteTimeout);
    };
  }, [isLoading, previewKey, previewWorks, suggestion]);

  return (
    <div
      ref={ref}
      className="absolute inset-0 overflow-hidden"
      style={{ background: 'var(--lt-ground)' }}
      aria-label="Suggested artworks"
    >
      <div className="pointer-events-none absolute inset-0">
        <IdleShowcaseLayer
          layer={committedLayer}
          isLoading={isLoading}
          isVisible={!incomingLayer || !isCrossfading}
          disableTransition={suppressCommittedTransition}
          layout={SHOWCASE_LAYOUT}
          onSelectArtwork={onSelectArtwork}
        />
        {incomingLayer && (
          <IdleShowcaseLayer
            layer={incomingLayer}
            isLoading={isLoading}
            isVisible={isCrossfading}
            disableTransition={false}
            layout={SHOWCASE_LAYOUT}
            onSelectArtwork={onSelectArtwork}
          />
        )}
      </div>
    </div>
  );
});

function IdleShowcaseLayer({
  layer,
  isLoading,
  isVisible,
  disableTransition = false,
  layout,
  onSelectArtwork,
}: {
  layer: ShowcaseLayerModel;
  isLoading: boolean;
  isVisible: boolean;
  disableTransition?: boolean;
  layout: ShowcaseLayoutItem[];
  onSelectArtwork: (artwork: ArtworkSearchResult) => void;
}) {
  const isChungChengFeature = isChungChengFeatureSuggestion(layer.suggestion);
  const showcaseWorks = isChungChengFeature
    ? layer.works.filter((artwork) => !isChungChengArtwork(artwork))
    : layer.works;
  const showcaseItems = isChungChengFeature
    ? getShowcaseItems(showcaseWorks).filter(
        (artwork): artwork is ArtworkSearchResult => Boolean(artwork)
      )
    : getShowcaseItems(showcaseWorks);

  return (
    <div
      className={`absolute inset-0 ${
        disableTransition
          ? ''
          : 'transition-[opacity,transform] duration-[420ms] ease-out'
      } ${
        isVisible
          ? 'translate-y-0 scale-100 opacity-100'
          : 'translate-y-3 scale-[0.985] opacity-0'
      }`}
      aria-hidden={!isVisible}
      data-showcase-layer={layer.key || 'empty'}
      data-showcase-suggestion={layer.suggestion?.query || ''}
    >
      {showcaseItems.map((artwork, index) => {
        const itemLayout = layout[index];
        const image = artwork
          ? getArtworkImageSources(artwork, 'thumbnail')
          : { src: null, fallbackSrc: null };
        const title = artwork ? getDisplayTitle(artwork) : 'Artwork';
        const artist = artwork ? getPublicArtist(artwork) : null;

        return (
          <button
            key={artwork?.id || `showcase-${index}`}
            type="button"
            data-showcase-work="true"
            disabled={!artwork || !isVisible}
            onClick={() => {
              if (artwork) onSelectArtwork(artwork);
            }}
            className={`group pointer-events-auto absolute flex w-fit justify-center overflow-hidden text-left shadow-2xl outline-none transition-transform duration-300 hover:scale-[1.02] focus-visible:ring-2 focus-visible:ring-fuchsia-300 ${
              itemLayout?.mobile ? '' : 'hidden md:block'
            }`}
            aria-label={`View ${title}`}
            title={
              artwork ? `${title}${artist ? ` - ${artist}` : ''}` : undefined
            }
            style={{
              top: itemLayout?.top,
              right: itemLayout?.right,
              bottom: itemLayout?.bottom,
              left: itemLayout?.left,
              maxWidth: itemLayout?.width,
              transform: `rotate(${itemLayout?.rotate || 0}deg)`,
            }}
          >
            {image.src ? (
              <span className="relative block w-fit max-w-full overflow-hidden">
                <ImageWithFallback
                  src={image.src}
                  fallbackSrc={image.fallbackSrc}
                  alt=""
                  protectFromDownload
                  loading="eager"
                  decoding="async"
                  className="block max-w-full object-contain"
                  style={{ height: 'min(22vh, 20rem)', width: 'auto' }}
                  fallback={
                    <div
                      className={`aspect-[4/5] w-full border border-white/[0.08] bg-white/[0.05] ${
                        isLoading ? 'animate-pulse' : ''
                      }`}
                    />
                  }
                />
                <span className="pointer-events-none absolute inset-x-0 bottom-0 min-w-0 max-w-full overflow-hidden bg-gradient-to-t from-black/90 via-black/55 to-transparent px-3 pb-3 pt-16 opacity-95 transition duration-200 group-hover:opacity-100 group-focus-visible:opacity-100">
                  <span className="line-clamp-2 max-w-full whitespace-normal break-words text-xs font-semibold leading-tight text-white drop-shadow [overflow-wrap:anywhere]">
                    {title}
                  </span>
                  {artist && (
                    <span className="mt-1 block max-w-full overflow-hidden text-ellipsis whitespace-nowrap text-[11px] font-medium leading-tight text-white/72 drop-shadow">
                      {artist}
                    </span>
                  )}
                </span>
              </span>
            ) : (
              <div
                className={`aspect-[4/5] w-full border border-white/[0.08] bg-white/[0.05] ${
                  isLoading ? 'animate-pulse' : ''
                }`}
              />
            )}
          </button>
        );
      })}
    </div>
  );
}

const ZHONG_ZHENG_MATRIX_GLYPHS = ['中', '正', '人', '仁', '學', '德'] as const;
const ZHONG_ZHENG_MASK_WIDTH = 360;
const ZHONG_ZHENG_MASK_COLUMNS = 64;
const ZHONG_ZHENG_MASK_MAX_PARTICLES = 680;
const ZHONG_ZHENG_POINTER_FRAME_MARGIN_PERCENT = 3.5;
const ZHONG_ZHENG_POINTER_PARTICLE_RADIUS_PERCENT = 7.5;
const ZHONG_ZHENG_POINTER_CORE_RADIUS_PERCENT = 12;

const getHighResolutionNow = () =>
  typeof performance !== 'undefined' ? performance.now() : Date.now();

type ZhongZhengMaskState = {
  particles: ZhongZhengAsciiParticle[];
};

const getDominantAlphaComponent = (
  alpha: Uint8ClampedArray,
  width: number,
  height: number
) => {
  const visited = new Uint8Array(width * height);
  const componentIds = new Int32Array(width * height);
  componentIds.fill(-1);
  const queue = new Int32Array(width * height);
  const componentWeights: number[] = [];
  const minAlpha = 34;
  let componentId = 0;

  for (let index = 0; index < alpha.length; index += 1) {
    if (visited[index] || (alpha[index] ?? 0) < minAlpha) continue;

    let head = 0;
    let tail = 0;
    let weight = 0;
    visited[index] = 1;
    queue[tail++] = index;

    while (head < tail) {
      const current = queue[head++] ?? 0;
      const x = current % width;
      const y = Math.floor(current / width);
      componentIds[current] = componentId;
      weight += alpha[current] || 0;

      const neighbors: number[] = [
        x > 0 ? current - 1 : -1,
        x < width - 1 ? current + 1 : -1,
        y > 0 ? current - width : -1,
        y < height - 1 ? current + width : -1,
      ];

      neighbors.forEach((neighbor) => {
        if (
          neighbor >= 0 &&
          !visited[neighbor] &&
          (alpha[neighbor] || 0) >= minAlpha
        ) {
          visited[neighbor] = 1;
          queue[tail++] = neighbor;
        }
      });
    }

    componentWeights[componentId] = weight;
    componentId += 1;
  }

  const dominantComponent = componentWeights.reduce(
    (strongest, weight, index) =>
      weight > strongest.weight ? { id: index, weight } : strongest,
    { id: -1, weight: 0 }
  );

  return { componentIds, dominantComponentId: dominantComponent.id };
};

const extractZhongZhengMaskFromImage = (
  image: HTMLImageElement
): ZhongZhengMaskState | null => {
  const naturalWidth = image.naturalWidth || image.width;
  const naturalHeight = image.naturalHeight || image.height;
  if (!naturalWidth || !naturalHeight) return null;

  const width = ZHONG_ZHENG_MASK_WIDTH;
  const height = Math.round((width * naturalHeight) / naturalWidth);
  const sourceCanvas = document.createElement('canvas');
  sourceCanvas.width = width;
  sourceCanvas.height = height;
  const sourceContext = sourceCanvas.getContext('2d', {
    willReadFrequently: true,
  });
  if (!sourceContext) return null;

  sourceContext.drawImage(image, 0, 0, width, height);

  const imageData = sourceContext.getImageData(0, 0, width, height);
  const rawAlpha = new Uint8ClampedArray(width * height);

  for (let index = 0; index < rawAlpha.length; index += 1) {
    const dataIndex = index * 4;
    const red = imageData.data[dataIndex] || 0;
    const green = imageData.data[dataIndex + 1] || 0;
    const blue = imageData.data[dataIndex + 2] || 0;
    const luma = red * 0.2126 + green * 0.7152 + blue * 0.0722;
    const ink = clampNumber((248 - luma) / 78, 0, 1);
    rawAlpha[index] =
      ink < 0.09 ? 0 : Math.round(clampNumber(ink * 1.32, 0, 1) * 255);
  }

  const { componentIds, dominantComponentId } = getDominantAlphaComponent(
    rawAlpha,
    width,
    height
  );
  if (dominantComponentId < 0) return null;

  const alpha = new Uint8ClampedArray(width * height);

  for (let index = 0; index < alpha.length; index += 1) {
    const currentAlpha =
      componentIds[index] === dominantComponentId ? rawAlpha[index] || 0 : 0;
    const left = index % width > 0 ? rawAlpha[index - 1] || 0 : currentAlpha;
    const right =
      index % width < width - 1 ? rawAlpha[index + 1] || 0 : currentAlpha;
    const top = index >= width ? rawAlpha[index - width] || 0 : currentAlpha;
    const bottom =
      index < alpha.length - width
        ? rawAlpha[index + width] || 0
        : currentAlpha;
    const softenedAlpha = Math.round(
      currentAlpha * 0.78 + ((left + right + top + bottom) / 4) * 0.22
    );
    alpha[index] = currentAlpha > 0 ? softenedAlpha : 0;
  }

  return {
    particles: buildZhongZhengMaskParticles({
      width,
      height,
      alpha,
      columns: ZHONG_ZHENG_MASK_COLUMNS,
      rows: Math.round((ZHONG_ZHENG_MASK_COLUMNS * height) / width),
      maxParticles: ZHONG_ZHENG_MASK_MAX_PARTICLES,
    }),
  };
};

function ZhongZhengAsciiFeature({
  artwork,
  isVisible,
  onSelectArtwork,
}: {
  artwork: ArtworkSearchResult;
  isVisible: boolean;
  onSelectArtwork: (artwork: ArtworkSearchResult) => void;
}) {
  const fallbackParticles = useMemo(() => buildZhongZhengAsciiParticles(), []);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const stageRef = useRef<HTMLSpanElement | null>(null);
  const [clock, setClock] = useState(0);
  const [entranceStartedAt, setEntranceStartedAt] = useState<number | null>(
    null
  );
  const [pointer, setPointerState] = useState({
    x: 50,
    y: 46,
    active: false,
  });
  const [maskState, setMaskState] = useState<ZhongZhengMaskState | null>(null);
  const [maskLoadFailed, setMaskLoadFailed] = useState(false);
  const particles =
    maskState?.particles ?? (maskLoadFailed ? fallbackParticles : []);
  const pointerRef = useRef(pointer);
  const title = getDisplayTitle(artwork);
  const setPointer = useCallback(
    (nextPointer: { x: number; y: number; active: boolean }) => {
      pointerRef.current = nextPointer;
      setPointerState(nextPointer);
    },
    []
  );
  const deactivatePointer = useCallback(() => {
    const currentPointer = pointerRef.current;
    if (currentPointer.active) {
      setPointer({ ...currentPointer, active: false });
    }
  }, [setPointer]);

  useEffect(() => {
    let cancelled = false;
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.onload = () => {
      try {
        const nextMaskState = extractZhongZhengMaskFromImage(image);
        if (!cancelled && nextMaskState) {
          setMaskState(nextMaskState);
          setMaskLoadFailed(false);
        } else if (!cancelled) {
          setMaskLoadFailed(true);
        }
      } catch {
        if (!cancelled) {
          setMaskLoadFailed(true);
        }
      }
    };
    image.onerror = () => {
      if (!cancelled) {
        setMaskLoadFailed(true);
      }
    };
    image.src = CHUNG_CHENG_STATUE_MASK_IMAGE_URL;

    return () => {
      cancelled = true;
      image.onload = null;
      image.onerror = null;
    };
  }, []);

  useEffect(() => {
    let animationFrame = 0;
    let lastTick = 0;
    const startedAt = getHighResolutionNow();
    setEntranceStartedAt(startedAt);
    setClock(startedAt);

    const tick = (timestamp: number) => {
      if (timestamp - lastTick > 40) {
        lastTick = timestamp;
        setClock(timestamp);
      }
      animationFrame = window.requestAnimationFrame(tick);
    };

    animationFrame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(animationFrame);
  }, []);

  useEffect(() => {
    if (particles.length === 0) return;

    const startedAt = getHighResolutionNow();
    setEntranceStartedAt(startedAt);
    setClock(startedAt);
  }, [particles.length]);

  useEffect(() => {
    const handleWindowPointerMove = (event: WindowEventMap['pointermove']) => {
      if (!pointerRef.current.active) return;

      const rect = buttonRef.current?.getBoundingClientRect();
      if (!rect) return;

      const isInside =
        event.clientX >= rect.left &&
        event.clientX <= rect.right &&
        event.clientY >= rect.top &&
        event.clientY <= rect.bottom;

      if (!isInside) deactivatePointer();
    };

    window.addEventListener('pointermove', handleWindowPointerMove, {
      passive: true,
    });
    return () =>
      window.removeEventListener('pointermove', handleWindowPointerMove);
  }, [deactivatePointer]);

  const handlePointerMove = useCallback(
    (event: PointerEvent<HTMLButtonElement>) => {
      const rect =
        stageRef.current?.getBoundingClientRect() ||
        event.currentTarget.getBoundingClientRect();
      const rawX = ((event.clientX - rect.left) / rect.width) * 100;
      const rawY = ((event.clientY - rect.top) / rect.height) * 100;

      const isNearFrame =
        rawX >= -ZHONG_ZHENG_POINTER_FRAME_MARGIN_PERCENT &&
        rawX <= 100 + ZHONG_ZHENG_POINTER_FRAME_MARGIN_PERCENT &&
        rawY >= -ZHONG_ZHENG_POINTER_FRAME_MARGIN_PERCENT &&
        rawY <= 100 + ZHONG_ZHENG_POINTER_FRAME_MARGIN_PERCENT;

      if (!isNearFrame || particles.length === 0) {
        deactivatePointer();
        return;
      }

      const nextX = clampNumber(rawX, 0, 100);
      const nextY = clampNumber(rawY, 0, 100);
      const nearestParticleDistance = particles.reduce(
        (nearestDistance, particle) =>
          Math.min(
            nearestDistance,
            Math.sqrt((particle.x - nextX) ** 2 + (particle.y - nextY) ** 2)
          ),
        Infinity
      );

      if (
        nearestParticleDistance > ZHONG_ZHENG_POINTER_PARTICLE_RADIUS_PERCENT
      ) {
        deactivatePointer();
        return;
      }

      setPointer({ x: nextX, y: nextY, active: true });
    },
    [deactivatePointer, particles, setPointer]
  );

  return (
    <button
      type="button"
      ref={buttonRef}
      disabled={!isVisible}
      onClick={() => onSelectArtwork(artwork)}
      onPointerMove={handlePointerMove}
      onPointerLeave={deactivatePointer}
      onPointerCancel={deactivatePointer}
      onLostPointerCapture={deactivatePointer}
      onBlur={deactivatePointer}
      className="chung-cheng-ascii-button group pointer-events-auto relative mx-auto mb-8 flex w-[min(94vw,72rem)] flex-col items-center text-center outline-none focus-visible:ring-2 focus-visible:ring-cyan-200/70 disabled:pointer-events-none disabled:opacity-60 lg:mb-10"
      aria-label={`View ${title} artwork details`}
      data-pointer-active={pointer.active ? 'true' : 'false'}
      data-particle-source={maskState ? 'image-alpha-mask' : 'ascii-fallback'}
    >
      <span className="chung-cheng-ascii-stage relative block h-[clamp(24rem,56vh,39rem)] w-full max-w-[58rem] sm:h-[clamp(27rem,60vh,42rem)]">
        <span
          ref={stageRef}
          className="chung-cheng-ascii-statue-frame absolute left-1/2 top-0 block aspect-[1539/2048] w-[min(76vw,25rem)] -translate-x-1/2 sm:w-[min(58vw,27rem)]"
        >
          <span className="chung-cheng-ascii-statue-orbit absolute inset-0 block">
            <span className="chung-cheng-ascii-statue absolute inset-0 block">
              {particles.map((particle) => {
                const pointerDistance = pointer.active
                  ? Math.sqrt(
                      (particle.x - pointer.x) ** 2 +
                        (particle.y - pointer.y) ** 2
                    )
                  : Infinity;
                const pointerCore = pointer.active
                  ? Math.max(
                      0,
                      1 -
                        (pointerDistance /
                          ZHONG_ZHENG_POINTER_CORE_RADIUS_PERCENT) **
                          1.45
                    )
                  : 0;
                const influence = clampNumber(pointerCore, 0, 1);
                const entranceProgress =
                  entranceStartedAt === null
                    ? 0
                    : clampNumber(
                        (clock -
                          entranceStartedAt -
                          (particle.y * 4.8 + (particle.phase % 95))) /
                          680,
                        0,
                        1
                      );
                const entranceEase =
                  1 - (1 - entranceProgress) * (1 - entranceProgress);
                const matrixIndex =
                  Math.floor(
                    particle.phase +
                      pointer.x * 0.17 +
                      pointer.y * 0.11 +
                      influence * 9
                  ) % ZHONG_ZHENG_MATRIX_GLYPHS.length;
                const matrixGlyph =
                  ZHONG_ZHENG_MATRIX_GLYPHS[matrixIndex] || particle.zh;
                const isMorphed = influence > 0.57;
                const isMatrix = influence > 0.22;
                const wave =
                  ((particle.phase +
                    particle.z * 2 +
                    pointer.x * 0.28 +
                    pointer.y * 0.18) *
                    Math.PI) /
                  180;
                const waveX = Math.cos(wave) * influence * 7;
                const waveY = Math.sin(wave * 1.18) * influence * 9;
                const pointerParallaxX = pointer.active
                  ? (pointer.x - 50) * particle.z * 0.006
                  : 0;
                const pointerParallaxY = pointer.active
                  ? (pointer.y - 50) * particle.z * 0.0035
                  : 0;
                const scale =
                  (particle.scale + influence * 0.28) *
                  (0.88 + entranceEase * 0.12);
                const opacity =
                  clampNumber(
                    0.18 + particle.shade * 0.34 + influence * 0.3,
                    0.22,
                    0.9
                  ) * entranceEase;
                const entranceY = (1 - entranceEase) * 10;

                return (
                  <span
                    key={particle.id}
                    aria-hidden="true"
                    className="chung-cheng-ascii-particle absolute font-mono text-[clamp(4.2px,1.16vw,7.2px)] font-semibold leading-none tracking-normal"
                    data-effect={
                      isMorphed ? 'morphed' : isMatrix ? 'matrix' : 'base'
                    }
                    style={{
                      left: `${particle.x}%`,
                      top: `${particle.y}%`,
                      opacity,
                      transform: `translate3d(calc(-50% + ${(
                        waveX + pointerParallaxX
                      ).toFixed(2)}px), calc(-50% + ${(
                        waveY +
                        pointerParallaxY +
                        entranceY
                      ).toFixed(2)}px), ${(particle.z + influence * 28).toFixed(
                        2
                      )}px) scale(${scale.toFixed(3)})`,
                    }}
                  >
                    {isMorphed
                      ? particle.zh
                      : isMatrix
                        ? matrixGlyph
                        : particle.en}
                  </span>
                );
              })}
            </span>
          </span>
        </span>
      </span>
      <span className="mt-4 flex max-w-full flex-wrap items-center justify-center gap-x-3 gap-y-1 font-mono text-[10px] uppercase tracking-[0.18em] text-white/40">
        <span className="truncate">Zhong Zheng Ren</span>
        <span className="text-white/25">/</span>
        <span>中正人</span>
        <span className="text-white/25">/</span>
        <span>2019-00754</span>
      </span>
    </button>
  );
}

function SearchArtworkDialog({
  artwork,
  routeBasePath,
  returnTo,
  onTrackArtworkInteraction,
  onSearch,
  onClose,
}: {
  artwork: ArtworkSearchResult | null;
  routeBasePath: string;
  returnTo: string;
  onTrackArtworkInteraction: (
    artwork: ArtworkSearchResult,
    type: PublicArtworkInteractionType,
    action: string,
    metadata?: Record<string, unknown>
  ) => void;
  onSearch: (query: string, facet?: SearchFacet | null) => void;
  onClose: () => void;
}) {
  const image = artwork
    ? getArtworkImageSources(artwork, 'large')
    : { src: null, fallbackSrc: null };
  const descriptionDetailsList = artwork
    ? getPublicDescriptionDetailList(artwork)
    : [];
  const rootsDescriptionDetails = descriptionDetailsList[0] || null;
  const caption = artwork ? getGeneratedCaptionText(artwork) : null;
  const generatedCaptionDetails = artwork
    ? getGeneratedCaptionDetails(artwork)
    : [];
  const catalogueGroups = artwork ? getPublicCatalogueRowGroups(artwork) : [];
  const ngsUrl = artwork ? getNgsUrl(artwork) : null;
  const rootsUrl = artwork ? getRootsUrl(artwork) : null;
  const title = artwork ? getDisplayTitle(artwork) : 'Untitled';
  const artist = artwork ? getPublicArtist(artwork) : null;

  return (
    <Dialog.Root
      open={Boolean(artwork)}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm" />
        {artwork && (
          <Dialog.Content className="themeable-surface fixed left-1/2 top-1/2 z-50 grid max-h-[92dvh] w-[calc(100vw-1rem)] max-w-6xl -translate-x-1/2 -translate-y-1/2 grid-rows-[minmax(280px,48dvh)_minmax(0,1fr)] overflow-hidden rounded-lg border border-white/10 bg-[#101014] shadow-2xl outline-none xl:h-[min(86dvh,780px)] xl:grid-cols-[minmax(0,1.05fr)_minmax(380px,0.95fr)] xl:grid-rows-none">
            <Dialog.Description className="sr-only">
              Source-labelled catalogue text, public fields, and generated
              caption for the selected artwork.
            </Dialog.Description>
            <div className="flex min-h-0 min-w-0 flex-col bg-black/35 p-4">
              <div className="flex min-h-0 flex-1 items-center justify-center">
                <ImageWithFallback
                  src={image.src}
                  fallbackSrc={image.fallbackSrc}
                  alt={title}
                  protectFromDownload
                  className="max-h-full w-full object-contain"
                  fallback={
                    <NoImagePlaceholder className="min-h-48 rounded-md text-white/25" />
                  }
                />
              </div>
              <div className="mt-3 shrink-0 space-y-3">
                {image.src && <ImageReuseNotice compact />}
                <div className="flex flex-wrap gap-2">
                  <Link
                    to={`${routeBasePath}/artworks/${encodeURIComponent(
                      artwork.id
                    )}?from=${encodeURIComponent(returnTo)}`}
                    onClick={() =>
                      onTrackArtworkInteraction(
                        artwork,
                        'click',
                        'artwork_full_page_open'
                      )
                    }
                    className="inline-flex h-9 max-w-full items-center gap-2 rounded-md bg-white px-3 text-xs font-semibold text-black transition-opacity hover:opacity-85"
                  >
                    <span className="truncate">Open full page</span>
                  </Link>
                  {ngsUrl && (
                    <RequestImageUseLink
                      className="h-9"
                      onClick={() =>
                        onTrackArtworkInteraction(
                          artwork,
                          'click',
                          'image_permission_request',
                          { source: 'ngs', surface: 'search_dialog' }
                        )
                      }
                    />
                  )}
                  {ngsUrl && (
                    <PublicRecordLink
                      href={ngsUrl}
                      label="National Gallery Singapore record"
                      onClick={() =>
                        onTrackArtworkInteraction(
                          artwork,
                          'click',
                          'source_record_open',
                          { source: 'ngs' }
                        )
                      }
                    />
                  )}
                  {rootsUrl && (
                    <PublicRecordLink
                      href={rootsUrl}
                      label="Roots NHB record"
                      onClick={() =>
                        onTrackArtworkInteraction(
                          artwork,
                          'click',
                          'source_record_open',
                          { source: 'roots' }
                        )
                      }
                    />
                  )}
                </div>
              </div>
            </div>
            <div className="min-h-0 overflow-y-auto p-5 md:p-6">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-white/35">
                    Artwork
                  </p>
                  <Dialog.Title className="mt-2 font-display text-2xl font-semibold leading-tight text-white md:text-3xl">
                    {title}
                  </Dialog.Title>
                  {artist && (
                    <button
                      type="button"
                      onClick={() => {
                        onTrackArtworkInteraction(
                          artwork,
                          'click',
                          'artist_search',
                          { artist }
                        );
                        onSearch(artist, 'artist');
                      }}
                      className="mt-2 block text-left text-sm text-white/60 underline decoration-white/20 underline-offset-4 transition-colors hover:text-cyan-100 hover:decoration-cyan-100/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-200/60"
                      title={`Search ${artist}`}
                    >
                      {artist}
                    </button>
                  )}
                </div>
                <Dialog.Close asChild>
                  <button
                    type="button"
                    className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-white/10 text-white/50 transition-colors hover:bg-white/[0.08] hover:text-white"
                    aria-label="Close artwork details"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </Dialog.Close>
              </div>

              {/* A description is only assistive if it can be heard. The
                  browser's own speech synthesis needs no agent and no account,
                  so this works for the visitor who most needs it. */}
              {(rootsDescriptionDetails || caption) && (
                <SpeakButton
                  className="mt-6"
                  label="Read this aloud"
                  text={caption || rootsDescriptionDetails?.text || ''}
                />
              )}

              {(rootsDescriptionDetails || caption) && (
                <CaptionSourceToggle
                  className="mt-4"
                  rootsCaption={
                    rootsDescriptionDetails
                      ? {
                          text: rootsDescriptionDetails.text,
                          sourceLabel: rootsDescriptionDetails.sourceLabel,
                        }
                      : null
                  }
                  generatedCaption={
                    caption
                      ? {
                          text: caption,
                          sourceLabel: 'Generated by Paillette AI',
                          details: generatedCaptionDetails,
                        }
                      : null
                  }
                />
              )}

              {catalogueGroups.length > 0 && (
                <MetadataSourceToggle
                  className="mt-6"
                  groups={catalogueGroups}
                  getSearchHref={(label, value) => {
                    const searchQuery = getCatalogueRowSearchQuery(
                      label,
                      value
                    );
                    const facet = getCatalogueRowSearchFacet(label);
                    return searchQuery
                      ? `${routeBasePath}/search?${new URLSearchParams(
                          getSearchParamsForQuery(
                            facet === 'artist'
                              ? normalizeArtistSearchQuery(searchQuery)
                              : normalizeSearchQuery(searchQuery),
                            facet
                          )
                        ).toString()}`
                      : null;
                  }}
                  onSearchLinkClick={onClose}
                />
              )}

              <CitationPanel
                artwork={artwork}
                className="mt-6"
                onCopyCitation={(copyMetadata) =>
                  onTrackArtworkInteraction(
                    artwork,
                    'citation_copy',
                    'citation_copy',
                    {
                      surface: 'search_dialog',
                      ...copyMetadata,
                    }
                  )
                }
              />
            </div>
          </Dialog.Content>
        )}
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function PublicRecordLink({
  href,
  label,
  onClick,
}: {
  href: string;
  label: string;
  onClick?: () => void;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      onClick={onClick}
      className="inline-flex h-9 max-w-full items-center gap-2 rounded-md border border-white/10 bg-white/[0.05] px-3 text-xs font-medium text-cyan-100/75 transition-colors hover:bg-white/[0.09] hover:text-cyan-100"
    >
      <span className="truncate">{label}</span>
      <ExternalLink className="h-3.5 w-3.5 shrink-0" />
    </a>
  );
}

function ColourRail({
  intent,
  selected,
  activeSort,
  customColour,
  disabled = false,
  onSelect,
  onCustomChange,
  onClear,
}: {
  intent: 'search' | 'sort';
  selected: string[];
  activeSort: boolean;
  customColour: string;
  disabled?: boolean;
  onSelect: (id: string) => void;
  onCustomChange: (hex: string) => void;
  onClear: () => void;
}) {
  const activeColour = selected[0] ? getSelectedColour(selected[0]) : null;
  const emptyStatus =
    intent === 'search'
      ? 'Choose a colour'
      : activeSort
        ? 'Spectrum order'
        : 'Off';
  const detailText = activeColour
    ? intent === 'search'
      ? `Search ${activeColour.name}`
      : `Nearest ${activeColour.name}`
    : emptyStatus;

  return (
    <div className="border-b border-white/[0.07] pb-3">
      <div className="grid gap-3 lg:grid-cols-[auto_minmax(0,1fr)_auto] lg:items-center">
        <div className="flex min-w-0 items-center gap-3">
          <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-white/35">
            Colour
          </span>
          <span className="inline-flex h-8 items-center rounded-md bg-white/[0.1] px-3 text-xs font-semibold text-white/85">
            {intent === 'search' ? 'Search' : 'Sort'}
          </span>
        </div>
        <ColourStrip
          selected={selected}
          disabled={disabled}
          onToggle={onSelect}
          customColour={customColour}
          onCustomChange={onCustomChange}
          customAriaLabel={
            intent === 'search'
              ? 'Choose custom colour search'
              : 'Choose custom colour target'
          }
          className="min-w-0"
        />
        <div className="flex min-w-0 items-center gap-3 lg:justify-end">
          {activeColour ? (
            <button
              type="button"
              disabled={disabled}
              onClick={onClear}
              className="inline-flex h-8 min-w-0 items-center gap-2 rounded-md border border-white/12 bg-white/[0.04] px-2.5 text-xs text-white/70 transition-colors hover:bg-white/[0.08] hover:text-white"
              aria-label={`Clear ${activeColour.name} colour target`}
              title="Clear colour target"
            >
              <span
                className="h-3.5 w-3.5 shrink-0 rounded-sm border border-white/20"
                style={{ background: activeColour.hex }}
              />
              <span className="truncate font-mono text-[10px] uppercase tracking-[0.14em]">
                {activeColour.name}
              </span>
              <X className="h-3 w-3 shrink-0 text-white/45" />
            </button>
          ) : null}
          <span className="min-w-0 truncate font-mono text-[10px] uppercase tracking-[0.18em] text-white/55">
            {detailText}
          </span>
        </div>
      </div>
    </div>
  );
}

function ModeButton({
  active,
  icon: Icon,
  label,
  onClick,
  disabled = false,
}: {
  active: boolean;
  icon: LucideIcon;
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      aria-label={`${label} search mode`}
      aria-pressed={active}
      className="lt-seg lt-focusable"
      data-active={active ? '' : undefined}
    >
      <Icon className="h-3.5 w-3.5" />
      {label}
    </button>
  );
}

function ColourStrip({
  selected,
  onToggle,
  disabled = false,
  customColour,
  onCustomChange,
  customAriaLabel = 'Choose custom colour',
  compact = false,
  className = '',
}: {
  selected: string[];
  onToggle: (id: string) => void;
  disabled?: boolean;
  customColour?: string;
  onCustomChange?: (hex: string) => void;
  customAriaLabel?: string;
  compact?: boolean;
  className?: string;
}) {
  const customActive = selected.some((id) => id.startsWith('custom:'));
  const heightClass = compact ? 'h-8' : 'h-11';
  const dotClass = compact ? 'h-2 w-2' : 'h-2.5 w-2.5';

  return (
    <div
      className={`flex ${heightClass} overflow-hidden rounded-md border border-white/10 ${className}`}
    >
      {COLOURS.map((colour, index) => {
        const active = selected.includes(colour.id);
        const grow = index === 9 ? 1.4 : index === 5 ? 1.25 : 1;
        return (
          <button
            key={colour.id}
            type="button"
            disabled={disabled}
            onClick={() => {
              if (disabled) return;
              onToggle(colour.id);
            }}
            title={colour.name}
            aria-pressed={active}
            className={`relative min-w-7 transition-[filter] hover:brightness-125 focus:z-10 focus:outline-none ${
              disabled ? 'cursor-not-allowed opacity-45' : ''
            }`}
            style={{ background: colour.hex, flex: `${grow} 1 0` }}
          >
            {active && (
              <span className="absolute inset-0 flex items-center justify-center ring-2 ring-inset ring-white">
                <span
                  className={`${dotClass} rounded-full bg-white shadow-[0_1px_8px_rgba(0,0,0,0.8)]`}
                />
              </span>
            )}
          </button>
        );
      })}
      {customColour && onCustomChange && (
        <label
          title="Custom colour"
          className="relative min-w-9 flex-[0.9_1_0] cursor-pointer overflow-hidden border-l border-white/10 transition-[filter] hover:brightness-125 focus-within:z-10 focus-within:ring-2 focus-within:ring-inset focus-within:ring-white"
          style={{
            background: customActive
              ? customColour
              : 'conic-gradient(from 90deg, #f7f7f7, #d24d57, #d7a931, #58a56b, #3a75c4, #8f55c7, #f7f7f7)',
          }}
        >
          <input
            type="color"
            value={customColour}
            disabled={disabled}
            onChange={(event) => onCustomChange(event.target.value)}
            className={`absolute inset-0 h-full w-full opacity-0 ${
              disabled ? 'cursor-not-allowed' : 'cursor-pointer'
            }`}
            aria-label={customAriaLabel}
          />
          <span className="pointer-events-none absolute inset-0 flex items-center justify-center">
            {customActive ? (
              <span className="absolute inset-0 flex items-center justify-center ring-2 ring-inset ring-white">
                <span
                  className={`${dotClass} rounded-full bg-white shadow-[0_1px_8px_rgba(0,0,0,0.8)]`}
                />
              </span>
            ) : (
              <Palette className="h-3.5 w-3.5 text-black/65 drop-shadow-[0_1px_3px_rgba(255,255,255,0.8)]" />
            )}
          </span>
        </label>
      )}
    </div>
  );
}

function ResultsView({
  view,
  results,
  selectedColours,
  sortMode,
  showSimilarity,
  onMasonryColumnEndVisible,
  onSortModeChange,
  onFacetSearch,
  onPaletteColourSelect,
  onSelectArtwork,
}: {
  view: ViewMode;
  results: ArtworkSearchResult[];
  selectedColours: string[];
  sortMode: SortMode;
  showSimilarity: boolean;
  onMasonryColumnEndVisible?: () => void;
  onSortModeChange: (sortMode: SortMode) => void;
  onFacetSearch: (query: string, facet?: SearchFacet | null) => void;
  onPaletteColourSelect: (hex: string) => void;
  onSelectArtwork: (artwork: ArtworkSearchResult) => void;
}) {
  if (view === 'table') {
    return (
      <TableResults
        results={results}
        selectedColours={selectedColours}
        sortMode={sortMode}
        showSimilarity={showSimilarity}
        onSortModeChange={onSortModeChange}
        onFacetSearch={onFacetSearch}
        onSelectArtwork={onSelectArtwork}
      />
    );
  }

  if (view === 'salon') {
    return (
      <SalonResults
        results={results}
        onFacetSearch={onFacetSearch}
        onSelectArtwork={onSelectArtwork}
      />
    );
  }

  if (view === 'atlas') {
    return <AtlasResults results={results} onSelectArtwork={onSelectArtwork} />;
  }

  return (
    <MasonryResults
      results={results}
      selectedColours={selectedColours}
      showSimilarity={showSimilarity}
      onColumnEndVisible={onMasonryColumnEndVisible}
      onFacetSearch={onFacetSearch}
      onPaletteColourSelect={onPaletteColourSelect}
      onSelectArtwork={onSelectArtwork}
    />
  );
}

function MasonryResults({
  results,
  selectedColours,
  showSimilarity,
  onColumnEndVisible,
  onFacetSearch,
  onPaletteColourSelect,
  onSelectArtwork,
}: {
  results: ArtworkSearchResult[];
  selectedColours: string[];
  showSimilarity: boolean;
  onColumnEndVisible?: () => void;
  onFacetSearch: (query: string, facet?: SearchFacet | null) => void;
  onPaletteColourSelect: (hex: string) => void;
  onSelectArtwork: (artwork: ArtworkSearchResult) => void;
}) {
  const columnCount = useMasonryColumnCount();
  const columnEndRefs = useRef<Array<HTMLDivElement | null>>([]);
  const effectiveColumnCount = Math.min(
    columnCount,
    Math.max(results.length, 1)
  );
  const columns = useMemo(
    () => distributeMasonryResults(results, effectiveColumnCount),
    [results, effectiveColumnCount]
  );
  const imageRole: ArtworkImageRole =
    results.length <= effectiveColumnCount ? 'large' : 'thumbnail';

  useEffect(() => {
    if (!onColumnEndVisible) return undefined;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          onColumnEndVisible();
        }
      },
      { rootMargin: MASONRY_COLUMN_END_ROOT_MARGIN }
    );
    const nodes = columnEndRefs.current
      .slice(0, columns.length)
      .filter((node): node is HTMLDivElement => Boolean(node));

    nodes.forEach((node) => observer.observe(node));
    return () => observer.disconnect();
  }, [columns.length, onColumnEndVisible]);

  return (
    <div className="flex items-start gap-4 pt-6">
      {columns.map((column, columnIndex) => (
        <div key={columnIndex} className="flex min-w-0 flex-1 flex-col gap-4">
          {column.map(({ result, index }) => (
            <ResultCard
              key={result.id}
              result={result}
              rank={index + 1}
              selectedColours={selectedColours}
              showSimilarity={showSimilarity}
              imageRole={imageRole}
              onFacetSearch={onFacetSearch}
              onPaletteColourSelect={onPaletteColourSelect}
              onSelectArtwork={onSelectArtwork}
            />
          ))}
          <div
            ref={(node) => {
              columnEndRefs.current[columnIndex] = node;
            }}
            aria-hidden="true"
            className="h-px w-full"
          />
        </div>
      ))}
    </div>
  );
}

function SalonResults({
  results,
  onFacetSearch,
  onSelectArtwork,
}: {
  results: ArtworkSearchResult[];
  onFacetSearch: (query: string, facet?: SearchFacet | null) => void;
  onSelectArtwork: (artwork: ArtworkSearchResult) => void;
}) {
  return (
    <div className="grid gap-x-8 gap-y-12 pt-8 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {results.map((result, index) => {
        const rotation = ((hashString(`${result.id}-${index}`) % 50) - 25) / 10;
        const image = getArtworkImageSources(result, 'thumbnail');
        const rank = (index + 1).toString().padStart(2, '0');
        const title = getDisplayTitle(result);
        const artist = getDisplayArtist(result);

        return (
          <article
            key={result.id}
            className="group block w-full appearance-none border-0 bg-transparent p-0 text-left"
            style={{ transform: `rotate(${rotation}deg)` }}
          >
            <button
              type="button"
              onClick={() => onSelectArtwork(result)}
              className="block w-full appearance-none border-0 bg-transparent p-0 text-left"
            >
              {/* A hang, so the work is framed and the frame is the chrome. */}
              <div className="lt-slide p-2 transition-transform duration-300 group-hover:scale-[1.03]">
                <ImageWithFallback
                  src={image.src}
                  fallbackSrc={image.fallbackSrc}
                  alt={title}
                  protectFromDownload
                  loading="lazy"
                  className="aspect-[4/5] w-full object-cover"
                  fallback={
                    <NoImagePlaceholder className="aspect-[4/5] text-white/25" />
                  }
                />
              </div>
            </button>
            <p className="lt-catalogue mt-3 text-center transition-colors">
              #{rank}
              <br />
              <button
                type="button"
                onClick={() => onSelectArtwork(result)}
                className="lt-focusable font-wall text-sm normal-case tracking-normal transition-colors"
                style={{ color: 'var(--ink-human)' }}
              >
                {title}
              </button>
              <br />
              <button
                type="button"
                onClick={() => onFacetSearch(artist, 'artist')}
                className="lt-focusable normal-case tracking-normal underline decoration-current/20 underline-offset-4 transition-colors"
                style={{ color: 'var(--ink-human-soft)' }}
              >
                {artist}
              </button>{' '}
              / {getDateText(result) || 'undated'}
            </p>
          </article>
        );
      })}
    </div>
  );
}

function AtlasResults({
  results,
  onSelectArtwork,
}: {
  results: ArtworkSearchResult[];
  onSelectArtwork: (artwork: ArtworkSearchResult) => void;
}) {
  return (
    <div className="relative mt-6 h-[70vh] min-h-[460px] overflow-hidden rounded-lg border border-white/[0.07] bg-[linear-gradient(rgba(255,255,255,0.035)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.035)_1px,transparent_1px)] bg-[size:64px_64px]">
      {results.map((result, index) => {
        const hash = hashString(`${result.id}-${index}`);
        const x = 4 + (hash % 82);
        const y = 6 + (Math.floor(hash / 83) % 76);
        const width = 58 + (hash % 76);
        const image = getArtworkImageSources(result, 'thumbnail');
        const rank = (index + 1).toString().padStart(2, '0');
        const title = getDisplayTitle(result);

        return (
          <button
            key={result.id}
            type="button"
            onClick={() => onSelectArtwork(result)}
            className="group absolute appearance-none border-0 bg-transparent p-0 text-left"
            style={{
              left: `${x}%`,
              top: `${y}%`,
              width,
              zIndex: 1000 - index,
            }}
          >
            <div className="relative aspect-[4/5] -translate-x-1/2 -translate-y-1/2 overflow-hidden bg-[#17171b] shadow-[0_18px_34px_-12px_rgba(0,0,0,0.9)] transition-transform duration-300 group-hover:scale-125">
              <span className="absolute left-1 top-1 z-10 rounded-sm bg-black/70 px-1.5 py-0.5 font-mono text-[9px] text-white/75">
                #{rank}
              </span>
              <ImageWithFallback
                src={image.src}
                fallbackSrc={image.fallbackSrc}
                alt={title}
                protectFromDownload
                loading="lazy"
                className="h-full w-full object-cover"
                fallback={
                  <NoImagePlaceholder
                    iconClassName="h-4 w-4"
                    showLabel={false}
                  />
                }
              />
            </div>
            <div className="pointer-events-none absolute left-1/2 top-full mt-1.5 -translate-x-1/2 whitespace-nowrap rounded-sm bg-black/90 px-2 py-1 opacity-0 transition-opacity group-hover:opacity-100">
              <span className="text-[10px] italic text-white">{title}</span>
            </div>
          </button>
        );
      })}
    </div>
  );
}

function ResultCard({
  result,
  rank,
  selectedColours,
  showSimilarity,
  imageRole,
  onFacetSearch,
  onPaletteColourSelect,
  onSelectArtwork,
}: {
  result: ArtworkSearchResult;
  rank: number;
  selectedColours: string[];
  showSimilarity: boolean;
  imageRole: ArtworkImageRole;
  onFacetSearch: (query: string, facet?: SearchFacet | null) => void;
  onPaletteColourSelect: (hex: string) => void;
  onSelectArtwork: (artwork: ArtworkSearchResult) => void;
}) {
  const palette = collectPalette(result).slice(0, 5);
  const title = getDisplayTitle(result);
  const artist = getDisplayArtist(result);
  const image = getArtworkImageSources(result, imageRole);
  const imageFrameStyle = getMasonryImageFrameStyle(result);

  return (
    /*
     * A slide on the light table: a pale mount, a well for the work, and real
     * shadow, so a card reads as an object rather than a region of the page.
     *
     * The `lt-slide` class is also where provenance ink lands. Whoever owns
     * flag state sets `data-flag` / `data-hand` / `data-provisional` on this
     * element and the frame, the badge and the desaturation follow from CSS —
     * no shared component, and no edit to this file.
     */
    <article className="lt-slide break-inside-avoid">
      <button
        type="button"
        onClick={() => onSelectArtwork(result)}
        className="group block w-full appearance-none border-0 bg-transparent p-0 text-left"
      >
        <div className="lt-slide-well" style={imageFrameStyle}>
          <ImageWithFallback
            src={image.src}
            fallbackSrc={image.fallbackSrc}
            alt={title}
            protectFromDownload
            loading="lazy"
            className={MASONRY_IMAGE_CLASS_NAME}
            fallback={<NoImagePlaceholder className="text-white/25" />}
          />
        </div>
      </button>
      <div className="space-y-2.5 p-3.5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <button
              type="button"
              onClick={() => onSelectArtwork(result)}
              className="min-w-0 appearance-none border-0 bg-transparent p-0 text-left"
            >
              {/* Wall labels are set in the serif. Hover goes to full graphite
                  rather than to the accent: on this board the coloured ink means
                  the agent and nothing else, so ordinary hover cannot borrow it. */}
              <h2
                className="font-wall text-lg leading-tight transition-colors"
                style={{ color: 'var(--ink-human)' }}
              >
                {title}
              </h2>
            </button>
            <button
              type="button"
              onClick={() => onFacetSearch(artist, 'artist')}
              className="lt-focusable mt-1 block max-w-full truncate text-left text-sm underline decoration-current/20 underline-offset-4 transition-colors hover:opacity-100"
              style={{ color: 'var(--ink-human-soft)' }}
              title={`Search ${artist}`}
            >
              {artist}
            </button>
          </div>
          <span className="lt-catalogue">
            #{rank.toString().padStart(2, '0')}
          </span>
        </div>

        <MetadataLine result={result} onFacetSearch={onFacetSearch} />

        <div className="flex items-center justify-between gap-3">
          <PaletteDots
            colours={palette}
            onColourSelect={onPaletteColourSelect}
          />
          <span
            className="lt-catalogue"
            title={
              selectedColours.length
                ? getColourMatchTitle(result, selectedColours)
                : undefined
            }
          >
            {showSimilarity
              ? selectedColours.length
                ? `Colour ${formatColourMatch(result, selectedColours)}`
                : `${Math.round(result.similarity * 100)}%`
              : getAccession(result) || 'Collection'}
          </span>
        </div>
      </div>
    </article>
  );
}

function MetadataLine({
  result,
  onFacetSearch,
}: {
  result: ArtworkSearchResult;
  onFacetSearch: (query: string, facet?: SearchFacet | null) => void;
}) {
  const facets = getMetadataFacets(result);

  if (!facets.length) return null;

  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs leading-relaxed text-white/45">
      {facets.map((facet, index) => (
        <span
          key={`${facet.value}-${index}`}
          className="inline-flex min-w-0 items-center gap-2"
        >
          {index > 0 && (
            <span
              aria-hidden="true"
              className="h-1 w-1 shrink-0 rounded-full bg-white/18"
            />
          )}
          <button
            type="button"
            onClick={() => onFacetSearch(facet.query)}
            className="min-w-0 max-w-full truncate text-left transition-colors hover:text-cyan-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-200/60"
            title={`Search ${facet.value}`}
          >
            {facet.value}
          </button>
        </span>
      ))}
    </div>
  );
}

function PaletteDots({
  colours,
  onColourSelect,
}: {
  colours: string[];
  onColourSelect?: (hex: string) => void;
}) {
  if (!colours.length) {
    return (
      <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-white/25">
        No palette
      </span>
    );
  }

  return (
    <div className="flex items-center gap-1">
      {colours.map((colour) => {
        const colourLabel = colour.toUpperCase();

        if (onColourSelect) {
          return (
            <button
              key={colour}
              type="button"
              onClick={() => onColourSelect(colour)}
              className="h-4 w-4 rounded-sm border border-white/15 transition-transform hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-200/70"
              style={{ background: colour }}
              title={`Use ${colourLabel} as colour target`}
              aria-label={`Use ${colourLabel} as colour target`}
            />
          );
        }

        return (
          <span
            key={colour}
            className="h-4 w-4 rounded-sm border border-white/15"
            style={{ background: colour }}
            title={colourLabel}
          />
        );
      })}
    </div>
  );
}

function TableResults({
  results,
  selectedColours,
  sortMode,
  showSimilarity,
  onSortModeChange,
  onFacetSearch,
  onSelectArtwork,
}: {
  results: ArtworkSearchResult[];
  selectedColours: string[];
  sortMode: SortMode;
  showSimilarity: boolean;
  onSortModeChange: (sortMode: SortMode) => void;
  onFacetSearch: (query: string, facet?: SearchFacet | null) => void;
  onSelectArtwork: (artwork: ArtworkSearchResult) => void;
}) {
  const isColourSort = sortMode === 'colour';

  return (
    <div className="mt-6 w-full overflow-x-auto rounded-lg border border-white/[0.08]">
      <table className="w-full min-w-[1120px] border-collapse text-sm">
        <thead className="border-b border-white/[0.08] bg-white/[0.04]">
          <tr className="text-left font-mono text-[10px] uppercase tracking-[0.18em] text-white/45">
            <th className="px-3 py-3 font-normal">#</th>
            <TableSortHeader
              label="Work"
              column="title"
              sortMode={sortMode}
              onSortModeChange={onSortModeChange}
            />
            <TableSortHeader
              label="Artist"
              column="artist"
              sortMode={sortMode}
              onSortModeChange={onSortModeChange}
            />
            <TableSortHeader
              label="Date"
              column="time"
              sortMode={sortMode}
              onSortModeChange={onSortModeChange}
            />
            <TableSortHeader
              label="Place"
              column="place"
              sortMode={sortMode}
              onSortModeChange={onSortModeChange}
            />
            <TableSortHeader
              label="Medium"
              column="medium"
              sortMode={sortMode}
              onSortModeChange={onSortModeChange}
            />
            <TableSortHeader
              label="Source"
              column="source"
              sortMode={sortMode}
              onSortModeChange={onSortModeChange}
            />
            <TableSortHeader
              label={
                showSimilarity ? (isColourSort ? 'Colour' : 'Score') : 'Rank'
              }
              column={isColourSort ? 'colour' : 'score'}
              sortMode={sortMode}
              onSortModeChange={onSortModeChange}
            />
          </tr>
        </thead>
        <tbody className="divide-y divide-white/[0.06]">
          {results.map((result, index) => {
            const title = getDisplayTitle(result);
            const artist = getDisplayArtist(result);
            const image = getArtworkImageSources(result, 'thumbnail');

            return (
              <tr
                key={result.id}
                className="transition-colors hover:bg-white/[0.035]"
              >
                <td className="px-3 py-3 font-mono text-white/35">
                  {(index + 1).toString().padStart(2, '0')}
                </td>
                <td className="px-3 py-3">
                  <button
                    type="button"
                    onClick={() => onSelectArtwork(result)}
                    className="flex items-center gap-3 text-left text-white transition-colors hover:text-cyan-200"
                  >
                    <ImageWithFallback
                      src={image.src}
                      fallbackSrc={image.fallbackSrc}
                      alt=""
                      protectFromDownload
                      loading="lazy"
                      className="h-12 w-12 object-cover"
                      fallback={
                        <NoImagePlaceholder
                          className="h-12 w-12 rounded-md"
                          iconClassName="h-4 w-4"
                          showLabel={false}
                        />
                      }
                    />
                    <span>
                      <span className="block font-medium">{title}</span>
                      {getAccession(result) && (
                        <span className="mt-0.5 block font-mono text-[10px] uppercase tracking-[0.14em] text-white/35">
                          {getAccession(result)}
                        </span>
                      )}
                    </span>
                  </button>
                </td>
                <td className="px-3 py-3">
                  <button
                    type="button"
                    onClick={() => onFacetSearch(artist, 'artist')}
                    className="text-left text-white/65 underline decoration-white/15 underline-offset-4 transition-colors hover:text-cyan-100 hover:decoration-cyan-100/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-200/60"
                    title={`Search ${artist}`}
                  >
                    {artist}
                  </button>
                </td>
                <td className="px-3 py-3 text-white/55">
                  {getDateText(result) || '-'}
                </td>
                <td className="px-3 py-3 text-white/55">
                  {getPlace(result) || '-'}
                </td>
                <td className="px-3 py-3 text-white/55">
                  {getMedium(result) || '-'}
                </td>
                <td className="px-3 py-3 text-white/55">
                  {getSourceUrl(result) ? (
                    <a
                      href={getSourceUrl(result) || undefined}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-cyan-200/75 hover:text-cyan-200"
                    >
                      {getSourceName(result)}
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  ) : (
                    getSourceName(result)
                  )}
                </td>
                <td
                  className="px-3 py-3 font-mono text-white/55"
                  title={
                    selectedColours.length
                      ? getColourMatchTitle(result, selectedColours)
                      : isColourSort
                        ? 'Nearest palette band for colour spectrum order'
                        : undefined
                  }
                >
                  {showSimilarity
                    ? selectedColours.length
                      ? formatColourMatch(result, selectedColours)
                      : isColourSort
                        ? getPaletteBandLabel(result)
                        : `${Math.round(result.similarity * 100)}%`
                    : (index + 1).toString().padStart(2, '0')}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function TableSortHeader({
  label,
  column,
  sortMode,
  onSortModeChange,
}: {
  label: string;
  column: TableSortColumn;
  sortMode: SortMode;
  onSortModeChange: (sortMode: SortMode) => void;
}) {
  const direction = tableSortDirection(column, sortMode);
  const nextSortMode =
    column === 'colour' && direction
      ? 'relevance'
      : tableColumnSortMode(column, sortMode);
  const directionLabel =
    direction === 'asc' ? 'ASC' : direction === 'desc' ? 'DESC' : '';

  return (
    <th className="px-3 py-3 font-normal">
      <button
        type="button"
        onClick={() => onSortModeChange(nextSortMode)}
        className={`inline-flex h-7 items-center gap-1.5 whitespace-nowrap rounded-md px-2 transition-colors ${
          direction
            ? 'bg-white/[0.1] text-white'
            : 'text-white/45 hover:bg-white/[0.06] hover:text-white/75'
        }`}
        aria-label={`Sort table by ${label.toLowerCase()}`}
      >
        {label}
        {directionLabel && (
          <span className="text-[9px] tracking-[0.08em] text-white/35">
            {directionLabel}
          </span>
        )}
      </button>
    </th>
  );
}
