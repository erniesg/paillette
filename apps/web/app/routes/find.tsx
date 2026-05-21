import type { MetaFunction } from '@remix-run/cloudflare';
import { Link } from '@remix-run/react';
import { motion } from 'framer-motion';
import { useState } from 'react';
import { PAINTING_LIST } from '~/lib/paintings';

export const meta: MetaFunction = () => [{ title: 'Paillette · Search' }];

// FIND — the landing IS the product. Giant search box. Example query chips.
// Results stream below. No marketing copy. No features section. Perplexity
// for art.

const CHIPS = [
  { label: 'melancholic blue', dot: '#1e3a5f' },
  { label: 'sunset glow', dot: '#c87850' },
  { label: '1800s portrait', dot: '#6a4030' },
  { label: 'sea or wave', dot: '#2a6a8a' },
  { label: 'gold + ornament', dot: '#c89f3a' },
  { label: 'unease', dot: '#c8542e' },
  { label: 'verdaccio green', dot: '#5a8a6a' },
  { label: 'chrome yellow', dot: '#e8b830' },
];

export default function Find() {
  const [query, setQuery] = useState('');

  return (
    <div className="min-h-screen bg-[#08070d] text-white">
      {/* Minimal header — no marketing real estate */}
      <header className="border-b border-white/[0.06]">
        <div className="container mx-auto px-6 py-4 flex items-center justify-between">
          <Link to="/" className="font-display font-bold text-xl tracking-tight">
            <span className="text-white">P</span>
            <span className="bg-gradient-accent bg-clip-text text-transparent">ai</span>
            <span className="text-white">llette</span>
          </Link>
          <nav className="flex items-center gap-5 text-[11px] font-mono uppercase tracking-[0.2em] text-white/55">
            <Link to="/collections" className="hover:text-white">Collections</Link>
            <Link to="/translate" className="hover:text-white">Translate</Link>
            <Link to="/design" className="hover:text-white">Design</Link>
            <Link to="/auth/signin" className="hover:text-white">Sign in</Link>
          </nav>
        </div>
      </header>

      {/* Search hero — the page IS the search */}
      <section className="relative">
        <div className="container mx-auto px-6 pt-16 lg:pt-24 pb-10 max-w-3xl">
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
          >
            <p className="text-[10px] uppercase tracking-[0.4em] text-white/45 font-mono mb-7 text-center">
              <span className="bg-gradient-accent bg-clip-text text-transparent font-semibold">paillette</span>
              {' '}· 47,000 works · 4 languages · multimodal
            </p>

            {/* The input */}
            <div className="relative">
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                autoFocus
                placeholder="search by feeling, color, era, subject — or paste an image URL"
                className="w-full bg-transparent border-b-2 border-white/25 focus:border-fuchsia-400 outline-none text-xl lg:text-3xl py-5 font-display italic transition-colors placeholder:text-white/30 placeholder:not-italic"
              />
              <div className="absolute right-0 top-1/2 -translate-y-1/2 flex items-center gap-2">
                <button
                  type="button"
                  className="text-[10px] uppercase tracking-[0.18em] text-white/50 hover:text-white font-mono px-2.5 py-1.5 border border-white/15 rounded hover:bg-white/5 transition-colors"
                  title="Search by image"
                >
                  img ↗
                </button>
                <button
                  type="button"
                  className="text-[10px] uppercase tracking-[0.18em] text-white/50 hover:text-white font-mono px-2.5 py-1.5 border border-white/15 rounded hover:bg-white/5 transition-colors"
                  title="Search by color"
                >
                  color ◐
                </button>
              </div>
            </div>

            {/* Example chips */}
            <div className="mt-6 flex flex-wrap gap-2 justify-center">
              {CHIPS.map((chip) => (
                <button
                  key={chip.label}
                  type="button"
                  onClick={() => setQuery(chip.label)}
                  className="group inline-flex items-center gap-2 text-[12px] px-3 py-1.5 rounded-full bg-white/[0.04] border border-white/10 hover:bg-white/[0.08] hover:border-white/25 transition-colors text-white/75 hover:text-white"
                >
                  <span
                    className="inline-block w-2 h-2 rounded-full"
                    style={{ background: chip.dot }}
                  />
                  {chip.label}
                </button>
              ))}
            </div>

            {/* Live result count */}
            <p className="mt-5 text-center text-[11px] font-mono uppercase tracking-[0.25em] text-white/40">
              {query ? (
                <>
                  <span className="bg-gradient-accent bg-clip-text text-transparent font-semibold">
                    {PAINTING_LIST.length}
                  </span>{' '}
                  results for <span className="italic normal-case tracking-normal text-white/75">"{query}"</span>
                </>
              ) : (
                <>{PAINTING_LIST.length} works · featured this week</>
              )}
            </p>
          </motion.div>
        </div>

        {/* Result grid — always populated. Animates in as if streaming. */}
        <div className="container mx-auto px-6 pb-24 max-w-6xl">
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
            {PAINTING_LIST.map((p, i) => (
              <motion.div
                key={p.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.45, delay: 0.1 + i * 0.05 }}
                className="group"
              >
                <Link to="/collections" className="block">
                  <div
                    className="relative overflow-hidden rounded-md"
                    style={{ aspectRatio: p.ratio }}
                  >
                    <img
                      src={p.src}
                      alt={p.title}
                      loading="lazy"
                      className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                    />
                    <div className="absolute inset-x-0 bottom-0 p-2.5 bg-gradient-to-t from-black/90 via-black/50 to-transparent opacity-0 group-hover:opacity-100 transition-opacity">
                      <p className="text-[11px] italic text-white leading-tight">{p.title}</p>
                      <p className="text-[9px] uppercase tracking-[0.15em] font-mono text-white/65 mt-0.5">
                        {p.artist} · {p.year}
                      </p>
                    </div>
                  </div>
                </Link>
              </motion.div>
            ))}
          </div>

          <p className="mt-10 text-center text-[11px] font-mono uppercase tracking-[0.25em] text-white/35">
            scroll for more · sort by similarity · refine with{' '}
            <kbd className="px-1.5 py-0.5 border border-white/15 rounded text-white/55">/</kbd>
          </p>
        </div>
      </section>

      <footer className="border-t border-white/[0.06] py-6">
        <div className="container mx-auto px-6 flex items-center justify-between text-[10px] font-mono uppercase tracking-[0.2em] text-white/35">
          <span>© {new Date().getFullYear()} paillette</span>
          <Link to="/design" className="hover:text-white">↩ design index</Link>
        </div>
      </footer>
    </div>
  );
}
