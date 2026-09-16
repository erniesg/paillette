import type { MetaFunction } from '@remix-run/cloudflare';
import { Link } from '@remix-run/react';
import { AlertTriangle, ArrowLeft, ImageIcon, Loader2 } from 'lucide-react';
import type { MouseEvent } from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { reduceTo2D } from '~/lib/dimensionality-reduction';
import type { ApiResponse, ArtworkSearchResult, SearchResponse } from '~/types';

export const meta: MetaFunction = () => [{ title: 'NGS Atlas - Paillette' }];

type BrowsePayload = SearchResponse & {
  total?: number;
  limit?: number;
  offset?: number;
  hasMore?: boolean;
};

type AtlasMode = 'embedded' | 'field' | 'error';

type EmbeddingArtwork = {
  id: string;
  title: string;
  artist: string | null;
  year: number | null;
  medium: string | null;
  imageUrl: string | null;
  thumbnailUrl: string | null;
  embedding: number[];
};

type EmbeddingsPayload = {
  embeddings: EmbeddingArtwork[];
  total: number;
  dimensions: number;
};

type AtlasPoint = {
  artwork: ArtworkSearchResult;
  x: number;
  y: number;
  residual: number;
  residualReasons: string[];
  residualLabel: 'projection residual' | 'metadata residual';
  hue: number;
  size: number;
};

const PAGE_SIZE = 100;
const EMBEDDING_PAGE_SIZE = 1000;
const MAX_ARTWORKS = 10000;
const PAGE_BATCH_SIZE = 4;
const YEAR_MIN = 1850;
const YEAR_MAX = 2026;
const ERROR_BANDS = ['image', 'description', 'source', 'date', 'colour', 'artist', 'accession', 'complete'];

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

const hashString = (value: string) => {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash >>> 0);
};

const normalizedHash = (value: string, salt = '') =>
  (hashString(`${salt}:${value}`) % 10000) / 10000;

const asRecord = (value: unknown): Record<string, any> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, any>)
    : {};

const getTitle = (artwork: ArtworkSearchResult) =>
  artwork.title || artwork.metadata?.title || 'Untitled';

const getArtist = (artwork: ArtworkSearchResult) =>
  artwork.artist || artwork.metadata?.artist || 'Unknown artist';

const getDateText = (artwork: ArtworkSearchResult) =>
  artwork.metadata?.dateText || artwork.metadata?.date_text || '';

const getAccession = (artwork: ArtworkSearchResult) =>
  artwork.metadata?.accessionNumber || artwork.metadata?.accession_number || '';

const getClassification = (artwork: ArtworkSearchResult) =>
  artwork.metadata?.classification || artwork.metadata?.medium || 'Unclassified';

const getYear = (artwork: ArtworkSearchResult) => {
  if (typeof artwork.year === 'number') return artwork.year;
  const match = String(getDateText(artwork)).match(/\b(1[5-9]\d{2}|20\d{2})\b/);
  return match ? Number(match[1]) : null;
};

const getPalette = (artwork: ArtworkSearchResult) => {
  const metadata = artwork.metadata || {};
  const colorPalette = asRecord(metadata.colorPalette || metadata.color_palette);
  const colors = Array.isArray(colorPalette.colors)
    ? colorPalette.colors
    : Array.isArray(metadata.dominantColors)
      ? metadata.dominantColors
      : Array.isArray(metadata.dominant_colors)
        ? metadata.dominant_colors
        : [];

  return colors.filter((color): color is string => typeof color === 'string');
};

const hexToHue = (hex: string) => {
  const normalized = hex.replace('#', '').trim();
  if (!/^[0-9a-f]{6}$/i.test(normalized)) return null;

  const red = parseInt(normalized.slice(0, 2), 16) / 255;
  const green = parseInt(normalized.slice(2, 4), 16) / 255;
  const blue = parseInt(normalized.slice(4, 6), 16) / 255;
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const delta = max - min;
  if (delta === 0) return 0;

  const hue =
    max === red
      ? ((green - blue) / delta) % 6
      : max === green
        ? (blue - red) / delta + 2
        : (red - green) / delta + 4;

  return (Math.round(hue * 60) + 360) % 360;
};

