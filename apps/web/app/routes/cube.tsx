import type { MetaFunction } from '@remix-run/cloudflare';
import { motion } from 'framer-motion';
import { Link } from '@remix-run/react';
import { PAINTINGS } from '~/lib/paintings';

export const meta: MetaFunction = () => [{ title: 'Paillette · White cube' }];

// White-cube minimalism: one painting, generous negative space, editorial type.
const PLATE = PAINTINGS.pearl;

export default function Cube() {
  return (
    <div className="min-h-screen bg-[#f5efe2] text-[#0d0a08]">
      <header className="border-b border-[#0d0a08]/8">
        <div className="container mx-auto px-6 py-5 flex items-center justify-between">
          <div className="text-2xl font-display font-bold tracking-tight">
            <span className="text-[#0d0a08]">P</span>
            <span className="bg-gradient-accent bg-clip-text text-transparent">ai</span>
            <span className="text-[#0d0a08]">llette</span>
          </div>
          <nav className="flex items-center gap-5 text-sm">
            <Link to="/collections" className="text-[#3a2818] hover:text-[#0d0a08]">Collections</Link>
            <Link to="/translate" className="text-[#3a2818] hover:text-[#0d0a08]">Translate</Link>
            <Link to="/design" className="text-[#6a4a2a] hover:text-[#0d0a08] text-xs font-mono">↩ variants</Link>
          </nav>
        </div>
      </header>

      {/* Hero */}
      <section className="relative pt-20 lg:pt-32 pb-24 lg:pb-32">
        <div className="container mx-auto px-6 max-w-4xl">
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
            className="text-center"
          >
            {/* Eyebrow */}
            <p className="text-[11px] uppercase tracking-[0.4em] text-[#6a4a2a] font-mono mb-12 lg:mb-16">
              <span className="inline-block w-6 h-px bg-[#6a4a2a]/60 align-middle mr-3" />
              the gallery, indexed
              <span className="inline-block w-6 h-px bg-[#6a4a2a]/60 align-middle ml-3" />
            </p>

            {/* The plate — single painting, museum-card framing */}
            <div className="flex flex-col items-center mb-12 lg:mb-16">
              <div
                className="relative inline-block"
                style={{ aspectRatio: PLATE.ratio, width: '14rem' }}
              >
                <img
                  src={PLATE.src}
                  alt={`${PLATE.title} — ${PLATE.artist}`}
                  className="absolute inset-0 w-full h-full object-cover"
                  style={{
                    boxShadow:
                      '0 24px 48px -16px rgba(20, 12, 4, 0.18), 0 6px 12px -4px rgba(20, 12, 4, 0.12), inset 0 0 0 1px rgba(20, 12, 4, 0.25)',
                  }}
                />
              </div>
              <div className="mt-5 text-[11px] uppercase tracking-[0.18em] text-[#6a4a2a] font-mono leading-tight">
                <p className="italic text-[#3a2818]">{PLATE.title}</p>
                <p className="mt-1">{PLATE.artist} · {PLATE.year} · {PLATE.size}</p>
              </div>
            </div>

            {/* Wordmark */}
            <h1 className="font-display font-bold tracking-tight leading-none text-7xl lg:text-[10rem]">
              <span className="text-[#0d0a08]">P</span>
              <span className="bg-gradient-accent bg-clip-text text-transparent">ai</span>
              <span className="text-[#0d0a08]">llette</span>
            </h1>

            <p className="mt-8 lg:mt-10 text-lg lg:text-2xl text-[#3a2818] leading-relaxed max-w-2xl mx-auto font-display italic">
              Search, translate, and manage a collection — tuned to how curators,
              registrars, and the public actually look at art.
            </p>

            <div className="mt-12 flex flex-col sm:flex-row gap-3 justify-center items-center">
              <Link
                to="/collections"
                className="px-8 py-4 bg-[#0d0a08] text-[#f5efe2] rounded-full font-semibold transition-all hover:scale-[1.02] hover:bg-[#1a120a]"
              >
                Enter the collection
              </Link>
              <a
                href="#features"
                className="px-8 py-4 border border-[#0d0a08]/25 text-[#0d0a08] rounded-full font-semibold transition-all hover:bg-[#0d0a08]/5 hover:border-[#0d0a08]/50"
              >
                See what's inside
              </a>
            </div>
          </motion.div>
        </div>
      </section>

      {/* Features — light, list-like, with hairlines */}
      <section id="features" className="relative border-t border-[#0d0a08]/10 py-24 lg:py-32">
        <div className="container mx-auto px-6 max-w-5xl">
          <div className="mb-16 lg:mb-20">
            <p className="text-[11px] uppercase tracking-[0.4em] text-[#6a4a2a] font-mono mb-3">
              capabilities
            </p>
            <h2 className="text-4xl lg:text-5xl font-display font-bold">
              What Paillette does
            </h2>
          </div>

          <div className="divide-y divide-[#0d0a08]/12">
            <Row num="01" title="Multimodal search" body="Find work by text, image, or color. Embeddings do the matching; you do the curating." />
            <Row num="02" title="Metadata at scale" body="Bulk CSV ingest, edit in place, sync to your CMS. No more spreadsheet chains." />
            <Row num="03" title="Embedding atlas" body="See your collection as a 2D / 3D field. Cluster, browse, surface the unlooked-at." />
            <Row num="04" title="Frame removal" body="Strip frames from archival photographs. One pass, reversible, batch-friendly." />
            <Row num="05" title="Four languages" body="English, Chinese, Tamil, Malay — wall labels in the languages of your visitors." link="/translate" />
            <Row num="06" title="Public API" body="REST endpoints with API-key auth. Plug Paillette into your studio, OPAC, or kiosk." />
          </div>
        </div>
      </section>

      <footer className="border-t border-[#0d0a08]/10 py-10 text-center">
        <p className="text-[#6a4a2a] text-sm font-mono tracking-wide">
          © {new Date().getFullYear()} · paillette · making collections shine
        </p>
      </footer>
    </div>
  );
}

function Row({
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
    <div className="py-8 lg:py-10 grid lg:grid-cols-[80px_280px_1fr_auto] gap-6 items-baseline group">
      <span className="text-xs font-mono text-[#6a4a2a] tracking-widest">{num}</span>
      <h3 className="text-2xl lg:text-3xl font-display font-semibold text-[#0d0a08]">{title}</h3>
      <p className="text-[#3a2818] leading-relaxed text-[15px] max-w-xl">{body}</p>
      {link && (
        <span className="text-sm font-mono text-[#6a4a2a] group-hover:text-[#0d0a08] transition-colors">
          Open →
        </span>
      )}
    </div>
  );
  return link ? <Link to={link}>{inner}</Link> : <div>{inner}</div>;
}
