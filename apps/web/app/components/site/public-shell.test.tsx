import type { AnchorHTMLAttributes, ReactNode } from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PublicSiteHeader } from './public-shell';

vi.mock('@remix-run/react', () => ({
  Link: ({
    children,
    to,
    ...props
  }: {
    children: ReactNode;
    to: string;
  } & Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'>) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
}));

describe('PublicSiteHeader', () => {
  it('places Technical details directly after About', () => {
    render(<PublicSiteHeader active="technical" />);
    const about = screen.getByRole('link', { name: 'About' });
    const technical = screen.getByRole('link', {
      name: 'Technical details',
    });
    expect(technical).toHaveAttribute('href', '/technical');
    expect(technical).toHaveAttribute('aria-current', 'page');
    expect(about.parentElement?.children[1]).toBe(technical);
  });
});
