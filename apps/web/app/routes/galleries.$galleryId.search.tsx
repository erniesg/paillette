import type { LoaderFunctionArgs, MetaFunction } from '@remix-run/cloudflare';
import { Link, useLoaderData, useSearchParams } from '@remix-run/react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { useDropzone } from 'react-dropzone';
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
  Table2,
  X,
  type LucideIcon,
} from 'lucide-react';
import { getApiClientForRequest, getPreferredOrgRouteId } from '~/lib/api';
import type {
  ApiResponse,
  ArtworkSearchResult,
  SearchImageRequest,
  SearchResponse,
  SearchTextRequest,
} from '~/types';
import { useUser } from '~/contexts/user-context';

export const meta: MetaFunction = () => {
  return [
    { title: 'Search Artworks - Paillette' },
    {
      name: 'description',
      content: 'Search and discover artworks using AI-powered multimodal search',
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

type SearchMode = 'text' | 'image';
type ViewMode = 'masonry' | 'salon' | 'atlas' | 'table';
type SortMode = 'relevance' | 'colour' | 'time-desc' | 'time-asc' | 'artist' | 'title';

const EXAMPLE_QUERIES = [
  { label: 'pineapple', dot: '#cda636' },
  { label: 'fishing boats', dot: '#365f9c' },
  { label: 'self portrait', dot: '#6a5238' },
  { label: 'batik patterns', dot: '#bf5631' },
  { label: '1950s Singapore', dot: '#8a9a7a' },
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

const SORT_OPTIONS: { id: SortMode; label: string; icon: LucideIcon }[] = [
  { id: 'relevance', label: 'Relevance', icon: ListFilter },
  { id: 'colour', label: 'Colour', icon: Palette },
  { id: 'time-desc', label: 'Newest', icon: Clock },
  { id: 'time-asc', label: 'Oldest', icon: Clock },
  { id: 'artist', label: 'Artist', icon: ListFilter },
  { id: 'title', label: 'Title', icon: ListFilter },
];

const VIEW_OPTIONS: { id: ViewMode; label: string; icon: LucideIcon }[] = [
  { id: 'masonry', label: 'Masonry', icon: LayoutGrid },
  { id: 'salon', label: 'Salon', icon: Frame },
  { id: 'atlas', label: 'Atlas', icon: Network },
  { id: 'table', label: 'Table', icon: Table2 },
];

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
  asText(getMeta(result).dateText) || asText(getMeta(result).date_text) || String(getYear(result) || '');

const getMedium = (result: ArtworkSearchResult) =>
  asText(getMeta(result).medium) || asText(getMeta(result).classification);

const getAccession = (result: ArtworkSearchResult) =>
  asText(getMeta(result).accessionNumber) || asText(getMeta(result).accession_number);

const getSourceName = (result: ArtworkSearchResult) =>
  asText(getMeta(result).sourceInstitution) ||
  asText(getMeta(result).source_institution) ||
  'National Gallery Singapore';

const getCaption = (result: ArtworkSearchResult) => {
  const meta = getMeta(result);
  const caption = meta.generated_caption || meta.generatedCaption;
  if (caption && typeof caption === 'object') {
    return asText((caption as Record<string, unknown>).text);
  }
  return asText(caption);
};

const getSourceUrl = (result: ArtworkSearchResult) =>
  asText(getMeta(result).sourceUrl) ||
  asText(getMeta(result).source_url) ||
  asText(getMeta(result).ngs_detail_url);

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
    const selectedColour = COLOURS.find((colour) => colour.id === colourId);
    if (!selectedColour) return sum;
    const nearest = Math.min(
      ...palette.map((paletteColour) => rgbDistance(selectedColour.hex, paletteColour))
    );
    return sum + nearest;
  }, 0);

  return total / selected.length;
};

const sortResults = (
  results: ArtworkSearchResult[],
  sortMode: SortMode,
  selectedColours: string[]
) => {
  const sorted = [...results];

  sorted.sort((a, b) => {
    if (sortMode === 'colour') {
      const delta = colourScore(a, selectedColours) - colourScore(b, selectedColours);
      if (Number.isFinite(delta) && delta !== 0) return delta;
    }

    if (sortMode === 'time-desc') {
      return (getYear(b) || -Infinity) - (getYear(a) || -Infinity);
    }

    if (sortMode === 'time-asc') {
      return (getYear(a) || Infinity) - (getYear(b) || Infinity);
    }

    if (sortMode === 'artist') {
      return (a.artist || '').localeCompare(b.artist || '') || b.similarity - a.similarity;
    }

    if (sortMode === 'title') {
      return (a.title || '').localeCompare(b.title || '') || b.similarity - a.similarity;
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

export default function SearchPage() {
  const { gallery, galleryId, preferredRouteId } = useLoaderData<typeof loader>();
  const [searchParams, setSearchParams] = useSearchParams();
  const { isAuthenticated, login } = useUser();

  const [searchMode, setSearchMode] = useState<SearchMode>('text');
  const [textQuery, setTextQuery] = useState(searchParams.get('q') || '');
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [selectedColours, setSelectedColours] = useState<string[]>([]);
  const [sortMode, setSortMode] = useState<SortMode>('relevance');
  const [view, setView] = useState<ViewMode>('masonry');
  const [topK, setTopK] = useState(30);
  const [minScore, setMinScore] = useState(0.3);
  const [shouldSearch, setShouldSearch] = useState(Boolean(searchParams.get('q')));

  const textSearchQuery = useQuery({
    queryKey: ['search', 'text', galleryId, textQuery, topK, minScore],
    queryFn: async () => {
      if (!textQuery.trim()) return null;
      return publicSearchText(
        galleryId,
        {
          query: textQuery,
          topK,
          minScore,
        }
      );
    },
    enabled:
      searchMode === 'text' &&
      shouldSearch &&
      textQuery.trim().length > 0,
  });

  const imageSearchQuery = useQuery({
    queryKey: ['search', 'image', galleryId, imageFile?.name, topK, minScore],
    queryFn: async () => {
      if (!imageFile) return null;
      return publicSearchImage(
        galleryId,
        {
          image: imageFile,
          topK,
          minScore,
        }
      );
    },
    enabled: searchMode === 'image' && shouldSearch && imageFile !== null,
  });

  const currentQuery = searchMode === 'text' ? textSearchQuery : imageSearchQuery;
  const rawResults = currentQuery.data?.results || [];
  const results = useMemo(
    () => sortResults(rawResults, sortMode, selectedColours),
    [rawResults, selectedColours, sortMode]
  );
  const isLoading = currentQuery.isLoading || currentQuery.isFetching;
  const error = currentQuery.error;

  useEffect(() => {
    if (searchMode !== 'text') return undefined;

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
  }, [searchMode, setSearchParams, textQuery]);

  const onDrop = useCallback((acceptedFiles: File[]) => {
    const file = acceptedFiles[0];
    if (file) {
      setImageFile(file);
      setImagePreview(URL.createObjectURL(file));
      setSearchMode('image');
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

    setSearchMode('text');
    setTextQuery(trimmed);
    setShouldSearch(true);
    setSearchParams({ q: trimmed });
  };

  const clearImage = () => {
    setImageFile(null);
    setImagePreview(null);
    setShouldSearch(false);
  };

  const toggleColour = (id: string) => {
    setSelectedColours((prev) =>
      prev.includes(id) ? prev.filter((value) => value !== id) : [...prev, id]
    );
    setSortMode('colour');
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
                className="font-display text-lg font-semibold leading-none tracking-normal"
              >
                Paillette
              </Link>
              <p className="mt-1 truncate font-mono text-[10px] uppercase tracking-[0.2em] text-white/35">
                {gallery.name}
              </p>
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
            ) : (
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
                    <p className="mt-3 text-sm text-white/65">Drop an image to search visually</p>
                    <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.18em] text-white/30">
                      jpg / png / webp
                    </p>
                  </div>
                )}
              </div>
            )}

            <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
              <span className="self-center pr-1 font-mono text-[10px] uppercase tracking-[0.2em] text-white/30">
                try
              </span>
              {EXAMPLE_QUERIES.map((query) => {
                const active = textQuery.trim().toLowerCase() === query.label.toLowerCase();
                return (
                  <button
                    key={query.label}
                    type="button"
                    onClick={() => {
                      if (active) {
                        setTextQuery('');
                        setShouldSearch(false);
                        setSearchParams({}, { replace: true });
                        return;
                      }

                      runTextSearch(query.label);
                    }}
                    className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs transition-colors ${
                      active
                        ? 'border-white/30 bg-white/[0.12] text-white'
                        : 'border-white/10 bg-white/[0.04] text-white/65 hover:bg-white/[0.08] hover:text-white'
                    }`}
                  >
                    <span className="h-2 w-2 rounded-full" style={{ background: query.dot }} />
                    {query.label}
                  </button>
                );
              })}
              <div className="ml-0 flex items-center gap-1 rounded-lg border border-white/10 bg-white/[0.035] p-1 sm:ml-2">
                <ModeButton
                  active={searchMode === 'text'}
                  icon={Search}
                  label="Text"
                  onClick={() => setSearchMode('text')}
                />
                <ModeButton
                  active={searchMode === 'image'}
                  icon={ImageIcon}
                  label="Image"
                  onClick={() => setSearchMode('image')}
                />
              </div>
            </div>

            <div className="mt-8 border-t border-white/[0.08] pt-5">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-baseline gap-2">
                  <span className="font-mono text-[10px] uppercase tracking-[0.28em] text-white/45">
                    Refine
                  </span>
                  <span className="text-sm font-medium text-white/75">Colour</span>
                </div>
                {selectedColours.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setSelectedColours([])}
                    className="rounded-md px-2 py-1 font-mono text-[10px] uppercase tracking-[0.16em] text-white/40 transition-colors hover:bg-white/[0.06] hover:text-white"
                  >
                    Clear colours
                  </button>
                )}
              </div>
              <ColourStrip selected={selectedColours} onToggle={toggleColour} />
            </div>

            <div className="mt-4 flex flex-wrap items-center justify-center gap-3">
              {selectedColours.map((id) => {
                const colour = COLOURS.find((item) => item.id === id);
                if (!colour) return null;
                return (
                  <span
                    key={id}
                    className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/[0.06] px-2.5 py-1 text-[11px] text-white/70"
                  >
                    <span className="h-3 w-3 rounded-full" style={{ background: colour.hex }} />
                    {colour.name}
                  </span>
                );
              })}
              <label className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-white/45">
                Limit
                <input
                  type="number"
                  min={1}
                  max={50}
                  value={topK}
                  onChange={(event) => setTopK(Number(event.target.value))}
                  className="h-8 w-16 rounded-md border border-white/10 bg-black/20 px-2 text-sm text-white outline-none focus:border-fuchsia-300"
                />
              </label>
              <label className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-white/45">
                Score
                <input
                  type="number"
                  min={0}
                  max={100}
                  step={5}
                  value={Math.round(minScore * 100)}
                  onChange={(event) => setMinScore(Number(event.target.value) / 100)}
                  className="h-8 w-16 rounded-md border border-white/10 bg-black/20 px-2 text-sm text-white outline-none focus:border-fuchsia-300"
                />
              </label>
            </div>
          </motion.div>
        </section>

        <section className="mt-8">
          <div className="sticky top-14 z-30 -mx-5 border-y border-white/[0.07] bg-[#0b0b0e]/90 px-5 py-3 backdrop-blur-md lg:-mx-8 lg:px-8">
            <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3">
              <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-white/45">
                {isLoading
                  ? 'Searching'
                  : results.length
                    ? `${results.length} works`
                    : shouldSearch
                      ? 'No works'
                      : 'Ready'}
                {textQuery && searchMode === 'text' && (
                  <span className="ml-2 normal-case tracking-normal text-white/70">
                    "{textQuery}"
                  </span>
                )}
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <div className="flex items-center gap-1 rounded-lg border border-white/10 bg-white/[0.035] p-1">
                  {SORT_OPTIONS.map((option) => {
                    const Icon = option.icon;
                    return (
                      <button
                        key={option.id}
                        type="button"
                        onClick={() => setSortMode(option.id)}
                        title={`Sort by ${option.label.toLowerCase()}`}
                        className={`inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium transition-colors ${
                          sortMode === option.id
                            ? 'bg-white/[0.14] text-white'
                            : 'text-white/45 hover:text-white/80'
                        }`}
                      >
                        <Icon className="h-3.5 w-3.5" />
                        <span className="hidden md:inline">{option.label}</span>
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
                        <span className="hidden sm:inline">{option.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>

          {isLoading && (
            <div className="py-16 text-center text-sm text-white/45">Searching artworks...</div>
          )}

          {error && (
            <div className="py-16 text-center">
              <p className="text-sm font-medium text-red-300">
                {error instanceof Error ? error.message : 'Search failed'}
              </p>
            </div>
          )}

          {!isLoading && !error && results.length > 0 && (
            <ResultsView
              view={view}
              results={results}
              routeId={preferredRouteId}
              selectedColours={selectedColours}
            />
          )}

          {!isLoading && !error && shouldSearch && results.length === 0 && (
            <div className="py-16 text-center">
              <p className="text-white/55">No artworks found.</p>
              <p className="mt-1 text-sm text-white/35">
                Try a broader query or lower the minimum score.
              </p>
            </div>
          )}
        </section>
      </main>
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
  routeId,
  selectedColours,
}: {
  view: ViewMode;
  results: ArtworkSearchResult[];
  routeId: string;
  selectedColours: string[];
}) {
  if (view === 'table') {
    return (
      <TableResults
        results={results}
        routeId={routeId}
        selectedColours={selectedColours}
      />
    );
  }

  if (view === 'salon') {
    return <SalonResults results={results} routeId={routeId} />;
  }

  if (view === 'atlas') {
    return <AtlasResults results={results} routeId={routeId} />;
  }

  return (
    <MasonryResults
      results={results}
      routeId={routeId}
      selectedColours={selectedColours}
    />
  );
}

function MasonryResults({
  results,
  routeId,
  selectedColours,
}: {
  results: ArtworkSearchResult[];
  routeId: string;
  selectedColours: string[];
}) {
  return (
    <div className="columns-1 gap-4 pt-6 sm:columns-2 lg:columns-3 xl:columns-4">
      {results.map((result, index) => (
        <ResultCard
          key={result.id}
          result={result}
          rank={index + 1}
          routeId={routeId}
          selectedColours={selectedColours}
        />
      ))}
    </div>
  );
}

function SalonResults({
  results,
  routeId,
}: {
  results: ArtworkSearchResult[];
  routeId: string;
}) {
  return (
    <div className="grid gap-x-8 gap-y-12 pt-8 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {results.map((result, index) => {
        const rotation = ((hashString(`${result.id}-${index}`) % 50) - 25) / 10;
        const image = result.thumbnailUrl || result.imageUrl;

        return (
          <Link
            key={result.id}
            to={`/${routeId}/artworks/${encodeURIComponent(result.id)}`}
            className="group block"
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
              {result.artist || 'Unknown artist'} / {getDateText(result) || 'undated'}
            </p>
          </Link>
        );
      })}
    </div>
  );
}

function AtlasResults({
  results,
  routeId,
}: {
  results: ArtworkSearchResult[];
  routeId: string;
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
          <Link
            key={result.id}
            to={`/${routeId}/artworks/${encodeURIComponent(result.id)}`}
            className="group absolute"
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
          </Link>
        );
      })}
    </div>
  );
}

function ResultCard({
  result,
  rank,
  routeId,
  selectedColours,
}: {
  result: ArtworkSearchResult;
  rank: number;
  routeId: string;
  selectedColours: string[];
}) {
  const palette = collectPalette(result).slice(0, 5);
  const caption = getCaption(result);

  return (
    <article className="mb-4 break-inside-avoid overflow-hidden rounded-lg border border-white/[0.08] bg-white/[0.025]">
      <Link to={`/${routeId}/artworks/${encodeURIComponent(result.id)}`} className="group block">
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
        <div className="space-y-3 p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="font-display text-lg font-semibold leading-tight text-white">
                {result.title || 'Untitled'}
              </h2>
              <p className="mt-1 text-sm text-white/60">{result.artist || 'Unknown artist'}</p>
            </div>
            <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-white/35">
              #{rank.toString().padStart(2, '0')}
            </span>
          </div>

          <MetadataLine result={result} />

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
              {selectedColours.length ? `dE ${Math.round(colourScore(result, selectedColours))}` : `${Math.round(result.similarity * 100)}%`}
            </span>
          </div>
        </div>
      </Link>
    </article>
  );
}

function MetadataLine({ result }: { result: ArtworkSearchResult }) {
  const items = [
    getDateText(result),
    getMedium(result),
    asText(getMeta(result).classification),
    getAccession(result),
  ].filter(Boolean);

  return (
    <div className="flex flex-wrap gap-1.5">
      {items.slice(0, 4).map((item) => (
        <span
          key={item}
          className="rounded-md border border-white/10 bg-black/20 px-2 py-1 text-[11px] text-white/55"
        >
          {item}
        </span>
      ))}
    </div>
  );
}

function PaletteDots({ colours }: { colours: string[] }) {
  if (!colours.length) {
    return <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-white/25">No palette</span>;
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
  routeId,
  selectedColours,
}: {
  results: ArtworkSearchResult[];
  routeId: string;
  selectedColours: string[];
}) {
  return (
    <div className="mt-6 overflow-x-auto rounded-lg border border-white/[0.08]">
      <table className="w-full min-w-[980px] border-collapse text-sm">
        <thead className="border-b border-white/[0.08] bg-white/[0.04]">
          <tr className="text-left font-mono text-[10px] uppercase tracking-[0.18em] text-white/45">
            <th className="px-3 py-3 font-normal">#</th>
            <th className="px-3 py-3 font-normal">Work</th>
            <th className="px-3 py-3 font-normal">Artist</th>
            <th className="px-3 py-3 font-normal">Date</th>
            <th className="px-3 py-3 font-normal">Medium</th>
            <th className="px-3 py-3 font-normal">Source</th>
            <th className="px-3 py-3 font-normal">Score</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-white/[0.06]">
          {results.map((result, index) => (
            <tr key={result.id} className="transition-colors hover:bg-white/[0.035]">
              <td className="px-3 py-3 font-mono text-white/35">
                {(index + 1).toString().padStart(2, '0')}
              </td>
              <td className="px-3 py-3">
                <Link
                  to={`/${routeId}/artworks/${encodeURIComponent(result.id)}`}
                  className="flex items-center gap-3 text-white transition-colors hover:text-cyan-200"
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
                    <span className="block font-medium">{result.title || 'Untitled'}</span>
                    {getAccession(result) && (
                      <span className="mt-0.5 block font-mono text-[10px] uppercase tracking-[0.14em] text-white/35">
                        {getAccession(result)}
                      </span>
                    )}
                  </span>
                </Link>
              </td>
              <td className="px-3 py-3 text-white/65">{result.artist || 'Unknown'}</td>
              <td className="px-3 py-3 text-white/55">{getDateText(result) || '-'}</td>
              <td className="px-3 py-3 text-white/55">{getMedium(result) || '-'}</td>
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
                {selectedColours.length
                  ? `dE ${Math.round(colourScore(result, selectedColours))}`
                  : `${Math.round(result.similarity * 100)}%`}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
