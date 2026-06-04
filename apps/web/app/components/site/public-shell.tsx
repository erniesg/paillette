import { Link } from '@remix-run/react';
import {
  ExternalLink,
  Github,
  LogIn,
  Network,
  ShieldCheck,
  UserPlus,
} from 'lucide-react';
import { Logo } from '~/components/ui/logo';
import { UserMenu } from '~/components/user/user-menu';

export const PAILLETTE_GITHUB_URL = 'https://github.com/erniesg/paillette';

type PublicSiteHeaderProps = {
  active: 'about' | 'search';
  searchHref?: string;
  isAuthenticated?: boolean;
  onLogoClick?: () => void;
  onLogin?: () => void;
  onSignup?: () => void;
};

export function PublicSiteHeader({
  active,
  searchHref = '/ngs/search',
  isAuthenticated = false,
  onLogoClick,
  onLogin,
  onSignup,
}: PublicSiteHeaderProps) {
  const canShowAuthActions = Boolean(onLogin && onSignup);

  return (
    <header className="sticky top-0 z-40 border-b border-white/[0.08] bg-[#0b0b0e]/90 backdrop-blur-md">
      <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-5 lg:px-8">
        <div className="flex min-w-0 items-baseline gap-5">
          <Link
            to={searchHref}
            onClick={onLogoClick}
            className="inline-flex shrink-0 leading-none transition-opacity hover:opacity-80"
          >
            <Logo size="sm" framed className="leading-none" />
          </Link>
          <Link
            to="/about"
            aria-current={active === 'about' ? 'page' : undefined}
            className={`inline-flex shrink-0 text-sm font-medium leading-none transition-colors ${
              active === 'about'
                ? 'text-white/75'
                : 'text-white/55 hover:text-white'
            }`}
          >
            About
          </Link>
        </div>

        <nav className="flex items-center gap-2" aria-label="Primary">
          {isAuthenticated ? (
            <UserMenu />
          ) : canShowAuthActions ? (
            <>
              <button
                type="button"
                onClick={onLogin}
                className="inline-flex items-center gap-2 rounded-md border border-white/10 bg-white/[0.06] px-3 py-1.5 text-xs font-medium text-white/75 transition-colors hover:bg-white/[0.1] hover:text-white"
              >
                <LogIn className="h-3.5 w-3.5" />
                Log in
              </button>
              <button
                type="button"
                onClick={onSignup}
                className="inline-flex items-center gap-2 rounded-md border border-white/10 bg-white px-3 py-1.5 text-xs font-semibold text-[#0b0b0e] transition-colors hover:bg-white/85"
              >
                <UserPlus className="h-3.5 w-3.5" />
                Create account
              </button>
            </>
          ) : (
            <Link
              to={searchHref}
              className="rounded-md border border-white/10 bg-white/[0.06] px-3 py-1.5 text-xs font-medium text-white/75 transition-colors hover:bg-white/[0.1] hover:text-white"
            >
              Search
            </Link>
          )}
        </nav>
      </div>
    </header>
  );
}

export function PublicSiteFooter({ separated }: { separated: boolean }) {
  return (
    <section
      className={
        separated ? 'mt-12 border-t border-white/[0.08] pt-8' : 'mt-8 pt-0'
      }
    >
      <div className="flex flex-col gap-3 text-sm leading-6 text-white/55 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex max-w-4xl items-start gap-2">
          <ShieldCheck className="mt-1 h-3.5 w-3.5 shrink-0 text-white/35" />
          <p>
            Experimental search, not an official catalogue; verify important
            details with linked source records.
          </p>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-4 font-mono text-[10px] uppercase tracking-[0.18em] text-white/35">
          <Link
            to="/docs/api"
            className="inline-flex items-center gap-1.5 transition-colors hover:text-white"
          >
            <Network className="h-3.5 w-3.5" />
            Docs
          </Link>
          <a
            href={PAILLETTE_GITHUB_URL}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 transition-colors hover:text-white"
          >
            <Github className="h-3.5 w-3.5" />
            GitHub
            <ExternalLink className="h-3 w-3" />
          </a>
        </div>
      </div>
    </section>
  );
}
