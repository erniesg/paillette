import { Link } from '@remix-run/react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import {
  Check,
  ChevronDown,
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
  active: 'about' | 'technical' | 'search';
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
      <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-2 sm:px-5 lg:px-8">
        <div className="flex min-w-0 items-center gap-2 sm:gap-5">
          <Link
            to={searchHref}
            onClick={onLogoClick}
            aria-label="Paillette search"
            className="inline-flex shrink-0 leading-none transition-opacity hover:opacity-80"
          >
            <Logo
              size="sm"
              framed
              className="text-base leading-none sm:text-xl [&>span:last-child]:hidden sm:[&>span:last-child]:inline"
            />
          </Link>
          <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild>
              <button
                type="button"
                aria-label="About"
                className={`group inline-flex min-h-11 min-w-11 items-center gap-1 rounded-sm px-1 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/70 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0b0b0e] ${
                  active === 'about' || active === 'technical'
                    ? 'text-white/75'
                    : 'text-white/55 hover:text-white'
                }`}
              >
                <span>About</span>
                <ChevronDown
                  aria-hidden="true"
                  className="h-3.5 w-3.5 text-white/35 transition-transform duration-150 group-data-[state=open]:rotate-180 group-data-[state=open]:text-white/60"
                />
              </button>
            </DropdownMenu.Trigger>

            <DropdownMenu.Portal>
              <DropdownMenu.Content
                align="start"
                sideOffset={8}
                collisionPadding={8}
                className="z-50 min-w-52 rounded-md border border-white/10 bg-[#111116] p-1 text-white shadow-[0_18px_50px_rgba(0,0,0,0.45)] outline-none"
              >
                <DropdownMenu.Item asChild>
                  <Link
                    to="/about"
                    aria-current={active === 'about' ? 'page' : undefined}
                    className="flex min-h-10 cursor-pointer items-center justify-between gap-4 rounded-sm px-3 py-2 text-sm text-white/65 outline-none transition-colors hover:bg-white/[0.06] hover:text-white focus:bg-white/[0.08] focus:text-white"
                  >
                    <span>About</span>
                    {active === 'about' ? (
                      <Check
                        aria-hidden="true"
                        className="h-3.5 w-3.5 text-white/45"
                      />
                    ) : null}
                  </Link>
                </DropdownMenu.Item>
                <DropdownMenu.Item asChild>
                  <Link
                    to="/technical"
                    aria-current={active === 'technical' ? 'page' : undefined}
                    className="flex min-h-10 cursor-pointer items-center justify-between gap-4 rounded-sm px-3 py-2 text-sm text-white/65 outline-none transition-colors hover:bg-white/[0.06] hover:text-white focus:bg-white/[0.08] focus:text-white"
                  >
                    <span>Technical details</span>
                    {active === 'technical' ? (
                      <Check
                        aria-hidden="true"
                        className="h-3.5 w-3.5 text-white/45"
                      />
                    ) : null}
                  </Link>
                </DropdownMenu.Item>
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
        </div>

        <nav className="flex items-center gap-1 sm:gap-2" aria-label="Primary">
          {isAuthenticated ? (
            <UserMenu />
          ) : canShowAuthActions ? (
            <>
              <button
                type="button"
                onClick={onLogin}
                aria-label="Log in"
                className="inline-flex min-h-11 min-w-11 items-center justify-center gap-0 rounded-md border border-white/10 bg-white/[0.06] px-2 py-1.5 text-xs font-medium text-white/75 transition-colors hover:bg-white/[0.1] hover:text-white sm:gap-2 sm:px-3"
              >
                <LogIn className="h-3.5 w-3.5 shrink-0" />
                <span className="hidden sm:inline">Log in</span>
              </button>
              <button
                type="button"
                onClick={onSignup}
                aria-label="Create account"
                className="inline-flex min-h-11 min-w-11 items-center justify-center gap-0 rounded-md border border-white/10 bg-white px-2 py-1.5 text-xs font-semibold text-[#0b0b0e] transition-colors hover:bg-white/85 sm:gap-2 sm:px-3"
              >
                <UserPlus className="h-3.5 w-3.5 shrink-0" />
                <span className="hidden sm:inline">Create account</span>
              </button>
            </>
          ) : (
            <Link
              to={searchHref}
              className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-md border border-white/10 bg-white/[0.06] px-2 py-1.5 text-xs font-medium text-white/75 transition-colors hover:bg-white/[0.1] hover:text-white sm:px-3"
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
