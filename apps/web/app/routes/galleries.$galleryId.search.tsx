import type { LoaderFunctionArgs, MetaFunction } from '@remix-run/cloudflare';
import { Link, useLoaderData, useSearchParams } from '@remix-run/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { useDropzone } from 'react-dropzone';
import * as Dialog from '@radix-ui/react-dialog';
import {
  ArrowLeft,
  Camera,
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
  getGeneratedCaptionText,
  getGeographicAssociation,
  getNgsUrl,
  getPublicDateText,
  getPublicAccession,
  getPublicCatalogueRows,
  getPublicDescription,
  getPublicImageUrl,
  getRootsUrl,
} from '~/lib/public-artwork-metadata';
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
    const gallery = await getApiClientForRequest(request).getGallery(galleryId);
    return {
      gallery,
      galleryId: gallery.id,
      preferredRouteId: getPreferredOrgRouteId(galleryId, gallery.slug),
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

const EVAL_SUGGESTIONS = [
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
  if (column === 'score') return 'relevance';
  if (column === 'time')
    return current === 'time-asc' ? 'time-desc' : 'time-asc';

  const mode = column;
  if (current === mode) return SORT_DESC[current] || mode;
  if (SORT_ASC[current] === mode) return mode;
  return mode;
};

const tableSortDirection = (column: TableSortColumn, current: SortMode) => {
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

const getCaption = (result: ArtworkSearchResult) => {
  const meta = getMeta(result);
  const caption = meta.generated_caption || meta.generatedCaption;
  if (caption && typeof caption === 'object') {
    return asText((caption as Record<string, unknown>).text);
  }
  return asText(caption);
};

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
          const color = asText((item as Record<string, unknown>).color);
          if (color && hexToRgb(color)) colours.push(color);
        }
      }
    }

    if (candidate && typeof candidate === 'object' && 'colors' in candidate) {
      const colorList = (candidate as { colors?: unknown }).colors;
      if (Array.isArray(colorList)) {
        for (const color of colorList) {
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
  const { gallery, galleryId, preferredRouteId } =
    useLoaderData<typeof loader>();
  const [searchParams, setSearchParams] = useSearchParams();
  const { isAuthenticated, login } = useUser();

  const [searchMode, setSearchMode] = useState<SearchMode>('text');
  const [textQuery, setTextQuery] = useState(searchParams.get('q') || '');
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [selectedColours, setSelectedColours] = useState<string[]>([]);
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

  const currentQuery =
    searchMode === 'image' ? imageSearchQuery : textSearchQuery;
  const rawResults = isBrowsingCollection
    ? browseQuery.data?.pages.flatMap((page) => page.results) || []
    : currentQuery.data?.results || [];
  const results = useMemo(
    () => sortResults(rawResults, sortMode, selectedColours),
    [rawResults, selectedColours, sortMode]
  );
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

  const runColourSearch = (selection: string) => {
    const query = getColourSearchText(selection);
    if (!query) return;

    setSearchMode('colour');
    setIsBrowsingCollection(false);
    setSelectedColours([selection]);
    setSortMode('colour');
    setTextQuery(query);
    setShouldSearch(true);
    setSearchParams({ q: query });
  };

  const runSpectrumColourSort = () => {
    setSortMode('colour');
    setSelectedColours([]);
  };

  const runTargetColourSort = (selection: string) => {
    setSortMode('colour');
    setSelectedColours([selection]);
  };

  const updateSortCustomColour = (hex: string) => {
    setCustomColour(hex);
    setSortMode('colour');
    setSelectedColours([`custom:${hex}`]);
  };

  const updateCustomColour = (hex: string) => {
    setCustomColour(hex);
    if (searchMode === 'colour') {
      setSelectedColours([`custom:${hex}`]);
    }
  };

  const runEvalSearch = (suggestion: (typeof EVAL_SUGGESTIONS)[number]) => {
    const active =
      textQuery.trim().toLowerCase() === suggestion.query.toLowerCase();
    if (active) {
      clearSearch();
      if (suggestion.type === 'colour') {
        setSelectedColours([]);
      }
      return;
    }

    if (suggestion.type === 'colour') {
      const colourId =
        'colourId' in suggestion ? suggestion.colourId : undefined;
      runColourSearch(colourId || `custom:${suggestion.dot}`);
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
            <Link
              to={`/galleries/${preferredRouteId}`}
              className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-white/10 text-white/65 transition-colors hover:text-white"
              aria-label="Back to org"
            >
              <ArrowLeft className="h-4 w-4" />
            </Link>
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
            <Link
              to={`/galleries/${preferredRouteId}/explore`}
              className="hidden rounded-md px-3 py-1.5 text-xs text-white/50 transition-colors hover:bg-white/[0.06] hover:text-white sm:inline-flex"
            >
              Explore
            </Link>
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
        <section className="mx-auto max-w-5xl">
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35 }}
          >
            <div className="mb-6 flex flex-wrap items-center justify-center gap-2 font-mono text-[10px] uppercase tracking-[0.3em] text-white/35">
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

            {searchMode === 'text' ? (
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
            ) : searchMode === 'image' ? (
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
            ) : (
              <ColourSearchPanel
                selected={selectedColours}
                customColour={customColour}
                onSelect={runColourSearch}
                onCustomChange={updateCustomColour}
                onCustomSearch={() => runColourSearch(`custom:${customColour}`)}
                onClear={() => {
                  setSelectedColours([]);
                  clearSearch();
                }}
              />
            )}

            <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
              <span className="self-center pr-1 font-mono text-[10px] uppercase tracking-[0.2em] text-white/30">
                eval set
              </span>
              {EVAL_SUGGESTIONS.map((query) => {
                const active =
                  textQuery.trim().toLowerCase() === query.query.toLowerCase();
                return (
                  <button
                    key={query.type}
                    type="button"
                    onClick={() => runEvalSearch(query)}
                    className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs transition-colors ${
                      active
                        ? 'border-white/30 bg-white/[0.12] text-white'
                        : 'border-white/10 bg-white/[0.04] text-white/65 hover:bg-white/[0.08] hover:text-white'
                    }`}
                  >
                    <span
                      className="h-2 w-2 rounded-full"
                      style={{ background: query.dot }}
                    />
                    <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-white/35">
                      {query.type}
                    </span>
                    <span>{query.label}</span>
                  </button>
                );
              })}
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
                    setIsBrowsingCollection(false);
                    setSearchMode('colour');
                  }}
                />
              </div>
            </div>
          </motion.div>
        </section>

        <section className="mt-8">
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
                  <div className="flex items-center gap-1 rounded-lg border border-white/10 bg-white/[0.035] p-1">
                    {SORT_OPTIONS.map((option) => {
                      const Icon = option.icon;
                      const active =
                        option.id === 'time'
                          ? sortMode === 'time-desc' || sortMode === 'time-asc'
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
                              setSortMode('colour');
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
                  <div className="flex items-center gap-1 rounded-lg border border-white/10 bg-white/[0.035] p-1">
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

              {sortMode === 'colour' && (
                <ColourSortControls
                  selected={selectedColours}
                  customColour={customColour}
                  onSpectrum={runSpectrumColourSort}
                  onSelect={runTargetColourSort}
                  onCustomChange={updateSortCustomColour}
                />
              )}

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
                selectedColours={selectedColours}
                sortMode={sortMode}
                showSimilarity={!isBrowsingCollection}
                onSortModeChange={setSortMode}
                onFacetSearch={runTextSearch}
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
      </main>
      <SearchArtworkDialog
        artwork={selectedArtwork}
        routeId={preferredRouteId}
        onClose={() => setSelectedArtwork(null)}
      />
    </div>
  );
}

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
  const description = artwork ? getPublicDescription(artwork) : null;
  const caption = artwork ? getGeneratedCaptionText(artwork) : null;
  const catalogRows = artwork ? getPublicCatalogueRows(artwork) : [];
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
              Public catalogue metadata and AI caption for the selected artwork.
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

              {description && (
                <section className="mt-6">
                  <h3 className="font-mono text-[10px] uppercase tracking-[0.2em] text-white/35">
                    Catalogue text
                  </h3>
                  <p className="mt-2 text-sm leading-relaxed text-white/70">
                    {description}
                  </p>
                </section>
              )}

              {catalogRows.length > 0 && (
                <section className="mt-6">
                  <h3 className="font-mono text-[10px] uppercase tracking-[0.2em] text-white/35">
                    Public National Gallery Singapore / NHB Roots fields
                  </h3>
                  <dl className="mt-3 grid gap-2 sm:grid-cols-2">
                    {catalogRows.map(({ label, value }) => (
                      <div
                        key={label}
                        className="rounded-md border border-white/[0.08] bg-black/20 p-3"
                      >
                        <dt className="font-mono text-[9px] uppercase tracking-[0.16em] text-white/35">
                          {label}
                        </dt>
                        <dd className="mt-1 text-sm text-white/70">{value}</dd>
                      </div>
                    ))}
                  </dl>
                </section>
              )}

              {caption && (
                <section className="mt-6 rounded-md border border-cyan-200/10 bg-cyan-200/[0.04] p-4">
                  <h3 className="font-mono text-[10px] uppercase tracking-[0.2em] text-cyan-100/55">
                    AI caption
                  </h3>
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

function ColourSortControls({
  selected,
  customColour,
  onSpectrum,
  onSelect,
  onCustomChange,
}: {
  selected: string[];
  customColour: string;
  onSpectrum: () => void;
  onSelect: (id: string) => void;
  onCustomChange: (hex: string) => void;
}) {
  const activeColour = selected[0] ? getSelectedColour(selected[0]) : null;

  return (
    <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-white/[0.07] pt-3">
      <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-white/35">
        Colour sort
      </span>
      <button
        type="button"
        onClick={onSpectrum}
        className={`inline-flex h-8 items-center rounded-md px-2.5 text-xs font-medium transition-colors ${
          selected.length
            ? 'text-white/45 hover:bg-white/[0.06] hover:text-white/80'
            : 'bg-white/[0.12] text-white'
        }`}
      >
        Spectrum
      </button>
      <div className="flex h-8 min-w-[260px] flex-1 overflow-hidden rounded-md border border-white/10 sm:flex-none sm:basis-[420px]">
        {COLOURS.map((colour) => {
          const active = selected.includes(colour.id);
          return (
            <button
              key={colour.id}
              type="button"
              onClick={() => onSelect(colour.id)}
              title={`Nearest ${colour.name.toLowerCase()}`}
              aria-label={`Sort by nearest ${colour.name.toLowerCase()}`}
              aria-pressed={active}
              className="relative min-w-6 flex-1 transition-[filter] hover:brightness-125 focus:z-10 focus:outline-none"
              style={{ background: colour.hex }}
            >
              {active && (
                <span className="absolute inset-0 flex items-center justify-center ring-2 ring-inset ring-white">
                  <span className="h-2 w-2 rounded-full bg-white shadow-[0_1px_8px_rgba(0,0,0,0.8)]" />
                </span>
              )}
            </button>
          );
        })}
      </div>
      <label className="inline-flex h-8 items-center gap-2 rounded-md border border-white/10 bg-white/[0.035] px-2.5">
        <input
          type="color"
          value={customColour}
          onChange={(event) => onCustomChange(event.target.value)}
          className="h-5 w-6 cursor-pointer rounded border-0 bg-transparent p-0"
          aria-label="Choose custom colour sort target"
        />
        <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-white/55">
          {activeColour?.id.startsWith('custom:')
            ? activeColour.name
            : customColour}
        </span>
      </label>
      <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-white/28">
        {activeColour ? `Nearest ${activeColour.name}` : 'Palette band order'}
      </span>
    </div>
  );
}

function ColourSearchPanel({
  selected,
  customColour,
  onSelect,
  onCustomChange,
  onCustomSearch,
  onClear,
}: {
  selected: string[];
  customColour: string;
  onSelect: (id: string) => void;
  onCustomChange: (hex: string) => void;
  onCustomSearch: () => void;
  onClear: () => void;
}) {
  const activeColour = selected[0] ? getSelectedColour(selected[0]) : null;

  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.025] p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Palette className="h-4 w-4 text-white/45" />
          <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-white/45">
            colour search
          </span>
        </div>
        {activeColour && (
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/[0.06] px-2.5 py-1 text-[11px] text-white/70">
              <span
                className="h-3 w-3 rounded-full"
                style={{ background: activeColour.hex }}
              />
              {activeColour.name}
            </span>
            <button
              type="button"
              onClick={onClear}
              className="rounded-md px-2 py-1 font-mono text-[10px] uppercase tracking-[0.16em] text-white/40 transition-colors hover:bg-white/[0.06] hover:text-white"
            >
              Clear
            </button>
          </div>
        )}
      </div>
      <ColourStrip selected={selected} onToggle={onSelect} />
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-md border border-white/10 bg-black/20 px-3 py-2">
        <label className="flex items-center gap-3">
          <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-white/45">
            Custom
          </span>
          <input
            type="color"
            value={customColour}
            onChange={(event) => onCustomChange(event.target.value)}
            className="h-8 w-10 cursor-pointer rounded border-0 bg-transparent p-0"
            aria-label="Choose custom colour"
          />
          <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-white/65">
            {customColour}
          </span>
        </label>
        <button
          type="button"
          onClick={onCustomSearch}
          className="inline-flex h-8 items-center gap-1.5 rounded-md bg-white/[0.12] px-3 text-xs font-medium text-white transition-colors hover:bg-white/[0.18]"
        >
          <Search className="h-3.5 w-3.5" />
          Search
        </button>
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
}: {
  selected: string[];
  onToggle: (id: string) => void;
}) {
  return (
    <div className="flex h-11 overflow-hidden rounded-md border border-white/10">
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
                <span className="h-2.5 w-2.5 rounded-full bg-white shadow-[0_1px_8px_rgba(0,0,0,0.8)]" />
              </span>
            )}
          </button>
        );
      })}
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
  onSelectArtwork,
}: {
  view: ViewMode;
  results: ArtworkSearchResult[];
  selectedColours: string[];
  sortMode: SortMode;
  showSimilarity: boolean;
  onSortModeChange: (sortMode: SortMode) => void;
  onFacetSearch: (query: string) => void;
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
      onSelectArtwork={onSelectArtwork}
    />
  );
}

function MasonryResults({
  results,
  selectedColours,
  showSimilarity,
  onFacetSearch,
  onSelectArtwork,
}: {
  results: ArtworkSearchResult[];
  selectedColours: string[];
  showSimilarity: boolean;
  onFacetSearch: (query: string) => void;
  onSelectArtwork: (artwork: ArtworkSearchResult) => void;
}) {
  return (
    <div className="columns-1 gap-4 pt-6 sm:columns-2 lg:columns-3 xl:columns-4">
      {results.map((result, index) => (
        <ResultCard
          key={result.id}
          result={result}
          rank={index + 1}
          selectedColours={selectedColours}
          showSimilarity={showSimilarity}
          onFacetSearch={onFacetSearch}
          onSelectArtwork={onSelectArtwork}
        />
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
              zIndex: 10 + index,
            }}
          >
            <div className="relative aspect-[4/5] -translate-x-1/2 -translate-y-1/2 overflow-hidden bg-[#17171b] shadow-[0_18px_34px_-12px_rgba(0,0,0,0.9)] transition-transform duration-300 group-hover:scale-125">
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
  onSelectArtwork,
}: {
  result: ArtworkSearchResult;
  rank: number;
  selectedColours: string[];
  showSimilarity: boolean;
  onFacetSearch: (query: string) => void;
  onSelectArtwork: (artwork: ArtworkSearchResult) => void;
}) {
  const palette = collectPalette(result).slice(0, 5);
  const caption = getCaption(result);

  return (
    <article className="mb-4 break-inside-avoid overflow-hidden rounded-lg border border-white/[0.08] bg-white/[0.025]">
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

        {caption && (
          <p className="line-clamp-3 text-sm leading-relaxed text-white/50">
            <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-cyan-200/65">
              AI caption
            </span>{' '}
            {caption}
          </p>
        )}

        <div className="flex items-center justify-between gap-3">
          <PaletteDots colours={palette} />
          <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-white/35">
            {showSimilarity
              ? selectedColours.length
                ? `dE ${Math.round(colourScore(result, selectedColours))}`
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

function PaletteDots({ colours }: { colours: string[] }) {
  if (!colours.length) {
    return (
      <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-white/25">
        No palette
      </span>
    );
  }

  return (
    <div className="flex items-center gap-1">
      {colours.map((colour) => (
        <span
          key={colour}
          className="h-4 w-4 rounded-sm border border-white/15"
          style={{ background: colour }}
          title={colour}
        />
      ))}
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
  return (
    <div className="mt-6 overflow-x-auto rounded-lg border border-white/[0.08]">
      <table className="w-full min-w-[980px] border-collapse text-sm">
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
              label={showSimilarity ? 'Score' : 'Rank'}
              column="score"
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
              <td className="px-3 py-3 font-mono text-white/55">
                {showSimilarity
                  ? selectedColours.length
                    ? `dE ${Math.round(colourScore(result, selectedColours))}`
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
  const nextSortMode = tableColumnSortMode(column, sortMode);

  return (
    <th className="px-3 py-3 font-normal">
      <button
        type="button"
        onClick={() => onSortModeChange(nextSortMode)}
        className={`inline-flex h-7 items-center gap-1.5 rounded-md px-2 transition-colors ${
          direction
            ? 'bg-white/[0.1] text-white'
            : 'text-white/45 hover:bg-white/[0.06] hover:text-white/75'
        }`}
        aria-label={`Sort table by ${label.toLowerCase()}`}
      >
        {label}
        <span className="text-[9px] tracking-[0.08em] text-white/35">
          {direction === 'asc' ? 'ASC' : direction === 'desc' ? 'DESC' : ''}
        </span>
      </button>
    </th>
  );
}
