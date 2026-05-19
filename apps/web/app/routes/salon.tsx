import type { MetaFunction } from '@remix-run/cloudflare';
import { motion } from 'framer-motion';
import { Link } from '@remix-run/react';
import { PAINTINGS } from '~/lib/paintings';

export const meta: MetaFunction = () => [{ title: 'Paillette · Salon hang' }];

// Salon hang composition — perimeter tiles, clear center band for the hero.
// Mixed aspect ratios + ±2° rotation read as a real Petersburg-style wall.
type Tile = {
  top: string;
  left: string;
  width: string;
  rotate: number;
  z: number;
  painting: keyof typeof PAINTINGS;
  hideOnMobile?: boolean;
};

const TILES: Tile[] = [
  // top band
  { top: '11%', left: '3%', width: '11%', rotate: -2.2, z: 2, painting: 'pearl' },
  { top: '9%', left: '17%', width: '13%', rotate: 1.4, z: 1, painting: 'wave', hideOnMobile: true },
  { top: '14%', left: '32%', width: '11%', rotate: -1.0, z: 2, painting: 'kiss' },
  { top: '10%', left: '46%', width: '12%', rotate: 1.8, z: 1, painting: 'starry', hideOnMobile: true },
  { top: '12%', left: '61%', width: '10%', rotate: -1.4, z: 2, painting: 'mona' },
  { top: '9%', left: '74%', width: '13%', rotate: 1.2, z: 1, painting: 'sunrise', hideOnMobile: true },
  { top: '13%', left: '89%', width: '10%', rotate: -2.0, z: 2, painting: 'scream' },

  // bottom band
  { top: '72%', left: '4%', width: '13%', rotate: 1.6, z: 1, painting: 'venus', hideOnMobile: true },
  { top: '74%', left: '20%', width: '11%', rotate: -1.2, z: 2, painting: 'sunflowers' },
  { top: '72%', left: '34%', width: '14%', rotate: 1.8, z: 1, painting: 'olympia', hideOnMobile: true },
  { top: '75%', left: '50%', width: '10%', rotate: -1.6, z: 2, painting: 'kiss' },
  { top: '73%', left: '62%', width: '13%', rotate: 1.2, z: 1, painting: 'starry', hideOnMobile: true },
  { top: '74%', left: '77%', width: '11%', rotate: -2.0, z: 2, painting: 'pearl' },
  { top: '72%', left: '90%', width: '10%', rotate: 1.4, z: 1, painting: 'mona', hideOnMobile: true },
];

export default function Salon() {
  return (
    <div className="min-h-screen bg-[#e8ddc6] text-[#1a120a] selection:bg-primary-200/60">
      <style>{`
        @keyframes salon-drift {
          0%, 100% { transform: var(--rot) translateY(0); }
          50% { transform: var(--rot) translateY(-3px); }
        }
      `}</style>

      <Header />

      {/* Hero — Petersburg hang on a linen wall */}
      <section className="relative min-h-[110vh] lg:min-h-[100vh] overflow-hidden">
        {/* Wall texture */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background:
              'radial-gradient(ellipse at 50% 30%, rgba(255,255,255,0.35) 0%, rgba(255,255,255,0) 65%), repeating-linear-gradient(180deg, rgba(120,80,40,0.025) 0 1px, transparent 1px 4px)',
          }}
        />

        {/* Tiles */}
        <div className="absolute inset-0">
          {TILES.map((t, i) => (
            <SalonTile key={i} tile={t} index={i} />
          ))}
        </div>

        {/* Center hero — sits clear of the tiles */}
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
            className="relative text-center max-w-2xl px-6 pointer-events-auto"
          >
            <div className="mb-5 text-[11px] uppercase tracking-[0.4em] text-[#6a4a2a] font-mono">
              <span className="inline-block w-6 h-px bg-[#6a4a2a]/60 align-middle mr-3" />
              the gallery, indexed
              <span className="inline-block w-6 h-px bg-[#6a4a2a]/60 align-middle ml-3" />
            </div>

            <h1 className="font-display font-bold tracking-tight leading-none text-6xl lg:text-8xl">
              <span className="text-[#1a120a]">P</span>
              <span className="bg-gradient-accent bg-clip-text text-transparent">ai</span>
              <span className="text-[#1a120a]">llette</span>
            </h1>

            <p className="mt-6 text-lg lg:text-xl text-[#3a2818] leading-relaxed max-w-lg mx-auto">
              Search, translate, and manage a collection the way curators actually
              look at it — by image, by color, by feeling.
            </p>

            <div className="mt-8 flex flex-col sm:flex-row gap-3 justify-center items-center">
              <Link
                to="/collections"
                className="px-7 py-3.5 bg-[#1a120a] text-[#f4ecd8] rounded-full font-semibold transition-all hover:bg-[#3a2818] hover:scale-[1.02]"
              >
                Enter the collection
              </Link>
              <a
                href="#features"
                className="px-7 py-3.5 border border-[#1a120a]/30 text-[#1a120a] rounded-full font-semibold transition-all hover:bg-[#1a120a]/5 hover:border-[#1a120a]/60"
              >
                See what's inside
              </a>
            </div>
          </motion.div>
        </div>
      </section>

      {/* Features — museum wall plaques */}
      <section id="features" className="relative bg-[#1a120a] text-[#f0e4ca] py-24 lg:py-32">
        <div className="container mx-auto px-6 max-w-6xl">
          <div className="mb-16 text-center">
            <p className="text-xs uppercase tracking-[0.4em] text-[#c9a76a] font-mono mb-3">
              the room behind the wall
            </p>
            <h2 className="text-4xl lg:text-5xl font-display font-bold">
              What Paillette does
            </h2>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            <Plaque num="01" title="Multimodal search" body="Find work by text, image, or color. Embeddings do the matching; you do the curating." />
            <Plaque num="02" title="Metadata at scale" body="Bulk CSV ingest, edit in place, sync to your CMS. No more spreadsheet chains." />
            <Plaque num="03" title="Embedding atlas" body="See your collection as a 2D / 3D field. Cluster, browse, surface the unlooked-at." />
            <Plaque num="04" title="Frame removal" body="Strip frames from archival photographs. One pass, reversible, batch-friendly." />
            <Plaque num="05" title="Four languages" body="English, Chinese, Tamil, Malay — wall labels in the languages of your visitors." link="/translate" />
            <Plaque num="06" title="Public API" body="REST endpoints with API-key auth. Plug Paillette into your studio, OPAC, or kiosk." />
          </div>
        </div>
      </section>

      <Footer />
    </div>
  );
}

