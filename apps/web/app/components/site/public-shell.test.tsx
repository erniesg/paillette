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
    expect(about.nextElementSibling).toBe(technical);
    expect(technical.parentElement).toHaveClass('flex-col', 'items-start');
    expect(technical.parentElement).not.toHaveClass('flex-row');
    expect(technical).toHaveClass('text-xs', 'font-normal', 'pl-2');
    expect(technical.parentElement?.parentElement).toHaveClass('items-center');
    expect(technical).toHaveTextContent('Technical details');
  });

  it('uses compact spacing and labels for narrow Search-only headers', () => {
    render(<PublicSiteHeader active="search" />);

    const technical = screen.getByRole('link', {
      name: 'Technical details',
    });
    const logo =
      technical.parentElement?.previousElementSibling?.firstElementChild;
    const headerContent = technical.closest('header')?.firstElementChild;

    expect(technical).toHaveTextContent('Technical details');
    expect(technical).not.toHaveClass('hidden');
    expect(logo).toHaveClass(
      '[&>span:last-child]:hidden',
      'sm:[&>span:last-child]:inline'
    );
    expect(headerContent).toHaveClass('px-2', 'sm:px-5');
    expect(screen.getByRole('link', { name: 'Search' })).toHaveClass(
      'min-h-11',
      'min-w-11',
      'px-2',
      'sm:px-3'
    );
    expect(screen.getByRole('link', { name: 'About' })).toHaveClass(
      'min-h-6',
      'min-w-6'
    );
    expect(technical).toHaveClass('min-h-6', 'min-w-6');
  });

  it('keeps auth actions icon-compact below sm and fully labelled above it', () => {
    render(
      <PublicSiteHeader active="about" onLogin={vi.fn()} onSignup={vi.fn()} />
    );

    const login = screen.getByRole('button', { name: 'Log in' });
    const signup = screen.getByRole('button', { name: 'Create account' });

    expect(login).toHaveClass('px-2', 'sm:px-3');
    expect(signup).toHaveClass('px-2', 'sm:px-3');
    expect(login).toHaveClass('min-h-11', 'min-w-11');
    expect(signup).toHaveClass('min-h-11', 'min-w-11');
    expect(login.querySelector('span')).toHaveClass('hidden', 'sm:inline');
    expect(signup.querySelector('span')).toHaveClass('hidden', 'sm:inline');
    expect(login.parentElement).toHaveClass('gap-1', 'sm:gap-2');
  });
});
