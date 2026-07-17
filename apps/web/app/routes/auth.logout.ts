import type { ActionFunctionArgs } from '@remix-run/cloudflare';
import { handleWorkOSSignOut } from '~/lib/workos-auth.server';

export const action = (args: ActionFunctionArgs) =>
  handleWorkOSSignOut(args as any);
