import type { MetaFunction } from '@remix-run/cloudflare';
import { useState } from 'react';
import { Link, useSearchParams } from '@remix-run/react';
import { motion } from 'framer-motion';
import { LogIn, Loader2 } from 'lucide-react';
import { useUser } from '~/contexts/user-context';
import { Button } from '~/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '~/components/ui/card';
import { Logo } from '~/components/ui/logo';

export const meta: MetaFunction = () => {
  return [
    { title: 'Sign In - Paillette' },
    { name: 'description', content: 'Sign in to your Paillette account' },
  ];
};

export default function LoginPage() {
  const { login, isLogtoConfigured } = useUser();
  const [searchParams] = useSearchParams();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const returnTo = searchParams.get('returnTo') || undefined;
  const returnToQuery = returnTo
    ? `?returnTo=${encodeURIComponent(returnTo)}`
    : '';

  const handleSignIn = async () => {
    setError('');
    setIsLoading(true);

    try {
      await login({ returnTo });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-neutral-950 via-neutral-900 to-primary-950 flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-md"
      >
        <div className="text-center mb-8">
          <Logo linkToHome className="mb-4 justify-center" />
          <h1 className="text-3xl font-display font-bold text-white mb-2">
            Welcome Back
          </h1>
          <p className="text-neutral-400">Log in to your Paillette account</p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Log in</CardTitle>
            <CardDescription>
              Continue with your Berlayar account
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {/* Error Message */}
              {error && (
                <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-sm">
                  {error}
                </div>
              )}

              {/* Submit Button */}
              <Button
                type="button"
                onClick={handleSignIn}
                disabled={isLoading || !isLogtoConfigured}
                className="w-full"
              >
                {isLoading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Logging in...
                  </>
                ) : (
                  <>
                    <LogIn className="h-4 w-4" />
                    Log in
                  </>
                )}
              </Button>

              {!isLogtoConfigured && (
                <p className="text-xs text-center text-red-400">
                  Logto is not configured for this environment.
                </p>
              )}

              {/* Sign Up Link */}
              <div className="text-center pt-4 border-t border-neutral-800">
                <p className="text-sm text-neutral-400">
                  Don't have an account?{' '}
                  <Link
                    to={`/auth/signup${returnToQuery}`}
                    className="text-primary-400 hover:text-primary-300 font-medium"
                  >
                    Create one
                  </Link>
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </motion.div>
    </div>
  );
}
