import { redirect } from '@remix-run/cloudflare';

export const loader = () => redirect('/about#technical-details', 301);

export default function TechnicalPage() {
  return null;
}
