import type { MetaFunction } from '@remix-run/cloudflare';
import { motion } from 'framer-motion';
import { Link } from '@remix-run/react';
import { PAINTINGS } from '~/lib/paintings';

export const meta: MetaFunction = () => [{ title: 'Paillette · Chrome' }];

// CHROME — anti-museum, Y2K-iridescent / fashion-zine.
// Aubergine-midnight base + heavy use of the V0 purple/fuchsia gradient,
// chrome glass cards (heavy blur), oversaturated, weird-luxe.
const S = {
  bg: 'radial-gradient(ellipse at 20% 0%, #1f0a3a 0%, #0a0612 55%), radial-gradient(ellipse at 80% 100%, #2a0a44 0%, #0a0612 60%)',
  panel: 'rgba(255, 255, 255, 0.06)',
  panelBorder: 'rgba(255, 255, 255, 0.14)',
  text: '#ffffff',
  textMuted: '#c8b8e0',
  textFaint: '#8870a8',
  accent: 'linear-gradient(135deg, #a855f7 0%, #d946ef 50%, #ec4899 100%)',
  accentSoft: 'linear-gradient(135deg, rgba(168,85,247,0.5), rgba(217,70,239,0.5), rgba(236,72,153,0.5))',
  display: '"Playfair Display", Georgia, serif',
  body: 'Inter, system-ui, sans-serif',
  mono: '"JetBrains Mono", ui-monospace, monospace',
  radius: '24px',
};

const HERO = PAINTINGS.kiss; // Klimt's gold square = chrome-friendly

