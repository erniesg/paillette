import { json, type LinksFunction, type LoaderFunctionArgs, type MetaFunction } from '@remix-run/cloudflare';
import {
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  useLoaderData,
} from '@remix-run/react';
import { LogtoProvider, UserScope, type LogtoConfig } from '@logto/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { ThemeToggle } from './components/theme/theme-toggle';
import { UserProvider } from './contexts/user-context';
import { ThemeProvider } from './contexts/theme-context';
import type { LogtoRuntimeEnv } from './lib/logto';

import styles from './tailwind.css?url';
// import colorfulStyles from 'react-colorful/dist/index.css?url';

export const meta: MetaFunction = () => {
  return [
    { title: 'Paillette - AI-Powered Art Gallery Search' },
    { name: 'description', content: 'Multimodal search and management platform for art galleries' },
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
    href: 'https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=Playfair+Display:ital,wght@0,400;0,500;0,600;0,700;0,800;1,400;1,500;1,600;1,700;1,800&display=swap',
  },
];

type WorkerContext = {
  cloudflare?: {
    env?: Record<string, string | undefined>;
  };
};

const getProcessEnv = () => {
  const runtime = globalThis as typeof globalThis & {
    process?: { env?: Record<string, string | undefined> };
  };

  return runtime.process?.env ?? {};
};

export const loader = ({ context }: LoaderFunctionArgs) => {
  const workerEnv = (context as WorkerContext).cloudflare?.env ?? {};
  const processEnv = getProcessEnv();
  const appEnv = workerEnv.APP_ENV ?? processEnv.APP_ENV ?? processEnv.NODE_ENV ?? 'development';
  const defaultStagingAppId = appEnv === 'production' ? '' : 'zsrsuc0jkv9zhinog3bx5';

  return json({
    env: {
      endpoint:
        workerEnv.LOGTO_ENDPOINT ??
        processEnv.LOGTO_ENDPOINT ??
        processEnv.VITE_LOGTO_ENDPOINT ??
        'https://m2fmae.logto.app/',
      appId:
        workerEnv.LOGTO_APP_ID ??
        processEnv.LOGTO_APP_ID ??
        processEnv.VITE_LOGTO_APP_ID ??
        defaultStagingAppId,
      apiResource:
        workerEnv.LOGTO_API_RESOURCE ??
        processEnv.LOGTO_API_RESOURCE ??
        processEnv.VITE_LOGTO_API_RESOURCE ??
        '',
    } satisfies LogtoRuntimeEnv,
  });
};

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
  const { env } = useLoaderData<typeof loader>();
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
  const logtoConfig = useMemo<LogtoConfig>(() => {
    const resources = env.apiResource ? [env.apiResource] : undefined;

    return {
      endpoint: env.endpoint,
      appId: env.appId,
      scopes: [UserScope.Email],
      resources,
    };
  }, [env.apiResource, env.appId, env.endpoint]);

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <LogtoProvider config={logtoConfig}>
          <UserProvider
            apiResource={env.apiResource || undefined}
            isLogtoConfigured={Boolean(env.endpoint && env.appId)}
          >
            <Outlet />
            <ThemeToggle />
          </UserProvider>
        </LogtoProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
