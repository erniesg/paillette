import type { MetaFunction } from '@remix-run/cloudflare';
import { motion } from 'framer-motion';
import { Link } from '@remix-run/react';
import { PAINTINGS } from '~/lib/paintings';

export const meta: MetaFunction = () => [{ title: 'Paillette · Noir' }];

const HERO = PAINTINGS.starry;

// NOIR system tokens — Linear / Vercel / Cursor coded.
// Near-black, Inter throughout (no decorative serif), sharp 8px radii,
// JetBrains Mono for labels. Gradient stays as the brand accent.
const S = {
  bg: '#0a0a0c',
  panel: '#141418',
  panelHi: '#1a1a1f',
  text: '#fafafa',
  textMuted: '#8a8a93',
  textFaint: '#525258',
  border: 'rgba(255,255,255,0.08)',
  accent: 'linear-gradient(135deg, #a855f7 0%, #d946ef 50%, #ec4899 100%)',
  body: 'Inter, system-ui, sans-serif',
  mono: '"JetBrains Mono", ui-monospace, monospace',
  radius: '8px',
};

export default function Noir() {
  return (
    <div style={{ background: S.bg, color: S.text, fontFamily: S.body }} className="min-h-screen">
      {/* Top bar — Linear-style */}
      <header style={{ borderBottom: `1px solid ${S.border}` }} className="relative z-30">
        <div className="container mx-auto px-6 py-3.5 flex items-center justify-between">
          <div className="flex items-center gap-8">
            <div className="text-lg font-semibold tracking-tight">
              <span style={{ color: S.text }}>P</span>
              <span
                style={{
                  backgroundImage: S.accent,
                  WebkitBackgroundClip: 'text',
                  backgroundClip: 'text',
                  color: 'transparent',
                }}
              >
                ai
              </span>
              <span style={{ color: S.text }}>llette</span>
            </div>
            <nav className="hidden md:flex items-center gap-5 text-sm" style={{ color: S.textMuted }}>
              <Link to="/collections" className="hover:text-white transition-colors">Collections</Link>
              <Link to="/translate" className="hover:text-white transition-colors">Translate</Link>
              <Link to="/design" className="hover:text-white transition-colors">Design</Link>
            </nav>
          </div>
          <div className="flex items-center gap-2">
            <span style={{ fontFamily: S.mono, color: S.textFaint }} className="text-[11px] uppercase tracking-wider hidden md:inline">
              v0.1 · staging
            </span>
            <Link
              to="/auth/signin"
              style={{ background: S.panelHi, borderRadius: S.radius, borderColor: S.border }}
              className="px-3.5 py-1.5 text-sm border hover:bg-[#202028] transition-colors"
            >
              Sign in
            </Link>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="container mx-auto px-6 pt-20 lg:pt-28 pb-16 lg:pb-24 max-w-6xl">
          <div className="grid lg:grid-cols-[1.1fr_1fr] gap-12 lg:gap-16 items-center">
            {/* Left: text */}
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6 }}
            >
              <div style={{ fontFamily: S.mono, color: S.textFaint }} className="text-[11px] uppercase tracking-[0.2em] mb-5 flex items-center gap-2">
                <span style={{ background: S.accent }} className="inline-block w-1.5 h-1.5 rounded-full" />
                Multimodal search · CLIP embeddings · 4 languages
              </div>

              <h1 className="text-5xl lg:text-7xl font-semibold tracking-[-0.03em] leading-[0.95]">
                <span>P</span>
                <span
                  style={{
                    backgroundImage: S.accent,
                    WebkitBackgroundClip: 'text',
                    backgroundClip: 'text',
                    color: 'transparent',
                  }}
                >
                  ai
                </span>
                <span>llette</span>
              </h1>

              <p style={{ color: S.textMuted }} className="mt-5 text-lg leading-relaxed max-w-md">
                Search, translate, and manage a collection — the way curators,
                registrars, and the public actually look at art.
              </p>

              <div className="mt-8 flex flex-wrap gap-2.5">
                <Link
                  to="/collections"
                  style={{ background: S.accent, borderRadius: S.radius }}
                  className="px-5 py-2.5 text-sm font-medium text-white hover:opacity-95 transition-opacity"
                >
                  Enter the collection
                </Link>
                <a
                  href="#features"
                  style={{ background: S.panel, borderRadius: S.radius, borderColor: S.border }}
                  className="px-5 py-2.5 text-sm font-medium border hover:bg-[#1c1c22] transition-colors"
                >
                  Read the docs →
                </a>
              </div>

              {/* Linear-style "what's new" stripe */}
              <div className="mt-10 flex items-center gap-3">
                <span style={{ background: S.accent, color: '#fff', borderRadius: S.radius, fontFamily: S.mono }} className="px-2 py-0.5 text-[10px] uppercase tracking-wider font-semibold">
                  New
                </span>
                <span style={{ color: S.textMuted }} className="text-sm">
                  Color-similarity search shipped →
                </span>
              </div>
            </motion.div>

            {/* Right: painting framed as if in a product UI */}
            <motion.div
              initial={{ opacity: 0, x: 12 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.7, delay: 0.1 }}
              className="relative"
            >
              <div
                style={{
                  background: S.panel,
                  borderColor: S.border,
                  borderRadius: '12px',
                }}
                className="border p-3 lg:p-4"
              >
                {/* Faux window chrome */}
                <div className="flex items-center justify-between mb-3">
                  <div className="flex gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-full" style={{ background: '#3a3a40' }} />
                    <span className="w-2.5 h-2.5 rounded-full" style={{ background: '#3a3a40' }} />
                    <span className="w-2.5 h-2.5 rounded-full" style={{ background: '#3a3a40' }} />
                  </div>
                  <div style={{ fontFamily: S.mono, color: S.textFaint }} className="text-[10px] uppercase tracking-wider">
                    /artworks/{HERO.id}
                  </div>
                </div>
                <div
                  style={{ aspectRatio: HERO.ratio, borderRadius: S.radius }}
                  className="overflow-hidden"
                >
                  <img src={HERO.src} alt="" className="w-full h-full object-cover" />
                </div>
                <div className="mt-3 flex items-baseline justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{HERO.title}</p>
                    <p style={{ color: S.textMuted, fontFamily: S.mono }} className="text-[11px] uppercase tracking-wider mt-0.5">
                      {HERO.artist} · {HERO.year}
                    </p>
                  </div>
                  <div style={{ background: S.panelHi, borderRadius: '4px', fontFamily: S.mono, color: S.textMuted }} className="px-2 py-0.5 text-[10px] uppercase tracking-wider">
                    {HERO.size}
                  </div>
                </div>
              </div>
            </motion.div>
          </div>
        </div>
      </section>

      {/* Features — tight cards, dev-tool feel */}
      <section id="features" className="relative" style={{ borderTop: `1px solid ${S.border}` }}>
        <div className="container mx-auto px-6 py-20 lg:py-24 max-w-6xl">
          <div className="mb-12">
            <p style={{ fontFamily: S.mono, color: S.textFaint }} className="text-[11px] uppercase tracking-[0.2em] mb-3">
              capabilities
            </p>
            <h2 className="text-3xl lg:text-4xl font-semibold tracking-tight">What's in the box</h2>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-3">
            {[
              ['01', 'Multimodal search', 'Find work by text, image, or color. CLIP embeddings, no fine-tuning.'],
              ['02', 'Metadata at scale', 'Bulk CSV ingest, edit in place, sync to your CMS.'],
              ['03', 'Embedding atlas', '2D / 3D field. Cluster, browse, surface the unlooked-at.'],
              ['04', 'Frame removal', 'Strip frames from archival photographs. Reversible.'],
              ['05', 'Four languages', 'EN · 中文 · தமிழ் · BM — labels in your visitors\' tongues.'],
              ['06', 'REST + API key', 'Plug Paillette into your studio, OPAC, or kiosk.'],
            ].map(([num, title, body]) => (
              <div
                key={num}
                style={{ background: S.panel, borderColor: S.border, borderRadius: S.radius }}
                className="border p-5 hover:bg-[#16161c] transition-colors"
              >
                <div className="flex items-center justify-between mb-3">
                  <span style={{ fontFamily: S.mono, color: S.textMuted }} className="text-[10px] uppercase tracking-wider">
                    {num}
                  </span>
                  <span style={{ background: S.accent }} className="w-1 h-1 rounded-full" />
                </div>
                <h3 className="text-base font-semibold mb-1.5">{title}</h3>
                <p style={{ color: S.textMuted }} className="text-sm leading-relaxed">
                  {body}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <footer style={{ borderTop: `1px solid ${S.border}` }} className="py-8">
        <div className="container mx-auto px-6 flex items-center justify-between">
          <p style={{ fontFamily: S.mono, color: S.textFaint }} className="text-[11px] uppercase tracking-wider">
            © {new Date().getFullYear()} paillette
          </p>
          <Link to="/design" style={{ fontFamily: S.mono, color: S.textMuted }} className="text-[11px] uppercase tracking-wider hover:text-white">
            ↩ design index
          </Link>
        </div>
      </footer>
    </div>
  );
}
