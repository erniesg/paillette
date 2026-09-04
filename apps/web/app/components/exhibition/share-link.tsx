/**
 * The link, and nothing else.
 *
 * One control, in the catalogue mono, in the rail under the statement. It
 * copies a URL that carries the whole show — so the board stops dying with the
 * tab, which is the one promise in the pitch the build was not keeping.
 *
 * The word changes to say it worked and changes back. That is the entire
 * feedback design: a toast would be a second surface for a fact that fits in
 * the button that caused it.
 */

import { useEffect, useRef, useState } from 'react';
import {
  encodeExhibitionLink,
  exhibitionLinkPath,
  type ExhibitionLinkPayload,
} from '~/lib/exhibition-link';
import { listHungWorks, resolveHang } from '~/lib/webmcp/exhibition';
import { getWebMcpState } from '~/lib/webmcp/store';
import { useExhibition } from './exhibition-head';

const buildPayload = (collectionId: string): ExhibitionLinkPayload => {
  const state = getWebMcpState().exhibition;
  return {
    collectionId,
    title: state.title.current?.value ?? null,
    titleByAgent: state.title.current?.by === 'agent',
    statement: state.statement.current?.value ?? null,
    statementByAgent: state.statement.current?.by === 'agent',
    works: listHungWorks(state).map((work) => ({
      artworkId: work.artworkId,
      label: work.label,
      labelByAgent: work.labelBy === 'agent',
    })),
  };
};

export const ShareExhibitionLink = ({
  collectionId = 'nga',
}: {
  collectionId?: string;
}) => {
  const exhibition = useExhibition();
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    []
  );

  // A show with no works is not shareable, and a link to nothing is worse than
  // no link.
  if (resolveHang(exhibition).length === 0) return null;

  const copy = async () => {
    try {
      const encoded = await encodeExhibitionLink(buildPayload(collectionId));
      const url = `${window.location.origin}${exhibitionLinkPath(encoded)}`;
      // Feature-detected: the async clipboard needs a secure context, and a
      // dead button is worse than one that says it could not.
      if (!navigator.clipboard?.writeText) throw new Error('no clipboard');
      await navigator.clipboard.writeText(url);
      setState('copied');
    } catch {
      setState('failed');
    }
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setState('idle'), 2400);
  };

  return (
    <button
      type="button"
      onClick={copy}
      data-share-state={state}
      className="paillette-share-link lt-catalogue"
    >
      {state === 'copied' ? 'Copied' : state === 'failed' ? 'Copy failed' : 'Copy link'}
    </button>
  );
};
