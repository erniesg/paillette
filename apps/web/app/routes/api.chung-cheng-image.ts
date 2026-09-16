import type { LoaderFunctionArgs } from '@remix-run/cloudflare';

const CHUNG_CHENG_ROOTS_IMAGE_URL =
  'https://www.roots.gov.sg/CollectionImages/1454646.jpg';

export async function loader(_args: LoaderFunctionArgs) {
  const response = await fetch(CHUNG_CHENG_ROOTS_IMAGE_URL, {
    headers: {
      Accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
      'User-Agent': 'Paillette/1.0',
    },
  });

  if (!response.ok || !response.body) {
    throw new Response('Unable to load Chung Cheng image.', { status: 502 });
  }

  return new Response(response.body, {
    headers: {
      'Cache-Control': 'public, max-age=86400, stale-while-revalidate=604800',
      'Content-Type': response.headers.get('Content-Type') || 'image/jpeg',
    },
  });
}
