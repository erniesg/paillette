import type { MetaFunction } from '@remix-run/cloudflare';
import { Link } from '@remix-run/react';
import { PAINTING_LIST } from '~/lib/paintings';

export const meta: MetaFunction = () => [{ title: 'paillette / index' }];

// RAW — brutalist. The aesthetic of `ls -la` and a 1995 museum database.
// White bg, all monospace, blue underlined links, real <table> with metadata.
// No images bigger than 24px. Aggressively un-designed. Bookish, useful.

export default function Raw() {
  return (
    <div
      className="min-h-screen bg-white text-black"
      style={{ fontFamily: '"JetBrains Mono", ui-monospace, monospace' }}
    >
      <div className="max-w-4xl mx-auto px-4 py-6 text-[13px] leading-relaxed">
        <h1 className="text-base">paillette / index of works</h1>
        <p className="mt-1">
          multimodal search and management for art galleries. starting with the{' '}
          <a href="https://www.nationalgallery.sg" className="text-blue-700 underline visited:text-purple-700">
            national gallery singapore
          </a>
          .
        </p>
        <p className="mt-2">
          [<Link to="/collections" className="text-blue-700 underline visited:text-purple-700">browse</Link>]{' '}
          [<Link to="/translate" className="text-blue-700 underline visited:text-purple-700">translate</Link>]{' '}
          [<Link to="/auth/signin" className="text-blue-700 underline visited:text-purple-700">sign in</Link>]{' '}
          [<Link to="/design" className="text-blue-700 underline visited:text-purple-700">design index</Link>]
        </p>

        <hr className="my-4 border-black border-t-2" />

        <form className="mb-3" onSubmit={(e) => e.preventDefault()}>
          <label>
            search:{' '}
            <input
              type="text"
              defaultValue=""
              placeholder="melancholic blue, 1800s landscape, stars…"
              className="border border-black px-1.5 py-0.5 w-[26rem] max-w-full bg-white"
              style={{ fontFamily: 'inherit' }}
            />
          </label>
          <button
            type="submit"
            className="ml-2 border border-black bg-gray-100 px-2 py-0.5 hover:bg-gray-200"
          >
            go
          </button>
          <span className="ml-3 text-gray-600 text-[12px]">
            or paste a URL · drop an image · pick a color
          </span>
        </form>

        <p className="text-[12px] text-gray-600 mb-2">
          showing {PAINTING_LIST.length} of {PAINTING_LIST.length} works · ordered by year ↑ · click a column header to sort
        </p>

        <table className="w-full border-collapse text-[12px]">
          <thead>
            <tr className="border-b-2 border-black">
              {['#', 'id', 'thumb', 'title', 'artist', 'year', 'ratio', 'size', 'actions'].map((h) => (
                <th key={h} className="text-left py-1 pr-3 font-normal text-gray-700">
                  {h} <span className="text-gray-400">↕</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {[...PAINTING_LIST]
              .sort((a, b) => Number(String(a.year).replace(/[^\d]/g, '')) - Number(String(b.year).replace(/[^\d]/g, '')))
              .map((p, i) => (
                <tr key={p.id} className="border-b border-gray-300 hover:bg-yellow-50">
                  <td className="py-1 pr-3 text-gray-600 tabular-nums">{(i + 1).toString().padStart(2, '0')}</td>
                  <td className="py-1 pr-3">{p.id}</td>
                  <td className="py-1 pr-3">
                    <img
                      src={p.src}
                      alt=""
                      className="w-6 h-6 object-cover border border-gray-400"
                      loading="lazy"
                    />
                  </td>
                  <td className="py-1 pr-3 italic">{p.title}</td>
                  <td className="py-1 pr-3">{p.artist}</td>
                  <td className="py-1 pr-3 tabular-nums">{p.year}</td>
                  <td className="py-1 pr-3 text-gray-600 tabular-nums">{p.ratio.replace(/\s/g, '')}</td>
                  <td className="py-1 pr-3 text-gray-600">{p.size}</td>
                  <td className="py-1 pr-3">
                    <a href={p.src} target="_blank" rel="noopener" className="text-blue-700 underline visited:text-purple-700">view</a>
                    <span className="text-gray-400 mx-1">·</span>
                    <a href={`#${p.id}`} className="text-blue-700 underline">similar</a>
                    <span className="text-gray-400 mx-1">·</span>
                    <a href={`#${p.id}`} className="text-blue-700 underline">cite</a>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>

        <p className="text-[11px] text-gray-600 mt-3">
          last updated: 2026-05-19 · indexed by paillette v0.1 · CLIP ViT-L/14 ·{' '}
          <a href="/api/v1/artworks" className="text-blue-700 underline">json</a> ·{' '}
          <a href="/api/v1/artworks.csv" className="text-blue-700 underline">csv</a>
        </p>

        <hr className="my-6 border-black border-t-2" />

        <h2 className="text-sm mb-1">paillette/</h2>
        <p>
          <span className="text-2xl font-bold" style={{ fontFamily: '"Playfair Display", Georgia, serif' }}>
            <span className="text-black">P</span>
            <span
              style={{
                backgroundImage: 'linear-gradient(135deg, #a855f7, #d946ef, #ec4899)',
                WebkitBackgroundClip: 'text',
                backgroundClip: 'text',
                color: 'transparent',
              }}
            >
              ai
            </span>
            <span className="text-black">llette</span>
          </span>{' '}
          is an ai-powered multimodal search and management platform for art galleries,
          starting with the national gallery singapore. search artworks by text, image,
          or color. translate metadata into english, chinese, tamil, and malay. project
          embeddings into 2D / 3D for browsing.
        </p>

        <h2 className="text-sm mt-5 mb-1">api/</h2>
        <pre className="text-[11px] bg-gray-100 border border-gray-300 p-3 overflow-x-auto leading-relaxed">
{`GET  /api/v1/artworks                  # list works
GET  /api/v1/artworks/:id              # fetch one
POST /api/v1/search                    # multimodal query (text/image/color)
GET  /api/v1/embeddings/atlas.json     # 2D/3D projection (UMAP, t-SNE, PCA)
POST /api/v1/translate                 # EN · 中文 · தமிழ் · BM
POST /api/v1/frames/remove             # strip frames from archival photos`}
        </pre>

        <h2 className="text-sm mt-5 mb-1">capabilities/</h2>
        <ul className="list-disc list-inside leading-relaxed">
          <li>multimodal search · text + image + color · CLIP embeddings</li>
          <li>metadata at scale · bulk CSV in/out · CMS sync</li>
          <li>embedding atlas · interactive 2D/3D · UMAP, t-SNE, PCA</li>
          <li>frame removal · archival photographs · reversible</li>
          <li>four languages · english · 中文 · தமிழ் · BM</li>
          <li>REST + API key auth · plug into your studio, OPAC, or kiosk</li>
        </ul>

        <h2 className="text-sm mt-5 mb-1">copyright/</h2>
        <p className="text-[12px] text-gray-700">
          works shown above are public-domain placeholders from{' '}
          <a href="https://commons.wikimedia.org" className="text-blue-700 underline">wikimedia commons</a>.
          national gallery singapore nanyang school works (liu kang, georgette chen, cheong soo pieng)
          remain under sg copyright into the 2050s–2070s; production deployment requires licensed imagery.
        </p>

        <hr className="my-6 border-black border-t-2" />

        <pre className="text-[11px] leading-tight text-gray-700">
{`© ${new Date().getFullYear()} paillette
making collections shine

contact:   hello@paillette.example
github:    /paillette/paillette
docs:      /docs

design index: /design`}
        </pre>
      </div>
    </div>
  );
}
