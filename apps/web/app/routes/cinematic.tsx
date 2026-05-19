import type { MetaFunction } from '@remix-run/cloudflare';
import { motion } from 'framer-motion';
import { Link } from '@remix-run/react';
import { PAINTINGS } from '~/lib/paintings';

export const meta: MetaFunction = () => [{ title: 'Paillette · Cinematic' }];

// One painting carries the whole hero. The page lives in its palette.
const HERO = PAINTINGS.starry;

export default function Cinematic() {
  return (
    <div className="min-h-screen bg-[#06080f] text-white">
      <style>{`
        @keyframes hero-pan {
          0% { transform: scale(1.05) translate(0, 0); }
          50% { transform: scale(1.08) translate(-1%, -0.5%); }
          100% { transform: scale(1.05) translate(0, 0); }
        }
      `}</style>

      {/* Hero */}
      <section className="relative min-h-[100vh] overflow-hidden">
        {/* Full-bleed artwork with slow Ken Burns drift */}
        <div className="absolute inset-0">
          <img
            src={HERO.src}
            alt={`${HERO.title} — ${HERO.artist}`}
            className="w-full h-full object-cover"
            style={{ animation: 'hero-pan 24s ease-in-out infinite' }}
          />
        </div>

        {/* Dark gradient overlay — protects the text without flattening the image */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background:
              'linear-gradient(180deg, rgba(6,8,15,0.7) 0%, rgba(6,8,15,0.2) 28%, rgba(6,8,15,0.1) 55%, rgba(6,8,15,0.85) 95%)',
          }}
        />
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background:
              'linear-gradient(90deg, rgba(6,8,15,0.55) 0%, rgba(6,8,15,0.1) 45%, rgba(6,8,15,0) 100%)',
          }}
        />

        {/* Header — floats over the artwork */}
        <header className="relative z-30">
          <div className="container mx-auto px-6 py-5 flex items-center justify-between">
            <div className="text-2xl font-display font-bold tracking-tight">
              <span className="text-white">P</span>
              <span className="bg-gradient-accent bg-clip-text text-transparent">ai</span>
              <span className="text-white">llette</span>
            </div>
            <nav className="flex items-center gap-5 text-sm">
              <Link to="/collections" className="text-white/80 hover:text-white">Collections</Link>
              <Link to="/translate" className="text-white/80 hover:text-white">Translate</Link>
              <Link to="/design" className="text-white/60 hover:text-white text-xs font-mono">↩ variants</Link>
            </nav>
          </div>
        </header>

        {/* Hero text — bottom-left, like a film title card */}
        <div className="absolute bottom-0 left-0 right-0 z-20">
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 1, ease: [0.22, 1, 0.36, 1], delay: 0.2 }}
            className="container mx-auto px-6 pb-24 lg:pb-32 max-w-3xl"
          >
            <div className="mb-4 text-[11px] uppercase tracking-[0.4em] text-white/60 font-mono">
              <span className="inline-block w-6 h-px bg-white/40 align-middle mr-3" />
              the gallery, indexed
            </div>

            <h1 className="font-display font-bold tracking-tight leading-[0.95] text-7xl lg:text-9xl">
              <span className="text-white">P</span>
              <span className="bg-gradient-accent bg-clip-text text-transparent animate-glow">ai</span>
              <span className="text-white">llette</span>
            </h1>

            <p className="mt-6 text-xl lg:text-2xl text-white/85 leading-relaxed max-w-xl">
              Multimodal search and management for collections — tuned to how
              curators actually look at art.
            </p>

            <div className="mt-9 flex flex-col sm:flex-row gap-3">
              <Link
                to="/collections"
                className="px-8 py-4 bg-gradient-accent rounded-full font-semibold text-lg transition-all hover:scale-[1.03] hover:shadow-2xl hover:shadow-primary-500/40"
              >
                Enter the collection
              </Link>
              <a
                href="#features"
                className="px-8 py-4 border border-white/30 backdrop-blur-md bg-white/[0.04] rounded-full font-semibold text-lg transition-all hover:bg-white/10 hover:border-white/50"
              >
                See what's inside
              </a>
            </div>
          </motion.div>
        </div>

        {/* Painting credit — bottom-right corner, museum-card style */}
        <div className="absolute bottom-6 right-6 z-20 text-right text-[11px] font-mono uppercase tracking-[0.18em] text-white/55 leading-tight">
          <p className="italic text-white/70">{HERO.title}</p>
          <p>{HERO.artist} · {HERO.year}</p>
        </div>
      </section>

      {/* Features — clean dark slab beneath */}
      <section id="features" className="relative bg-[#06080f] py-24 lg:py-32 border-t border-white/[0.06]">
        <div className="container mx-auto px-6 max-w-6xl">
          <div className="mb-16 text-center">
            <p className="text-xs uppercase tracking-[0.4em] text-primary-300/70 font-mono mb-3">
              capabilities
            </p>
            <h2 className="text-4xl lg:text-5xl font-display font-bold">
              What Paillette does
            </h2>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-5">
            <Card num="01" title="Multimodal search" body="Find work by text, image, or color. Embeddings do the matching; you do the curating." />
            <Card num="02" title="Metadata at scale" body="Bulk CSV ingest, edit in place, sync to your CMS. No more spreadsheet chains." />
            <Card num="03" title="Embedding atlas" body="See your collection as a 2D / 3D field. Cluster, browse, surface the unlooked-at." />
            <Card num="04" title="Frame removal" body="Strip frames from archival photographs. One pass, reversible, batch-friendly." />
            <Card num="05" title="Four languages" body="English, Chinese, Tamil, Malay — wall labels in the languages of your visitors." link="/translate" />
            <Card num="06" title="Public API" body="REST endpoints with API-key auth. Plug Paillette into your studio, OPAC, or kiosk." />
          </div>
        </div>
      </section>

      <footer className="bg-[#06080f] border-t border-white/[0.06] py-10 text-center">
        <p className="text-white/40 text-sm font-mono tracking-wide">
          © {new Date().getFullYear()} · paillette · making collections shine
        </p>
      </footer>
    </div>
  );
}

function Card({
  num,
  title,
  body,
  link,
}: {
  num: string;
  title: string;
  body: string;
  link?: string;
}) {
  const inner = (
    <div className="h-full bg-white/[0.03] border border-white/10 rounded-2xl p-8 transition-all hover:bg-white/[0.05] hover:border-white/20">
      <div className="flex items-baseline gap-3 mb-4">
        <span className="text-xs font-mono text-primary-300/80 tracking-widest">{num}</span>
        <span className="h-px flex-1 bg-white/10" />
      </div>
      <h3 className="text-xl font-display font-semibold mb-3 text-white">{title}</h3>
      <p className="text-white/65 leading-relaxed text-[15px]">{body}</p>
      {link && <div className="mt-5 text-sm text-primary-300">Open →</div>}
    </div>
  );
  return link ? <Link to={link}>{inner}</Link> : <div>{inner}</div>;
}
