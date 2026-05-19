import type { MetaFunction } from '@remix-run/cloudflare';
import { motion } from 'framer-motion';
import { Link } from '@remix-run/react';
import { PAINTINGS, PAINTING_LIST } from '~/lib/paintings';

export const meta: MetaFunction = () => [{ title: 'Paillette · MUBI-coded' }];

// MUBI / Criterion / A24 — warm charcoal, big Playfair display kept,
// JetBrains Mono for film-credit captions, paintings framed as posters.
const S = {
  bg: '#0d0c0e',
  panel: '#181519',
  text: '#f0ebe0',
  textMuted: '#9a8e7a',
  textFaint: '#5a5048',
  rule: 'rgba(240, 235, 224, 0.12)',
  accent: 'linear-gradient(135deg, #a855f7 0%, #d946ef 50%, #ec4899 100%)',
  display: '"Playfair Display", Georgia, serif',
  body: 'Inter, system-ui, sans-serif',
  mono: '"JetBrains Mono", ui-monospace, monospace',
};

const HERO = PAINTINGS.starry;

// Featured "this week" carousel selections
const FEATURED = [PAINTINGS.pearl, PAINTINGS.wave, PAINTINGS.kiss, PAINTINGS.mona, PAINTINGS.scream];

export default function Mubi() {
  return (
    <div style={{ background: S.bg, color: S.text, fontFamily: S.body }} className="min-h-screen">
      {/* Header */}
      <header style={{ borderBottom: `1px solid ${S.rule}` }} className="relative z-30">
        <div className="container mx-auto px-6 py-5 flex items-center justify-between">
          <div style={{ fontFamily: S.display }} className="text-2xl font-bold tracking-tight">
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
          </div>
          <nav style={{ fontFamily: S.mono, color: S.textMuted }} className="flex items-center gap-6 text-[11px] uppercase tracking-[0.2em]">
            <Link to="/collections" className="hover:text-white">Collection</Link>
            <Link to="/translate" className="hover:text-white">Library</Link>
            <Link to="/design" className="hover:text-white">Notebook</Link>
          </nav>
        </div>
      </header>

      {/* Hero — single painting as if it's the "now showing" feature */}
      <section className="relative">
        <div className="grid lg:grid-cols-[1.3fr_1fr] min-h-[80vh]">
          {/* Left: huge painting frame */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 1.2 }}
            className="relative overflow-hidden"
            style={{ borderRight: `1px solid ${S.rule}` }}
          >
            <img
              src={HERO.src}
              alt={HERO.title}
              className="absolute inset-0 w-full h-full object-cover"
              style={{ filter: 'brightness(0.95)' }}
            />
            <div
              className="absolute inset-0 pointer-events-none"
              style={{
                background:
                  'linear-gradient(90deg, rgba(13,12,14,0) 60%, rgba(13,12,14,0.6) 100%)',
              }}
            />
            {/* Film-credit caption bottom-left */}
            <div className="absolute bottom-6 left-6 right-6 flex items-end justify-between gap-4">
              <div>
                <p style={{ fontFamily: S.mono, color: S.textMuted }} className="text-[10px] uppercase tracking-[0.3em] mb-2">
                  Now showing · this week
                </p>
                <p style={{ fontFamily: S.display }} className="text-3xl lg:text-4xl italic font-medium leading-tight">
                  {HERO.title}
                </p>
                <p style={{ fontFamily: S.mono, color: S.textMuted }} className="text-[11px] uppercase tracking-[0.18em] mt-2">
                  {HERO.artist} · {HERO.year} · {HERO.size}
                </p>
              </div>
            </div>
          </motion.div>

          {/* Right: hero text — like MUBI's right-rail editorial */}
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.2 }}
            className="flex flex-col justify-center px-8 lg:px-12 py-16"
          >
            <p style={{ fontFamily: S.mono, color: S.textMuted }} className="text-[11px] uppercase tracking-[0.3em] mb-6">
              ── est. 2026
            </p>

            <h1 style={{ fontFamily: S.display }} className="font-bold tracking-tight leading-[0.95] text-6xl lg:text-7xl">
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

            <p style={{ color: S.textMuted }} className="mt-6 text-lg leading-relaxed max-w-md">
              A curated index for collections. Search by text, image, or color.
              Read by curators, registered by registrars, looked at by anyone.
            </p>

            <div className="mt-9 flex flex-wrap gap-3">
              <Link
                to="/collections"
                style={{ background: S.accent }}
                className="px-7 py-3.5 text-base font-semibold text-white rounded-full hover:scale-[1.02] transition-transform"
              >
                Enter the collection
              </Link>
              <a
                href="#features"
                style={{ borderColor: S.text }}
                className="px-7 py-3.5 text-base font-semibold border rounded-full hover:bg-white/5 transition-colors"
              >
                Read on
              </a>
            </div>

            {/* Coming up — like MUBI's calendar */}
            <div style={{ borderTop: `1px solid ${S.rule}`, fontFamily: S.mono }} className="mt-12 pt-6">
              <p style={{ color: S.textMuted }} className="text-[10px] uppercase tracking-[0.3em] mb-4">
                In the wings
              </p>
              <ul className="space-y-2 text-sm">
                {FEATURED.slice(0, 3).map((p) => (
                  <li key={p.id} className="flex items-center justify-between gap-4">
                    <span style={{ fontFamily: S.display }} className="italic">{p.title}</span>
                    <span style={{ color: S.textFaint }} className="text-[10px] uppercase tracking-wider">
                      {p.artist}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </motion.div>
        </div>
      </section>

      {/* Features — magazine-section grid */}
      <section id="features" style={{ borderTop: `1px solid ${S.rule}` }}>
        <div className="container mx-auto px-6 py-20 lg:py-28 max-w-6xl">
          <div className="mb-14 flex items-baseline justify-between gap-6 flex-wrap">
            <h2 style={{ fontFamily: S.display }} className="text-4xl lg:text-5xl font-bold leading-none">
              The room behind the wall
            </h2>
            <span style={{ fontFamily: S.mono, color: S.textFaint }} className="text-[11px] uppercase tracking-[0.3em]">
              06 capabilities
            </span>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-px" style={{ background: S.rule }}>
            {[
              ['01', 'Multimodal search', 'Find by text, image, or color. CLIP embeddings, no fine-tuning.'],
              ['02', 'Metadata at scale', 'Bulk CSV ingest, edit in place, sync to your CMS.'],
              ['03', 'Embedding atlas', '2D / 3D field. Cluster, browse, surface the unlooked-at.'],
              ['04', 'Frame removal', 'Strip frames from archival photographs. Reversible.'],
              ['05', 'Four languages', 'EN · 中文 · தமிழ் · BM — wall labels in your visitors\' tongues.'],
              ['06', 'REST + API key', 'Plug Paillette into your studio, OPAC, or kiosk.'],
            ].map(([num, title, body]) => (
              <div key={num} style={{ background: S.bg }} className="p-8 lg:p-10">
                <p style={{ fontFamily: S.mono, color: S.textFaint }} className="text-[11px] uppercase tracking-[0.2em] mb-4">
                  {num}
                </p>
                <h3 style={{ fontFamily: S.display }} className="text-2xl font-bold mb-3 leading-tight">{title}</h3>
                <p style={{ color: S.textMuted }} className="text-sm leading-relaxed">{body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <footer style={{ borderTop: `1px solid ${S.rule}`, fontFamily: S.mono }} className="py-8">
        <div className="container mx-auto px-6 flex items-center justify-between">
          <p style={{ color: S.textFaint }} className="text-[11px] uppercase tracking-[0.2em]">
            © {new Date().getFullYear()} paillette — making collections shine
          </p>
          <Link to="/design" style={{ color: S.textMuted }} className="text-[11px] uppercase tracking-[0.2em] hover:text-white">
            ↩ design index
          </Link>
        </div>
      </footer>
    </div>
  );
}
