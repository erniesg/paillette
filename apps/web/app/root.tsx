import {
  type LinksFunction,
  type LoaderFunctionArgs,
  type MetaFunction,
} from '@remix-run/cloudflare';
import {
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  useLoaderData,
} from '@remix-run/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import { ThemeToggle } from './components/theme/theme-toggle';
import { UserProvider } from './contexts/user-context';
import { ThemeProvider } from './contexts/theme-context';
import { getApiBaseUrl, getServerEnv } from './lib/public-search.server';
import {
  getWorkOSRuntimeConfig,
  withWorkOSSession,
} from './lib/workos-auth.server';

import styles from './tailwind.css?url';
// import colorfulStyles from 'react-colorful/dist/index.css?url';

export const meta: MetaFunction = () => {
  return [
    { title: 'Paillette - AI-Powered Art Gallery Search' },
    {
      name: 'description',
      content: 'Multimodal search and management platform for art galleries',
    },
  ];
};

export const links: LinksFunction = () => [
  { rel: 'stylesheet', href: styles },
  // { rel: 'stylesheet', href: colorfulStyles },
  { rel: 'preconnect', href: 'https://fonts.googleapis.com' },
  {
    rel: 'preconnect',
    href: 'https://fonts.gstatic.com',
    crossOrigin: 'anonymous' as const,
  },
  {
    rel: 'stylesheet',
    href: 'https://fonts.googleapis.com/css2?family=EB+Garamond:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&family=Inter:wght@300;400;500;600;700&family=Playfair+Display:ital,wght@0,400;0,500;0,600;0,700;0,800;1,400;1,500;1,600;1,700;1,800&display=swap',
  },
];

export const loader = (args: LoaderFunctionArgs) =>
  withWorkOSSession(args, async (session) => {
    const env = getServerEnv(args.context);
    let searchAccess: 'anonymous' | 'pending' | 'approved' = session.user
      ? 'pending'
      : 'anonymous';

    if (session.accessToken) {
      try {
        const response = await fetch(`${getApiBaseUrl(env)}/me/access`, {
          headers: { Authorization: `Bearer ${session.accessToken}` },
        });
        if (response.ok) searchAccess = 'approved';
      } catch {
        // Fail closed. A signed-in account is pending until the API confirms it.
      }
    }

    return {
      sessionUser: session.user,
      searchAccess,
      isWorkOSConfigured: Boolean(getWorkOSRuntimeConfig(args.context)),
    };
  });

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <Meta />
        <script
          dangerouslySetInnerHTML={{
            __html:
              "(() => { try { const theme = localStorage.getItem('paillette-theme') === 'light' ? 'light' : 'dark'; document.documentElement.dataset.theme = theme; document.documentElement.style.colorScheme = theme; } catch (_) { document.documentElement.dataset.theme = 'dark'; document.documentElement.style.colorScheme = 'dark'; } })();",
          }}
        />
        <Links />
      </head>
      <body suppressHydrationWarning>
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function App() {
  const { sessionUser, searchAccess, isWorkOSConfigured } =
    useLoaderData<typeof loader>();
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 60 * 1000, // 1 minute
            refetchOnWindowFocus: false,
          },
        },
      })
  );
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <UserProvider
          initialUser={sessionUser}
          isWorkOSConfigured={isWorkOSConfigured}
          searchAccess={searchAccess}
        >
          <Outlet />
          <ThemeToggle />
        </UserProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
