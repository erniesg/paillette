/**
 * The measured copy that goes on a room label.
 *
 * Canvas has no layout engine, so this keeps wrapping and the texture's actual
 * height in one deterministic place. The scene supplies `measure` from its
 * canvas context; tests use a simple character measure.
 */

export const PLATE_WIDTH_PX = 512;
export const PLATE_PADDING_PX = 24;
export const MAX_PLATE_DESCRIPTION_CHARS = 320;

export type PlateColorRole = 'title' | 'metadata' | 'description';

export interface PlateLine {
  text: string;
  x: number;
  y: number;
  font: string;
  colorRole: PlateColorRole;
}

export interface PlateLayout {
  widthPx: number;
  heightPx: number;
  lines: PlateLine[];
}

export interface PlateCopy {
  title: string;
  artist: string | null;
  date: string | null;
  medium?: string | null;
  label: string | null;
}

export type MeasurePlateText = (text: string, font: string) => number;

const TITLE_FONT = '600 28px "EB Garamond", Georgia, serif';
const METADATA_FONT = '600 15px "IBM Plex Mono", ui-monospace, monospace';
const DESCRIPTION_FONT = '19px "EB Garamond", Georgia, serif';

const normalize = (value: string) => value.trim().replace(/\s+/g, ' ');

/** Wrap words first, then split a single overlong word only when necessary. */
export const wrapPlateText = (
  text: string,
  maxWidth: number,
  font: string,
  measure: MeasurePlateText
): string[] => {
  const words = normalize(text).split(' ').filter(Boolean);
  const lines: string[] = [];
  let line = '';

  const pushWord = (word: string) => {
    if (measure(word, font) <= maxWidth) {
      line = word;
      return;
    }

    let piece = '';
    for (const character of word) {
      const next = piece + character;
      if (piece && measure(next, font) > maxWidth) {
        lines.push(piece);
        piece = character;
      } else {
        piece = next;
      }
    }
    line = piece;
  };

  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (!line || measure(next, font) <= maxWidth) {
      line = next;
      continue;
    }
    lines.push(line);
    pushWord(word);
  }
  if (line) lines.push(line);
  return lines;
};

/**
 * Builds a plate with only the rows that have copy. `label` is bounded to the
 * editor's readable 320-character allowance; titles and catalogue metadata
 * are always kept in full and wrap rather than being sliced.
 */
export const layoutPlate = (
  copy: PlateCopy,
  measure: MeasurePlateText
): PlateLayout => {
  const lines: PlateLine[] = [];
  const contentWidth = PLATE_WIDTH_PX - PLATE_PADDING_PX * 2;
  let top = PLATE_PADDING_PX;

  const add = (
    text: string,
    font: string,
    colorRole: PlateColorRole,
    lineHeight: number,
    gapAfter: number
  ) => {
    const wrapped = wrapPlateText(text, contentWidth, font, measure);
    for (const line of wrapped) {
      lines.push({ text: line, x: PLATE_PADDING_PX, y: top + lineHeight - 5, font, colorRole });
      top += lineHeight;
    }
    if (wrapped.length) top += gapAfter;
  };

  add(copy.title, TITLE_FONT, 'title', 35, 7);

  const metadata = [copy.artist, copy.date, copy.medium]
    .filter((part): part is string => Boolean(part?.trim()))
    .map(normalize)
    .join(' · ');
  if (metadata) add(metadata, METADATA_FONT, 'metadata', 22, 9);

  const description = copy.label ? normalize(copy.label).slice(0, MAX_PLATE_DESCRIPTION_CHARS) : '';
  if (description) add(description, DESCRIPTION_FONT, 'description', 26, 0);

  return {
    widthPx: PLATE_WIDTH_PX,
    heightPx: Math.ceil(top + PLATE_PADDING_PX),
    lines,
  };
};
