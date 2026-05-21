import type { LinksFunction, MetaFunction } from '@remix-run/cloudflare';
import { motion } from 'framer-motion';
import { Link } from '@remix-run/react';
import { PAINTINGS } from '~/lib/paintings';

export const meta: MetaFunction = () => [
  { title: 'Paillette - Design Exploration' },
];

export const links: LinksFunction = () => [
  {
    rel: 'stylesheet',
    href: 'https://fonts.googleapis.com/css2?family=EB+Garamond:ital,wght@0,400;0,500;0,600;1,400&family=IBM+Plex+Mono:wght@400;500&family=JetBrains+Mono:wght@400;500&family=Noto+Sans:wght@400;500;700&family=Noto+Serif:wght@400;500;700&display=swap',
  },
];

// Every variant route, newest first. This is the master index.
const ALL_VARIANTS = [
  { round: 'R4', href: '/home-2', name: 'Home 2', note: 'Search + Refine (colour facet) × layout (Masonry / Salon / Atlas / Table) × group-by-colour. The synthesis.' },
  { round: 'R3', href: '/find', name: 'Find', note: 'Search-as-hero — the landing IS the product. No marketing copy.' },
  { round: 'R3', href: '/spectrum', name: 'Spectrum', note: '12 color bars fill the viewport. Color is the navigation.' },
  { round: 'R3', href: '/atlas', name: 'Atlas', note: 'The embedding atlas itself is the hero — paintings in style clusters.' },
  { round: 'R3', href: '/raw', name: 'Raw', note: 'Brutalist wiki. Monospace, sortable table, anti-design.' },
  { round: 'R2', href: '/noir', name: 'Noir', note: 'Tech-product. Linear / Vercel / Cursor coded, near-black, Inter only.' },
  { round: 'R2', href: '/mubi', name: 'Cinema', note: 'MUBI / Criterion coded. Painting framed as the "now showing" poster.' },
  { round: 'R2', href: '/chrome', name: 'Chrome', note: 'Y2K iridescent anti-museum. Glass cards, oversaturated gradient.' },
  { round: 'R1', href: '/salon', name: 'Salon hang', note: 'Petersburg hang on a cream linen wall, hero text in the clear band.' },
  { round: 'R1', href: '/cinematic', name: 'Cinematic', note: 'Full-bleed Van Gogh with Ken Burns drift, film-title-card hero.' },
  { round: 'R1', href: '/cube', name: 'White cube', note: 'Museum-minimal. One small artwork plate, huge serif wordmark.' },
  { round: 'orig', href: '/', name: 'V0 Current', note: 'The original homepage — dark gradient, floating orbs, feature grid.' },
];

type System = {
  id: string;
  name: string;
  vibe: string;
  inspiration: string;
  palette: {
    bg: string;
    cardBg: string;
    ink: string;
    inkMuted: string;
    accent: string; // can be a gradient string
    accentInk: string;
    divider: string;
  };
  fonts: { display: string; body: string; mono: string };
  radius: string;
  letterTracking?: string;
};

