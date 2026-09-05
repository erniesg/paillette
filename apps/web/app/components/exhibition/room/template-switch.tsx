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
 * Three answers, not two, and the third one matters.
 *
 * The server cannot know whether a device can draw a room, so before the check
 * has run the answer is `unknown` rather than `no`. Collapsing that to `no`
 * meant a `?v=room` link rendered the whole flat hang first — and the browser
 * started fetching six 1400 px wall images that were about to be replaced by a
 * room. Measured on a six-work show: eighteen requests to the image server for
 * pictures nobody would see.
 *
 * Deliberately not read in a `useState` initialiser either: that disagrees
 * with the server's render for anyone whose device *can* draw a room, and
 * React throws the markup away and warns.
 */
export type RoomAvailability = 'unknown' | 'yes' | 'no';

export const useRoomAvailable = (): RoomAvailability => {
  const [available, setAvailable] = useState<RoomAvailability>('unknown');
  useEffect(() => setAvailable(canRenderRoom() ? 'yes' : 'no'), []);
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
  available: RoomAvailability;
}) => {
  const location = useLocation();
  const here = `${location.pathname}${location.search}`;

  const offered = EXHIBITION_TEMPLATES.filter(
    (candidate) =>
      candidate === 'page' || available === 'yes' || candidate === template
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
