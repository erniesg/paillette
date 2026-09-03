/**
 * Provenance ink.
 *
 * Two hands work this board. Graphite is the human, one coloured ink is the
 * agent, and a dashed line means the agent has proposed something the human has
 * not confirmed. That is the whole vocabulary, and it is deliberately small
 * enough that a viewer stops needing a legend after about a second.
 *
 * The colours themselves are CSS custom properties (`--ink-human`,
 * `--ink-agent`) defined in `tailwind.css` for both themes. Nothing here should
 * hard-code a hex value; this module only decides *which* ink applies and
 * hands the answer back as DOM attributes.
 */

export type ProvenanceHand = 'human' | 'agent';

/** What was decided about a work. Matches the `flag_artworks` vocabulary. */
export type BoardFlag = 'pick' | 'reject';

export interface BoardMark {
  flag: BoardFlag;
  /** Who made the mark. Decides the ink. */
  hand: ProvenanceHand;
  /**
   * The agent's marks are provisional until the human confirms them, and are
   * drawn dashed while they are. A human's own mark is never provisional —
   * they made it, so there is nobody left to confirm it.
   */
  provisional?: boolean;
  /** The agent always gives a reason; the human never has to. */
  reason?: string;
}

/**
 * The attribute contract the rest of the app styles against.
 *
 * These attributes are the seam between the lane that owns flag *logic* and the
 * lane that owns flag *appearance*: set them on a tile and the ink follows,
 * with no shared component and no shared import.
 */
export interface ProvenanceAttributes {
  'data-flag'?: BoardFlag;
  'data-hand'?: ProvenanceHand;
  'data-provisional'?: '';
  'data-agent-active'?: '';
}

export function provenanceAttributes(
  mark: BoardMark | undefined,
  options: { agentActive?: boolean } = {}
): ProvenanceAttributes {
  const attributes: ProvenanceAttributes = {};

  if (mark) {
    attributes['data-flag'] = mark.flag;
    attributes['data-hand'] = mark.hand;
    // Only the agent can hold a provisional mark, so a human mark flagged as
    // provisional is treated as confirmed rather than drawn as a proposal.
    if (mark.provisional && mark.hand === 'agent') {
      attributes['data-provisional'] = '';
    }
  }

  if (options.agentActive) {
    attributes['data-agent-active'] = '';
  }

  return attributes;
}

/** The glyph shown in the corner badge. Lightroom's own vocabulary. */
export function markGlyph(mark: BoardMark): string {
  return mark.flag === 'pick' ? 'P' : 'X';
}

/**
 * A one-line description of a mark for screen readers, because the ink and the
 * dashes carry meaning that is purely visual otherwise.
 */
export function markLabel(mark: BoardMark): string {
  const verb = mark.flag === 'pick' ? 'Picked' : 'Rejected';
  const hand = mark.hand === 'agent' ? 'the agent' : 'you';
  const status =
    mark.provisional && mark.hand === 'agent' ? ', not yet confirmed' : '';
  const reason = mark.reason ? ` — ${mark.reason}` : '';

  return `${verb} by ${hand}${status}${reason}`;
}