const getArtworkHue = (artwork: ArtworkSearchResult) => {
  const paletteHue = getPalette(artwork)
    .map(hexToHue)
    .find((hue): hue is number => typeof hue === 'number');

  if (typeof paletteHue === 'number') return paletteHue;
  return Math.round(normalizedHash(artwork.id, 'hue') * 360);
};

const getResidual = (artwork: ArtworkSearchResult) => {
  const metadata = artwork.metadata || {};
  const checks = [
    {
      label: 'image',
      missing: !artwork.imageUrl && !artwork.thumbnailUrl,
      weight: 0.22,
    },
    { label: 'artist', missing: !artwork.artist && !metadata.artist, weight: 0.12 },
    { label: 'date', missing: !getYear(artwork), weight: 0.12 },
    {
      label: 'description',
      missing: !metadata.description || String(metadata.description).length < 80,
      weight: 0.18,
    },
    {
      label: 'source',
      missing:
        !metadata.sourceUrl &&
        !metadata.source_url &&
        !metadata.rootsListingUrl &&
        !metadata.roots_listing_url,
      weight: 0.14,
    },
    {
      label: 'colour',
      missing: getPalette(artwork).length === 0,
      weight: 0.1,
    },
    {
      label: 'accession',
      missing: !getAccession(artwork),
      weight: 0.12,
    },
  ];

  const residual = checks.reduce(
    (sum, check) => sum + (check.missing ? check.weight : 0),
    0
  );
  const residualReasons = checks
    .filter((check) => check.missing)
    .map((check) => check.label);

  return { residual: clamp(residual, 0, 1), residualReasons };
};

const buildPoint = (artwork: ArtworkSearchResult): AtlasPoint => {
  const year = getYear(artwork);
  const classification = getClassification(artwork);
  const artist = getArtist(artwork);
  const hue = getArtworkHue(artwork);
  const { residual, residualReasons } = getResidual(artwork);
  const yearX =
    year === null
      ? normalizedHash(`${artist}:${artwork.id}`, 'missing-year')
      : clamp((year - YEAR_MIN) / (YEAR_MAX - YEAR_MIN), 0, 1);
  const colourY = hue / 360;
  const classBand = normalizedHash(classification, 'classification');
  const artistJitter = normalizedHash(artist, 'artist') - 0.5;
  const idJitter = normalizedHash(artwork.id, 'id') - 0.5;

  return {
    artwork,
    x: clamp(yearX * 86 + 7 + idJitter * 2.8, 2, 98),
    y: clamp((colourY * 0.58 + classBand * 0.42) * 82 + 8 + artistJitter * 5, 4, 96),
    residual,
    residualReasons,
    residualLabel: 'metadata residual',
    hue,
    size: 4.5 + Math.max(0, 1 - residual) * 3.5,
  };
};

const formatPercent = (value: number) => `${Math.round(value * 100)}%`;

const embeddingToArtwork = (artwork: EmbeddingArtwork): ArtworkSearchResult => ({
  id: artwork.id,
  galleryId: 'ngs',
  title: artwork.title,
  artist: artwork.artist || undefined,
  year: artwork.year || undefined,
  imageUrl: artwork.imageUrl,
  thumbnailUrl: artwork.thumbnailUrl,
  similarity: 1,
  metadata: {
    medium: artwork.medium || undefined,
  },
});

const cosineDistance = (a: number[], b: number[]) => {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  const length = Math.min(a.length, b.length);

  for (let index = 0; index < length; index += 1) {
    const av = a[index] || 0;
    const bv = b[index] || 0;
    dot += av * bv;
    normA += av * av;
    normB += bv * bv;
  }

  if (!normA || !normB) return 1;
  return 1 - dot / (Math.sqrt(normA) * Math.sqrt(normB));
};