function SalonTile({ tile, index }: { tile: Tile; index: number }) {
  const painting = PAINTINGS[tile.painting];
  return (
    <div
      className={`absolute group ${tile.hideOnMobile ? 'hidden lg:block' : ''}`}
      style={{ top: tile.top, left: tile.left, width: tile.width, zIndex: tile.z }}
    >
      <div
        style={{
          aspectRatio: painting.ratio,
          ['--rot' as string]: `rotate(${tile.rotate}deg)`,
          transform: `rotate(${tile.rotate}deg)`,
          animation: `salon-drift ${8 + (index % 3)}s ease-in-out ${index * 0.3}s infinite`,
        }}
        className="relative"
      >
        {/* Painting */}
        <img
          src={painting.src}
          alt={`${painting.title} — ${painting.artist}`}
          loading="lazy"
          className="absolute inset-0 w-full h-full object-cover"
          style={{
            boxShadow: [
              '0 18px 36px -12px rgba(40, 22, 8, 0.45)',
              '0 6px 12px -4px rgba(40, 22, 8, 0.35)',
              'inset 0 0 0 1px rgba(20, 10, 4, 0.4)',
            ].join(', '),
          }}
        />
        {/* Caption on hover */}
        <div className="absolute -bottom-9 left-0 right-0 text-center opacity-0 group-hover:opacity-100 transition-opacity duration-300">
          <p className="text-[10px] uppercase tracking-[0.18em] text-[#3a2818] font-mono leading-tight">
            <span className="italic">{painting.title}</span>
            <br />
            {painting.artist} · {painting.year} · {painting.size}
          </p>
        </div>
      </div>
    </div>
  );
}

function Plaque({
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
    <div className="h-full bg-[#241810] border border-[#3a2818] rounded-lg p-8 transition-colors hover:bg-[#2c1d12] hover:border-[#5a3a20]">
      <div className="flex items-baseline gap-3 mb-4">
        <span className="text-xs font-mono text-[#c9a76a] tracking-widest">{num}</span>
        <span className="h-px flex-1 bg-[#3a2818]" />
      </div>
      <h3 className="text-xl font-display font-semibold mb-3 text-[#f4e8cc]">{title}</h3>
      <p className="text-[#c4a888] leading-relaxed text-[15px]">{body}</p>
      {link && <div className="mt-5 text-sm text-[#c9a76a] hover:text-[#e0c489]">Open →</div>}
    </div>
  );
  return link ? <Link to={link}>{inner}</Link> : <div>{inner}</div>;
}

function Header() {
  return (
    <header className="relative z-50 border-b border-[#1a120a]/10 bg-[#e8ddc6]/80 backdrop-blur-sm">
      <div className="container mx-auto px-6 py-4 flex items-center justify-between">
        <div className="text-2xl font-display font-bold tracking-tight">
          <span className="text-[#1a120a]">P</span>
          <span className="bg-gradient-accent bg-clip-text text-transparent">ai</span>
          <span className="text-[#1a120a]">llette</span>
        </div>
        <nav className="flex items-center gap-5 text-sm">
          <Link to="/collections" className="text-[#3a2818] hover:text-[#1a120a]">Collections</Link>
          <Link to="/translate" className="text-[#3a2818] hover:text-[#1a120a]">Translate</Link>
          <Link to="/design" className="text-[#6a4a2a] hover:text-[#1a120a] text-xs font-mono">↩ variants</Link>
        </nav>
      </div>
    </header>
  );
}

function Footer() {
  return (
    <footer className="bg-[#1a120a] border-t border-[#3a2818] py-10 text-center">
      <p className="text-[#9a8068] text-sm font-mono tracking-wide">
        © {new Date().getFullYear()} · paillette · making collections shine
      </p>
    </footer>
  );
}
