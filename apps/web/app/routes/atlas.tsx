import type { MetaFunction } from '@remix-run/cloudflare';
import { Link } from '@remix-run/react';
import { motion } from 'framer-motion';
import { PAINTINGS } from '~/lib/paintings';

export const meta: MetaFunction = () => [{ title: 'Paillette · Atlas' }];

// ATLAS — the hero IS what Paillette does. Floating thumbnails arranged in
// embedding-space clusters (old masters / impressionists / modernists / asian
// + expressionism). The wordmark sits at the centroid of the field. Show the
// product, not a stock landing page.

type Node = {
  painting: keyof typeof PAINTINGS;
  top: string;
  left: string;
  width: string;
  rotate: number;
};

const NODES: Node[] = [
  // Old Masters cluster — top-left
  { painting: 'mona', top: '13%', left: '8%', width: '70px', rotate: -3 },
  { painting: 'pearl', top: '24%', left: '20%', width: '78px', rotate: 2 },
  { painting: 'venus', top: '38%', left: '3%', width: '150px', rotate: -1.5 },

  // Impressionists / Post-impressionists — top-right
  { painting: 'starry', top: '14%', left: '70%', width: '170px', rotate: 1.8 },
  { painting: 'sunrise', top: '30%', left: '86%', width: '110px', rotate: -2 },
  {
    painting: 'sunflowers',
    top: '46%',
    left: '88%',
    width: '74px',
    rotate: 2.4,
  },

  // Symbolism / Modernism — bottom-left
  { painting: 'kiss', top: '64%', left: '16%', width: '95px', rotate: -2 },
  { painting: 'olympia', top: '78%', left: '4%', width: '140px', rotate: 1.6 },

  // Ukiyo-e + Expressionism — bottom-right
  { painting: 'wave', top: '64%', left: '72%', width: '170px', rotate: -1.4 },
  { painting: 'scream', top: '80%', left: '88%', width: '80px', rotate: 2.6 },
];

// Cluster lines (within-cluster + cross-cluster bridges)
const EDGES: Array<[number, number, string]> = [
  [0, 1, 'old-masters'],
  [1, 2, 'old-masters'],
  [3, 4, 'impressionists'],
  [4, 5, 'impressionists'],
  [6, 7, 'modernism'],
  [8, 9, 'expressionism'],
  // bridges
  [2, 6, 'figure-tradition'],
  [5, 8, 'modernist-eye'],
];