const SYSTEMS: System[] = [
  {
    id: 'editorial',
    name: 'Editorial',
    vibe: 'Magazine-coded. Sharp serif on cream paper, hairline rules, rust accent.',
    inspiration: 'Frieze · Apollo · Burlington',
    palette: {
      bg: '#f5efe2',
      cardBg: '#ede5d0',
      ink: '#0d0a08',
      inkMuted: '#5a4030',
      accent: '#b8591e',
      accentInk: '#fff5e8',
      divider: 'rgba(13, 10, 8, 0.16)',
    },
    fonts: {
      display: '"Playfair Display", Georgia, serif',
      body: 'Inter, system-ui, sans-serif',
      mono: '"IBM Plex Mono", "JetBrains Mono", monospace',
    },
    radius: '2px',
    letterTracking: '0.3em',
  },
  {
    id: 'institution',
    name: 'Institution',
    vibe: 'White-cube confident. Pure white, bold sans, vermillion accent.',
    inspiration: 'Tate · MoMA · Whitechapel',
    palette: {
      bg: '#ffffff',
      cardBg: '#f4f4f4',
      ink: '#000000',
      inkMuted: '#5a5a5a',
      accent: '#e30613',
      accentInk: '#ffffff',
      divider: 'rgba(0, 0, 0, 0.12)',
    },
    fonts: {
      display: 'Inter, system-ui, sans-serif',
      body: 'Inter, system-ui, sans-serif',
      mono: '"JetBrains Mono", monospace',
    },
    radius: '0px',
    letterTracking: '0.04em',
  },
  {
    id: 'gallerist',
    name: 'Gallerist',
    vibe: 'Quiet luxury. Paper white, classical serif, hunter-green accent.',
    inspiration: 'David Zwirner · Gagosian · Hauser & Wirth',
    palette: {
      bg: '#fafaf6',
      cardBg: '#f0ede4',
      ink: '#1a1a1a',
      inkMuted: '#6a6a60',
      accent: '#2a4a32',
      accentInk: '#f0ede4',
      divider: 'rgba(26, 26, 26, 0.1)',
    },
    fonts: {
      display: '"EB Garamond", Georgia, serif',
      body: 'Inter, system-ui, sans-serif',
      mono: '"JetBrains Mono", monospace',
    },
    radius: '0px',
    letterTracking: '0.18em',
  },
  {
    id: 'nanyang',
    name: 'Nanyang',
    vibe: 'Rooted in place. Sand, teak, peranakan blue. Multilingual-ready (Noto).',
    inspiration: 'NGS · regional museums · place-specific',
    palette: {
      bg: '#ecdfc4',
      cardBg: '#e0d2b0',
      ink: '#3a2415',
      inkMuted: '#7a5a3a',
      accent: '#1d5b8c',
      accentInk: '#ecdfc4',
      divider: 'rgba(58, 36, 21, 0.18)',
    },
    fonts: {
      display: '"Noto Serif", Georgia, serif',
      body: '"Noto Sans", system-ui, sans-serif',
      mono: '"JetBrains Mono", monospace',
    },
    radius: '4px',
    letterTracking: '0.22em',
  },
  {
    id: 'lustre',
    name: 'Lustre',
    vibe: 'Current direction, tightened. Aubergine night, prismatic gradient on "ai".',
    inspiration: 'Paillette V0 — refined',
    palette: {
      bg: '#0a060f',
      cardBg: '#15101d',
      ink: '#f4ecdc',
      inkMuted: '#a89a86',
      accent: 'linear-gradient(135deg, #a855f7 0%, #d946ef 50%, #ec4899 100%)',
      accentInk: '#ffffff',
      divider: 'rgba(244, 236, 220, 0.1)',
    },
    fonts: {
      display: '"Playfair Display", Georgia, serif',
      body: 'Inter, system-ui, sans-serif',
      mono: '"JetBrains Mono", monospace',
    },
    radius: '9999px',
    letterTracking: '0.3em',
  },
];

const isGradient = (v: string) =>
  v.includes('linear-gradient') || v.includes('radial-gradient');

function aiStyle(accent: string): React.CSSProperties {
  if (isGradient(accent)) {
    return {
      backgroundImage: accent,
      WebkitBackgroundClip: 'text',
      backgroundClip: 'text',
      color: 'transparent',
    };
  }
  return { color: accent };
}

const PAGE_VARIANTS = [
  {
    href: '/',
    label: 'V0 · Current',
    note: 'Dark gradient, floating orbs, centered hero, feature card grid. The baseline.',
    bg: 'linear-gradient(135deg, #0a0a0a 0%, #171717 50%, #3b0764 100%)',
    accent: 'starry',
  },
  {
    href: '/salon',
    label: 'V1 · Salon hang',
    note: 'Petersburg-style wall on warm linen. Real paintings on the perimeter, hero text in the clear band. Cream + dark-brown palette.',
    bg: '#e8ddc6',
    accent: 'pearl',
    light: true,
  },
  {
    href: '/cinematic',
    label: 'V2 · Cinematic',
    note: 'One painting fills the screen with slow Ken Burns drift. Hero text bottom-left like a film title card. Painting credit bottom-right.',
    bg: 'linear-gradient(180deg, #06080f 0%, #1a2540 100%)',
    accent: 'starry',
  },
  {
    href: '/cube',
    label: 'V3 · White cube',
    note: 'Museum-minimal. One small painting plate centered, huge serif Paillette below, hairline rule features. Off-white + warm-brown.',
    bg: '#f5efe2',
    accent: 'pearl',
    light: true,
  },
];

