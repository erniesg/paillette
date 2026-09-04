/**
 * The agent's sentence, and the swatches it was written from.
 *
 * It renders in two places and must be one component: above a set of results
 * that is not a dealt board, and — once a deal is on the table — inside the
 * board's own box, where whatever frames the twelve cards frames the sentence
 * too. Measured at 1440×900 the note in normal flow sat 210px above the top of
 * the frame at the only scroll position that held all twelve cards, so the
 * thesis of the submission ("the human points, the agent narrates, the board
 * is the transcript") was true and unphotographable at the same time.
 *
 * Set in the serif with one rule down the side, in the ink of whoever wrote
 * it. Who wrote it is provenance, and provenance is ink rather than a caption.
 */

import { NoteSwatches } from './note-swatches';

export function BoardNote({
  note,
  provenance,
  className,
}: {
  note: string;
  /** Whose hand put this board on the table. Selects the ink, says nothing. */
  provenance: 'agent' | 'human';
  className?: string;
}) {
  return (
    // `data-board-note` is a measurement hook, not styling: the one frame the
    // submission is made of was checked by measuring the toolbar and never the
    // sentence, and it shipped with the sentence cut in half. Now the geometry
    // harness can find it by name.
    <div className={className} data-board-note>
      <p className="paillette-wall-label" data-provenance={provenance}>
        {note}
      </p>
      {/* The swatches the note was written from, so a claim about colour can
          be checked without leaving the sentence. */}
      <NoteSwatches />
    </div>
  );
}
