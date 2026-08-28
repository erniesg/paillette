import type { LoaderFunctionArgs } from '@remix-run/cloudflare';
import { getSafeReturnTo, startWorkOSAuthorization } from '~/lib/workos-auth.server';

export const loader = ({ context, request, params }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  return startWorkOSAuthorization(
    { context, request, params },
    url.searchParams.get('screen') === 'sign-up' ? 'sign-up' : 'sign-in',
    getSafeReturnTo(url.searchParams.get('returnTo'))
  );
};
