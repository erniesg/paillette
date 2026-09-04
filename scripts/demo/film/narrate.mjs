/**
 * Speak the voiceover, one cue at a time.
 *
 * Per-cue files rather than one long take, so a beat can be re-timed — or
 * re-spoken — without re-rendering the film. The cue ids are the filenames and
 * the edit refers to them by id, so nothing depends on the order they were
 * generated in.
 *
 * The words are `docs/webmcp-vo-script-v2.md` §1, verbatim. Where a cue
 * carries a number, the number is the one this machine measured tonight and
 * not the one the script inherited — see `cues.json` in the output directory,
 * which records exactly what was spoken.
 *
 * Reads OPENAI_API_KEY from the environment. It is never printed and never
 * written to any file this script produces.
 *
 *   node scripts/demo/film/narrate.mjs [out-dir]
 */

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..', '..');
const OUT = process.argv[2] ?? path.join(REPO, 'docs', 'night', 'video', 'narration');

const KEY = process.env.OPENAI_API_KEY;
if (!KEY) {
  process.stderr.write('OPENAI_API_KEY is not set\n');
  process.exit(1);
}

/**
 * A gallery voice, not an ad read.
 *
 * This is an art collection and the film is 40% silence by design; the
 * narration has to sit under the pictures rather than sell over them. `sage`
 * is the least performed of the voices available and takes direction on pace.
 */
const VOICE = 'sage';
const MODEL = 'gpt-4o-mini-tts';
const DIRECTION =
  'Calm, low and warm. A curator talking quietly beside the work, not a ' +
  'narrator selling a product. Even, conversational pace — do not drag, and ' +
  'do not leave long gaps inside a line; the silence between lines belongs to ' +
  'the film, not to the read. No brightness, no upsell, no rising enthusiasm ' +
  'at the end of a line.';

const CUES = [
  // Beat 1 — cold open
  ['1a', "Most art is never seen. Not because it's hidden — because nobody knows what to ask for."],
  ['1b', 'So I stop asking. I point.'],
  ['1c', 'I never typed any of those words. It read what I threw away.'],

  // Beat 2 — Enter on an empty bar
  ['2a', 'Now the bar is empty. Nothing typed. Nothing said.'],
  ['2b', 'Same picks. Same slots. And not one call to a model.'],
  ['2c', 'One request, to a vector index, thirteen milliseconds after the key.'],
  ['2d', "The agent isn't the mechanism. It's a second operator of one that works without it."],

  // Beat 3 — say one thing, do another
  ['3a', "Three warm pictures kept. Now I'll ask it for the opposite."],
  ['3b', 'It followed my hands, not my mouth. And it said so.'],

  // Beat 4 — scale
  ['4a', 'Sixty-three thousand works. Open access, from the National Gallery of Art.'],
  ['4b', 'Three keys move through all of them.'],

  // Beat 5 — the show leaves the tab
  ['5a', "What's left is a show, and the statement is mine."],
  ['5b', 'The labels are written against it. The same picture reads differently under a different sentence.'],
  ['5c', 'Then it leaves. A real URL, no account, and a line saying how many of the labels an agent wrote.'],

  // Beat 6 — without looking
  ['6a', 'None of this needed a mouse.'],
  ['6b', 'The control says the work, and it says the key.'],
  ['6c', "Someone who can't see the pictures is still the one choosing. Not the one being told."],

  // Beat 7 — WebMCP, on screen
  ['7a', "How it's built is on the page. Five dots until a tool runs."],
  ['7b', 'Twenty-five tools on document dot model context — with their arguments, their answers and their timings.'],
  ['7c', 'Flag artworks is P and X. Redeal is Enter. Compare artworks is C.'],
  ['7d', 'One workspace. Two operators.'],

  // Beat 8 — co-curator
  ['8a', "So the agent becomes a co-curator. I didn't search for a single one of these. I described a room."],
];

await mkdir(OUT, { recursive: true });

const spoken = [];
for (const [id, text] of CUES) {
  const res = await fetch('https://api.openai.com/v1/audio/speech', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${KEY}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
      voice: VOICE,
      input: text,
      instructions: DIRECTION,
      response_format: 'wav',
    }),
  });
  if (!res.ok) {
    process.stderr.write(`cue ${id} failed: ${res.status} ${await res.text()}\n`);
    process.exit(1);
  }
  const file = path.join(OUT, `${id}.wav`);
  await writeFile(file, Buffer.from(await res.arrayBuffer()));
  spoken.push({ id, text, file: path.basename(file) });
  process.stdout.write(`${id}  ${text.slice(0, 62)}\n`);
}

await writeFile(
  path.join(OUT, 'cues.json'),
  `${JSON.stringify({ voice: VOICE, model: MODEL, direction: DIRECTION, cues: spoken }, null, 2)}\n`
);
process.stdout.write(`\n${spoken.length} cues -> ${OUT}\n`);
