import { redirect, type LoaderFunctionArgs } from '@remix-run/cloudflare';
import {
  getConfiguredAuthorizationUrl,
  getSafeReturnTo,
} from '~/lib/workos-auth.server';

export const loader = async ({ context, request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const screen = url.searchParams.get('screen') === 'sign-up' ? 'sign-up' : 'sign-in';
  const returnTo = getSafeReturnTo(url.searchParams.get('returnTo'));
  const authorizationUrl = await getConfiguredAuthorizationUrl(
    context,
    screen,
    returnTo
  );

  if (!authorizationUrl) {
    throw new Response('Authentication is not configured', { status: 503 });
  }

  return redirect(authorizationUrl);
};
