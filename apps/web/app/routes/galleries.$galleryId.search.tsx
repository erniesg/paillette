import type { LoaderFunctionArgs, MetaFunction } from '@remix-run/cloudflare';
import { Link, useLoaderData, useSearchParams } from '@remix-run/react';
import {
  forwardRef,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
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
  LogIn,
  Network,
  Palette,
  Search,
  SlidersHorizontal,
  Table2,
  X,
  type LucideIcon,
} from 'lucide-react';
import { getApiClientForRequest, getPreferredOrgRouteId } from '~/lib/api';
import { Logo } from '~/components/ui/logo';
import {
  getDominantSourceLabel,
  getGeneratedCaptionText,
  getGeographicAssociation,
  getNgsUrl,
  getPublicAccession,
  getPublicCatalogueRows,
  getPublicDateText,
  getPublicDescriptionDetails,
  getPublicImageUrl,
  getRootsUrl,
} from '~/lib/public-artwork-metadata';
import {
  getUpcomingSingaporeHolidaySuggestions,
  type HolidaySearchSuggestion,
} from '~/lib/singapore-holidays.server';
import type {
  ApiResponse,
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
  if (!galleryId) {
    throw new Response('Gallery ID is required', { status: 400 });
  }

  try {
    const [gallery, holidaySuggestions] = await Promise.all([
      getApiClientForRequest(request).getGallery(galleryId),
      getUpcomingSingaporeHolidaySuggestions(),
    ]);
    return {
      gallery,
      galleryId: gallery.id,
      preferredRouteId: getPreferredOrgRouteId(galleryId, gallery.slug),
      holidaySuggestions,
    };
  } catch {
    throw new Response('Gallery not found', { status: 404 });
  }
}

type SearchMode = 'text' | 'image' | 'colour';
type ViewMode = 'masonry' | 'salon' | 'atlas' | 'table';
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

type EvalSuggestion = {
  type:
    | 'keyword'
    | 'occasion'
    | 'motif'
    | 'mood'
    | 'style'
    | 'medium'
    | 'metadata'
    | 'colour';
  label: string;
  query: string;
  dot: string;
  detail?: string;
  colourId?: string;
  source?: HolidaySearchSuggestion['source'];
};

const EVAL_SUGGESTIONS: EvalSuggestion[] = [
  {
    type: 'keyword',
    label: 'tropical fruit and flowers',
    query: 'a still life of tropical fruit and flowers',
    dot: '#cda636',
  },
  {
    type: 'occasion',
    label: 'Mid-Autumn Festival',
    query: 'Mid-Autumn Festival — lanterns and the moon',
    dot: '#cdbfa2',
  },
  {
    type: 'motif',
    label: 'batik textile pattern',
    query: 'batik or songket textile pattern',
    dot: '#bf5631',
  },
  {
    type: 'mood',
    label: 'serene and contemplative',
    query: 'serene, still and contemplative',
    dot: '#8a9a7a',
  },
  {
    type: 'style',
    label: 'Nanyang style',
    query: 'Nanyang-style fusion of Chinese and Southeast Asian',
    dot: '#365f9c',
  },
  {
    type: 'medium',
    label: 'watercolour painting',
    query: 'watercolour painting',
    dot: '#6e8ea8',
  },
  {
    type: 'metadata',
    label: '1950s works',
    query: 'artworks made in the 1950s',
    dot: '#6a5238',
  },
  {
    type: 'colour',
    label: 'muted sage green',
    query: 'muted sage green',
    dot: '#8a9a7a',
    colourId: 'sage',
  },
];

const buildSuggestionPool = (
  holidaySuggestions: HolidaySearchSuggestion[]
): EvalSuggestion[] => {
  const [firstSuggestion, ...remainingSuggestions] = EVAL_SUGGESTIONS;
  const leadingSuggestions = firstSuggestion ? [firstSuggestion] : [];
  const staticSuggestions = remainingSuggestions.filter(
    (suggestion) => suggestion.type !== 'occasion'
  );

  if (!holidaySuggestions.length) {
    return EVAL_SUGGESTIONS;
  }

  return [
    ...leadingSuggestions,
    ...holidaySuggestions.map((suggestion) => ({
      type: suggestion.type,
      label: suggestion.label,
      query: suggestion.query,
      dot: suggestion.dot,
      detail: suggestion.detail,
      source: suggestion.source,
    })),
    ...staticSuggestions,
  ];
};

const getSuggestionKey = (suggestion: EvalSuggestion) =>
  `${suggestion.type}-${suggestion.label}-${suggestion.query}`;

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

const getSourceName = (result: ArtworkSearchResult) =>
  getNgsUrl(result)
    ? asText(getMeta(result).sourceInstitution) ||
      asText(getMeta(result).source_institution) ||
      'National Gallery Singapore'
    : getRootsUrl(result)
      ? 'NHB Roots'
      : asText(getMeta(result).sourceInstitution) ||
        asText(getMeta(result).source_institution) ||
        'National Gallery Singapore';

const getPlace = (result: ArtworkSearchResult) =>
  getGeographicAssociation(result);

const getSourceUrl = (result: ArtworkSearchResult) =>
  getNgsUrl(result) || getRootsUrl(result);

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

const collectPalette = (result: ArtworkSearchResult): string[] => {
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

  return [...new Set(colours)];
};

const colourScore = (result: ArtworkSearchResult, selected: string[]) => {
  const palette = collectPalette(result);
  if (!selected.length) return 0;
  if (!palette.length) return Infinity;

  const total = selected.reduce((sum, colourId) => {
    const selectedColour = getSelectedColour(colourId);
    if (!selectedColour) return sum;
    const nearest = Math.min(
      ...palette.map((paletteColour) =>
        rgbDistance(selectedColour.hex, paletteColour)
      )
    );
    return sum + nearest;
  }, 0);

  return total / selected.length;
};

