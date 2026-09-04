/**
 * The head of the show: its title, and what it is about.
 *
 * This is the object the two parties argue over. The agent drafts it, the
 * human corrects it — *"it's not about weather, it's about leaving"* — and the
 * agent re-selects and re-labels around the correction, keeping their words.
 * So both fields are typed state on the page, not a message in a transcript.
 *
 * It appears once someone has begun to curate: a confirmed pick, or a draft the
 * agent has already written. A plain search does not carry a title block.
 */

import { useSyncExternalStore } from 'react';
import {
  acceptProposal,
  declineProposal,
  hasExhibition,
  resolveHang,
  writeExhibition,
} from '~/lib/webmcp/exhibition';
import { getExemplars } from '~/lib/webmcp/flags';
import {
  getWebMcpServerState,
  getWebMcpState,
  subscribeWebMcpState,
  type ExhibitionState,
} from '~/lib/webmcp/store';
import { commitHumanTurn } from '~/lib/webmcp/turn';
import { EditableText } from './editable-text';

export const useExhibition = (): ExhibitionState =>
  useSyncExternalStore(
    subscribeWebMcpState,
    () => getWebMcpState().exhibition,
    () => getWebMcpServerState().exhibition
  );

export const ExhibitionHead = ({ trailing }: { trailing?: React.ReactNode }) => {
  const exhibition = useExhibition();
  // Subscribing to flags as well: a first pick is what turns a search into a
  // show, and it is the moment this block earns its space.
  const flagged = useSyncExternalStore(
    subscribeWebMcpState,
    () => getWebMcpState().flags.length,
    () => 0
  );

  const started = hasExhibition(exhibition) || getExemplars().positive.length > 0;
  if (!started) return null;
  void flagged;

  const count = resolveHang(exhibition).length;

  return (
    <section
      className="paillette-exhibition-head mx-auto mt-8 max-w-3xl"
      aria-label="Exhibition"
    >
      <EditableText
        label="Exhibition title"
        value={exhibition.title.current?.value ?? ''}
        by={exhibition.title.current?.by ?? null}
        proposed={exhibition.title.proposed?.value ?? null}
        onCommit={(value) => writeExhibition({ title: value }, { by: 'human' })}
        onAccept={() => acceptProposal('title')}
        onDecline={() => declineProposal('title')}
        placeholder="Untitled"
        textClassName="paillette-exhibition-title"
      />

      <EditableText
        label="Exhibition statement"
        value={exhibition.statement.current?.value ?? ''}
        by={exhibition.statement.current?.by ?? null}
        proposed={exhibition.statement.proposed?.value ?? null}
        /*
         * The one gesture on this page that is an instruction.
         *
         * §5c step 4: they cross out the draft, write "it's not about weather,
         * it's about leaving", and the wall has to move. This used to write the
         * field and stop — the correction sat in the edit journal until the
         * human happened to type something unrelated at the agent, so the most
         * consequential thing they can do had no automatic consequence at all.
         * Committing it *is* the turn now.
         *
         * Only the statement. A title is a few words and a label is about one
         * work; neither is a brief, and neither should cost a model call every
         * time somebody fixes a typo. Those still ride the next turn.
         */
        onCommit={(value) => {
          writeExhibition({ statement: value }, { by: 'human' });
          void commitHumanTurn();
        }}
        onAccept={() => acceptProposal('statement')}
        onDecline={() => declineProposal('statement')}
        placeholder="What it’s about."
        multiline
        className="mt-3"
        textClassName="paillette-exhibition-statement"
      />

      {/* Catalogue data, in the mono face: a count and whatever control the
          page hangs here. Never a sentence. */}
      <div className="paillette-exhibition-rail mt-4 flex items-center gap-4">
        <span className="lt-catalogue">
          {count} {count === 1 ? 'work' : 'works'}
        </span>
        {trailing}
      </div>
    </section>
  );
};
