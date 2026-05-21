import type { MetaFunction } from '@remix-run/cloudflare';
import { Link } from '@remix-run/react';
import { motion } from 'framer-motion';
import { useEffect, useMemo, useState } from 'react';
import { Frame, Layers, LayoutGrid, Network, Search, Table2 } from 'lucide-react';
import { PAINTING_LIST, type Painting } from '~/lib/paintings';

export const meta: MetaFunction = () => [
  { title: 'Paillette — search the collection' },
];

// Two clean axes: VIEW = how results are arranged · GROUPING = optional buckets.
type View = 'masonry' | 'salon' | 'atlas' | 'table';
type Result = Painting & { key: string };

// Prototype result set. Registry has 10 placeholder works; tripled for density.
const RESULT_SET: Result[] = [0, 1, 2].flatMap((pass) =>
  PAINTING_LIST.map((p) => ({ ...p, key: `${p.id}-${pass}` }))
);

// Atlas cluster centroids (% of container), keyed by base painting id.
const ATLAS_CENTROID: Record<string, { x: number; y: number }> = {
  mona: { x: 19, y: 28 },
  pearl: { x: 28, y: 17 },
  venus: { x: 12, y: 42 },
  starry: { x: 73, y: 21 },
  sunrise: { x: 85, y: 33 },
  sunflowers: { x: 77, y: 13 },
  kiss: { x: 33, y: 73 },
  olympia: { x: 18, y: 64 },
  wave: { x: 70, y: 71 },
  scream: { x: 86, y: 79 },
};

const CLUSTER_LABELS = [
  { x: 6, y: 9, text: 'old masters' },
  { x: 76, y: 5, text: 'post-impressionism' },
  { x: 8, y: 88, text: 'symbolism' },
  { x: 66, y: 90, text: 'ukiyo-e + expressionism' },
];

// Text example queries.
const CHIPS: { label: string; dot: string; ids: string[] }[] = [
  { label: 'melancholic blue', dot: '#1e3a5f', ids: ['pearl', 'starry', 'wave'] },
  { label: 'sunset glow', dot: '#c87850', ids: ['sunrise', 'starry', 'scream'] },
  { label: 'portraits', dot: '#6a4030', ids: ['pearl', 'mona', 'olympia'] },
  { label: 'sea & wave', dot: '#2a6a8a', ids: ['wave', 'sunrise'] },
  { label: 'gold & ornament', dot: '#c89f3a', ids: ['kiss', 'sunflowers'] },
  { label: 'unease', dot: '#c8542e', ids: ['scream', 'olympia'] },
];

const VIEW_TABS: { id: View; label: string; icon: typeof LayoutGrid }[] = [
  { id: 'masonry', label: 'Masonry', icon: LayoutGrid },
  { id: 'salon', label: 'Salon', icon: Frame },
  { id: 'atlas', label: 'Atlas', icon: Network },
  { id: 'table', label: 'Table', icon: Table2 },
];

/* ---------- colour system — ONE taxonomy, shared by the filter + the grouping ---------- */

// In production these are cluster centroids of every artwork's colour signature.
const COLOURS: { id: string; hex: string; name: string }[] = [
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

// Per-artwork colour. `palette` = top ~4 colours by area; `primary` = the
// characteristic colour the work groups under (a COLOURS id). Hand-extracted
// for the prototype — production runs a colour-quantisation pass per work.
const ARTWORK_COLOUR: Record<string, { palette: string[]; primary: string }> = {
  pearl: { palette: ['#161812', '#3a5a7a', '#b8923e', '#dcc4a0'], primary: 'cobalt' },
  starry: { palette: ['#0e1a3a', '#2e5a9a', '#e0c054', '#1a2a1a'], primary: 'navy' },
  wave: { palette: ['#1a3a52', '#5a8aa8', '#e8e0c8', '#d0c8b0'], primary: 'steel' },
  kiss: { palette: ['#c89a2e', '#e8c860', '#6a7a3a', '#2a2418'], primary: 'gold' },
  sunrise: { palette: ['#6a7a88', '#8a9aa5', '#d4843a', '#46566a'], primary: 'steel' },
  mona: { palette: ['#3a2e1c', '#6a5638', '#8a7a52', '#c0a075'], primary: 'umber' },
  scream: { palette: ['#c85a2e', '#e09a3a', '#2a3a5a', '#7a4a3a'], primary: 'rust' },
  venus: { palette: ['#8a9a7a', '#cdc8b0', '#d8c0a0', '#b89858'], primary: 'sage' },
  sunflowers: { palette: ['#e0b32e', '#c8902a', '#b8a858', '#5a4a2a'], primary: 'gold' },
  olympia: { palette: ['#c8b89c', '#2a2420', '#d8c4a8', '#7a5a4a'], primary: 'bone' },
};

type Lab = [number, number, number];

function hexToRgb(hex: string): [number, number, number] {
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ];
}

