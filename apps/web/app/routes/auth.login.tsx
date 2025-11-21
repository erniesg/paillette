/**
 * Login Page
 * Simple login form with mock authentication
 */

import type { MetaFunction } from '@remix-run/cloudflare';
import { useState } from 'react';
import { useNavigate, Link } from '@remix-run/react';
import { motion } from 'framer-motion';
import { LogIn, Loader2 } from 'lucide-react';
import { useUser } from '~/contexts/user-context';
import { Button } from '~/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card';
import { Logo } from '~/components/ui/logo';

export const meta: MetaFunction = () => {
  return [
    { title: 'Sign In - Paillette' },
    { name: 'description', content: 'Sign in to your Paillette account' },
  ];
};

export default function LoginPage() {
  const navigate = useNavigate();
  const { login } = useUser();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);

    try {
      await login(email, password);
      navigate('/galleries');
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
          <h1 className="text-3xl font-display font-bold text-white mb-2">Welcome Back</h1>
          <p className="text-neutral-400">Sign in to your Paillette account</p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Sign In</CardTitle>
            <CardDescription>Enter your credentials to continue</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              {/* Email */}
              <div className="space-y-2">
                <label htmlFor="email" className="text-sm font-medium text-neutral-200">
                  Email
                </label>
                <input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  required
                  className="w-full bg-neutral-900/50 border-2 border-neutral-700 rounded-lg px-4 py-3 text-white placeholder:text-neutral-500 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/30 transition-all"
                />
              </div>

              {/* Password */}
              <div className="space-y-2">
                <label htmlFor="password" className="text-sm font-medium text-neutral-200">
                  Password
                </label>
                <input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter your password"
                  required
                  className="w-full bg-neutral-900/50 border-2 border-neutral-700 rounded-lg px-4 py-3 text-white placeholder:text-neutral-500 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/30 transition-all"
                />
              </div>

              {/* Error Message */}
              {error && (
                <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-sm">
                  {error}
                </div>
              )}

              {/* Submit Button */}
              <Button
                type="submit"
                disabled={isLoading}
                className="w-full"
              >
                {isLoading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Signing in...
                  </>
                ) : (
                  <>
                    <LogIn className="h-4 w-4" />
                    Sign In
                  </>
                )}
              </Button>

              {/* Note */}
              <p className="text-xs text-center text-neutral-500 mt-4">
                Note: This is a demo. Any email/password will work.
              </p>

              {/* Sign Up Link */}
              <div className="text-center pt-4 border-t border-neutral-800">
                <p className="text-sm text-neutral-400">
                  Don't have an account?{' '}
                  <Link to="/auth/signup" className="text-primary-400 hover:text-primary-300 font-medium">
                    Create one
                  </Link>
                </p>
              </div>
            </form>
          </CardContent>
        </Card>
      </motion.div>
    </div>
  );
}
