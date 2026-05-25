import { json, type LoaderFunctionArgs } from '@remix-run/cloudflare';
import { getApiBaseUrl, getServerEnv } from '~/lib/public-search.server';
import type { ApiResponse } from '~/types';

type OrgDirectoryItem = {
  key?: string | null;
  id: string;
  name: string;
  slug?: string | null;
  description?: string | null;
  website?: string | null;
};

export const loader = async ({ context }: LoaderFunctionArgs) => {
  const apiBase = getApiBaseUrl(getServerEnv(context));

  try {
    const response = await fetch(`${apiBase}/orgs?limit=20`);
    const payload = (await response.json()) as ApiResponse<
      OrgDirectoryItem[]
    > & {
      metadata?: { total?: number };
    };

    if (!response.ok || !payload.success || !payload.data) {
      return json(
        {
          message:
            payload.error?.message || `Request failed (${response.status})`,
        },
        { status: response.ok ? 502 : response.status }
      );
    }

    return json({
      orgs: payload.data,
      total: payload.metadata?.total ?? payload.data.length,
    });
  } catch (error) {
    return json(
      {
        message:
          error instanceof Error
            ? error.message
            : 'Could not load /orgs from the configured API.',
      },
      { status: 502 }
    );
  }
};