// sRGB → CIELAB (D65). Perceptual space — distances match how colours look.
function rgbToLab([r, g, b]: [number, number, number]): Lab {
  const lin = [r, g, b].map((c) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  let x = (lin[0] * 0.4124 + lin[1] * 0.3576 + lin[2] * 0.1805) / 0.95047;
  let y = lin[0] * 0.2126 + lin[1] * 0.7152 + lin[2] * 0.0722;
  let z = (lin[0] * 0.0193 + lin[1] * 0.1192 + lin[2] * 0.9505) / 1.08883;
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  [x, y, z] = [f(x), f(y), f(z)];
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}

const labOf = (hex: string): Lab => rgbToLab(hexToRgb(hex));

// ΔE76 — Euclidean distance in Lab. Production: upgrade to CIEDE2000.
function deltaE(a: Lab, b: Lab): number {
  return Math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2);
}

const COLOUR_LAB: Record<string, Lab> = Object.fromEntries(
  COLOURS.map((c) => [c.id, labOf(c.hex)])
);
const PALETTE_LAB: Record<string, Lab[]> = Object.fromEntries(
  Object.entries(ARTWORK_COLOUR).map(([id, c]) => [id, c.palette.map(labOf)])
);

// Each artwork-palette colour votes for its nearest taxonomy colour → frequency.
const COLOUR_FREQ: Record<string, number> = (() => {
  const freq: Record<string, number> = {};
  for (const c of COLOURS) freq[c.id] = 0;
  for (const cols of Object.values(PALETTE_LAB)) {
    for (const lab of cols) {
      let best = COLOURS[0].id;
      let bestD = Infinity;
      for (const c of COLOURS) {
        const d = deltaE(lab, COLOUR_LAB[c.id]);
        if (d < bestD) {
          bestD = d;
          best = c.id;
        }
      }
      freq[best]++;
    }
  }
  return freq;
})();

// Match score: for each selected colour, ΔE to the artwork's nearest palette
// colour, averaged. Lower = closer. v1 stand-in for Earth Mover's Distance.
function colourScore(paintingId: string, selected: string[]): number {
  const pal = PALETTE_LAB[paintingId];
  if (!pal || selected.length === 0) return 0;
  let total = 0;
  for (const id of selected) {
    const q = COLOUR_LAB[id];
    let nearest = Infinity;
    for (const c of pal) {
      const d = deltaE(q, c);
      if (d < nearest) nearest = d;
    }
    total += nearest;
  }
  return total / selected.length;
}

// white or near-black ink, whichever reads on the given swatch
function readableInk(hex: string): string {
  const [r, g, b] = hexToRgb(hex);
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum > 0.62 ? '#1a1208' : '#ffffff';
}

/* ---------- layout helpers ---------- */

function ratioToHW(ratio: string): number {
  const [w, h] = ratio.split('/').map((s) => parseFloat(s.trim()));
  return h / w;
}

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

// shortest-column packing — keeps top results near the top, no gaps
function distribute(items: Result[], colCount: number): Result[][] {
  const cols: Result[][] = Array.from({ length: colCount }, () => []);
  const heights = new Array(colCount).fill(0);
  for (const item of items) {
    let shortest = 0;
    for (let i = 1; i < colCount; i++) {
      if (heights[i] < heights[shortest]) shortest = i;
    }
    cols[shortest].push(item);
    heights[shortest] += ratioToHW(item.ratio);
  }
  return cols;
}

/* ---------- page ---------- */

