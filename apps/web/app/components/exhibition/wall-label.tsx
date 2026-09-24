/**
 * The wall label under one work.
 *
 * A label belongs beside its picture and nowhere else, so it renders on the
 * card rather than in a panel. An empty work offers a small Add wall label
 * control so writing the first label is as discoverable as editing one.
 *
 * The human edits it in place. The agent's unaccepted rewording sits under it,
 * dashed, one click from being taken.
 */

import { useState, useSyncExternalStore } from 'react';
import { requestAgentTurn } from '~/lib/webmcp/agent-request';
import {
  acceptProposal,
  declineProposal,
  writeExhibition,
} from '~/lib/webmcp/exhibition';
import {
  getWebMcpServerState,
  getWebMcpState,
  subscribeWebMcpState,
  type ExhibitionField,
} from '~/lib/webmcp/store';
import type { HumanTurnPayload } from '~/lib/webmcp/turn';
import { EditableText } from './editable-text';

const EMPTY: ExhibitionField = { current: null, proposed: null };

export const useWallLabel = (artworkId: string): ExhibitionField =>
  useSyncExternalStore(
    subscribeWebMcpState,
    () => getWebMcpState().exhibition.labels[artworkId] ?? EMPTY,
    () => getWebMcpServerState().exhibition.labels[artworkId] ?? EMPTY
  );

export const WallLabel = ({
  artworkId,
  title,
}: {
  artworkId: string;
  /** Named for the screen reader, so "Wall label" is never ambiguous. */
  title?: string;
}) => {
  const field = useWallLabel(artworkId);
  const [adding, setAdding] = useState(false);
  const [agentStatus, setAgentStatus] = useState<string | null>(null);

  const suffix = title ? ` for ${title}` : '';
  const hasLabel = Boolean(field.current || field.proposed);

  const suggestLabel = () => {
    const namedWork = title ? `“${title}”` : `artwork ${artworkId}`;
    const gestures: HumanTurnPayload = {
      flagsDelta: [],
      selection: [{ id: artworkId, ...(title ? { title } : {}) }],
      hovered: null,
      compareChoice: null,
      exhibitionEdits: [],
    };
    const dispatched = requestAgentTurn({
      instruction:
        `Write a wall label for ${namedWork} (ID: ${artworkId}). ` +
        `Call write_labels with artworkIds: [${JSON.stringify(artworkId)}] only.`,
      gestures,
    });
    setAgentStatus(
      dispatched
        ? 'The agent is preparing a label suggestion.'
        : 'Open Agent mode, then choose Suggest label to ask for a draft.'
    );
  };

  if (!hasLabel && !adding) {
    return (
      <div className="paillette-wall-label-slot px-3 pb-3 pt-1">
        <div className="flex items-center gap-3">
          <button
            type="button"
            className="paillette-wall-label-add p-0 text-left text-xs underline-offset-2 hover:underline"
            onClick={() => setAdding(true)}
          >
            Add wall label
          </button>
          <button
            type="button"
            className="paillette-wall-label-suggest p-0 text-left text-xs underline-offset-2 hover:underline"
            onClick={suggestLabel}
          >
            Suggest label
          </button>
        </div>
        {agentStatus && (
          <p className="mt-1 text-xs" role="status">
            {agentStatus}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="paillette-wall-label-slot px-3 pb-3 pt-1">
      <EditableText
        label={`Wall label${suffix}`}
        value={field.current?.value ?? ''}
        by={field.current?.by ?? null}
        proposed={field.proposed?.value ?? null}
        onCommit={(value) =>
          writeExhibition({ works: [{ artworkId, label: value }] }, { by: 'human' })
        }
        onAccept={() => acceptProposal({ artworkId })}
        onDecline={() => declineProposal({ artworkId })}
        multiline
        textClassName="paillette-label-text"
      />
      <div className="mt-2 flex items-center gap-3">
        <button
          type="button"
          className="paillette-wall-label-suggest p-0 text-left text-xs underline-offset-2 hover:underline"
          onClick={suggestLabel}
        >
          Suggest label
        </button>
        {agentStatus && (
          <p className="text-xs" role="status">
            {agentStatus}
          </p>
        )}
      </div>
    </div>
  );
};
