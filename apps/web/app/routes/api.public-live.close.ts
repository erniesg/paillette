import type { ActionFunctionArgs } from '@remix-run/cloudflare';
import { proxyLive } from '~/lib/voice/live.server';

/**
 * POST /api/public-live/close — the page hanging up.
 *
 * The polite path, not the enforcing one: the grant was debited at mint, so
 * this can only ever refund what the session did not use. A page that never
 * gets here is swept server-side instead.
 */
export const action = ({ context, request }: ActionFunctionArgs) =>
  proxyLive(request, context, 'close');