export default function Design() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-neutral-950 via-neutral-900 to-primary-950 text-white">
      <style>{`
        @keyframes shimmer-flow {
          0% { background-position: 0% 50%; }
          100% { background-position: 200% 50%; }
        }
        @keyframes orb-drift {
          0%, 100% { transform: translate(0, 0) scale(1); opacity: 0.5; }
          50% { transform: translate(-4%, 3%) scale(1.08); opacity: 0.75; }
        }
        @keyframes underline-sweep {
          0% { transform: scaleX(0); transform-origin: left; }
          50% { transform: scaleX(1); transform-origin: left; }
          50.01% { transform-origin: right; }
          100% { transform: scaleX(0); transform-origin: right; }
        }
        @keyframes float-soft {
          0%, 100% { transform: translateY(0px); }
          50% { transform: translateY(-6px); }
        }
      `}</style>

      {/* Ambient bg */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/3 right-20 w-[28rem] h-[28rem] bg-primary-500/10 rounded-full blur-3xl" />
        <div className="absolute bottom-1/4 left-20 w-[28rem] h-[28rem] bg-accent-500/10 rounded-full blur-3xl" />
      </div>

      <div className="relative z-10 container mx-auto px-6 py-16 max-w-6xl">
        {/* Quick index — every variant, one click away */}
        <div className="mb-16">
          <div className="text-center mb-6">
            <p className="text-sm uppercase tracking-[0.3em] text-neutral-400 mb-1">
              Index
            </p>
            <h1 className="text-3xl font-display">All variants — 11 routes</h1>
            <p className="text-neutral-500 text-sm mt-2">
              Bookmark this page (/design). Every mockup below is a live route.
            </p>
          </div>
          <div className="rounded-2xl border border-neutral-800 bg-neutral-900/50 backdrop-blur-sm divide-y divide-neutral-800 overflow-hidden">
            {ALL_VARIANTS.map((v) => (
              <Link
                key={v.href}
                to={v.href}
                className="flex items-center gap-4 px-5 py-3 hover:bg-neutral-800/50 transition-colors group"
              >
                <span className="text-[10px] font-mono uppercase tracking-wider text-neutral-600 w-16 shrink-0">
                  {v.round}
                </span>
                <span className="font-mono text-sm text-accent-300 w-28 shrink-0">
                  {v.href}
                </span>
                <span className="font-display text-base text-white w-32 shrink-0">
                  {v.name}
                </span>
                <span className="text-sm text-neutral-400 flex-1 hidden md:block truncate">
                  {v.note}
                </span>
                <span className="text-xs text-neutral-600 group-hover:text-primary-300 transition-colors shrink-0">
                  open →
                </span>
              </Link>
            ))}
          </div>
        </div>

        {/* Round 3 — actually divergent. Not another "hero + CTA + features". */}
        <div className="mb-10 text-center">
          <p className="text-sm uppercase tracking-[0.3em] text-accent-300 mb-2">
            Round 3 · divergent
          </p>
          <h2 className="text-3xl font-display">Four routes that aren't "hero + CTA + features"</h2>
          <p className="text-neutral-400 mt-3 max-w-2xl mx-auto">
            Each one departs structurally — the search is the page, the page is a wall of color,
            the hero is the product itself, or the whole site refuses to be designed.
          </p>
        </div>

        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-3 mb-20">
          {[
            {
              href: '/find',
              label: 'Find',
              vibe: 'The landing IS the search. Giant input, query chips, results stream below. No marketing copy, no features. Perplexity-for-art.',
              tag: 'product-as-hero',
              bg: '#08070d',
            },
            {
              href: '/spectrum',
              label: 'Spectrum',
              vibe: '12 vertical color bars fill the viewport. Each one is a painting\'s dominant color. Hover to reveal the work. Color IS navigation.',
              tag: 'no traditional hero',
              bg: 'linear-gradient(90deg, #1e3a5f, #c89f3a, #c8542e, #8a2a6a)',
            },
            {
              href: '/atlas',
              label: 'Atlas',
              vibe: 'The hero is the embedding atlas itself — a galaxy of paintings clustered by style, similarity edges drawn between them. Show the product, don\'t describe it.',
              tag: 'show, don\'t tell',
              bg: 'radial-gradient(ellipse at 30% 30%, rgba(168,85,247,0.3), #08070d 60%)',
            },
            {
              href: '/raw',
              label: 'Raw',
              vibe: 'Brutalist wiki. White bg, monospace, blue underlined links, real table with sortable columns. Looks like a 1995 museum database. Aggressively un-designed.',
              tag: 'anti-design',
              bg: '#ffffff',
              isLight: true,
            },
          ].map((v) => (
            <Link
              key={v.href}
              to={v.href}
              className="group rounded-2xl border border-neutral-800 hover:border-accent-400/60 overflow-hidden transition-colors"
            >
              <div className="aspect-[4/5] relative overflow-hidden" style={{ background: v.bg }}>
                <div className="absolute top-5 left-5 right-5">
                  <p className={`text-[10px] uppercase tracking-[0.3em] font-mono ${v.isLight ? 'text-black/60' : 'text-white/60'}`}>
                    {v.tag}
                  </p>
                  <p className={`mt-1 font-display font-bold text-2xl ${v.isLight ? 'text-black' : 'text-white'}`}>
                    {v.label}
                  </p>
                </div>
                <div className={`absolute bottom-5 left-5 right-5 font-display font-bold text-xl`}>
                  <span className={v.isLight ? 'text-black' : 'text-white'}>P</span>
                  <span className="bg-gradient-accent bg-clip-text text-transparent">ai</span>
                  <span className={v.isLight ? 'text-black' : 'text-white'}>llette</span>
                </div>
              </div>
              <div className="p-4 bg-neutral-900/60 backdrop-blur-sm">
                <div className="flex items-baseline justify-between gap-3 mb-1.5">
                  <div className="text-sm font-mono uppercase tracking-widest text-accent-300">
                    {v.label}
                  </div>
                  <div className="text-xs text-neutral-500 group-hover:text-primary-300 transition-colors">
                    open →
                  </div>
                </div>
                <p className="text-[12px] text-neutral-400 leading-relaxed">{v.vibe}</p>
              </div>
            </Link>
          ))}
        </div>

        {/* Round 2 — kept for reference */}
        <div className="mb-10 text-center">
          <p className="text-sm uppercase tracking-[0.3em] text-neutral-500 mb-2">
            Round 2 · system swaps (kept for reference)
          </p>
          <h2 className="text-2xl font-display text-neutral-300">Three system shifts (same shape)</h2>
          <p className="text-neutral-400 mt-3 max-w-2xl mx-auto">
            Dropping the museum-reference framing (Frieze / Tate / Zwirner / NGS were all wrong).
            All three keep the V0 purple gradient as the only accent. Click into each — they're real pages, not swatch cards.
          </p>
        </div>

        <div className="grid md:grid-cols-3 gap-4 mb-20">
          {[
            {
              href: '/noir',
              label: 'Noir',
              vibe: 'Tech-product. Linear / Vercel / Cursor coded — near-black, Inter only (no Playfair), sharp 8px radii, mono labels, gradient accent on "ai" + primary CTA.',
              bg: '#0a0a0c',
              painting: PAINTINGS.starry,
              isDark: true,
            },
            {
              href: '/mubi',
              label: 'Cinema',
              vibe: 'MUBI / Criterion / A24 — warm charcoal, big Playfair display kept, mono film-credit captions, painting framed as the "now showing" poster.',
              bg: '#0d0c0e',
              painting: PAINTINGS.starry,
              isDark: true,
            },
            {
              href: '/chrome',
              label: 'Chrome',
              vibe: 'Anti-museum, Y2K-iridescent. Aubergine midnight + heavy purple/fuchsia gradient, glass cards with deep blur, oversaturated, weird-luxe.',
              bg: 'radial-gradient(ellipse at 20% 0%, #1f0a3a 0%, #0a0612 55%)',
              painting: PAINTINGS.kiss,
              isDark: true,
            },
          ].map((v) => (
            <Link
              key={v.href}
              to={v.href}
              className="group rounded-2xl border border-neutral-800 hover:border-primary-400/60 overflow-hidden transition-colors"
            >
              <div className="aspect-[4/5] relative overflow-hidden" style={{ background: v.bg }}>
                <img
                  src={v.painting.src}
                  alt=""
                  className="absolute -bottom-4 right-3 w-40 h-40 object-cover rounded-md opacity-90 group-hover:opacity-100 transition-opacity"
                  style={{
                    transform: 'rotate(-2deg)',
                    boxShadow: '0 24px 48px -16px rgba(0,0,0,0.7)',
                  }}
                />
                <div className="absolute top-5 left-5">
                  <div className="font-display font-bold text-xl">
                    <span className="text-white">P</span>
                    <span className="bg-gradient-accent bg-clip-text text-transparent">ai</span>
                    <span className="text-white">llette</span>
                  </div>
                  <p className="mt-1 text-[10px] uppercase tracking-[0.3em] text-white/60 font-mono">
                    {v.label.toLowerCase()}
                  </p>
                </div>
              </div>
              <div className="p-5 bg-neutral-900/60 backdrop-blur-sm">
                <div className="flex items-baseline justify-between gap-3 mb-2">
                  <div className="text-sm font-mono uppercase tracking-widest text-accent-300">
                    {v.label}
                  </div>
                  <div className="text-xs text-neutral-500 group-hover:text-primary-300 transition-colors">
                    open →
                  </div>
                </div>
                <p className="text-[13px] text-neutral-400 leading-relaxed">{v.vibe}</p>
              </div>
            </Link>
          ))}
        </div>

        <p className="text-neutral-500 text-xs text-center mb-20 max-w-2xl mx-auto leading-relaxed">
          Paintings are Wikimedia placeholders. Nanyang School works (Liu Kang, Georgette Chen,
          Cheong Soo Pieng) are still under SG copyright into the 2050s–2070s, so production
          will need NGS to authorize images.
        </p>

        {/* Layout directions — kept below for reference */}
        <div className="mb-10 text-center">
          <p className="text-sm uppercase tracking-[0.3em] text-neutral-400 mb-2">
            Layout directions
          </p>
          <h2 className="text-3xl font-display">Layouts (separate axis from system)</h2>
          <p className="text-neutral-400 mt-3 max-w-xl mx-auto">
            You said you'd use Salon + Cinematic in different places. Open each to see them in V0's palette;
            once you pick a system above, both get reskinned.
          </p>
        </div>

        <div className="grid md:grid-cols-2 gap-5 mb-20">
          {PAGE_VARIANTS.map((v) => (
            <Link
              key={v.href}
              to={v.href}
              className="group relative rounded-3xl border border-neutral-800 hover:border-primary-400/50 overflow-hidden transition-colors"
            >
              <div className="aspect-[16/10] relative overflow-hidden" style={{ background: v.bg }}>
                {/* Mini "salon" decoration — a single painting peeking */}
                <img
                  src={PAINTINGS[v.accent].src}
                  alt=""
                  className="absolute -bottom-6 -right-8 w-48 h-48 object-cover rounded-sm opacity-80 group-hover:opacity-100 transition-opacity"
                  style={{
                    transform: 'rotate(-3deg)',
                    boxShadow: '0 20px 40px -12px rgba(0,0,0,0.6), inset 0 0 0 1px rgba(20,10,4,0.3)',
                  }}
                />
                {/* Wordmark stamp */}
                <div className="absolute top-6 left-6 font-display font-bold text-2xl">
                  <span className={v.light ? 'text-[#0d0a08]' : 'text-white'}>P</span>
                  <span className="bg-gradient-accent bg-clip-text text-transparent">ai</span>
                  <span className={v.light ? 'text-[#0d0a08]' : 'text-white'}>llette</span>
                </div>
              </div>
              <div className="p-5 bg-neutral-900/60 backdrop-blur-sm">
                <div className="flex items-baseline justify-between gap-3 mb-1.5">
                  <div className="text-sm font-mono uppercase tracking-widest text-accent-300">
                    {v.label}
                  </div>
                  <div className="text-xs text-neutral-500 group-hover:text-primary-300 transition-colors">
                    open →
                  </div>
                </div>
                <p className="text-sm text-neutral-400 leading-relaxed">{v.note}</p>
              </div>
            </Link>
          ))}
        </div>

        {/* Logo treatments */}
        <div className="mb-12 text-center">
          <p className="text-sm uppercase tracking-[0.3em] text-neutral-400 mb-2">
            Logo treatments
          </p>
          <h2 className="text-3xl font-display">"ai" detail (V0 is the chosen baseline)</h2>
          <p className="text-neutral-400 mt-3 max-w-xl mx-auto">
            Alternate stylings for the AI inside Paillette. V0 stays unless we want to revisit.
          </p>
        </div>

        <div className="space-y-6">
          <Variant
            label="V0 · Current"
            note="Single gradient sweep + soft glow shadow on the wordmark."
          >
            <Logo>
              <span className="text-white">P</span>
              <span className="bg-gradient-accent bg-clip-text text-transparent animate-glow">ai</span>
              <span className="text-white">llette</span>
            </Logo>
          </Variant>

          <Variant
            label="V2 · Iridescent shimmer"
            note="Animated rainbow gradient flow — feels alive and intelligent."
          >
            <Logo>
              <span className="text-white">P</span>
              <span
                className="bg-clip-text text-transparent"
                style={{
                  backgroundImage:
                    'linear-gradient(110deg, #a855f7 0%, #d946ef 20%, #ec4899 40%, #06b6d4 60%, #a855f7 80%, #d946ef 100%)',
                  backgroundSize: '200% 100%',
                  WebkitBackgroundClip: 'text',
                  backgroundClip: 'text',
                  animation: 'shimmer-flow 5s linear infinite',
                }}
              >
                ai
              </span>
              <span className="text-white">llette</span>
            </Logo>
          </Variant>
        </div>

        <div className="mt-16 text-center text-neutral-500 text-sm">
          Tell me which one (or which combo) you want and I'll wire it into the homepage.
        </div>
      </div>
    </div>
  );
}

