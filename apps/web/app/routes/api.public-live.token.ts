import type { ActionFunctionArgs } from '@remix-run/cloudflare';
import { proxyLive } from '~/lib/voice/live.server';

/**
 * POST /api/public-live/token — the gate, relayed.
 *
 * This is where the audio budget is checked and debited, upstream in the
 * Worker. Nothing here decides anything: a budget check in a proxy is advice,
 * and advice is not a ceiling.
 */
export const action = ({ context, request }: ActionFunctionArgs) =>
  proxyLive(request, context, 'token');
