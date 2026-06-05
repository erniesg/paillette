import { json, type LoaderFunctionArgs } from '@remix-run/cloudflare';

const ALLOWED_PUBLIC_IMAGE_HOSTS = new Set([
  'paillette-api.berlayar.ai',
  'paillette-api-stg.berlayar.ai',
  'www.nationalgallery.sg',
  'www.roots.gov.sg',
]);

const imageProxyError = (message: string, status = 400) =>
  json(
    {
      success: false,
      error: { code: 'PUBLIC_IMAGE_PROXY_ERROR', message },
    },
    { status }
  );

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const requestUrl = new URL(request.url);
  const sourceUrl = requestUrl.searchParams.get('url');
  if (!sourceUrl) return imageProxyError('Image URL is required.');

  let imageUrl: URL;
  try {
    imageUrl = new URL(sourceUrl);
  } catch {
    return imageProxyError('Image URL is invalid.');
  }

  if (
    imageUrl.protocol !== 'https:' ||
    !ALLOWED_PUBLIC_IMAGE_HOSTS.has(imageUrl.hostname)
  ) {
    return imageProxyError('Image host is not allowed.', 403);
  }

  const upstream = await fetch(imageUrl.toString(), {
    redirect: 'manual',
    headers: {
      Accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
    },
  });

  if (!upstream.ok || !upstream.body) {
    return imageProxyError('Image could not be loaded.', 502);
  }

  const contentType = upstream.headers.get('content-type') || 'image/jpeg';
  if (!contentType.toLowerCase().startsWith('image/')) {
    return imageProxyError('URL did not return an image.', 415);
  }

  const headers = new Headers();
  headers.set('Content-Type', contentType);
  headers.set('Cache-Control', 'public, max-age=86400');
  headers.set('Access-Control-Allow-Origin', '*');

  return new Response(upstream.body, {
    status: 200,
    headers,
  });
};