const estimateProjectionResiduals = (
  embeddings: number[][],
  points: Array<{ x: number; y: number }>
) => {
  if (!embeddings.length) return [];
  const anchorCount = Math.min(10, embeddings.length);
  const anchors = Array.from({ length: anchorCount }, (_, index) =>
    Math.floor((index / Math.max(1, anchorCount - 1)) * (embeddings.length - 1))
  );

  return embeddings.map((embedding, index) => {
    const point = points[index] || { x: 0, y: 0 };
    const error = anchors.reduce((sum, anchorIndex) => {
      if (anchorIndex === index) return sum;
      const anchorEmbedding = embeddings[anchorIndex];
      const anchorPoint = points[anchorIndex];
      if (!anchorEmbedding || !anchorPoint) return sum;

      const highDistance = clamp(cosineDistance(embedding, anchorEmbedding), 0, 2) / 2;
      const lowDistance =
        Math.hypot(point.x - anchorPoint.x, point.y - anchorPoint.y) / Math.SQRT2;
      return sum + Math.abs(highDistance - lowDistance);
    }, 0);

    return clamp(error / Math.max(1, anchorCount - 1), 0, 1);
  });
};

const buildEmbeddingPoints = (artworks: EmbeddingArtwork[]): AtlasPoint[] => {
  const embeddings = artworks.map((artwork) => artwork.embedding);
  const reduced = reduceTo2D(embeddings);
  const residuals = estimateProjectionResiduals(embeddings, reduced);

  return artworks.map((embeddingArtwork, index) => {
    const artwork = embeddingToArtwork(embeddingArtwork);
    const point = reduced[index] || { x: normalizedHash(artwork.id), y: normalizedHash(artwork.id, 'y') };
    const residual = residuals[index] || 0;

    return {
      artwork,
      x: clamp(point.x * 86 + 7, 2, 98),
      y: clamp((1 - point.y) * 82 + 8, 4, 96),
      residual,
      residualReasons: ['2d projection distortion'],
      residualLabel: 'projection residual',
      hue: getArtworkHue(artwork),
      size: 4.5 + Math.max(0, 1 - residual) * 3.5,
    };
  });
};

const getPointPosition = (point: AtlasPoint, mode: AtlasMode) => {
  if (mode === 'field' || mode === 'embedded') return { x: point.x, y: point.y };

  const primaryReason = point.residualReasons[0] || 'complete';
  const bandIndex = ERROR_BANDS.indexOf(primaryReason);
  const band = bandIndex === -1 ? ERROR_BANDS.length - 1 : bandIndex;
  const bandStep = 84 / Math.max(1, ERROR_BANDS.length - 1);
  const yJitter = (normalizedHash(point.artwork.id, 'error-y') - 0.5) * 6;
  const xJitter = (normalizedHash(point.artwork.id, 'error-x') - 0.5) * 3;

  return {
    x: clamp(point.residual * 86 + 7 + xJitter, 2, 98),
    y: clamp(8 + band * bandStep + yJitter, 4, 96),
  };
};