export default function HomeTwo() {
  const [query, setQuery] = useState('');
  const [view, setView] = useState<View>('masonry');
  const [columns, setColumns] = useState(4); // SSR + first client render match
  const [selectedColours, setSelectedColours] = useState<string[]>([]);
  const [grouped, setGrouped] = useState(false);

  useEffect(() => {
    const update = () => {
      const w = window.innerWidth;
      setColumns(w < 640 ? 2 : w < 1024 ? 3 : 4);
    };
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    let set = RESULT_SET;
    if (q) {
      const chip = CHIPS.find((c) => c.label === q);
      if (chip) {
        set = RESULT_SET.filter((r) => chip.ids.includes(r.id));
      } else {
        const matched = RESULT_SET.filter(
          (r) =>
            r.title.toLowerCase().includes(q) ||
            r.artist.toLowerCase().includes(q) ||
            String(r.year).includes(q)
        );
        set = matched.length ? matched : RESULT_SET;
      }
    }
    if (selectedColours.length) {
      set = [...set].sort(
        (a, b) =>
          colourScore(a.id, selectedColours) - colourScore(b.id, selectedColours)
      );
    }
    return set;
  }, [query, selectedColours]);

  const toggleColour = (id: string) =>
    setSelectedColours((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );

  // Grouping is a results-area control, orthogonal to layout — except Atlas,
  // which is itself a spatial grouping, so colour-grouping is suppressed there.
  const canGroup = view !== 'atlas';
  const showGrouped = grouped && canGroup;

  return (
    <div className="min-h-screen bg-[#0b0b0e] text-white overflow-x-hidden">
      {/* Slim brand band */}
      <header className="sticky top-0 z-40 border-b border-white/[0.07] bg-[#0b0b0e]/85 backdrop-blur-md">
        <div className="container mx-auto px-6 h-14 flex items-center justify-between">
          <div className="flex items-baseline gap-3">
            <Link to="/" className="font-display font-bold text-xl tracking-tight">
              <span className="text-white">P</span>
              <span className="bg-gradient-accent bg-clip-text text-transparent">ai</span>
              <span className="text-white">llette</span>
            </Link>
            <span className="text-[10px] font-mono uppercase tracking-[0.2em] text-white/30">
              /home-2 · prototype
            </span>
          </div>
          <nav className="flex items-center gap-5 text-[11px] font-mono uppercase tracking-[0.2em] text-white/55">
            <Link to="/collections" className="hover:text-white transition-colors hidden sm:inline">Collections</Link>
            <Link to="/translate" className="hover:text-white transition-colors hidden sm:inline">Translate</Link>
            <Link to="/design" className="hover:text-white transition-colors">Design</Link>
            <Link
              to="/auth/signin"
              className="px-3 py-1.5 rounded-md bg-white/[0.06] border border-white/10 hover:bg-white/10 text-white/80 transition-colors"
            >
              Sign in
            </Link>
          </nav>
        </div>
      </header>

      {/* Search + refine */}
      <section className="container mx-auto px-6 pt-12 lg:pt-16 pb-6 max-w-3xl">
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
        >
          <p className="text-center text-[10px] font-mono uppercase tracking-[0.35em] text-white/40 mb-6">
            <span className="bg-gradient-accent bg-clip-text text-transparent font-semibold">
              paillette
            </span>{' '}
            · 47,000 works · text · colour · image
          </p>

          {/* Text query */}
          <div className="relative">
            <Search className="absolute left-0 top-1/2 -translate-y-1/2 w-5 h-5 text-white/30" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              autoFocus
              placeholder="search by feeling, era, subject…"
              className="w-full bg-transparent border-b-2 border-white/20 focus:border-fuchsia-400 outline-none text-xl lg:text-2xl py-4 pl-8 pr-4 font-display italic transition-colors placeholder:not-italic placeholder:text-white/25"
            />
          </div>

          {/* Example text queries */}
          <div className="mt-4 flex flex-wrap gap-2 justify-center">
            <span className="text-[10px] font-mono uppercase tracking-[0.2em] text-white/30 self-center mr-1">
              try
            </span>
            {CHIPS.map((chip) => {
              const active = query.trim().toLowerCase() === chip.label;
              return (
                <button
                  key={chip.label}
                  type="button"
                  onClick={() => setQuery(active ? '' : chip.label)}
                  className={`inline-flex items-center gap-2 text-[12px] px-3 py-1.5 rounded-full border transition-colors ${
                    active
                      ? 'bg-white/[0.12] border-white/30 text-white'
                      : 'bg-white/[0.04] border-white/10 text-white/70 hover:bg-white/[0.08] hover:text-white'
                  }`}
                >
                  <span className="w-2 h-2 rounded-full" style={{ background: chip.dot }} />
                  {chip.label}
                </button>
              );
            })}
          </div>

          {/* Refine — every filter lives here. Colour is one facet. */}
          <div className="mt-7 rounded-xl border border-white/[0.08] bg-white/[0.02] p-4">
            <div className="flex items-center justify-between mb-3">
              <span className="text-[10px] font-mono uppercase tracking-[0.3em] text-white/50">
                Refine
              </span>
              {selectedColours.length > 0 && (
                <button
                  type="button"
                  onClick={() => setSelectedColours([])}
                  className="text-[10px] font-mono uppercase tracking-[0.16em] text-white/40 hover:text-white transition-colors"
                >
                  clear colour ×
                </button>
              )}
            </div>

            {/* Colour facet */}
            <div className="flex items-baseline gap-2 mb-2">
              <span className="text-[12px] font-medium text-white/75">Colour</span>
              <span className="text-[10px] font-mono text-white/35">
                — pick one or more · segment width = how common in the collection
              </span>
            </div>
            <ColourStrip selected={selectedColours} onToggle={toggleColour} />
            {selectedColours.length > 0 && (
              <div className="mt-2.5 flex items-center gap-2 flex-wrap">
                {selectedColours.map((id) => {
                  const c = COLOURS.find((x) => x.id === id);
                  return (
                    <span
                      key={id}
                      className="inline-flex items-center gap-1.5 text-[11px] px-2.5 py-1 rounded-full bg-white/[0.06] border border-white/15"
                    >
                      <span className="w-3 h-3 rounded-full" style={{ background: c?.hex }} />
                      {c?.name}
                    </span>
                  );
                })}
                <span className="text-[10px] font-mono uppercase tracking-[0.16em] text-white/35">
                  → results ranked by colour distance
                </span>
              </div>
            )}

            <p className="mt-3.5 pt-3 border-t border-white/[0.06] text-[10px] font-mono uppercase tracking-[0.18em] text-white/25">
              Period · Medium · Movement · Image — facets coming
            </p>
          </div>
        </motion.div>
      </section>

      {/* Sticky controls: count · grouping · layout */}
      <div className="sticky top-14 z-30 bg-[#0b0b0e]/90 backdrop-blur-md">
        <div className="container mx-auto px-6 max-w-6xl">
          <div className="flex items-center justify-between gap-4 py-3 border-y border-white/[0.07]">
            <p className="text-[11px] font-mono uppercase tracking-[0.2em] text-white/45">
              {query ? (
                <>
                  <span className="bg-gradient-accent bg-clip-text text-transparent font-semibold">
                    {results.length}
                  </span>{' '}
                  results ·{' '}
                  <span className="text-white/70 italic normal-case tracking-normal">
                    "{query}"
                  </span>
                </>
              ) : (
                <>{results.length} works · featured this week</>
              )}
              {selectedColours.length > 0 && (
                <span className="text-white/65"> · sorted by colour</span>
              )}
              {showGrouped && <span className="text-white/65"> · grouped</span>}
            </p>

            <div className="flex items-center gap-2">
              {/* Grouping — orthogonal to layout */}
              <button
                type="button"
                onClick={() => canGroup && setGrouped((g) => !g)}
                disabled={!canGroup}
                title={
                  canGroup
                    ? 'Group results into colour bands'
                    : 'Grouping is off in Atlas — Atlas is already a spatial grouping'
                }
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                  !canGroup
                    ? 'border-white/[0.06] text-white/25 cursor-not-allowed'
                    : showGrouped
                      ? 'bg-white/[0.12] border-white/25 text-white'
                      : 'bg-white/[0.04] border-white/10 text-white/55 hover:text-white/85'
                }`}
              >
                <Layers className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Group by colour</span>
              </button>

              {/* Layout */}
              <div className="flex items-center gap-1 p-1 rounded-lg bg-white/[0.04] border border-white/10">
                {VIEW_TABS.map((tab) => {
                  const Icon = tab.icon;
                  return (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => setView(tab.id)}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                        view === tab.id
                          ? 'bg-white/[0.12] text-white'
                          : 'text-white/45 hover:text-white/80'
                      }`}
                    >
                      <Icon className="w-3.5 h-3.5" />
                      <span className="hidden sm:inline">{tab.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Results */}
      <section className="container mx-auto px-6 max-w-6xl py-8 lg:py-10">
        <motion.div
          key={`${view}-${showGrouped}`}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.35 }}
        >
          {showGrouped ? (
            <GroupedResults
              view={view}
              results={results}
              columns={columns}
              selected={selectedColours}
            />
          ) : (
            <LayoutView
              view={view}
              results={results}
              columns={columns}
              selected={selectedColours}
            />
          )}
        </motion.div>

        {results.length === 0 && (
          <p className="text-center text-white/40 font-mono text-sm py-20">
            no works match — try a chip or a colour above
          </p>
        )}
      </section>

      <footer className="border-t border-white/[0.07] py-6">
        <div className="container mx-auto px-6 flex items-center justify-between text-[10px] font-mono uppercase tracking-[0.2em] text-white/35">
          <span>© {new Date().getFullYear()} paillette · prototype · results padded with repeats</span>
          <Link to="/design" className="hover:text-white transition-colors">↩ design index</Link>
        </div>
      </footer>
    </div>
  );
}

