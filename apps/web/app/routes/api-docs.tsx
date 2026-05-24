import { redirect, type LoaderFunctionArgs } from '@remix-run/cloudflare';

export const loader = (_args: LoaderFunctionArgs) => redirect('/docs/api');
