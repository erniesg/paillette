/**
 * What the board says when nobody wrote it a sentence.
 *
 * §7.1 calls the deal *"the single most important visual in the submission"*
 * and its whole content is that the picks do not move. They moved. The note
 * wrapper carries `empty:hidden`, the deterministic redeal passed no note, and
 * so pressing Enter on an empty bar — the beat the thesis is built on — deleted
 * the agent's wall label and slid all twelve cards up 56px into the gap, picks
 * included. Reported unfixed in two consecutive iterations, and reproduced 3/3
 * with `noteAfterRedeal = null` every time.
 *
 * Reserving the row would have hidden the arithmetic. This is the better answer
 * to the same defect: the deal writes its own line. No model call is anywhere
 * near this path — it is composed from the flags and the palettes already
 * printed on the cards — which turns the worst beat in the build into the
 * clearest possible proof of the claim underneath it. **The board still speaks
 * with the model switched off.**
 *
 * Museum discipline, per §5b: one line, no preamble, and no narrating the
 * mechanism. It names what was thrown out or kept, because that is the thing
 * the human just did and the thing the swatches beside it can be checked
 * against. It never says "relevance feedback", "redealing", or "I".
 */

import { getNearestPaletteColourDistance } from '~/lib/local-colour-refinement';
import { recallArtwork } from './artwork-index';
import { toAgentArtworkSummary, toAgentVisualFacts } from './artwork-summary';
import { NAMED_COLOURS } from './colours';

/**
 * Past this the nearest swatch is not a description of the picture any more,
 * and a wall label that names a colour nobody can see in the work is worse
 * than one that names none. CIEDE2000; roughly "a person would call it that".
 */
const MAX_COLOUR_DISTANCE = 26;

/** Two names read as an observation. Three read as a list. */
const MAX_COLOURS = 2;

/** A title long enough to be a sentence is not a name any more. */
const MAX_TITLE_CHARS = 40;

/**
 * Numerals are catalogue data and this is a wall label. Spelled out to twelve,
 * which is the board, and past that there is nothing left to spell.
 */
const spell = (count: number) =>
  [
    'No',
    'One',
    'Two',
    'Three',
    'Four',
    'Five',
    'Six',
    'Seven',
    'Eight',
    'Nine',
    'Ten',
    'Eleven',
    'Twelve',
  ][count] ?? String(count);

/**
 * The named swatch closest to a work's *dominant* colour, or null when none is
 * close enough to be a description rather than a guess.
 *
 * The weightiest entry only, not the nearest match anywhere in the palette:
 * almost every painting has some near-black in it somewhere, so scanning the
 * whole strip calls half the collection charcoal. `collectDominantColors`
 * already sorts weightiest first, which is the colour a person would name.
 */
const nameColour = (palette: readonly string[]): string | null => {
  const dominant = palette[0];
  if (!dominant) return null;

  let best: { name: string; distance: number } | null = null;
  for (const colour of NAMED_COLOURS) {
    const distance = getNearestPaletteColourDistance([colour.hex], [dominant]);
    if (!best || distance < best.distance) {
      best = { name: colour.name.toLowerCase(), distance };
    }
  }
  return best && best.distance <= MAX_COLOUR_DISTANCE ? best.name : null;
};

/**
 * What a handful of works looked like, in at most two words.
 *
 * Colour first, because it is the property the note sits beside evidence for:
 * the swatch strips under the sentence are drawn from these same palettes, so
 * a reader can check the claim without leaving it. Titles are the fallback,
 * and a bare count is the fallback to that.
 */
const describe = (ids: readonly string[]): string | null => {
  const summaries = ids
    .map((id) => recallArtwork(id))
    .filter((artwork): artwork is NonNullable<typeof artwork> =>
      Boolean(artwork)
    )
    .map((artwork) => toAgentArtworkSummary(artwork));
  if (!summaries.length) return null;

  const names: string[] = [];
  for (const summary of summaries) {
    const { palette } = toAgentVisualFacts(summary);
    const name = nameColour(palette);
    if (name && !names.includes(name)) names.push(name);
    if (names.length === MAX_COLOURS) break;
  }
  if (names.length) return names.join(' and ');

  // No usable palettes — an engraving, a drawing, a record with no extracted
  // colour. Name the works instead; the human recognises them, which is more
  // than a colour they cannot see would give them.
  const titles = summaries
    .map((summary) => summary.title?.trim())
    .filter((title): title is string => Boolean(title))
    .filter((title) => title.length <= MAX_TITLE_CHARS)
    .slice(0, MAX_COLOURS);
  return titles.length ? titles.map((title) => `“${title}”`).join(' and ') : null;
};

export interface DealNoteInput {
  /** The human's confirmed flags. Provisional marks steer nothing and say nothing. */
  exemplars: { positive: readonly string[]; negative: readonly string[] };
  /** Ids dealt in this round. */
  added: readonly string[];
}

/**
 * One line for a board nobody named, or null when there is nothing to name.
 *
 * Shapes, in the order they are reached:
 *
 *   Three picks hold — bone and steel.
 *   Two rejects out — rust and gold.
 *   One pick holds.
 *   Twelve works — umber and gold.
 *
 * The last one is the case with nothing flagged, which still deals: the works
 * left alone are the direction, so the line names the board that arrived rather
 * than a judgement nobody made. It matters because it is the state a board is
 * in *before* the first flag — without it the sentence arrives on the first
 * pick and the cards move then instead.
 *
 * **One sentence, and it never says what just happened.** The first version of
 * this wrote two — "One pick holds — bone. Eleven works dealt to sit with it."
 * — and the second half is §5b's "never narrate the mechanism" exactly: eleven
 * new cards had just arrived on screen, so the sentence was telling the human
 * something the board had already shown them, in the register of software
 * explaining itself. What is left is what a wall label carries: what is being
 * held or thrown out, and what it looks like. The swatches underneath are the
 * evidence for the second half and the marks on the cards are the evidence for
 * the first, so nothing here needs a legend.
 */
export const composeDealNote = ({
  exemplars,
  added,
}: DealNoteInput): string | null => {
  const picks = exemplars.positive.length;
  const rejects = exemplars.negative.length;

  if (picks) {
    const held = `${spell(picks)} ${picks === 1 ? 'pick holds' : 'picks hold'}`;
    const look = describe(exemplars.positive);
    return look ? `${held} — ${look}.` : `${held}.`;
  }

  if (rejects) {
    const out = `${spell(rejects)} ${rejects === 1 ? 'reject' : 'rejects'} out`;
    const look = describe(exemplars.negative);
    return look ? `${out} — ${look}.` : `${out}.`;
  }

  // Nothing marked by anyone. The board is all there is to name, so the count
  // is a description of it rather than a report on the deal — and it is the
  // only fact available when no palette resolves.
  if (!added.length) return null;
  const board = `${spell(added.length)} ${added.length === 1 ? 'work' : 'works'}`;
  const look = describe(added);
  return look ? `${board} — ${look}.` : `${board}.`;
};
