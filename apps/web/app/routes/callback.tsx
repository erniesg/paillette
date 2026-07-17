import type { LoaderFunctionArgs } from '@remix-run/cloudflare';
import { handleWorkOSCallback } from '~/lib/workos-auth.server';

export const loader = (args: LoaderFunctionArgs): Promise<any> =>
  handleWorkOSCallback(args);
