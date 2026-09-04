import type { ActionFunctionArgs } from '@remix-run/cloudflare';
import { proxyLive } from '~/lib/voice/live.server';

/**
 * POST /api/public-live/heartbeat — is this session still inside its grant?
 *
 * A `false` answer arrives after the call has already been hung up at the
 * provider, so the page is being told rather than asked.
 */
export const action = ({ context, request }: ActionFunctionArgs) =>
  proxyLive(request, context, 'heartbeat');