export default function Atlas() {
  return (
    <div className="min-h-screen bg-[#08070d] text-white overflow-hidden relative">
      <style>{`
        @keyframes atlas-drift {
          0%, 100% { transform: var(--rot) translate(0, 0); }
          33%      { transform: var(--rot) translate(3px, -6px); }
          66%      { transform: var(--rot) translate(-4px, 4px); }
        }
      `}</style>

      {/* Soft galaxy gradients */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            'radial-gradient(ellipse at 22% 18%, rgba(168,85,247,0.18) 0%, transparent 45%), radial-gradient(ellipse at 78% 82%, rgba(236,72,153,0.13) 0%, transparent 45%), radial-gradient(ellipse at 50% 50%, rgba(217,70,239,0.08) 0%, transparent 35%)',
        }}
      />

      {/* SVG cluster lines */}
      <svg
        className="absolute inset-0 w-full h-full pointer-events-none"
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
      >
        {EDGES.map(([a, b], i) => {
          const na = NODES[a]!;
          const nb = NODES[b]!;
          return (
            <line
              key={i}
              x1={parseFloat(na.left)}
              y1={parseFloat(na.top)}
              x2={parseFloat(nb.left)}
              y2={parseFloat(nb.top)}
              stroke="rgba(168, 85, 247, 0.18)"
              strokeWidth="0.08"
              strokeDasharray="0.5 0.5"
              vectorEffect="non-scaling-stroke"
            />
          );
        })}
      </svg>

      {/* Painting nodes */}
      <div className="absolute inset-0">
        {NODES.map((node, i) => (
          <AtlasNode key={i} node={node} index={i} />
        ))}
      </div>

      {/* Cluster labels — small annotations like in scatterplot UIs */}
      <ClusterLabel top="6%" left="6%" text="cluster · old masters" />
      <ClusterLabel top="7%" left="78%" text="cluster · impressionism →" />
      <ClusterLabel top="88%" left="8%" text="↳ modernism · symbolism" />
      <ClusterLabel top="58%" left="78%" text="ukiyo-e · expressionism" />

      {/* Header */}
      <header className="absolute top-0 inset-x-0 z-40">
        <div className="container mx-auto px-6 py-5 flex items-center justify-between">
          <Link
            to="/"
            className="font-display font-bold text-2xl tracking-tight"
          >
            <span className="text-white">P</span>
            <span className="bg-gradient-accent bg-clip-text text-transparent">
              ai
            </span>
            <span className="text-white">llette</span>
          </Link>
          <nav className="flex items-center gap-5 text-[11px] font-mono uppercase tracking-[0.2em] text-white/60">
            <Link to="/collections" className="hover:text-white">
              Collections
            </Link>
            <Link to="/translate" className="hover:text-white">
              Translate
            </Link>
            <Link to="/design" className="hover:text-white">
              Design
            </Link>
          </nav>
        </div>
      </header>

      {/* Hero centroid */}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 1.1, ease: [0.22, 1, 0.36, 1] }}
          className="relative"
        >
          <div className="absolute inset-0 -m-24 rounded-full bg-[#08070d] blur-3xl opacity-90" />
          <div className="relative text-center max-w-lg px-6">
            <p className="text-[10px] uppercase tracking-[0.4em] text-white/55 font-mono mb-5">
              embedding atlas · CLIP ViT-L/14 · UMAP n=2
            </p>
            <h1 className="text-6xl lg:text-8xl font-display font-bold tracking-tight leading-[0.95]">
              <span className="text-white">P</span>
              <span className="bg-gradient-accent bg-clip-text text-transparent animate-glow">
                ai
              </span>
              <span className="text-white">llette</span>
            </h1>
            <p className="mt-5 text-base lg:text-lg text-white/80 leading-relaxed">
              Browse the collection as a field of similarity. Drag the canvas.
              Click a work to enter.
            </p>
            <div className="mt-7 flex gap-2.5 justify-center pointer-events-auto">
              <Link
                to="/collections"
                className="px-6 py-3 bg-gradient-accent rounded-full font-semibold text-sm hover:scale-[1.03] transition-transform"
              >
                Enter the atlas
              </Link>
              <Link
                to="/collections"
                className="px-6 py-3 border border-white/30 rounded-full font-semibold text-sm bg-black/40 backdrop-blur-md hover:bg-black/60 transition-colors"
              >
                Search by text
              </Link>
            </div>
          </div>
        </motion.div>
      </div>

      {/* Mini-legend bottom */}
      <div className="absolute bottom-4 inset-x-0 z-30 flex items-center justify-between px-6 text-[10px] font-mono uppercase tracking-[0.2em] text-white/35 pointer-events-none">
        <span>· · · dotted line = similarity edge</span>
        <Link
          to="/design"
          className="pointer-events-auto hover:text-white transition-colors"
        >
          ↩ design index
        </Link>
      </div>
    </div>
  );
}

function AtlasNode({ node, index }: { node: Node; index: number }) {
  const p = PAINTINGS[node.painting];
  return (
    <Link
      to="/collections"
      className="absolute group block"
      style={{ top: node.top, left: node.left, width: node.width, zIndex: 10 }}
    >
      <div
        className="relative transition-transform group-hover:scale-110 group-hover:z-20"
        style={{
          aspectRatio: p.ratio,
          ['--rot' as string]: `rotate(${node.rotate}deg)`,
          transform: `rotate(${node.rotate}deg)`,
          animation: `atlas-drift ${12 + (index % 5) * 2}s ease-in-out ${index * 0.4}s infinite`,
        }}
      >
        <img
          src={p.src}
          alt={p.title}
          className="absolute inset-0 w-full h-full object-cover"
          style={{
            boxShadow:
              '0 18px 36px -10px rgba(0,0,0,0.85), 0 4px 10px -2px rgba(0,0,0,0.6), inset 0 0 0 1px rgba(255,255,255,0.1)',
          }}
        />
      </div>
      {/* Hover caption */}
      <div className="absolute top-full mt-2 left-1/2 -translate-x-1/2 opacity-0 group-hover:opacity-100 transition-opacity bg-black/85 backdrop-blur-md px-2.5 py-1.5 rounded-sm text-[10px] whitespace-nowrap font-mono uppercase tracking-[0.15em] pointer-events-none">
        <span className="italic text-white normal-case tracking-normal">
          {p.title}
        </span>
        <br />
        <span className="text-white/70">
          {p.artist} · {p.year}
        </span>
      </div>
    </Link>
  );
}

function ClusterLabel({
  top,
  left,
  text,
}: {
  top: string;
  left: string;
  text: string;
}) {
  return (
    <div
      className="absolute pointer-events-none z-20 text-[10px] font-mono uppercase tracking-[0.25em] text-white/35"
      style={{ top, left }}
    >
      {text}
    </div>
  );
}
