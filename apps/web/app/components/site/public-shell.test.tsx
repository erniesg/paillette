import { forwardRef, type AnchorHTMLAttributes, type ReactNode } from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PublicSiteHeader } from './public-shell';

vi.mock('@remix-run/react', () => ({
  Link: forwardRef<
    HTMLAnchorElement,
    {
      children: ReactNode;
      to: string;
    } & Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'>
  >(({ children, to, ...props }, ref) => (
    <a ref={ref} href={to} {...props}>
      {children}
    </a>
  )),
}));

describe('PublicSiteHeader', () => {
  it('links directly to About without a redundant submenu', () => {
    render(<PublicSiteHeader active="about" />);

    const about = screen.getByRole('link', { name: 'About' });
    expect(about).toHaveAttribute('href', '/about');
    expect(about).toHaveAttribute('aria-current', 'page');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(
      screen.queryByRole('link', { name: 'Technical details' })
    ).toBeNull();
  });

  it('keeps the production one-line header geometry', () => {
    render(<PublicSiteHeader active="search" />);

    const about = screen.getByRole('link', { name: 'About' });
    const logo = about.previousElementSibling;
    const headerContent = about.closest('header')?.firstElementChild;

    expect(about).toHaveClass('text-sm', 'font-medium');
    expect(about.parentElement).toHaveClass('items-center');
    expect(logo).toHaveClass('inline-flex', 'shrink-0');
    expect(headerContent).toHaveClass('h-14', 'px-2', 'sm:px-5');
    expect(screen.getByRole('link', { name: 'Search' })).toHaveClass(
      'min-h-11',
      'min-w-11',
      'px-2',
      'sm:px-3'
    );
    expect(
      screen.queryByRole('link', { name: 'Technical details' })
    ).toBeNull();
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

describe('PublicSiteHeader — while a board is dealt', () => {
  it('stands the account chrome down but keeps the way back', () => {
    // Five of the 48 chrome words on a dealt board were an invitation to leave,
    // sitting directly above the one image the submission is made of.
    render(
      <PublicSiteHeader
        active="search"
        quiet
        onLogin={vi.fn()}
        onSignup={vi.fn()}
      />
    );

    expect(screen.queryByRole('button', { name: 'Log in' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Create account' })).toBeNull();
    expect(screen.queryByText('About')).toBeNull();
    expect(screen.getByLabelText('Paillette search')).toBeInTheDocument();
  });
});