export default function NgsAtlas() {
  const [artworks, setArtworks] = useState<ArtworkSearchResult[]>([]);
  const [embeddingArtworks, setEmbeddingArtworks] = useState<EmbeddingArtwork[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [embeddingTotal, setEmbeddingTotal] = useState<number | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [embeddingStatus, setEmbeddingStatus] = useState<
    'idle' | 'loading' | 'ready' | 'error'
  >('idle');
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<AtlasMode>('embedded');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const loadAtlas = async () => {
      setStatus('loading');
      setError(null);

      try {
        const fetchPage = async (offset: number) => {
          const response = await fetch(
            `/api/public-search/ngs/browse?limit=${PAGE_SIZE}&offset=${offset}&sort_by=title&sort_order=asc`
          );
          const payload = (await response.json()) as ApiResponse<BrowsePayload>;

          if (!payload.success || !payload.data) {
            throw new Error(payload.error?.message || 'Unable to load atlas data.');
          }

          return payload.data;
        };

        const firstPage = await fetchPage(0);
        const expectedTotal =
          firstPage.total ?? firstPage.count ?? firstPage.results.length;
        const targetTotal = Math.min(expectedTotal, MAX_ARTWORKS);
        const pageMap = new Map<number, ArtworkSearchResult[]>();
        pageMap.set(0, firstPage.results);

        if (!cancelled) {
          setArtworks(firstPage.results);
          setTotal(expectedTotal);
        }

        const offsets: number[] = [];
        for (let offset = PAGE_SIZE; offset < targetTotal; offset += PAGE_SIZE) {
          offsets.push(offset);
        }

        for (
          let index = 0;
          index < offsets.length && !cancelled;
          index += PAGE_BATCH_SIZE
        ) {
          const batchOffsets = offsets.slice(index, index + PAGE_BATCH_SIZE);
          const pages = await Promise.all(
            batchOffsets.map(
              async (offset) => [offset, await fetchPage(offset)] as const
            )
          );

          pages.forEach(([offset, page]) => {
            pageMap.set(offset, page.results);
          });

          const ordered = [...pageMap.entries()]
            .sort(([a], [b]) => a - b)
            .flatMap(([, results]) => results);

          setArtworks(ordered);
          setTotal(expectedTotal);
        }

        if (!cancelled) setStatus('ready');
      } catch (loadError) {
        if (!cancelled) {
          setStatus('error');
          setError(
            loadError instanceof Error
              ? loadError.message
              : 'Unable to load atlas data.'
          );
        }
      }
    };

    void loadAtlas();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    const loadEmbeddings = async () => {
      setEmbeddingStatus('loading');

      const apiBases =
        typeof window !== 'undefined' && window.location.hostname === '127.0.0.1'
          ? ['http://127.0.0.1:8787', 'https://paillette-stg.workers.dev']
          : [window.location.origin];

      for (const apiBase of apiBases) {
        try {
          const fetchPage = async (offset: number) => {
            const response = await fetch(
              `${apiBase}/api/v1/galleries/ngs/embeddings?limit=${EMBEDDING_PAGE_SIZE}&offset=${offset}`
            );
            const payload = (await response.json()) as ApiResponse<EmbeddingsPayload>;
            if (!payload.success || !payload.data) {
              throw new Error(payload.error?.message || 'Unable to load embeddings.');
            }
            return payload.data;
          };

          const firstPage = await fetchPage(0);
          const expectedTotal = firstPage.total || firstPage.embeddings.length;
          const targetTotal = Math.min(expectedTotal, MAX_ARTWORKS);
          const allEmbeddings = [...firstPage.embeddings];

          if (!cancelled) {
            setEmbeddingArtworks(allEmbeddings);
            setEmbeddingTotal(expectedTotal);
          }

          for (
            let offset = EMBEDDING_PAGE_SIZE;
            offset < targetTotal && !cancelled;
            offset += EMBEDDING_PAGE_SIZE
          ) {
            const page = await fetchPage(offset);
            allEmbeddings.push(...page.embeddings);
            setEmbeddingArtworks([...allEmbeddings]);
            setEmbeddingTotal(expectedTotal);
          }

          if (!cancelled) setEmbeddingStatus('ready');
          return;
        } catch {
          // Try the next configured API base, then fall back to metadata atlas.
        }
      }

      if (!cancelled) setEmbeddingStatus('error');
    };

    void loadEmbeddings();

    return () => {
      cancelled = true;
    };
  }, []);

  const metadataPoints = useMemo(() => artworks.map(buildPoint), [artworks]);
  const embeddingPoints = useMemo(
    () => buildEmbeddingPoints(embeddingArtworks),
    [embeddingArtworks]
  );
  const hasEmbeddings = embeddingPoints.length > 0;
  const points = mode === 'embedded' && hasEmbeddings ? embeddingPoints : metadataPoints;
  const activeTotal = mode === 'embedded' && hasEmbeddings ? embeddingTotal : total;
  const activeResidualLabel =
    mode === 'embedded' && hasEmbeddings ? 'Projection residual' : 'Metadata residual';
  const selectedPoint =
    points.find((point) => point.artwork.id === selectedId) || points[0] || null;
  const highResidualCount = points.filter((point) => point.residual >= 0.38).length;
  const imageCount = points.filter(
    (point) => point.artwork.imageUrl || point.artwork.thumbnailUrl
  ).length;
  const residualAverage = points.length
    ? points.reduce((sum, point) => sum + point.residual, 0) / points.length
    : 0;
  const highResidualPoints = useMemo(
    () => [...points].sort((a, b) => b.residual - a.residual).slice(0, 6),
    [points]
  );
  const thumbnailPoints = useMemo(() => {
    const imagePoints = points.filter(
      (point) => point.artwork.thumbnailUrl || point.artwork.imageUrl
    );
    const maxThumbnails = 650;
    const stride = Math.max(1, Math.ceil(imagePoints.length / maxThumbnails));
    return imagePoints.filter(
      (point, index) =>
        point.artwork.id === selectedPoint?.artwork.id ||
        index % stride === 0
    );
  }, [points, selectedPoint?.artwork.id]);

  return (
    <main className="min-h-screen overflow-hidden bg-[#090a0c] text-white">
      <div className="relative min-h-screen">
        <div className="absolute inset-0 bg-[linear-gradient(125deg,rgba(45,212,191,0.12),transparent_34%),linear-gradient(235deg,rgba(244,114,182,0.1),transparent_32%),linear-gradient(180deg,rgba(255,255,255,0.035),transparent_38%)]" />
        <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.035)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.035)_1px,transparent_1px)] bg-[size:56px_56px] opacity-35" />

        <header className="relative z-20 flex items-center justify-between px-5 py-4 sm:px-8">
          <Link
            to="/ngs/search"
            className="inline-flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.18em] text-white/60 transition-colors hover:text-white"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Search
          </Link>
          <div className="flex items-center gap-2 rounded border border-white/10 bg-black/25 p-1 font-mono text-[10px] uppercase tracking-[0.16em]">
            <button
              type="button"
              onClick={() => setMode('embedded')}
              className={`rounded-sm px-3 py-1.5 transition-colors ${
                mode === 'embedded' ? 'bg-white text-black' : 'text-white/55'
              }`}
            >
              Embedded
            </button>
            <button
              type="button"
              onClick={() => setMode('field')}
              className={`rounded-sm px-3 py-1.5 transition-colors ${
                mode === 'field' ? 'bg-white text-black' : 'text-white/55'
              }`}
            >
              Field
            </button>
            <button
              type="button"
              onClick={() => setMode('error')}
              className={`rounded-sm px-3 py-1.5 transition-colors ${
                mode === 'error' ? 'bg-white text-black' : 'text-white/55'
              }`}
            >
              Error
            </button>
          </div>
        </header>

        <section className="relative z-10 grid min-h-[calc(100vh-72px)] grid-rows-[auto_1fr_auto] px-5 pb-5 sm:px-8">
          <div className="flex flex-col gap-5 py-3 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="font-mono text-[10px] uppercase tracking-[0.28em] text-cyan-200/70">
                National Gallery Singapore
              </p>
              <h1 className="mt-2 text-4xl font-semibold tracking-normal sm:text-6xl">
                Collection atlas
              </h1>
            </div>
            <div className="grid grid-cols-2 gap-x-8 gap-y-2 font-mono text-[11px] uppercase tracking-[0.14em] text-white/55 sm:grid-cols-4">
              <Metric label="Loaded" value={`${points.length}`} detail={activeTotal ? `/ ${activeTotal}` : ''} />
              <Metric label="Images" value={`${imageCount}`} detail={formatPercent(points.length ? imageCount / points.length : 0)} />
              <Metric label="Residual" value={formatPercent(residualAverage)} detail="avg" />
              <Metric label="Review" value={`${highResidualCount}`} detail="hot" />
            </div>
          </div>

          <div className="relative min-h-[28rem] overflow-hidden border-y border-white/10">
            <div className="absolute inset-x-0 top-[7%] h-px bg-white/10" />
            <div className="absolute inset-x-0 top-[91%] h-px bg-white/10" />
            <div className="absolute bottom-3 left-0 font-mono text-[10px] uppercase tracking-[0.2em] text-white/35">
              {mode === 'error' ? '0% residual' : mode === 'embedded' ? 'embedding x' : YEAR_MIN}
            </div>
            <div className="absolute bottom-3 right-0 font-mono text-[10px] uppercase tracking-[0.2em] text-white/35">
              {mode === 'error' ? '100% residual' : mode === 'embedded' ? 'embedding x' : YEAR_MAX}
            </div>

            {status === 'loading' && points.length === 0 ? (
              <div className="absolute inset-0 grid place-items-center">
                <div className="flex items-center gap-3 font-mono text-xs uppercase tracking-[0.18em] text-white/60">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Loading atlas
                </div>
              </div>
            ) : null}

            {status === 'error' ? (
              <div className="absolute inset-0 grid place-items-center">
                <div className="flex max-w-md items-center gap-3 text-sm text-rose-100">
                  <AlertTriangle className="h-5 w-5 text-rose-300" />
                  <span>{error}</span>
                </div>
              </div>
            ) : null}

            <AtlasCanvas
              points={points}
              mode={mode}
              selectedId={selectedPoint?.artwork.id || null}
              onSelect={setSelectedId}
            />

            <div className="pointer-events-none absolute inset-0">
              {thumbnailPoints.map((point) => {
                const imageUrl = point.artwork.thumbnailUrl || point.artwork.imageUrl;
                const isSelected = point.artwork.id === selectedPoint?.artwork.id;
                const position = getPointPosition(point, mode);

                return (
                  <button
                    key={`thumb-${point.artwork.id}`}
                    type="button"
                    onClick={() => setSelectedId(point.artwork.id)}
                    className={`pointer-events-auto absolute block overflow-hidden border bg-black/70 shadow-[0_10px_28px_rgba(0,0,0,0.45)] transition-transform hover:z-30 hover:scale-150 focus-visible:z-30 focus-visible:scale-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white ${
                      isSelected
                        ? 'z-20 border-white'
                        : point.residual >= 0.38
                          ? 'z-10 border-rose-300/80'
                          : 'border-white/20'
                    }`}
                    style={{
                      left: `${position.x}%`,
                      top: `${position.y}%`,
                      width: isSelected ? 38 : 24,
                      height: isSelected ? 48 : 31,
                      transform: 'translate(-50%, -50%)',
                    }}
                    aria-label={`${getTitle(point.artwork)} residual estimate ${formatPercent(
                      point.residual
                    )}`}
                  >
                    {imageUrl ? (
                      <img
                        src={imageUrl}
                        alt=""
                        className="h-full w-full object-cover"
                        loading="lazy"
                      />
                    ) : null}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="grid gap-5 pt-5 lg:grid-cols-[1fr_24rem]">
            <div className="grid gap-3 overflow-hidden font-mono text-[10px] uppercase tracking-[0.18em] text-white/45">
              <div className="flex items-center gap-4">
                <span className="h-2 w-2 bg-cyan-300" />
                <span>
                  {mode === 'error'
                    ? 'x = error estimate, y = primary metadata gap'
                    : mode === 'embedded' && hasEmbeddings
                      ? 'native embedding atlas, residual = 2d projection distortion'
                      : mode === 'embedded'
                        ? embeddingStatus === 'loading'
                          ? 'loading embeddings, showing metadata atlas meanwhile'
                          : 'embedding API unavailable, showing metadata atlas fallback'
                        : 'x = date, y = colour/classification proxy'}
                </span>
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-2">
                {highResidualPoints.map((point) => (
                  <button
                    key={`hot-${point.artwork.id}`}
                    type="button"
                    onClick={() => setSelectedId(point.artwork.id)}
                    className="text-left text-white/45 transition-colors hover:text-white focus-visible:text-white focus-visible:outline-none"
                  >
                  {formatPercent(point.residual)} {getTitle(point.artwork)}
                  </button>
                ))}
              </div>
              <span className="hidden h-2 w-2 bg-rose-300 sm:inline-block" />
              <span className="hidden sm:inline">rose = higher residual estimate</span>
            </div>
            {selectedPoint ? (
              <Inspector point={selectedPoint} residualLabel={activeResidualLabel} />
            ) : null}
          </div>
        </section>
      </div>
    </main>
  );
}

function AtlasCanvas({
  points,
  mode,
  selectedId,
  onSelect,
}: {
  points: AtlasPoint[];
  mode: AtlasMode;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const pixelRatio = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.floor(rect.width * pixelRatio));
    canvas.height = Math.max(1, Math.floor(rect.height * pixelRatio));

    const context = canvas.getContext('2d');
    if (!context) return;

    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    context.clearRect(0, 0, rect.width, rect.height);

    for (const point of points) {
      const position = getPointPosition(point, mode);
      const x = (position.x / 100) * rect.width;
      const y = (position.y / 100) * rect.height;
      const isSelected = point.artwork.id === selectedId;
      const side = isSelected ? 8 : point.residual >= 0.38 ? 4 : 3;
      const alpha = isSelected ? 1 : 0.28 + point.residual * 0.58;

      context.fillStyle =
        point.residual >= 0.38
          ? `rgba(251,113,133,${alpha})`
          : `rgba(103,232,249,${alpha})`;
      context.fillRect(x - side / 2, y - side / 2, side, side);

      if (isSelected) {
        context.strokeStyle = 'rgba(255,255,255,0.95)';
        context.lineWidth = 1.5;
        context.strokeRect(x - side / 2 - 2, y - side / 2 - 2, side + 4, side + 4);
      }
    }
  }, [mode, points, selectedId]);

  const handleClick = (event: MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const clickX = event.clientX - rect.left;
    const clickY = event.clientY - rect.top;
    let nearest: { id: string; distance: number } | null = null;

    for (const point of points) {
      const position = getPointPosition(point, mode);
      const x = (position.x / 100) * rect.width;
      const y = (position.y / 100) * rect.height;
      const distance = Math.hypot(clickX - x, clickY - y);
      if (!nearest || distance < nearest.distance) {
        nearest = { id: point.artwork.id, distance };
      }
    }

    if (nearest && nearest.distance <= 14) onSelect(nearest.id);
  };

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 h-full w-full"
      onClick={handleClick}
      aria-label="All loaded artworks plotted as residual squares"
    />
  );
}