export default function Chrome() {
  return (
    <div style={{ background: S.bg, color: S.text, fontFamily: S.body }} className="min-h-screen overflow-x-hidden">
      <style>{`
        @keyframes chrome-shift {
          0%, 100% { background-position: 0% 50%; }
          50% { background-position: 100% 50%; }
        }
        @keyframes orb-float {
          0%, 100% { transform: translate(0, 0); }
          33% { transform: translate(20px, -30px); }
          66% { transform: translate(-15px, 25px); }
        }
      `}</style>

      {/* Iridescent ambient orbs */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div
          className="absolute top-[-20%] right-[-10%] w-[55rem] h-[55rem] rounded-full blur-3xl opacity-40"
          style={{
            background: 'radial-gradient(circle, #d946ef 0%, transparent 60%)',
            animation: 'orb-float 18s ease-in-out infinite',
          }}
        />
        <div
          className="absolute bottom-[-15%] left-[-10%] w-[50rem] h-[50rem] rounded-full blur-3xl opacity-35"
          style={{
            background: 'radial-gradient(circle, #a855f7 0%, transparent 60%)',
            animation: 'orb-float 24s ease-in-out infinite reverse',
          }}
        />
        <div
          className="absolute top-[40%] left-[35%] w-[30rem] h-[30rem] rounded-full blur-3xl opacity-25"
          style={{
            background: 'radial-gradient(circle, #ec4899 0%, transparent 60%)',
            animation: 'orb-float 30s ease-in-out infinite',
          }}
        />
      </div>

      {/* Header — chrome glass */}
      <header className="relative z-30">
        <div
          style={{ background: S.panel, borderBottom: `1px solid ${S.panelBorder}` }}
          className="backdrop-blur-2xl"
        >
          <div className="container mx-auto px-6 py-4 flex items-center justify-between">
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
            <nav className="hidden md:flex items-center gap-6 text-sm" style={{ color: S.textMuted }}>
              <Link to="/collections" className="hover:text-white">Collections</Link>
              <Link to="/translate" className="hover:text-white">Translate</Link>
              <Link to="/design" className="hover:text-white">Design</Link>
            </nav>
            <Link
              to="/auth/signin"
              style={{ background: S.accent, borderRadius: '9999px' }}
              className="px-5 py-2 text-sm font-semibold text-white"
            >
              Sign in
            </Link>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="relative z-10">
        <div className="container mx-auto px-6 pt-20 lg:pt-28 pb-24 lg:pb-32 max-w-6xl">
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
            className="text-center"
          >
            <div style={{ fontFamily: S.mono, color: S.textMuted }} className="inline-flex items-center gap-3 px-4 py-1.5 mb-8 rounded-full backdrop-blur-md" >
              <span
                style={{ background: S.panel, border: `1px solid ${S.panelBorder}`, color: S.textMuted }}
                className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-[10px] uppercase tracking-[0.3em]"
              >
                <span style={{ background: S.accent }} className="w-1.5 h-1.5 rounded-full" />
                AI for collections · NEW
              </span>
            </div>

            <h1
              style={{ fontFamily: S.display, letterSpacing: '-0.04em' }}
              className="text-7xl lg:text-[10rem] font-bold leading-[0.9]"
            >
              <span>P</span>
              <span
                style={{
                  backgroundImage: S.accent,
                  WebkitBackgroundClip: 'text',
                  backgroundClip: 'text',
                  color: 'transparent',
                }}
                className="animate-glow"
              >
                ai
              </span>
              <span>llette</span>
            </h1>

            <p style={{ color: S.textMuted }} className="mt-8 text-xl lg:text-2xl leading-relaxed max-w-2xl mx-auto">
              The way curators, registrars, and the public actually look at art.
              Search by feeling, color, or guess.
            </p>

            <div className="mt-10 flex flex-col sm:flex-row gap-3 justify-center">
              <Link
                to="/collections"
                style={{ background: S.accent, borderRadius: '9999px' }}
                className="px-9 py-4 text-base font-semibold text-white hover:scale-[1.03] transition-transform shadow-2xl shadow-fuchsia-500/30"
              >
                Enter the collection
              </Link>
              <a
                href="#features"
                style={{
                  background: S.panel,
                  border: `1px solid ${S.panelBorder}`,
                  borderRadius: '9999px',
                }}
                className="px-9 py-4 text-base font-semibold backdrop-blur-md hover:bg-white/10 transition-colors"
              >
                See what's inside
              </a>
            </div>

            {/* Chrome-glass artwork plate */}
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 1, delay: 0.4 }}
              className="mt-20 lg:mt-24 flex justify-center"
            >
              <div
                style={{
                  background: S.panel,
                  border: `1px solid ${S.panelBorder}`,
                  borderRadius: S.radius,
                  boxShadow: '0 60px 120px -30px rgba(168,85,247,0.4), 0 0 0 1px rgba(255,255,255,0.08) inset',
                }}
                className="backdrop-blur-2xl p-3 lg:p-4 max-w-md w-full"
              >
                <div
                  style={{ aspectRatio: HERO.ratio, borderRadius: '16px' }}
                  className="overflow-hidden"
                >
                  <img src={HERO.src} alt={HERO.title} className="w-full h-full object-cover" />
                </div>
                <div className="mt-3 px-2 flex items-baseline justify-between gap-3">
                  <p style={{ fontFamily: S.display }} className="text-sm italic">{HERO.title}</p>
                  <p style={{ fontFamily: S.mono, color: S.textMuted }} className="text-[10px] uppercase tracking-[0.18em]">
                    {HERO.artist} · {HERO.year}
                  </p>
                </div>
              </div>
            </motion.div>
          </motion.div>
        </div>
      </section>

      {/* Features — chrome glass cards */}
      <section id="features" className="relative z-10">
        <div className="container mx-auto px-6 py-20 lg:py-24 max-w-6xl">
          <div className="text-center mb-14">
            <p style={{ fontFamily: S.mono, color: S.textFaint }} className="text-[11px] uppercase tracking-[0.3em] mb-3">
              capabilities
            </p>
            <h2 style={{ fontFamily: S.display }} className="text-4xl lg:text-5xl font-bold">
              Everything, framed
            </h2>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
            {[
              ['01', 'Multimodal search', 'Find by text, image, or color.'],
              ['02', 'Metadata at scale', 'Bulk CSV. Edit. Sync. No spreadsheet chains.'],
              ['03', 'Embedding atlas', '2D / 3D field. Surface the unlooked-at.'],
              ['04', 'Frame removal', 'Strip frames from archival photographs.'],
              ['05', 'Four languages', 'EN · 中文 · தமிழ் · BM.'],
              ['06', 'REST + API key', 'Plug into your studio, OPAC, or kiosk.'],
            ].map(([num, title, body]) => (
              <div
                key={num}
                style={{
                  background: S.panel,
                  border: `1px solid ${S.panelBorder}`,
                  borderRadius: S.radius,
                }}
                className="backdrop-blur-2xl p-7 hover:bg-white/10 transition-colors"
              >
                <div className="flex items-center justify-between mb-4">
                  <span style={{ fontFamily: S.mono, color: S.textMuted }} className="text-[11px] uppercase tracking-[0.2em]">
                    {num}
                  </span>
                  <span style={{ background: S.accent }} className="w-2 h-2 rounded-full" />
                </div>
                <h3 style={{ fontFamily: S.display }} className="text-xl font-bold mb-2">{title}</h3>
                <p style={{ color: S.textMuted }} className="text-sm leading-relaxed">{body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <footer
        style={{ borderTop: `1px solid ${S.panelBorder}` }}
        className="relative z-10 py-8 backdrop-blur-md"
      >
        <div className="container mx-auto px-6 flex items-center justify-between">
          <p style={{ fontFamily: S.mono, color: S.textFaint }} className="text-[11px] uppercase tracking-[0.2em]">
            © {new Date().getFullYear()} paillette
          </p>
          <Link to="/design" style={{ fontFamily: S.mono, color: S.textMuted }} className="text-[11px] uppercase tracking-[0.2em] hover:text-white">
            ↩ design index
          </Link>
        </div>
      </footer>
    </div>
  );
}
