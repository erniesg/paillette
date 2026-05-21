import type { MetaFunction } from '@remix-run/cloudflare';
import { useState } from 'react';
import { Link } from '@remix-run/react';
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
  const { signup, isLogtoConfigured } = useUser();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSignup = async () => {
    setError('');
    setIsLoading(true);

    try {
      await signup();
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
            <CardDescription>Create your Berlayar account to continue</CardDescription>
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
                onClick={handleSignup}
                disabled={isLoading || !isLogtoConfigured}
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

              {!isLogtoConfigured && (
                <p className="text-xs text-center text-red-400">
                  Logto is not configured for this environment.
                </p>
              )}

              {/* Sign In Link */}
              <div className="text-center pt-4 border-t border-neutral-800">
                <p className="text-sm text-neutral-400">
                  Already have an account?{' '}
                  <Link to="/auth/login" className="text-primary-400 hover:text-primary-300 font-medium">
                    Sign in
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
