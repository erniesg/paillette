import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { forwardRef, type AnchorHTMLAttributes, type ReactNode } from 'react';
import { afterEach, describe, expect, expectTypeOf, it, vi } from 'vitest';

vi.mock('@remix-run/react', () => ({
  Link: forwardRef<
    HTMLAnchorElement,
    { children: ReactNode; to: string } & Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'>
  >(({ children, to, ...props }, ref) => (
    <a ref={ref} href={to} {...props}>
      {children}
    </a>
  )),
}));

vi.mock('framer-motion', () => ({
  AnimatePresence: ({ children }: { children: ReactNode }) => <>{children}</>,
  motion: {
    div: forwardRef<
      HTMLDivElement,
      React.HTMLAttributes<HTMLDivElement> & { initial?: unknown; animate?: unknown; exit?: unknown; transition?: unknown }
    >(({ initial: _initial, animate: _animate, exit: _exit, transition: _transition, ...props }, ref) => (
      <div ref={ref} {...props} />
    )),
  },
}));

vi.mock('~/components/ui/logo', () => ({ Logo: () => <div>Paillette</div> }));
vi.mock('~/components/user/user-menu', () => ({ UserMenu: () => <div>User menu</div> }));

vi.mock('~/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('~/lib/api')>();
  return {
    ...actual,
    apiClient: {
      listGalleries: vi.fn(),
      createGallery: vi.fn(),
    },
  };
});

import GalleriesIndex from '../galleries._index';
import { apiClient } from '~/lib/api';
import type { Gallery } from '~/types';

const gallery = {
  id: '2b1ca095-7dbd-4f6f-bfbb-70685e702fd0',
  name: 'New Gallery',
  slug: 'new-gallery',
  isPublic: true,
  createdAt: '2026-08-28T00:00:00.000Z',
  updatedAt: '2026-08-28T00:00:00.000Z',
};

const renderPage = () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <GalleriesIndex />
    </QueryClientProvider>
  );
};

describe('gallery creation', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('shows completion when the successful response contains no organization API key', async () => {
    vi.mocked(apiClient.listGalleries).mockResolvedValue([]);
    vi.mocked(apiClient.createGallery).mockResolvedValue(gallery as never);
    const user = userEvent.setup();

    renderPage();
    await user.click(await screen.findByRole('button', { name: /create gallery/i }));
    await user.type(screen.getByLabelText(/gallery name/i), gallery.name);
    fireEvent.submit(screen.getByRole('button', { name: /^create gallery$/i }).closest('form')!);

    expect(await screen.findByText('Gallery created successfully!')).toBeInTheDocument();
    expect(screen.queryByText(/save this api key/i)).not.toBeInTheDocument();
    expect(screen.queryByText('undefined')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /search new gallery/i })).toHaveAttribute(
      'href',
      '/new-gallery/search'
    );

    await waitFor(() => {
      expect(apiClient.listGalleries).toHaveBeenCalledTimes(2);
    });
  });

  it('keeps gallery creation typed as a normal gallery response', () => {
    expectTypeOf(apiClient.createGallery).returns.toEqualTypeOf<
      Promise<Gallery>
    >();
  });
});