/* ---------- result rendering ---------- */

// Layout dispatcher — VIEW is purely how results are arranged.
function LayoutView({
  view,
  results,
  columns,
  selected,
}: {
  view: View;
  results: Result[];
  columns: number;
  selected: string[];
}) {
  if (view === 'salon') {
    return <SalonView results={results} columns={Math.max(2, columns - 1)} />;
  }
  if (view === 'atlas') return <AtlasView results={results} />;
  if (view === 'table') return <TableView results={results} selected={selected} />;
  return <MasonryView results={results} columns={columns} />;
}

// Grouping wraps a layout — colour bands, each rendered in the chosen view.
function GroupedResults({
  view,
  results,
  columns,
  selected,
}: {
  view: View;
  results: Result[];
  columns: number;
  selected: string[];
}) {
  return (
    <div className="space-y-3">
      {COLOURS.map((col) => {
        const band = results.filter(
          (r) => ARTWORK_COLOUR[r.id]?.primary === col.id
        );
        if (!band.length) return null;
        const ink = readableInk(col.hex);
        return (
          <div
            key={col.id}
            className="rounded-xl overflow-hidden border border-white/[0.07]"
          >
            <div
              className="flex items-baseline gap-3 px-4 py-2.5"
              style={{ background: col.hex }}
            >
              <span
                className="font-display font-bold text-lg leading-none"
                style={{ color: ink }}
              >
                {col.name}
              </span>
              <span
                className="text-[10px] font-mono uppercase tracking-[0.2em]"
                style={{ color: ink, opacity: 0.7 }}
              >
                {band.length} {band.length === 1 ? 'work' : 'works'}
              </span>
              <span
                className="ml-auto text-[10px] font-mono uppercase tracking-[0.1em]"
                style={{ color: ink, opacity: 0.55 }}
              >
                {col.hex}
              </span>
            </div>
            <div className="p-4 bg-[#0e0e13]">
              <LayoutView
                view={view}
                results={band}
                columns={columns}
                selected={selected}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function MasonryView({ results, columns }: { results: Result[]; columns: number }) {
  const cols = distribute(results, columns);
  return (
    <div className="flex gap-3 lg:gap-4 items-start">
      {cols.map((col, ci) => (
        <div key={ci} className="flex-1 flex flex-col gap-3 lg:gap-4 min-w-0">
          {col.map((item) => (
            <Link
              key={item.key}
              to="/collections"
              className="group relative block overflow-hidden rounded-lg"
            >
              <div style={{ aspectRatio: item.ratio }} className="bg-white/[0.03]">
                <img
                  src={item.src}
                  alt={item.title}
                  loading="lazy"
                  className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-[1.04]"
                />
              </div>
              <div className="absolute inset-x-0 bottom-0 p-3 bg-gradient-to-t from-black/85 to-transparent opacity-0 group-hover:opacity-100 transition-opacity">
                <p className="text-[12px] italic text-white leading-tight">{item.title}</p>
                <p className="text-[9px] font-mono uppercase tracking-[0.15em] text-white/65 mt-0.5">
                  {item.artist} · {item.year}
                </p>
              </div>
            </Link>
          ))}
        </div>
      ))}
    </div>
  );
}

function SalonView({ results, columns }: { results: Result[]; columns: number }) {
  const cols = distribute(results, columns);
  return (
    <div className="flex gap-8 lg:gap-14 items-start px-2 lg:px-6">
      {cols.map((col, ci) => (
        <div key={ci} className="flex-1 flex flex-col gap-10 lg:gap-16 pt-4 min-w-0">
          {col.map((item) => {
            const rot = ((hash(item.key) % 50) - 25) / 10;
            return (
              <Link
                key={item.key}
                to="/collections"
                className="group block"
                style={{ transform: `rotate(${rot}deg)` }}
              >
                <div
                  className="relative"
                  style={{
                    aspectRatio: item.ratio,
                    boxShadow:
                      '0 22px 44px -14px rgba(0,0,0,0.8), 0 6px 14px -4px rgba(0,0,0,0.6), inset 0 0 0 1px rgba(212,180,120,0.22)',
                  }}
                >
                  <img
                    src={item.src}
                    alt={item.title}
                    loading="lazy"
                    className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"
                  />
                </div>
                <p className="mt-3 text-center text-[9px] font-mono uppercase tracking-[0.2em] text-white/45 group-hover:text-white/75 transition-colors">
                  <span className="italic normal-case tracking-normal text-white/70">
                    {item.title}
                  </span>
                  <br />
                  {item.artist} · {item.year}
                </p>
              </Link>
            );
          })}
        </div>
      ))}
    </div>
  );
}

function AtlasView({ results }: { results: Result[] }) {
  return (
    <div
      className="relative w-full rounded-xl border border-white/[0.06] overflow-hidden"
      style={{ height: '78vh', minHeight: '520px' }}
    >
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            'radial-gradient(ellipse at 20% 28%, rgba(168,85,247,0.16), transparent 42%), radial-gradient(ellipse at 80% 22%, rgba(236,72,153,0.13), transparent 42%), radial-gradient(ellipse at 26% 70%, rgba(217,70,239,0.12), transparent 40%), radial-gradient(ellipse at 78% 76%, rgba(124,58,237,0.13), transparent 42%)',
        }}
      />
      {CLUSTER_LABELS.map((c) => (
        <span
          key={c.text}
          className="absolute text-[10px] font-mono uppercase tracking-[0.25em] text-white/30 pointer-events-none"
          style={{ left: `${c.x}%`, top: `${c.y}%` }}
        >
          {c.text}
        </span>
      ))}
      {results.map((item) => {
        const c = ATLAS_CENTROID[item.id];
        const j = hash(item.key);
        const x = Math.min(89, Math.max(2, c.x + ((j % 15) - 7)));
        const y = Math.min(82, Math.max(3, c.y + ((Math.floor(j / 15) % 15) - 7)));
        const w = 56 + (j % 56);
        return (
          <Link
            key={item.key}
            to="/collections"
            className="absolute group"
            style={{ left: `${x}%`, top: `${y}%`, width: `${w}px`, zIndex: 10 }}
          >
            <div
              className="relative transition-transform duration-300 group-hover:scale-125 group-hover:z-20"
              style={{ aspectRatio: item.ratio }}
            >
              <img
                src={item.src}
                alt={item.title}
                loading="lazy"
                className="w-full h-full object-cover"
                style={{
                  boxShadow:
                    '0 16px 32px -10px rgba(0,0,0,0.85), inset 0 0 0 1px rgba(255,255,255,0.1)',
                }}
              />
            </div>
            <div className="absolute top-full mt-1.5 left-1/2 -translate-x-1/2 opacity-0 group-hover:opacity-100 transition-opacity bg-black/90 backdrop-blur-md px-2 py-1 rounded-sm whitespace-nowrap pointer-events-none">
              <span className="text-[10px] italic text-white">{item.title}</span>
            </div>
          </Link>
        );
      })}
      <p className="absolute bottom-3 right-4 text-[9px] font-mono uppercase tracking-[0.2em] text-white/30 pointer-events-none">
        · · · positioned by visual similarity
      </p>
    </div>
  );
}

function TableView({
  results,
  selected,
}: {
  results: Result[];
  selected: string[];
}) {
  const showDelta = selected.length > 0;
  const headers = ['#', '', 'title', 'artist', 'year', 'ratio', 'size'];
  return (
    <div className="overflow-x-auto rounded-xl border border-white/[0.07]">
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="border-b border-white/15 text-left">
            {headers.map((h, i) => (
              <th
                key={i}
                className="py-2.5 px-3 font-mono text-[10px] uppercase tracking-[0.18em] text-white/45 font-normal"
              >
                {h}
              </th>
            ))}
            {showDelta && (
              <th className="py-2.5 px-3 font-mono text-[10px] uppercase tracking-[0.18em] text-white/45 font-normal whitespace-nowrap">
                ΔE colour
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {results.map((item, i) => {
            const score = showDelta
              ? Math.round(colourScore(item.id, selected))
              : 0;
            const scoreColor =
              score < 25 ? '#7ee0a0' : score < 45 ? '#e0c060' : 'rgba(255,255,255,0.4)';
            return (
              <tr
                key={item.key}
                className="border-b border-white/[0.05] hover:bg-white/[0.03] transition-colors"
              >
                <td className="py-2 px-3 font-mono text-white/40 tabular-nums">
                  {(i + 1).toString().padStart(2, '0')}
                </td>
                <td className="py-2 px-3">
                  <img
                    src={item.src}
                    alt=""
                    loading="lazy"
                    className="w-9 h-9 object-cover rounded-sm"
                  />
                </td>
                <td className="py-2 px-3 font-display italic">{item.title}</td>
                <td className="py-2 px-3 text-white/75">{item.artist}</td>
                <td className="py-2 px-3 font-mono text-white/55 tabular-nums">
                  {item.year}
                </td>
                <td className="py-2 px-3 font-mono text-white/40">
                  {item.ratio.replace(/\s/g, '')}
                </td>
                <td className="py-2 px-3 font-mono text-white/55">{item.size}</td>
                {showDelta && (
                  <td
                    className="py-2 px-3 font-mono tabular-nums"
                    style={{ color: scoreColor }}
                  >
                    {score}
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// Colour facet — collection swatches, spectrum-ordered, multi-select.
// Segment width ∝ how often the colour appears across the collection.
function ColourStrip({
  selected,
  onToggle,
}: {
  selected: string[];
  onToggle: (id: string) => void;
}) {
  const maxFreq = Math.max(...COLOURS.map((c) => COLOUR_FREQ[c.id]), 1);
  return (
    <div className="flex h-11 rounded-lg overflow-hidden border border-white/10">
      {COLOURS.map((c) => {
        const isSel = selected.includes(c.id);
        return (
          <button
            key={c.id}
            type="button"
            onClick={() => onToggle(c.id)}
            title={`${c.name} · ${COLOUR_FREQ[c.id]} colour matches`}
            aria-pressed={isSel}
            className="relative transition-[filter] duration-200 hover:brightness-125 focus:outline-none focus:z-10"
            style={{
              background: c.hex,
              flexGrow: 0.5 + COLOUR_FREQ[c.id] / maxFreq,
              flexBasis: 0,
              minWidth: 26,
            }}
          >
            {isSel && (
              <>
                <span className="absolute inset-0 ring-2 ring-inset ring-white rounded-[3px]" />
                <span
                  className="absolute inset-0 flex items-center justify-center text-white text-sm font-bold"
                  style={{ textShadow: '0 1px 4px rgba(0,0,0,0.9)' }}
                >
                  ✓
                </span>
              </>
            )}
          </button>
        );
      })}
    </div>
  );
}