function Metric({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail?: string;
}) {
  return (
    <div>
      <div className="text-white">{value}</div>
      <div>
        {label} {detail ? <span className="text-white/30">{detail}</span> : null}
      </div>
    </div>
  );
}

function Inspector({
  point,
  residualLabel,
}: {
  point: AtlasPoint;
  residualLabel: string;
}) {
  const artwork = point.artwork;
  const imageUrl = artwork.thumbnailUrl || artwork.imageUrl;

  return (
    <aside className="grid grid-cols-[5rem_1fr] gap-4 border-t border-white/10 pt-4 lg:border-t-0 lg:pt-0">
      <div className="relative aspect-[4/5] overflow-hidden bg-white/[0.04]">
        {imageUrl ? (
          <img
            src={imageUrl}
            alt={getTitle(artwork)}
            className="h-full w-full object-cover"
            loading="lazy"
          />
        ) : (
          <div className="grid h-full place-items-center text-white/25">
            <ImageIcon className="h-6 w-6" />
          </div>
        )}
      </div>
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-white">{getTitle(artwork)}</p>
        <p className="mt-1 truncate text-sm text-white/55">{getArtist(artwork)}</p>
        <div className="mt-3 flex flex-wrap gap-2 font-mono text-[10px] uppercase tracking-[0.14em] text-white/45">
          <span>{getDateText(artwork) || getYear(artwork) || 'No date'}</span>
          <span>{getAccession(artwork) || artwork.id}</span>
        </div>
        <div className="mt-3 h-1.5 overflow-hidden bg-white/10">
          <div
            className="h-full bg-gradient-to-r from-cyan-300 via-amber-200 to-rose-400"
            style={{ width: `${Math.round(point.residual * 100)}%` }}
          />
        </div>
        <p className="mt-2 font-mono text-[10px] uppercase tracking-[0.14em] text-white/45">
          {residualLabel} {formatPercent(point.residual)}
          {point.residualReasons.length
            ? ` / ${point.residualReasons.join(', ')}`
            : ' / complete'}
        </p>
      </div>
    </aside>
  );
}
