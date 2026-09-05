/**
 * The rule this file exists for: **no dead control.**
 *
 * A device that cannot draw a room must never be shown the word ROOM, and
 * "never" includes the case where the URL asked for the room and the device
 * said no. That case shipped to staging once — the switch also offered
 * whichever template the URL named, so a browser with WebGL disabled got a
 * ROOM link sitting on a flat page it could not leave. Every assertion below
 * was checked against the broken version first.
 */

import { forwardRef, type AnchorHTMLAttributes, type ReactNode } from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ExhibitionTemplate } from '~/lib/room/template';
import { TemplateSwitch, type RoomAvailability } from '../template-switch';

let here = { pathname: '/e/abc', search: '' };

vi.mock('@remix-run/react', () => ({
  useLocation: () => here,
  Link: forwardRef<
    HTMLAnchorElement,
    { children: ReactNode; to: string; preventScrollReset?: boolean } & Omit<
      AnchorHTMLAttributes<HTMLAnchorElement>,
      'href'
    >
  >(({ children, to, preventScrollReset: _ignored, ...props }, ref) => (
    <a ref={ref} href={to} {...props}>
      {children}
    </a>
  )),
}));

const at = (
  location: { pathname: string; search: string },
  props: { template: ExhibitionTemplate; available: RoomAvailability }
) => {
  here = location;
  return render(<TemplateSwitch {...props} />);
};

const SHORT_LINK = { pathname: '/e/abc', search: '' };
const ROOM_LINK = { pathname: '/e/abc', search: '?v=room' };

describe('TemplateSwitch', () => {
  it('offers the room once the device has proved it can draw one', () => {
    at(SHORT_LINK, { template: 'page', available: 'yes' });
    expect(screen.getByRole('link', { name: 'Room' })).toHaveAttribute(
      'href',
      '/e/abc?v=room'
    );
    expect(screen.getByRole('link', { name: 'Page' })).toHaveAttribute(
      'href',
      '/e/abc'
    );
  });

  it('shows nothing at all before the check has answered', () => {
    const { container } = at(SHORT_LINK, {
      template: 'page',
      available: 'unknown',
    });
    expect(container.querySelector('.exhibition-template')).toBeNull();
  });

  it('shows nothing at all on a device that cannot draw a room', () => {
    const { container } = at(SHORT_LINK, { template: 'page', available: 'no' });
    expect(container.querySelector('.exhibition-template')).toBeNull();
  });

  /** The staging bug, as an assertion. */
  it('does not offer the room to a device that said no, even from a room URL', () => {
    at(ROOM_LINK, { template: 'room', available: 'no' });
    expect(screen.queryByRole('link', { name: 'Room' })).toBeNull();
  });

  it('keeps the show when the show is in the query string', () => {
    at(
      { pathname: '/exhibition', search: '?e=payload' },
      { template: 'page', available: 'yes' }
    );
    expect(screen.getByRole('link', { name: 'Room' })).toHaveAttribute(
      'href',
      '/exhibition?e=payload&v=room'
    );
  });

  it('marks the current view without a word for it', () => {
    at(ROOM_LINK, { template: 'room', available: 'yes' });
    expect(screen.getByRole('link', { name: 'Room' })).toHaveAttribute(
      'aria-current',
      'page'
    );
    expect(screen.getByRole('link', { name: 'Page' })).not.toHaveAttribute(
      'aria-current'
    );
  });
});
