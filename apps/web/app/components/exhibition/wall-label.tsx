/**
 * The wall label under one work.
 *
 * A label belongs beside its picture and nowhere else, so it renders on the
 * card rather than in a panel. It is present only when someone has written
 * one: an empty label under every work would be twelve blank rectangles
 * asking to be filled in, which is a form, not a hang.
 *
 * The human edits it in place. The agent's unaccepted rewording sits under it,
 * dashed, one click from being taken.
 */

import { useSyncExternalStore } from 'react';
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
  if (!field.current && !field.proposed) return null;

  const suffix = title ? ` for ${title}` : '';

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
    </div>
  );
};
