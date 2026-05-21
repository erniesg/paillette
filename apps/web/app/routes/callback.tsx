import type { MetaFunction } from '@remix-run/cloudflare';
import { LogtoCallback } from '~/components/auth/logto-callback';

export const meta: MetaFunction = () => {
  return [
    { title: 'Signing In - Paillette' },
    { name: 'description', content: 'Completing your Paillette sign in' },
  ];
};

export default function CallbackPage() {
  return <LogtoCallback />;
}