function Variant({
  label,
  note,
  children,
}: {
  label: string;
  note: string;
  children: React.ReactNode;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ duration: 0.5 }}
      className="relative rounded-3xl border border-neutral-800 bg-neutral-900/40 backdrop-blur-sm overflow-hidden"
    >
      <div className="grid lg:grid-cols-[200px_1fr] gap-6 p-6 lg:p-10 items-center">
        <div>
          <div className="text-xs uppercase tracking-[0.2em] text-accent-300 font-mono">
            {label}
          </div>
          <p className="text-sm text-neutral-400 mt-2 leading-relaxed">{note}</p>
        </div>
        <div className="flex items-center justify-center min-h-[140px] lg:min-h-[180px]">
          {children}
        </div>
      </div>
    </motion.div>
  );
}

function Logo({ children }: { children: React.ReactNode }) {
  return (
    <h1 className="text-6xl lg:text-8xl font-display font-bold tracking-tight leading-none">
      {children}
    </h1>
  );
}

function SystemCard({ system: s }: { system: System }) {
  const trackTight = s.letterTracking ?? '0.18em';
  return (
    <div
      className="rounded-3xl overflow-hidden border"
      style={{
        background: s.palette.bg,
        color: s.palette.ink,
        borderColor: s.palette.divider,
        fontFamily: s.fonts.body,
      }}
    >
      {/* Header */}
      <div
        className="p-6 lg:p-8"
        style={{ borderBottom: `1px solid ${s.palette.divider}` }}
      >
        <div
          style={{
            fontFamily: s.fonts.mono,
            color: s.palette.inkMuted,
            letterSpacing: trackTight,
          }}
          className="text-[10px] uppercase"
        >
          {s.inspiration}
        </div>
        <h3
          style={{ fontFamily: s.fonts.display, color: s.palette.ink }}
          className="text-4xl font-bold mt-2 leading-none"
        >
          {s.name}
        </h3>
        <p
          style={{ color: s.palette.inkMuted }}
          className="mt-3 text-sm leading-relaxed"
        >
          {s.vibe}
        </p>
      </div>

      {/* Palette */}
      <div
        className="px-6 lg:px-8 py-5"
        style={{ borderBottom: `1px solid ${s.palette.divider}` }}
      >
        <div
          style={{
            fontFamily: s.fonts.mono,
            color: s.palette.inkMuted,
            letterSpacing: '0.2em',
          }}
          className="text-[10px] uppercase mb-3"
        >
          Palette
        </div>
        <div className="flex gap-2">
          {[
            ['bg', s.palette.bg],
            ['card', s.palette.cardBg],
            ['ink', s.palette.ink],
            ['muted', s.palette.inkMuted],
            ['accent', s.palette.accent],
            ['divider', s.palette.divider],
          ].map(([key, value]) => (
            <div key={key} className="flex-1">
              <div
                className="aspect-square"
                style={{
                  background: value,
                  borderRadius: s.radius === '9999px' ? '8px' : s.radius,
                  border: `1px solid ${s.palette.divider}`,
                }}
              />
              <div
                style={{
                  fontFamily: s.fonts.mono,
                  color: s.palette.inkMuted,
                  letterSpacing: '0.08em',
                }}
                className="text-[9px] mt-1.5 uppercase"
              >
                {key}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Typography */}
      <div
        className="px-6 lg:px-8 py-5"
        style={{ borderBottom: `1px solid ${s.palette.divider}` }}
      >
        <div
          style={{
            fontFamily: s.fonts.mono,
            color: s.palette.inkMuted,
            letterSpacing: '0.2em',
          }}
          className="text-[10px] uppercase mb-3"
        >
          Typography
        </div>
        <p
          style={{
            fontFamily: s.fonts.display,
            color: s.palette.ink,
            letterSpacing: '-0.02em',
          }}
          className="text-4xl lg:text-5xl font-bold leading-none"
        >
          P<span style={aiStyle(s.palette.accent)}>ai</span>llette
        </p>
        <p
          style={{ fontFamily: s.fonts.body, color: s.palette.ink }}
          className="mt-4 text-[15px] leading-relaxed"
        >
          The way curators, registrars, and the public actually look at art.
        </p>
        <p
          style={{
            fontFamily: s.fonts.mono,
            color: s.palette.inkMuted,
            letterSpacing: '0.18em',
          }}
          className="mt-3 text-[10px] uppercase"
        >
          <span className="italic">Girl with a Pearl Earring</span>
          {' · '}Johannes Vermeer · 1665 · 8F
        </p>
      </div>

      {/* Components */}
      <div className="px-6 lg:px-8 py-5">
        <div
          style={{
            fontFamily: s.fonts.mono,
            color: s.palette.inkMuted,
            letterSpacing: '0.2em',
          }}
          className="text-[10px] uppercase mb-4"
        >
          Components
        </div>

        <div className="flex flex-wrap gap-3 items-center mb-5">
          {/* Primary button */}
          <div
            style={{
              background: s.palette.accent,
              color: s.palette.accentInk,
              borderRadius: s.radius,
              fontFamily: s.fonts.body,
            }}
            className="px-5 py-2.5 font-semibold text-sm"
          >
            Enter the collection
          </div>
          {/* Secondary button */}
          <div
            style={{
              borderColor: s.palette.ink,
              color: s.palette.ink,
              borderRadius: s.radius,
              fontFamily: s.fonts.body,
            }}
            className="px-5 py-2.5 font-semibold text-sm border opacity-80"
          >
            Explore
          </div>
        </div>

        {/* Sample card with framed artwork */}
        <div
          className="flex gap-4 p-4 border"
          style={{
            background: s.palette.cardBg,
            borderColor: s.palette.divider,
            borderRadius: s.radius,
          }}
        >
          <div
            className="flex-shrink-0"
            style={{
              width: '64px',
              aspectRatio: PAINTINGS.pearl.ratio,
              boxShadow: `0 6px 12px -4px rgba(0,0,0,0.25), inset 0 0 0 1px ${s.palette.divider}`,
            }}
          >
            <img
              src={PAINTINGS.pearl.src}
              alt=""
              className="w-full h-full object-cover"
              style={{ borderRadius: s.radius === '9999px' ? '4px' : s.radius }}
            />
          </div>
          <div className="flex-1 min-w-0">
            <div
              style={{
                fontFamily: s.fonts.mono,
                color: s.palette.inkMuted,
                letterSpacing: '0.18em',
              }}
              className="text-[10px] uppercase mb-1.5"
            >
              01 — Multimodal search
            </div>
            <p
              style={{ color: s.palette.ink, fontFamily: s.fonts.body }}
              className="text-sm leading-relaxed"
            >
              Find work by text, image, or color. Embeddings do the matching;
              you do the curating.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
