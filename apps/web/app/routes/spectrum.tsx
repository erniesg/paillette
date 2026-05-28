import type { MetaFunction } from '@remix-run/cloudflare';
import { motion } from 'framer-motion';
import { Link } from '@remix-run/react';
import { PAINTINGS } from '~/lib/paintings';

export const meta: MetaFunction = () => [{ title: 'Paillette · Spectrum' }];

// SPECTRUM — 12 vertical color bars fill the viewport. Each bar is the dominant
// color extracted from a painting. Hovering a bar widens it and reveals the
// painting it came from. Color IS the navigation. No traditional hero — the
// wall of color is the brand.

type Bar = {
  color: string;
  label: string;
  painting?: keyof typeof PAINTINGS;
};

const BARS: Bar[] = [
  { color: '#1e3a5f', label: 'lapis · ultramarine', painting: 'pearl' },
  { color: '#1a3a78', label: 'starry blue', painting: 'starry' },
  { color: '#2a6a8a', label: 'wave teal', painting: 'wave' },
  { color: '#5a8a6a', label: 'verdaccio', painting: 'venus' },
  { color: '#2a5a3a', label: 'forest umber' },
  { color: '#c89f3a', label: 'klimt gold', painting: 'kiss' },
  { color: '#e8b830', label: 'chrome yellow', painting: 'sunflowers' },
  { color: '#c87850', label: 'sunrise rose', painting: 'sunrise' },
  { color: '#c8542e', label: 'burnt orange', painting: 'scream' },
  { color: '#6a4030', label: 'sepia umber', painting: 'mona' },
  { color: '#d4c0a8', label: 'olympia bone', painting: 'olympia' },
  { color: '#8a2a6a', label: 'magenta stain' },
];

export default function Spectrum() {
  return (
    <div className="min-h-screen bg-black text-white overflow-hidden relative">
      {/* Vertical color bars filling the whole viewport */}
      <div className="absolute inset-0 flex">
        {BARS.map((bar, i) => (
          <SpectrumBar key={i} bar={bar} />
        ))}
      </div>

      {/* Floating hero overlay */}
      <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none px-6">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
          className="text-center max-w-xl"
          style={{
            textShadow:
              '0 8px 32px rgba(0,0,0,0.85), 0 2px 8px rgba(0,0,0,0.7)',
          }}
        >
          <p className="text-[10px] uppercase tracking-[0.4em] text-white font-mono mb-6">
            search by color · 47,000 works · 12 dominant tones
          </p>
          <h1 className="text-7xl lg:text-9xl font-display font-bold tracking-tight leading-none">
            <span className="text-white">P</span>
            <span className="bg-gradient-accent bg-clip-text text-transparent animate-glow">
              ai
            </span>
            <span className="text-white">llette</span>
          </h1>
          <p className="mt-6 text-lg text-white max-w-md mx-auto leading-relaxed">
            Hover a color. The works it came from appear in its place.
          </p>
          <div className="mt-9 flex flex-col sm:flex-row gap-3 justify-center pointer-events-auto">
            <Link
              to="/collections"
              className="px-8 py-3.5 bg-gradient-accent rounded-full font-semibold text-white hover:scale-[1.03] transition-transform shadow-2xl shadow-fuchsia-500/30"
            >
              Enter the collection
            </Link>
            <Link
              to="/design"
              className="px-8 py-3.5 border border-white/40 rounded-full font-semibold text-white backdrop-blur-md bg-black/30 hover:bg-black/50 transition-colors"
            >
              ↩ design index
            </Link>
          </div>
        </motion.div>
      </div>

      {/* Top-left wordmark, small */}
      <div className="absolute top-6 left-6 z-30">
        <Link
          to="/"
          className="font-display font-bold text-lg"
          style={{ textShadow: '0 2px 8px rgba(0,0,0,0.7)' }}
        >
          <span className="text-white">P</span>
          <span className="bg-gradient-accent bg-clip-text text-transparent">
            ai
          </span>
          <span className="text-white">llette</span>
        </Link>
      </div>

      {/* Bottom legend */}
      <div className="absolute bottom-4 inset-x-0 z-30 flex items-center justify-between px-6 text-[10px] font-mono uppercase tracking-[0.3em] text-white pointer-events-none">
        <span style={{ textShadow: '0 2px 4px rgba(0,0,0,0.8)' }}>
          12 bars · 12 paintings · 1 algorithm
        </span>
        <span style={{ textShadow: '0 2px 4px rgba(0,0,0,0.8)' }}>
          hover to reveal →
        </span>
      </div>
    </div>
  );
}

function SpectrumBar({ bar }: { bar: Bar }) {
  const painting = bar.painting ? PAINTINGS[bar.painting] : null;
  return (
    <div
      className="flex-1 relative group cursor-pointer transition-[flex-grow] duration-700 ease-out hover:flex-[5]"
      style={{ background: bar.color }}
    >
      {/* Painting reveal */}
      {painting && (
        <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500 overflow-hidden">
          <img
            src={painting.src}
            alt={painting.title}
            className="w-full h-full object-cover"
          />
          <div className="absolute inset-x-0 bottom-0 p-5 bg-gradient-to-t from-black/90 via-black/50 to-transparent">
            <p className="text-[10px] font-mono uppercase tracking-[0.25em] text-white/80 mb-1">
              {bar.label}
            </p>
            <p className="text-lg font-display italic text-white">
              {painting.title}
            </p>
            <p className="text-[10px] font-mono uppercase tracking-[0.18em] text-white/70 mt-1">
              {painting.artist} · {painting.year} · {painting.size}
            </p>
          </div>
        </div>
      )}

      {/* Vertical label always on bar */}
      <div
        className="absolute bottom-6 left-1/2 -translate-x-1/2 text-[9px] font-mono uppercase tracking-[0.3em] text-white/50 group-hover:opacity-0 transition-opacity"
        style={{
          writingMode: 'vertical-rl',
          transform: 'translateX(-50%) rotate(180deg)',
        }}
      >
        {bar.label.split(' · ')[0]}
      </div>
    </div>
  );
}
