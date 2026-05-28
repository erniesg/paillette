import { Link, useSearchParams } from '@remix-run/react';
import { useHandleSignInCallback } from '@logto/react';
import { AlertCircle, Loader2 } from 'lucide-react';
import { Button } from '~/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '~/components/ui/card';
import { Logo } from '~/components/ui/logo';

const formatCallbackError = (value: string | null) => {
  if (!value) return '';
  return value.replace(/\+/g, ' ');
};

export function LogtoCallback() {
  const { isLoading, error } = useHandleSignInCallback();
  const [searchParams] = useSearchParams();
  const callbackErrorDescription = formatCallbackError(
    searchParams.get('error_description')
  );
  const callbackError = formatCallbackError(searchParams.get('error'));
  const hasError = Boolean(error || callbackErrorDescription || callbackError);
  const errorMessage =
    callbackErrorDescription ||
    error?.message ||
    callbackError ||
    'The sign-in callback could not be completed.';

  return (
    <div className="min-h-screen bg-gradient-to-br from-neutral-950 via-neutral-900 to-primary-950 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <Logo linkToHome className="mb-4 justify-center" />
        </div>

        <Card>
          <CardHeader>
            <CardTitle>
              {hasError ? 'Sign In Failed' : 'Signing You In'}
            </CardTitle>
            <CardDescription>
              {hasError
                ? 'Paillette could not complete the Logto callback.'
                : 'Finishing your Berlayar sign in.'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {hasError ? (
              <div className="space-y-4">
                <div className="flex items-start gap-3 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">
                  <AlertCircle className="mt-0.5 h-4 w-4 flex-none" />
                  <span>{errorMessage}</span>
                </div>

                <Button asChild className="w-full">
                  <Link to="/auth/login">Try Again</Link>
                </Button>
              </div>
            ) : (
              <div className="flex items-center gap-3 text-neutral-300">
                <Loader2 className="h-5 w-5 animate-spin text-primary-400" />
                <span>
                  {isLoading
                    ? 'Redirecting after sign in...'
                    : 'Redirecting...'}
                </span>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
