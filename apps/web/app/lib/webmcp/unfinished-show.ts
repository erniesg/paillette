/**
 * What the agent said it would do, and did not.
 *
 * Two things were asked for in the prompt, agreed to by the model, and then
 * measured on staging as not happening:
 *
 *  - **The opening turn writes no wall labels.** A typed instruction came back
 *    with a title, a 68-word statement and six works carrying `label: null`
 *    on every one. The one thing that proves a label is contextual is the same
 *    work reading differently under a different statement, and with no labels
 *    in the first draft there is nothing to compare against. The feature was
 *    real and invisible.
 *  - **The title does not follow a correction.** The statement was rewritten
 *    to "It is not about weather. It is about leaving", all six labels
 *    rewrote around leaving, and the show stayed named "Sea Change" — the
 *    theme the human had just rejected, still the first thing a reader sees.
 *
 * Both had prompt wording telling the model to do them. Wording is how you ask
 * for good judgement; it is not how you guarantee a post-condition. So these
 * are checks against the state the tools actually wrote, run when the model
 * thinks it has finished, and each one can put the turn back to work. The model
 * still writes the words — nothing here composes prose — it is only stopped
 * from walking away mid-job.
 *
 * **Once per gap was wrong, and it shipped the deliverable blank.** A correction
 * turn writes labels for the six works hanging, is nudged once and satisfied,
 * then drops four of them and hangs six others — and those six are never
 * labelled, because the gap had already had its go. Measured on staging: a board
 * ending with two labelled works and six carrying `labelBy: null`, and four of
 * seven published `/e/:code` pages with no wall label anywhere on them. So a
 * nudge is now identified by *what it was about* rather than by which gap it
 * was: a different set of unlabelled works is a different job, and the caller's
 * own ceiling on how many nudges a turn may issue is what stops it looping.
 */

export type ShowGap = 'labels' | 'title';

export interface ShowState {
  /** The statement on the wall, whoever wrote it. */
  statement: string | null;
  title: string | null;
  /** Who wrote the title. A title the human holds is theirs, and stays. */
  titleBy: 'agent' | 'human' | null;
  titleHeldByHuman: boolean;
  /** The works hanging, and whether each has a label. */
  hung: { artworkId: string; label: string | null }[];
  /** True when the human rewrote the statement in the turn being answered. */
  statementCorrected: boolean;
}

export interface ShowNudge {
  gap: ShowGap;
  /**
   * What this nudge is about, not merely which gap it is. The caller keys its
   * "already asked" set on this, so asking again for the *same* six works is
   * refused and asking for six different ones is not.
   */
  key: string;
  message: string;
}

/**
 * The unlabelled works, capped. `write_labels` takes up to twelve and does the
 * whole wall in one model call, so naming them all is one call either way.
 */
const unlabelled = (state: ShowState) =>
  state.hung.filter((work) => !work.label?.trim()).map((work) => work.artworkId);

export const findShowGap = (
  state: ShowState,
  already: ReadonlySet<string>
): ShowNudge | null => {
  // Nothing is owed until there is a theme to write against. `write_labels`
  // refuses without a statement, and rightly: a label with no theme is a
  // caption.
  if (!state.statement?.trim()) return null;

  const missing = unlabelled(state);
  // Keyed on the works, so a second helping of newcomers is a second job. The
  // ids are sorted because "which six" is the question, not what order the hang
  // happens to report them in.
  const labelsKey = `labels:${[...missing].sort().join(',')}`;
  if (missing.length && !already.has(labelsKey)) {
    return {
      gap: 'labels',
      key: labelsKey,
      message:
        `The statement is written and ${missing.length} of the ${state.hung.length} works on the wall have no label: ` +
        `${missing.join(', ')}. Call write_labels for them now, against that statement, before you reply. ` +
        'A show whose works carry no labels is a list, and the labels are the only place the theme touches the individual pictures. ' +
        'Works you have just hung count: a picture you added after writing the wall is exactly the one a reader will find blank.',
    };
  }

  // Only after a correction, and only onto a title the agent wrote itself. A
  // title the human typed is theirs; `set_exhibition` would park a write onto
  // it as a proposal anyway, and pestering them for one is worse than silence.
  const titleKey = `title:${state.title?.trim() ?? ''}`;
  if (
    state.statementCorrected &&
    !already.has(titleKey) &&
    !state.titleHeldByHuman &&
    state.titleBy === 'agent' &&
    state.title?.trim()
  ) {
    return {
      gap: 'title',
      key: titleKey,
      message:
        `The show is still called "${state.title.trim()}". You wrote that against the theme they have just replaced, ` +
        'and it is the first thing a reader sees on the shared page — a room whose name contradicts its own statement reads as a mistake. ' +
        'Call set_exhibition with a title that follows their statement, then reply.',
    };
  }

  return null;
};
