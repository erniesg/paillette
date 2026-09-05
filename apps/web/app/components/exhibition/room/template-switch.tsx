/**
 * How this show is being looked at.
 *
 * Two words in the catalogue mono, on the line that already carries the work
 * count. Not an icon — nobody reads a bare glyph for "walkable three
 * dimensional room", and a control whose meaning needs a tooltip is a control
 * that has failed. Not a toggle switch either: these are two addresses for one
 * exhibition, so they are two links, and the browser's own back button does
 * the right thing without anybody writing history handling.
 *
 * **ROOM is absent until the device has proved it can draw one.** The check
 * runs after mount, so the server sends only PAGE and a machine with no WebGL
 * never sees the other word at all. That is the whole of "degrade honestly, no
 * dead control and no apology on screen": there is nothing to apologise for
 * because there was never anything offered.
 */

import { Link, useLocation } from '@remix-run/react';
import { useEffect, useState } from 'react';
import { canRenderRoom } from '~/lib/room/capability';
import {
  EXHIBITION_TEMPLATES,
  templateHref,
  type ExhibitionTemplate,
} from '~/lib/room/template';

/**
 * False on the server and for one frame after hydration, then the truth.
 *
 * Deliberately not read in a `useState` initialiser: that disagrees with the
 * server's render for anyone whose device *can* draw a room, and React throws
 * the markup away and warns.
 */
export const useRoomAvailable = (): boolean => {
  const [available, setAvailable] = useState(false);
  useEffect(() => setAvailable(canRenderRoom()), []);
  return available;
};

const WORD: Record<ExhibitionTemplate, string> = {
  page: 'Page',
  room: 'Room',
};

export const TemplateSwitch = ({
  template,
  available,
}: {
  template: ExhibitionTemplate;
  available: boolean;
}) => {
  const location = useLocation();
  const here = `${location.pathname}${location.search}`;

  const offered = EXHIBITION_TEMPLATES.filter(
    (candidate) => candidate === 'page' || available || candidate === template
  );
  if (offered.length < 2) return null;

  return (
    <p className="exhibition-template lt-catalogue">
      {offered.map((candidate) => (
        <Link
          key={candidate}
          to={templateHref(here, candidate)}
          data-current={candidate === template ? 'true' : undefined}
          aria-current={candidate === template ? 'page' : undefined}
          preventScrollReset
        >
          {WORD[candidate]}
        </Link>
      ))}
    </p>
  );
};
