/**
 * Sign Up Page
 * Simple registration form with mock authentication
 */

import type { MetaFunction } from '@remix-run/cloudflare';
import { useState } from 'react';
import { useNavigate, Link } from '@remix-run/react';
import { motion } from 'framer-motion';
import { UserPlus, Loader2 } from 'lucide-react';
import { useUser } from '~/contexts/user-context';
import { Button } from '~/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card';
import { Logo } from '~/components/ui/logo';

export const meta: MetaFunction = () => {
  return [
    { title: 'Create Account - Paillette' },
    { name: 'description', content: 'Create your Paillette account' },
  ];
};

export default function SignupPage() {
  const navigate = useNavigate();
  const { signup } = useUser();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    // Validate passwords match
    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    setIsLoading(true);

    try {
      await signup(email, password, name);
      navigate('/galleries');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Signup failed');
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
          <h1 className="text-3xl font-display font-bold text-white mb-2">Create Account</h1>
          <p className="text-neutral-400">Get started with Paillette</p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Sign Up</CardTitle>
            <CardDescription>Create your account to continue</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              {/* Name */}
              <div className="space-y-2">
                <label htmlFor="name" className="text-sm font-medium text-neutral-200">
                  Full Name
                </label>
                <input
                  id="name"
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="John Doe"
                  required
                  className="w-full bg-neutral-900/50 border-2 border-neutral-700 rounded-lg px-4 py-3 text-white placeholder:text-neutral-500 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/30 transition-all"
                />
              </div>

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
                  placeholder="Create a strong password"
                  required
                  minLength={8}
                  className="w-full bg-neutral-900/50 border-2 border-neutral-700 rounded-lg px-4 py-3 text-white placeholder:text-neutral-500 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/30 transition-all"
                />
              </div>

              {/* Confirm Password */}
              <div className="space-y-2">
                <label htmlFor="confirmPassword" className="text-sm font-medium text-neutral-200">
                  Confirm Password
                </label>
                <input
                  id="confirmPassword"
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Re-enter your password"
                  required
                  minLength={8}
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
                    Creating account...
                  </>
                ) : (
                  <>
                    <UserPlus className="h-4 w-4" />
                    Create Account
                  </>
                )}
              </Button>

              {/* Note */}
              <p className="text-xs text-center text-neutral-500 mt-4">
                Note: This is a demo. Any details will work.
              </p>

              {/* Sign In Link */}
              <div className="text-center pt-4 border-t border-neutral-800">
                <p className="text-sm text-neutral-400">
                  Already have an account?{' '}
                  <Link to="/auth/login" className="text-primary-400 hover:text-primary-300 font-medium">
                    Sign in
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
