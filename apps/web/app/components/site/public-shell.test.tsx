import { forwardRef, type AnchorHTMLAttributes, type ReactNode } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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
  it('opens About and Technical details in a proper dropdown menu', async () => {
    const user = userEvent.setup();
    render(<PublicSiteHeader active="technical" />);

    const trigger = screen.getByRole('button', { name: 'About' });
    expect(trigger).toHaveAttribute('aria-haspopup', 'menu');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();

    await user.click(trigger);

    const menu = await screen.findByRole('menu');
    const about = screen.getByRole('menuitem', { name: 'About' });
    const technical = screen.getByRole('menuitem', {
      name: 'Technical details',
    });

    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(menu).toHaveClass('border-white/10', 'bg-[#111116]', 'p-1');
    expect(about).toHaveAttribute('href', '/about');
    expect(technical).toHaveAttribute('href', '/technical');
    expect(technical).toHaveAttribute('aria-current', 'page');
  });

  it('keeps the production one-line header geometry', () => {
    render(<PublicSiteHeader active="search" />);

    const about = screen.getByRole('button', { name: 'About' });
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
