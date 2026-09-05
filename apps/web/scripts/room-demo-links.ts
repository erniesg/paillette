/**
 * Demo exhibitions as real links, for the screenshots and the measurements.
 *
 * `/exhibition?e=…` carries the whole show in the URL, so a six-work and a
 * thirty-work exhibition can be minted without writing anything to a database
 * and without a fixture route that only exists to be photographed. The pages
 * these produce are the *same* pages a visitor gets — the same loader, the
 * same catalogue fetches, the same renderer — which is the point: a shot of a
 * demo harness proves the harness works.
 *
 * Run with `pnpm --filter web exec tsx scripts/room-demo-links.ts`.
 */

import { encodeExhibitionLink } from '../app/lib/exhibition-link';

const BROWSE = process.env.PAILLETTE_ORIGIN ?? 'http://localhost:5199';

/** Labels in the register the app writes them in: one sentence, no preamble. */
const LABELS = [
  'The valley empties of light before anyone has decided to go.',
  'A stopping place, which is not the same as an arrival.',
  'The route drawn as though the drawing were the journey.',
  'Two people sitting for a picture that will outlast the room.',
  'A benefit performance: everyone present, nobody staying.',
  'Mine.',
  'The harbour works whether or not anybody is watching it.',
  'Weather standing in for a decision nobody wants to name.',
  'A shore with the tide out and the boats on their sides.',
  'The last light on the water, and nothing on the water.',
];

interface BrowseResult {
  id: string;
  title: string;
}

const browse = async (limit: number): Promise<BrowseResult[]> => {
  const response = await fetch(`${BROWSE}/api/public-search/nga/browse?limit=${limit}`);
  const body = (await response.json()) as {
    data?: { results?: BrowseResult[] };
  };
  return body.data?.results ?? [];
};

const link = async (
  title: string,
  statement: string,
  works: BrowseResult[]
): Promise<string> => {
  const encoded = await encodeExhibitionLink({
    collectionId: 'nga',
    title,
    titleByAgent: true,
    statement,
    statementByAgent: false,
    works: works.map((work, index) => ({
      artworkId: work.id,
      label: LABELS[index % LABELS.length] ?? null,
      // Alternating, so the two provenance inks are both visible in a shot.
      labelByAgent: index % 3 !== 0,
    })),
  });
  return `/exhibition?e=${encoded}`;
};

const main = async () => {
  const pool = await browse(40);
  if (pool.length < 30) {
    throw new Error(`only ${pool.length} works available; need 30`);
  }

  const six = await link(
    'Everything the Light Left Behind',
    'It is not about weather. It is about leaving. Six works in which the horizon does the work the figures will not — a valley emptying of light, a stopping place that was never a destination, a room arranged for someone who has already gone.',
    pool.slice(0, 6)
  );
  const thirty = await link(
    'A Long Way Round',
    'Thirty works arranged as a walk rather than a list. The sequence is the argument: what you meet first changes what the next thing means, and the last wall is the one you carry out.',
    pool.slice(0, 30)
  );
  const one = await link(
    'One Thing',
    'A single work, and a room built to be exactly large enough for it.',
    pool.slice(0, 1)
  );

  console.log(JSON.stringify({ one, six, thirty }, null, 2));
};

void main();