const colourMatchPercent = (
  result: ArtworkSearchResult,
  selected: string[]
) => {
  const distance = colourScore(result, selected);
  if (!Number.isFinite(distance)) return null;

  const maxUsefulDistance = 160;
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

const estimateMasonryCardHeight = (result: ArtworkSearchResult) => {
  const titleLength = result.title?.length || 0;
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
      if (selectedColours.length) {
        const delta =
          colourScore(a, selectedColours) - colourScore(b, selectedColours);
        if (Number.isFinite(delta) && delta !== 0) return delta;
      } else {
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
      return (
        textCompare(a, b, (result) => result.artist) ||
        b.similarity - a.similarity
      );
    }

    if (sortMode === 'artist-desc') {
      return (
        textCompare(a, b, (result) => result.artist, 'desc') ||
        b.similarity - a.similarity
      );
    }

    if (sortMode === 'title') {
      return (
        textCompare(a, b, (result) => result.title) ||
        b.similarity - a.similarity
      );
    }

    if (sortMode === 'title-desc') {
      return (
        textCompare(a, b, (result) => result.title, 'desc') ||
        b.similarity - a.similarity
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
    throw new Error(payload.error?.message || 'Search failed');
  }

  return payload.data;
};

const publicSearchText = async (
  orgId: string,
  request: SearchTextRequest
): Promise<SearchResponse> => {
  const response = await fetch(
    `/api/public-search/${encodeURIComponent(orgId)}/text`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(request),
    }
  );

  return readSearchResponse(response);
};

const publicSearchImage = async (
  orgId: string,
  request: SearchImageRequest
): Promise<SearchResponse> => {
  const body = new FormData();
  body.set('image', request.image);
  if (request.topK) body.set('topK', String(request.topK));
  if (request.minScore) body.set('minScore', String(request.minScore));

  const response = await fetch(
    `/api/public-search/${encodeURIComponent(orgId)}/image`,
    {
      method: 'POST',
      body,
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
    preferredRouteId,
    holidaySuggestions = [],
  } = useLoaderData<typeof loader>();
  const [searchParams, setSearchParams] = useSearchParams();
  const { isAuthenticated, login } = useUser();

  const [searchMode, setSearchMode] = useState<SearchMode>('text');
  const [textQuery, setTextQuery] = useState(searchParams.get('q') || '');
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [searchColours, setSearchColours] = useState<string[]>([]);
  const [sortColours, setSortColours] = useState<string[]>([]);
  const [customColour, setCustomColour] = useState('#cda636');
  const [sortMode, setSortMode] = useState<SortMode>('relevance');
  const [view, setView] = useState<ViewMode>('masonry');
  const [topK, setTopK] = useState(30);
  const [minScore, setMinScore] = useState(0.3);
  const [browsePageSize, setBrowsePageSize] = useState(BROWSE_PAGE_SIZE);
  const [isBrowsingCollection, setIsBrowsingCollection] = useState(false);
  const [visibleCount, setVisibleCount] = useState(SEARCH_DISPLAY_INCREMENT);
  const [shouldSearch, setShouldSearch] = useState(
    Boolean(searchParams.get('q'))
  );
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [selectedArtwork, setSelectedArtwork] =
    useState<ArtworkSearchResult | null>(null);
  const [hasMounted, setHasMounted] = useState(false);
  const loadMoreRef = useRef<HTMLDivElement | null>(null);
  const colourRailRef = useRef<HTMLDivElement | null>(null);
  const searchPanelRef = useRef<HTMLElement | null>(null);
  const idleShowcaseRef = useRef<HTMLDivElement | null>(null);
  const resultsAreaRef = useRef<HTMLElement | null>(null);

  const suggestionPool = useMemo(
    () => buildSuggestionPool(holidaySuggestions),
    [holidaySuggestions]
  );
  const hasActiveSearch =
    isBrowsingCollection ||
    shouldSearch ||
    searchMode !== 'text' ||
    textQuery.trim().length > 0 ||
    imageFile !== null ||
    searchColours.length > 0;

  const revealColourRail = useCallback(() => {
    window.requestAnimationFrame(() => {
      colourRailRef.current?.scrollIntoView({
        block: 'center',
        behavior: 'smooth',
      });
    });
  }, []);

  useEffect(() => {
    setHasMounted(true);
  }, []);

  const textSearchQuery = useQuery({
    queryKey: ['search', 'text', galleryId, textQuery, topK, minScore],
    queryFn: async () => {
      if (!textQuery.trim()) return null;
      return publicSearchText(galleryId, {
        query: textQuery,
        topK,
        minScore,
      });
    },
    enabled:
      hasMounted &&
      (searchMode === 'text' || searchMode === 'colour') &&
      shouldSearch &&
      textQuery.trim().length > 0,
  });

  const imageSearchQuery = useQuery({
    queryKey: ['search', 'image', galleryId, imageFile?.name, topK, minScore],
    queryFn: async () => {
      if (!imageFile) return null;
      return publicSearchImage(galleryId, {
        image: imageFile,
        topK,
        minScore,
      });
    },
    enabled:
      hasMounted &&
      searchMode === 'image' &&
      shouldSearch &&
      imageFile !== null,
  });

  const browseSort = useMemo(() => getBrowseSort(sortMode), [sortMode]);
  const browseQuery = useInfiniteQuery({
    queryKey: [
      'browse',
      galleryId,
      browsePageSize,
      browseSort.sortBy,
      browseSort.sortOrder,
    ],
    initialPageParam: 0,
    queryFn: ({ pageParam }) =>
      publicBrowseCollection(galleryId, {
        limit: browsePageSize,
        offset: Number(pageParam),
        sortBy: browseSort.sortBy,
        sortOrder: browseSort.sortOrder,
      }),
    getNextPageParam: (lastPage) =>
      lastPage.hasMore ? lastPage.offset + lastPage.limit : undefined,
    enabled: hasMounted && isBrowsingCollection,
  });

  const idleShowcaseQuery = useQuery({
    queryKey: ['idle-showcase', galleryId],
    queryFn: () =>
      publicBrowseCollection(galleryId, {
        limit: 12,
        offset: 0,
        sortBy: 'year',
        sortOrder: 'desc',
      }),
    enabled: hasMounted && !hasActiveSearch,
  });

  const currentQuery =
    searchMode === 'image' ? imageSearchQuery : textSearchQuery;
  const rawResults = isBrowsingCollection
    ? browseQuery.data?.pages.flatMap((page) => page.results) || []
    : currentQuery.data?.results || [];
  const results = useMemo(
    () => sortResults(rawResults, sortMode, sortColours),
    [rawResults, sortColours, sortMode]
  );
  const activeSortColours = sortMode === 'colour' ? sortColours : [];
  const visibleResults = isBrowsingCollection
    ? results
    : results.slice(0, visibleCount);
  const totalBrowseResults =
    browseQuery.data?.pages[0]?.total ?? results.length;
  const isLoading =
    hasMounted &&
    (isBrowsingCollection
      ? browseQuery.isLoading
      : currentQuery.isLoading || currentQuery.isFetching);
  const error = isBrowsingCollection ? browseQuery.error : currentQuery.error;
  const hasMoreResults = isBrowsingCollection
    ? Boolean(browseQuery.hasNextPage)
    : visibleCount < results.length;
  const idleShowcaseResults = idleShowcaseQuery.data?.results || [];

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
    if (isBrowsingCollection) {
      if (browseQuery.hasNextPage && !browseQuery.isFetchingNextPage) {
        void browseQuery.fetchNextPage();
      }
      return;
    }

    setVisibleCount((count) =>
      Math.min(count + SEARCH_DISPLAY_INCREMENT, results.length)
    );
  }, [browseQuery, isBrowsingCollection, results.length]);

  useEffect(() => {
    setVisibleCount(SEARCH_DISPLAY_INCREMENT);
  }, [
    galleryId,
    imageFile?.name,
    minScore,
    searchMode,
    sortMode,
    sortColours,
    textQuery,
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

  useEffect(() => {
    if (isBrowsingCollection || searchMode !== 'text') return undefined;

    const trimmed = textQuery.trim();
    if (!trimmed) {
      setShouldSearch(false);
      return undefined;
    }

    setShouldSearch(false);
    const handle = window.setTimeout(() => {
      setShouldSearch(true);
      setSearchParams({ q: trimmed }, { replace: true });
    }, 450);

    return () => window.clearTimeout(handle);
  }, [isBrowsingCollection, searchMode, setSearchParams, textQuery]);

  const onDrop = useCallback((acceptedFiles: File[]) => {
    const file = acceptedFiles[0];
    if (file) {
      setImageFile(file);
      setImagePreview(URL.createObjectURL(file));
      setSearchMode('image');
      setSearchColours([]);
      setIsBrowsingCollection(false);
      setShouldSearch(true);
    }
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'image/jpeg': ['.jpg', '.jpeg'],
      'image/png': ['.png'],
      'image/webp': ['.webp'],
    },
    maxFiles: 1,
  });

  const runTextSearch = (query = textQuery) => {
    const trimmed = query.trim();
    if (!trimmed) return;

    setIsBrowsingCollection(false);
    setSearchMode('text');
    setSearchColours([]);
    setTextQuery(trimmed);
    setShouldSearch(true);
    setSearchParams({ q: trimmed });
  };

  const clearSearch = () => {
    setTextQuery('');
    setShouldSearch(false);
    setIsBrowsingCollection(false);
    setSearchParams({}, { replace: true });
  };

  const clearImage = () => {
    setImageFile(null);
    setImagePreview(null);
    setShouldSearch(false);
    setIsBrowsingCollection(false);
  };

  const selectColourSearch = (selection: string) => {
    const query = getColourSearchText(selection);
    if (!query) return;

    setSearchMode('colour');
    setIsBrowsingCollection(false);
    setSearchColours([selection]);
    setSortColours([selection]);
    setSortMode('colour');
    setTextQuery(query);
    setShouldSearch(true);
    setSearchParams({ q: query });
  };

  const clearColourSearch = () => {
    const clearedColours = searchColours;
    setSearchColours([]);
    clearSearch();
    if (
      sortMode === 'colour' &&
      clearedColours.some((colour) => sortColours.includes(colour))
    ) {
      setSortColours([]);
      setSortMode('relevance');
    }
  };

  const clearColourSort = () => {
    setSortColours([]);
    if (sortMode === 'colour') {
      setSortMode('relevance');
    }
  };

  const clearColourSortTarget = () => {
    setSortColours([]);
  };

  const runColourSearch = (selection: string) => {
    const active = searchMode === 'colour' && searchColours.includes(selection);
    if (active) {
      clearColourSearch();
      return;
    }

    selectColourSearch(selection);
  };

  const runTargetColourSort = (selection: string) => {
    if (sortMode === 'colour' && sortColours.includes(selection)) {
      setSortColours([]);
      return;
    }

    setSortMode('colour');
    setSortColours([selection]);
  };

  const updateSortCustomColour = (hex: string) => {
    setCustomColour(hex);
    setSortMode('colour');
    setSortColours([`custom:${hex}`]);
  };

  const updateCustomColour = (hex: string) => {
    setCustomColour(hex);
    if (searchMode === 'colour') {
      selectColourSearch(`custom:${hex}`);
    }
  };

  const useArtworkPaletteColour = (hex: string) => {
    if (searchMode === 'colour') {
      updateCustomColour(hex);
      revealColourRail();
      return;
    }

    updateSortCustomColour(hex);
    revealColourRail();
  };

  const showColourRail = searchMode === 'colour' || sortMode === 'colour';
  const colourRailIsSearch = searchMode === 'colour';

  const runEvalSearch = (suggestion: EvalSuggestion) => {
    const active =
      textQuery.trim().toLowerCase() === suggestion.query.toLowerCase();
    if (active) {
      clearSearch();
      if (suggestion.type === 'colour') {
        setSearchColours([]);
        setSortColours([]);
        setSortMode('relevance');
      }
      return;
    }

    if (suggestion.type === 'colour') {
      runColourSearch(suggestion.colourId || `custom:${suggestion.dot}`);
      return;
    }

    runTextSearch(suggestion.query);
  };

  const updateTopK = (value: number) => {
    if (!Number.isFinite(value)) return;
    setTopK(Math.min(MAX_SEARCH_RESULTS, Math.max(1, Math.round(value))));
  };

  const updateBrowsePageSize = (value: number) => {
    if (!Number.isFinite(value)) return;
    setBrowsePageSize(
      Math.min(
        MAX_BROWSE_PAGE_SIZE,
        Math.max(MIN_BROWSE_PAGE_SIZE, Math.round(value))
      )
    );
  };

  const updateMinScorePercent = (value: number) => {
    if (!Number.isFinite(value)) return;
    setMinScore(Math.min(1, Math.max(0, value / 100)));
  };

  return (
    <div className="min-h-screen bg-[#0b0b0e] text-white">
      <header className="sticky top-0 z-40 border-b border-white/[0.08] bg-[#0b0b0e]/90 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-5 lg:px-8">
          <div className="flex min-w-0 items-center gap-3">
            <div className="min-w-0">
              <Link
                to={`/${preferredRouteId}/search`}
                className="inline-flex items-center transition-opacity hover:opacity-80"
              >
                <Logo size="sm" />
              </Link>
            </div>
          </div>
          <nav className="flex items-center gap-2">
            {!isAuthenticated && (
              <button
                type="button"
                onClick={() => void login()}
                className="inline-flex items-center gap-2 rounded-md border border-white/10 bg-white/[0.06] px-3 py-1.5 text-xs font-medium text-white/75 transition-colors hover:bg-white/[0.1] hover:text-white"
              >
                <LogIn className="h-3.5 w-3.5" />
                Sign in
              </button>
            )}
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-5 pb-14 pt-10 lg:px-8">
        <section ref={searchPanelRef} className="mx-auto max-w-6xl">
          <div>
            <div className="mb-4 flex flex-wrap items-center justify-center gap-2 font-mono text-[10px] uppercase tracking-[0.3em] text-white/35">
              <span>{gallery.name}</span>
              <span>/</span>
              <span>collection search</span>
              {currentQuery.data?.queryTime !== undefined && (
                <>
                  <span>/</span>
                  <span>{Math.round(currentQuery.data.queryTime)}ms</span>
                </>
              )}
            </div>

            <div className="space-y-4">
              {searchMode === 'text' && (
                <div className="relative">
                  <Search className="absolute left-0 top-1/2 h-6 w-6 -translate-y-1/2 text-white/30" />
                  <input
                    value={textQuery}
                    onChange={(event) => setTextQuery(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') runTextSearch();
                    }}
                    autoFocus
                    placeholder="search by feeling, era, subject..."
                    className="w-full border-b-2 border-white/20 bg-transparent py-5 pl-10 pr-4 font-display text-3xl italic outline-none transition-colors placeholder:not-italic placeholder:text-white/25 focus:border-fuchsia-400 lg:text-5xl"
                  />
                </div>
              )}

              {searchMode === 'image' && (
                <div
                  {...getRootProps()}
                  className={`flex min-h-44 cursor-pointer items-center justify-center rounded-lg border border-dashed px-6 py-8 transition-colors ${
                    isDragActive
                      ? 'border-fuchsia-300 bg-fuchsia-300/10'
                      : 'border-white/15 bg-white/[0.025] hover:border-white/30'
                  }`}
                >
                  <input {...getInputProps()} />
                  {imagePreview ? (
                    <div className="relative w-full max-w-lg">
                      <img
                        src={imagePreview}
                        alt="Query preview"
                        className="max-h-64 w-full rounded-md object-contain"
                      />
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          clearImage();
                        }}
                        className="absolute right-2 top-2 inline-flex h-8 w-8 items-center justify-center rounded-md bg-black/75 text-white transition-colors hover:bg-black"
                        aria-label="Clear image"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  ) : (
                    <div className="text-center">
                      <Camera className="mx-auto h-8 w-8 text-white/45" />
                      <p className="mt-3 text-sm text-white/65">
                        Drop an image to search visually
                      </p>
                      <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.18em] text-white/30">
                        jpg / png / webp
                      </p>
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
              <SuggestionPicker
                suggestions={suggestionPool}
                currentQuery={textQuery}
                onSelect={runEvalSearch}
              />
              <div className="ml-0 flex items-center gap-1 rounded-lg border border-white/10 bg-white/[0.035] p-1 sm:ml-2">
                <ModeButton
                  active={searchMode === 'text'}
                  icon={Search}
                  label="Text"
                  onClick={() => {
                    setIsBrowsingCollection(false);
                    setSearchMode('text');
                  }}
                />
                <ModeButton
                  active={searchMode === 'image'}
                  icon={ImageIcon}
                  label="Image"
                  onClick={() => {
                    setIsBrowsingCollection(false);
                    setSearchMode('image');
                  }}
                />
                <ModeButton
                  active={searchMode === 'colour'}
                  icon={Palette}
                  label="Colour"
                  onClick={() => {
                    if (searchMode === 'colour') {
                      if (searchColours.length) {
                        clearColourSearch();
                      }
                      setSearchMode('text');
                      return;
                    }

                    setIsBrowsingCollection(false);
                    setSearchMode('colour');
                    setSortMode('colour');
                    setSortColours(searchColours);
                    revealColourRail();
                  }}
                />
              </div>
            </div>
          </div>
        </section>

        {!hasActiveSearch && (
          <IdleShowcase
            ref={idleShowcaseRef}
            artworks={idleShowcaseResults}
            isLoading={idleShowcaseQuery.isLoading}
            onSearch={runTextSearch}
          />
        )}

        {hasActiveSearch && (
          <section ref={resultsAreaRef} className="mt-8">
            <div className="sticky top-14 z-30 -mx-5 border-y border-white/[0.07] bg-[#0b0b0e]/90 px-5 py-3 backdrop-blur-md lg:-mx-8 lg:px-8">
              <div className="mx-auto max-w-7xl">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-white/45">
                    {isBrowsingCollection
                      ? isLoading && !results.length
                        ? 'Loading collection'
                        : `${visibleResults.length} / ${totalBrowseResults} works`
                      : isLoading
                        ? 'Searching'
                        : results.length
                          ? `${visibleResults.length} / ${results.length} works`
                          : hasMounted && shouldSearch
                            ? 'No works'
                            : 'Ready'}
                    {textQuery &&
                      searchMode !== 'image' &&
                      !isBrowsingCollection && (
                        <span className="ml-2 normal-case tracking-normal text-white/70">
                          "{textQuery}"
                        </span>
                      )}
                    {isBrowsingCollection && (
                      <span className="ml-2 normal-case tracking-normal text-white/70">
                        infinite browse
                      </span>
                    )}
                  </p>
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="flex min-w-0 items-stretch overflow-hidden rounded-lg border border-white/10 bg-white/[0.035]">
                      <span className="flex h-10 items-center border-r border-white/10 px-3 font-mono text-[9px] uppercase tracking-[0.18em] text-white/35">
                        Sort
                      </span>
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
                              onClick={() => {
                                if (option.id === 'time') {
                                  setSortMode(
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

                                  setSortMode('colour');
                                  revealColourRail();
                                  return;
                                }

                                if (
                                  sortMode === option.id ||
                                  SORT_ASC[sortMode] === option.id
                                ) {
                                  setSortMode('relevance');
                                  return;
                                }

                                setSortMode(option.id);
                              }}
                              title={
                                option.id === 'time'
                                  ? 'Toggle newest or oldest'
                                  : `Sort by ${option.label.toLowerCase()}`
                              }
                              className={`inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium transition-colors ${
                                active
                                  ? 'bg-white/[0.14] text-white'
                                  : 'text-white/45 hover:text-white/80'
                              }`}
                            >
                              <Icon className="h-3.5 w-3.5" />
                              <span className="hidden md:inline">{label}</span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                    <div className="flex min-w-0 items-stretch overflow-hidden rounded-lg border border-white/10 bg-white/[0.035]">
                      <span className="flex h-10 items-center border-r border-white/10 px-3 font-mono text-[9px] uppercase tracking-[0.18em] text-white/35">
                        View
                      </span>
                      <div className="flex min-w-0 flex-1 items-center gap-1 p-1">
                        {VIEW_OPTIONS.map((option) => {
                          const Icon = option.icon;
                          return (
                            <button
                              key={option.id}
                              type="button"
                              onClick={() => setView(option.id)}
                              title={option.label}
                              className={`inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium transition-colors ${
                                view === option.id
                                  ? 'bg-white/[0.14] text-white'
                                  : 'text-white/45 hover:text-white/80'
                              }`}
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
                      onClick={() => setIsSettingsOpen((value) => !value)}
                      aria-expanded={isSettingsOpen}
                      aria-label="Search settings"
                      className={`inline-flex h-10 items-center gap-2 rounded-lg border px-3 text-xs font-medium transition-colors ${
                        isSettingsOpen
                          ? 'border-white/20 bg-white/[0.12] text-white'
                          : 'border-white/10 bg-white/[0.035] text-white/55 hover:text-white/85'
                      }`}
                    >
                      <SlidersHorizontal className="h-3.5 w-3.5" />
                      <span>Settings</span>
                      <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-white/35">
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
                        onClick={() => {
                          setIsBrowsingCollection((value) => !value);
                          setShouldSearch(false);
                        }}
                        className={`flex w-full items-center justify-between rounded-md border px-3 py-2 text-left transition-colors ${
                          isBrowsingCollection
                            ? 'border-fuchsia-300/35 bg-fuchsia-300/10 text-white'
                            : 'border-white/10 bg-white/[0.035] text-white/65 hover:bg-white/[0.07] hover:text-white'
                        }`}
                      >
                        <span>
                          <span className="block text-sm font-medium">
                            Infinite browse
                          </span>
                          <span className="mt-0.5 block text-xs text-white/40">
                            Show the full source-backed collection. Ranked AI
                            search stays capped.
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
                          onChange={(event) =>
                            isBrowsingCollection
                              ? updateBrowsePageSize(Number(event.target.value))
                              : updateTopK(Number(event.target.value))
                          }
                          className="h-8 w-16 rounded-md border border-white/10 bg-black/20 px-2 text-sm text-white outline-none focus:border-fuchsia-300"
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
                          disabled={isBrowsingCollection}
                          onChange={(event) =>
                            updateMinScorePercent(Number(event.target.value))
                          }
                          className="h-8 w-16 rounded-md border border-white/10 bg-black/20 px-2 text-sm text-white outline-none focus:border-fuchsia-300"
                        />
                      </span>
                      <input
                        type="range"
                        min={0}
                        max={100}
                        step={5}
                        value={Math.round(minScore * 100)}
                        disabled={isBrowsingCollection}
                        onChange={(event) =>
                          updateMinScorePercent(Number(event.target.value))
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
              <div className="py-16 text-center text-sm text-white/45">
                Searching artworks...
              </div>
            )}

            {error && (
              <div className="py-16 text-center">
                <p className="text-sm font-medium text-red-300">
                  {error instanceof Error ? error.message : 'Search failed'}
                </p>
              </div>
            )}

            {!isLoading && !error && results.length > 0 && (
              <>
                <ResultsView
                  view={view}
                  results={visibleResults}
                  selectedColours={activeSortColours}
                  sortMode={sortMode}
                  showSimilarity={!isBrowsingCollection}
                  onSortModeChange={setSortMode}
                  onFacetSearch={runTextSearch}
                  onPaletteColourSelect={useArtworkPaletteColour}
                  onSelectArtwork={setSelectedArtwork}
                />
                <div ref={loadMoreRef} className="flex justify-center py-8">
                  {hasMoreResults ? (
                    <button
                      type="button"
                      onClick={loadMoreResults}
                      disabled={
                        isBrowsingCollection && browseQuery.isFetchingNextPage
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
                  <p className="text-white/55">No artworks found.</p>
                  <p className="mt-1 text-sm text-white/35">
                    Try a broader query or lower the minimum score.
                  </p>
                </div>
              )}
          </section>
        )}
      </main>
      <SearchArtworkDialog
        artwork={selectedArtwork}
        routeId={preferredRouteId}
        onClose={() => setSelectedArtwork(null)}
      />
    </div>
  );
}

function SuggestionPicker({
  suggestions,
  currentQuery,
  onSelect,
}: {
  suggestions: EvalSuggestion[];
  currentQuery: string;
  onSelect: (suggestion: EvalSuggestion) => void;
}) {
  const [index, setIndex] = useState(0);
  const [open, setOpen] = useState(false);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (!suggestions.length) return;
    setIndex((value) => value % suggestions.length);
  }, [suggestions.length]);

  useEffect(() => {
    if (open || paused || suggestions.length < 2) return undefined;

    const handle = window.setInterval(() => {
      setIndex((value) => (value + 1) % suggestions.length);
    }, 4200);

    return () => window.clearInterval(handle);
  }, [open, paused, suggestions.length]);

  if (!suggestions.length) return null;

  const suggestion = suggestions[index] ?? suggestions[0];
  if (!suggestion) return null;

  const activeQuery = currentQuery.trim().toLowerCase();

  return (
    <div
      className="flex min-w-0 items-center overflow-hidden rounded-full border border-white/10 bg-white/[0.04]"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      <span className="shrink-0 border-r border-white/10 px-3 font-mono text-[10px] uppercase tracking-[0.18em] text-white/30">
        Try
      </span>
      <button
        type="button"
        onClick={() => onSelect(suggestion)}
        className={`inline-flex min-w-0 items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors ${
          activeQuery === suggestion.query.toLowerCase()
            ? 'bg-white/[0.12] text-white'
            : 'text-white/70 hover:bg-white/[0.08] hover:text-white'
        }`}
      >
        <span
          className="h-2 w-2 shrink-0 rounded-full"
          style={{ background: suggestion.dot }}
        />
        <span className="shrink-0 font-mono text-[9px] uppercase tracking-[0.14em] text-white/35">
          {suggestion.type}
        </span>
        <span className="truncate">{suggestion.label}</span>
        {suggestion.detail && (
          <span className="hidden shrink-0 font-mono text-[9px] uppercase tracking-[0.12em] text-white/35 sm:inline">
            {suggestion.detail}
          </span>
        )}
      </button>
      <DropdownMenu.Root open={open} onOpenChange={setOpen}>
        <DropdownMenu.Trigger asChild>
          <button
            type="button"
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center border-l border-white/10 text-white/45 transition-colors hover:bg-white/[0.08] hover:text-white"
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
                onSelect={() => {
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

const IdleShowcase = forwardRef<
  HTMLDivElement,
  {
    artworks: ArtworkSearchResult[];
    isLoading: boolean;
    onSearch: (query: string) => void;
  }
>(function IdleShowcase({ artworks, isLoading, onSearch }, ref) {
  const featured = artworks.filter(
    (artwork) => artwork.thumbnailUrl || artwork.imageUrl
  );
  const previewWorks = featured.slice(0, 5);
  const previewItems = Array.from(
    { length: 5 },
    (_, index) => previewWorks[index] ?? null
  );
  const previewLayout = [
    'col-span-3 row-span-2',
    'col-span-2',
    'col-span-1',
    'col-span-1',
    'col-span-2',
  ];

  return (
    <div
      ref={ref}
      className="mx-auto mt-8 max-w-7xl border-y border-white/[0.08] py-6"
    >
      <div className="grid gap-7 lg:grid-cols-[minmax(0,0.85fr)_minmax(480px,1.15fr)] lg:items-center">
        <section className="py-2 lg:py-6">
          <div className="max-w-2xl">
            <p className="font-mono text-[10px] uppercase tracking-[0.26em] text-white/35">
              National Gallery Singapore
            </p>
            <h1 className="mt-3 font-display text-3xl font-semibold leading-tight text-white lg:text-5xl">
              Start with a collection direction.
            </h1>
          </div>
        </section>

        <section className="min-w-0">
          <div className="mb-4 flex items-center justify-between">
            <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-white/35">
              Collection preview
            </p>
            {isLoading && (
              <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-white/25">
                Loading
              </span>
            )}
          </div>
          <div className="grid h-[260px] grid-cols-6 grid-rows-2 gap-2 sm:h-[320px] lg:h-[360px]">
            {previewItems.map((artwork, index) => (
              <button
                key={artwork?.id || `preview-${index}`}
                type="button"
                disabled={!artwork?.title}
                onClick={() => artwork?.title && onSearch(artwork.title)}
                aria-label={
                  artwork?.title ? `Search ${artwork.title}` : 'Loading artwork'
                }
                className={`group relative min-h-0 overflow-hidden border border-white/[0.08] bg-white/[0.035] text-left transition-colors hover:border-white/20 disabled:cursor-default disabled:hover:border-white/[0.08] ${
                  previewLayout[index] || ''
                }`}
              >
                {artwork ? (
                  <>
                    <img
                      src={
                        artwork.thumbnailUrl || artwork.imageUrl || undefined
                      }
                      alt={artwork.title || 'Artwork'}
                      className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"
                    />
                    <span className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 via-black/45 to-transparent px-2 pb-2 pt-8 font-mono text-[9px] uppercase tracking-[0.1em] text-white/70 opacity-0 transition-opacity duration-200 group-hover:opacity-100 group-focus-visible:opacity-100">
                      <span className="block truncate">{artwork.title}</span>
                    </span>
                  </>
                ) : (
                  <div
                    className="h-full w-full animate-pulse bg-white/[0.04]"
                    aria-hidden="true"
                  />
                )}
              </button>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
});

function SearchArtworkDialog({
  artwork,
  routeId,
  onClose,
}: {
  artwork: ArtworkSearchResult | null;
  routeId: string;
  onClose: () => void;
}) {
  const imageUrl = artwork ? getPublicImageUrl(artwork) : null;
  const descriptionDetails = artwork
    ? getPublicDescriptionDetails(artwork)
    : null;
  const caption = artwork ? getGeneratedCaptionText(artwork) : null;
  const catalogRows = artwork ? getPublicCatalogueRows(artwork) : [];
  const catalogPrimarySource = getDominantSourceLabel(catalogRows);
  const ngsUrl = artwork ? getNgsUrl(artwork) : null;
  const rootsUrl = artwork ? getRootsUrl(artwork) : null;

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
          <Dialog.Content className="fixed left-1/2 top-1/2 z-50 grid max-h-[90vh] w-[calc(100vw-2rem)] max-w-5xl -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-lg border border-white/10 bg-[#101014] shadow-2xl outline-none md:grid-cols-[minmax(0,0.95fr)_minmax(360px,1.05fr)]">
            <Dialog.Description className="sr-only">
              Source-labelled catalogue text, public fields, and generated
              caption for the selected artwork.
            </Dialog.Description>
            <div className="flex min-h-[280px] items-center justify-center bg-black/35 p-4 md:min-h-[620px]">
              {imageUrl ? (
                <img
                  src={imageUrl}
                  alt={artwork.title || 'Artwork'}
                  className="max-h-[72vh] w-full rounded-md object-contain"
                />
              ) : (
                <div className="flex h-full min-h-64 w-full items-center justify-center rounded-md bg-white/[0.04] text-white/30">
                  <ImageIcon className="mr-2 h-5 w-5" />
                  No image
                </div>
              )}
            </div>
            <div className="max-h-[90vh] overflow-y-auto p-5">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-white/35">
                    Artwork
                  </p>
                  <Dialog.Title className="mt-2 font-display text-3xl font-semibold leading-tight text-white">
                    {artwork.title || 'Untitled'}
                  </Dialog.Title>
                  {artwork.artist && (
                    <p className="mt-2 text-sm text-white/60">
                      {artwork.artist}
                    </p>
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

              <div className="mt-5 flex flex-wrap gap-2">
                <Link
                  to={`/${routeId}/artworks/${encodeURIComponent(artwork.id)}`}
                  className="inline-flex h-9 items-center gap-2 rounded-md bg-white px-3 text-xs font-semibold text-black transition-opacity hover:opacity-85"
                >
                  Open full page
                </Link>
                {imageUrl && (
                  <a
                    href={imageUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex h-9 items-center gap-2 rounded-md border border-white/10 bg-white/[0.05] px-3 text-xs font-medium text-white/75 transition-colors hover:bg-white/[0.09] hover:text-white"
                  >
                    Open image
                    <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                )}
                {ngsUrl && (
                  <PublicRecordLink
                    href={ngsUrl}
                    label="National Gallery Singapore record"
                  />
                )}
                {rootsUrl && (
                  <PublicRecordLink href={rootsUrl} label="NHB Roots record" />
                )}
              </div>

              {descriptionDetails && (
                <section className="mt-6">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-mono text-[10px] uppercase tracking-[0.2em] text-white/35">
                      Catalogue text
                    </h3>
                    <SourceBadge label={descriptionDetails.sourceLabel} />
                  </div>
                  <p className="mt-2 text-sm leading-relaxed text-white/70">
                    {descriptionDetails.text}
                  </p>
                </section>
              )}

              {catalogRows.length > 0 && (
                <section className="mt-6">
                  <h3 className="font-mono text-[10px] uppercase tracking-[0.2em] text-white/35">
                    Catalogue fields
                  </h3>
                  {catalogPrimarySource && (
                    <p className="mt-1 font-mono text-[9px] uppercase tracking-[0.14em] text-white/35">
                      Mostly from {catalogPrimarySource}; exceptions marked
                    </p>
                  )}
                  <dl className="mt-3 grid gap-2 sm:grid-cols-2">
                    {catalogRows.map(({ label, value, sourceLabel }) => (
                      <div
                        key={label}
                        className="rounded-md border border-white/[0.08] bg-black/20 p-3"
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <dt className="font-mono text-[9px] uppercase tracking-[0.16em] text-white/35">
                            {label}
                          </dt>
                          {sourceLabel !== catalogPrimarySource && (
                            <SourceBadge label={sourceLabel} compact />
                          )}
                        </div>
                        <dd className="mt-1 text-sm text-white/70">{value}</dd>
                      </div>
                    ))}
                  </dl>
                </section>
              )}

              {caption && (
                <section className="mt-6 rounded-md border border-cyan-200/10 bg-cyan-200/[0.04] p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-mono text-[10px] uppercase tracking-[0.2em] text-cyan-100/55">
                      Generated caption
                    </h3>
                    <SourceBadge label="Paillette AI" />
                  </div>
                  <p className="mt-2 text-sm leading-relaxed text-white/68">
                    {caption}
                  </p>
                </section>
              )}
            </div>
          </Dialog.Content>
        )}
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function SourceBadge({
  label,
  compact = false,
}: {
  label: string;
  compact?: boolean;
}) {
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full border border-cyan-200/10 bg-cyan-200/[0.05] font-mono uppercase tracking-[0.12em] text-cyan-100/55 ${
        compact ? 'px-1.5 py-0.5 text-[8px]' : 'px-2 py-0.5 text-[9px]'
      }`}
    >
      {label}
    </span>
  );
}

function PublicRecordLink({ href, label }: { href: string; label: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="inline-flex h-9 items-center gap-2 rounded-md border border-white/10 bg-white/[0.05] px-3 text-xs font-medium text-cyan-100/75 transition-colors hover:bg-white/[0.09] hover:text-cyan-100"
    >
      {label}
      <ExternalLink className="h-3.5 w-3.5" />
    </a>
  );
}

function ColourRail({
  intent,
  selected,
  activeSort,
  customColour,
  onSelect,
  onCustomChange,
  onClear,
}: {
  intent: 'search' | 'sort';
  selected: string[];
  activeSort: boolean;
  customColour: string;
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
}: {
  active: boolean;
  icon: LucideIcon;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`${label} search mode`}
      className={`inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium transition-colors ${
        active
          ? 'bg-white/[0.14] text-white'
          : 'text-white/45 hover:text-white/80'
      }`}
    >
      <Icon className="h-3.5 w-3.5" />
      {label}
    </button>
  );
}

function ColourStrip({
  selected,
  onToggle,
  customColour,
  onCustomChange,
  customAriaLabel = 'Choose custom colour',
  compact = false,
  className = '',
}: {
  selected: string[];
  onToggle: (id: string) => void;
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
            onClick={() => onToggle(colour.id)}
            title={colour.name}
            aria-pressed={active}
            className="relative min-w-7 transition-[filter] hover:brightness-125 focus:z-10 focus:outline-none"
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
            onChange={(event) => onCustomChange(event.target.value)}
            className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
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
  onSortModeChange: (sortMode: SortMode) => void;
  onFacetSearch: (query: string) => void;
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
        onSelectArtwork={onSelectArtwork}
      />
    );
  }

  if (view === 'salon') {
    return <SalonResults results={results} onSelectArtwork={onSelectArtwork} />;
  }

  if (view === 'atlas') {
    return <AtlasResults results={results} onSelectArtwork={onSelectArtwork} />;
  }

  return (
    <MasonryResults
      results={results}
      selectedColours={selectedColours}
      showSimilarity={showSimilarity}
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
  onFacetSearch,
  onPaletteColourSelect,
  onSelectArtwork,
}: {
  results: ArtworkSearchResult[];
  selectedColours: string[];
  showSimilarity: boolean;
  onFacetSearch: (query: string) => void;
  onPaletteColourSelect: (hex: string) => void;
  onSelectArtwork: (artwork: ArtworkSearchResult) => void;
}) {
  const columnCount = useMasonryColumnCount();
  const effectiveColumnCount = Math.min(
    columnCount,
    Math.max(results.length, 1)
  );
  const columns = useMemo(
    () => distributeMasonryResults(results, effectiveColumnCount),
    [results, effectiveColumnCount]
  );

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
              onFacetSearch={onFacetSearch}
              onPaletteColourSelect={onPaletteColourSelect}
              onSelectArtwork={onSelectArtwork}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

function SalonResults({
  results,
  onSelectArtwork,
}: {
  results: ArtworkSearchResult[];
  onSelectArtwork: (artwork: ArtworkSearchResult) => void;
}) {
  return (
    <div className="grid gap-x-8 gap-y-12 pt-8 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {results.map((result, index) => {
        const rotation = ((hashString(`${result.id}-${index}`) % 50) - 25) / 10;
        const image = result.thumbnailUrl || result.imageUrl;
        const rank = (index + 1).toString().padStart(2, '0');

        return (
          <button
            key={result.id}
            type="button"
            onClick={() => onSelectArtwork(result)}
            className="group block w-full appearance-none border-0 bg-transparent p-0 text-left"
            style={{ transform: `rotate(${rotation}deg)` }}
          >
            <div className="bg-[#131318] p-2 shadow-[0_24px_50px_-18px_rgba(0,0,0,0.85),inset_0_0_0_1px_rgba(255,255,255,0.08)] transition-transform duration-300 group-hover:scale-[1.03]">
              {image ? (
                <img
                  src={image}
                  alt={result.title || 'Artwork'}
                  loading="lazy"
                  className="aspect-[4/5] w-full object-cover"
                />
              ) : (
                <div className="flex aspect-[4/5] items-center justify-center bg-white/[0.04] text-sm text-white/30">
                  No image
                </div>
              )}
            </div>
            <p className="mt-3 text-center font-mono text-[9px] uppercase tracking-[0.18em] text-white/45 transition-colors group-hover:text-white/75">
              #{rank}
              <br />
              <span className="font-display text-sm italic normal-case tracking-normal text-white/75">
                {result.title || 'Untitled'}
              </span>
              <br />
              {result.artist || 'Unknown artist'} /{' '}
              {getDateText(result) || 'undated'}
            </p>
          </button>
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
        const image = result.thumbnailUrl || result.imageUrl;
        const rank = (index + 1).toString().padStart(2, '0');

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
              {image ? (
                <img
                  src={image}
                  alt={result.title || 'Artwork'}
                  loading="lazy"
                  className="h-full w-full object-cover"
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-white/25">
                  <ImageIcon className="h-4 w-4" />
                </div>
              )}
            </div>
            <div className="pointer-events-none absolute left-1/2 top-full mt-1.5 -translate-x-1/2 whitespace-nowrap rounded-sm bg-black/90 px-2 py-1 opacity-0 transition-opacity group-hover:opacity-100">
              <span className="text-[10px] italic text-white">
                {result.title || 'Untitled'}
              </span>
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
  onFacetSearch,
  onPaletteColourSelect,
  onSelectArtwork,
}: {
  result: ArtworkSearchResult;
  rank: number;
  selectedColours: string[];
  showSimilarity: boolean;
  onFacetSearch: (query: string) => void;
  onPaletteColourSelect: (hex: string) => void;
  onSelectArtwork: (artwork: ArtworkSearchResult) => void;
}) {
  const palette = collectPalette(result).slice(0, 5);

  return (
    <article className="break-inside-avoid overflow-hidden rounded-lg border border-white/[0.08] bg-white/[0.025]">
      <button
        type="button"
        onClick={() => onSelectArtwork(result)}
        className="group block w-full appearance-none border-0 bg-transparent p-0 text-left"
      >
        <div className="bg-white/[0.03]">
          {result.thumbnailUrl || result.imageUrl ? (
            <img
              src={result.thumbnailUrl || result.imageUrl || undefined}
              alt={result.title || 'Artwork'}
              loading="lazy"
              className="w-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"
            />
          ) : (
            <div className="flex aspect-[4/3] items-center justify-center text-sm text-white/35">
              No image
            </div>
          )}
        </div>
      </button>
      <div className="space-y-3 p-4">
        <div className="flex items-start justify-between gap-3">
          <button
            type="button"
            onClick={() => onSelectArtwork(result)}
            className="min-w-0 appearance-none border-0 bg-transparent p-0 text-left"
          >
            <h2 className="font-display text-lg font-semibold leading-tight text-white transition-colors hover:text-cyan-100">
              {result.title || 'Untitled'}
            </h2>
            <p className="mt-1 text-sm text-white/60">
              {result.artist || 'Unknown artist'}
            </p>
          </button>
          <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-white/35">
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
            className="font-mono text-[10px] uppercase tracking-[0.14em] text-white/35"
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
  onFacetSearch: (query: string) => void;
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
  onSelectArtwork,
}: {
  results: ArtworkSearchResult[];
  selectedColours: string[];
  sortMode: SortMode;
  showSimilarity: boolean;
  onSortModeChange: (sortMode: SortMode) => void;
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
          {results.map((result, index) => (
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
                  {result.thumbnailUrl || result.imageUrl ? (
                    <img
                      src={result.thumbnailUrl || result.imageUrl || undefined}
                      alt=""
                      loading="lazy"
                      className="h-12 w-12 rounded-md object-cover"
                    />
                  ) : (
                    <span className="flex h-12 w-12 items-center justify-center rounded-md bg-white/[0.04] text-white/25">
                      <ImageIcon className="h-4 w-4" />
                    </span>
                  )}
                  <span>
                    <span className="block font-medium">
                      {result.title || 'Untitled'}
                    </span>
                    {getAccession(result) && (
                      <span className="mt-0.5 block font-mono text-[10px] uppercase tracking-[0.14em] text-white/35">
                        {getAccession(result)}
                      </span>
                    )}
                  </span>
                </button>
              </td>
              <td className="px-3 py-3 text-white/65">
                {result.artist || 'Unknown'}
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
          ))}
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
