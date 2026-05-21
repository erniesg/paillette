/**
 * Account Settings Page
 * User profile and settings management
 */

import type { MetaFunction } from '@remix-run/cloudflare';
import { Link } from '@remix-run/react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import {
  Activity,
  ArrowLeft,
  Check,
  Copy,
  KeyRound,
  Loader2,
  Mail,
  Shield,
  Trash2,
  User,
} from 'lucide-react';
import { useState } from 'react';
import { useUser } from '~/contexts/user-context';
import { apiClient } from '~/lib/api';
import { Button } from '~/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card';
import { Logo } from '~/components/ui/logo';
import { UserMenu } from '~/components/user/user-menu';

export const meta: MetaFunction = () => {
  return [
    { title: 'Account Settings - Paillette' },
    { name: 'description', content: 'Manage your account settings' },
  ];
};

export default function AccountSettingsPage() {
  const { user, getAccessToken } = useUser();
  const queryClient = useQueryClient();
  const [keyName, setKeyName] = useState('Default key');
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const apiKeysQuery = useQuery({
    queryKey: ['api-keys'],
    queryFn: () => apiClient.listApiKeys(getAccessToken),
    enabled: Boolean(user),
    retry: false,
  });

  const usageQuery = useQuery({
    queryKey: ['api-usage-today'],
    queryFn: () => apiClient.getTodayUsage(getAccessToken),
    enabled: Boolean(user),
    retry: false,
  });

  const createApiKeyMutation = useMutation({
    mutationFn: () => apiClient.createApiKey(getAccessToken, keyName || 'Default key'),
    onSuccess: (created) => {
      setCreatedKey(created.key);
      setKeyName('Default key');
      void queryClient.invalidateQueries({ queryKey: ['api-keys'] });
    },
  });

  const revokeApiKeyMutation = useMutation({
    mutationFn: (keyId: string) => apiClient.revokeApiKey(getAccessToken, keyId),
    onSuccess: () => {
      setCreatedKey(null);
      void queryClient.invalidateQueries({ queryKey: ['api-keys'] });
    },
  });

  const keys = apiKeysQuery.data?.keys ?? [];
  const activeKey = keys.find((key) => key.status === 'active');
  const activeUsage = activeKey
    ? {
        used: Number(activeKey.used_today ?? 0),
        quota: Number(activeKey.quota_today ?? 100),
      }
    : usageQuery.data
      ? {
          used: usageQuery.data.used,
          quota: usageQuery.data.quota,
        }
      : { used: 0, quota: 100 };
  const usagePercent =
    activeUsage.quota > 0 ? Math.min((activeUsage.used / activeUsage.quota) * 100, 100) : 0;

  const handleCopyKey = async () => {
    if (!createdKey) return;

    await navigator.clipboard.writeText(createdKey);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };

  if (!user) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-neutral-950 via-neutral-900 to-primary-950 flex items-center justify-center p-4">
        <Card>
          <CardContent className="p-8 text-center">
            <p className="text-neutral-400 mb-4">Please sign in to access your settings</p>
            <Link to="/auth/login" className="text-primary-400 hover:text-primary-300">
              Sign In
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-neutral-950 via-neutral-900 to-primary-950 text-white">
      {/* Header */}
      <header className="border-b border-neutral-800 bg-neutral-900/50 backdrop-blur-sm">
        <div className="container mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <Logo linkToHome />
            <nav className="flex items-center gap-4">
              <Link
                to="/galleries"
                className="flex items-center gap-2 text-neutral-400 hover:text-white transition-colors"
              >
                <ArrowLeft className="w-4 h-4" />
                Back to Galleries
              </Link>
              <div className="ml-2 pl-4 border-l border-neutral-700">
                <UserMenu />
              </div>
            </nav>
          </div>
        </div>
      </header>

      <div className="container mx-auto px-6 py-12 max-w-4xl">
        {/* Page Title */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-8"
        >
          <h1 className="text-4xl font-display font-bold mb-2">Account Settings</h1>
          <p className="text-neutral-400">Manage your account and preferences</p>
        </motion.div>

        <div className="space-y-6">
          {/* Profile Information */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
          >
            <Card>
              <CardHeader>
                <div className="flex items-center gap-3">
                  <User className="w-5 h-5 text-primary-400" />
                  <div>
                    <CardTitle>Profile Information</CardTitle>
                    <CardDescription>Your personal details</CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <label className="text-sm text-neutral-400 block mb-1">Full Name</label>
                  <p className="text-white">{user.name}</p>
                </div>
                <div>
                  <label className="text-sm text-neutral-400 block mb-1">Email</label>
                  <p className="text-white">{user.email}</p>
                </div>
                <div>
                  <label className="text-sm text-neutral-400 block mb-1">User ID</label>
                  <p className="text-neutral-500 text-sm font-mono">{user.id}</p>
                </div>
              </CardContent>
            </Card>
          </motion.div>

          {/* Email Preferences */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
          >
            <Card>
              <CardHeader>
                <div className="flex items-center gap-3">
                  <Mail className="w-5 h-5 text-primary-400" />
                  <div>
                    <CardTitle>Email Preferences</CardTitle>
                    <CardDescription>Manage your email notifications</CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <p className="text-neutral-400 text-sm">
                  Product updates and API usage alerts will be available soon.
                </p>
              </CardContent>
            </Card>
          </motion.div>

          {/* API Access */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
          >
            <Card>
              <CardHeader>
                <div className="flex items-center gap-3">
                  <KeyRound className="w-5 h-5 text-primary-400" />
                  <div>
                    <CardTitle>API Access</CardTitle>
                    <CardDescription>Personal key and daily free query usage</CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-5">
                {apiKeysQuery.isError && (
                  <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">
                    {apiKeysQuery.error instanceof Error
                      ? apiKeysQuery.error.message
                      : 'Failed to load API keys'}
                  </div>
                )}

                <div className="grid gap-4 md:grid-cols-[1fr_auto] md:items-end">
                  <div className="space-y-2">
                    <label htmlFor="api-key-name" className="text-sm font-medium text-neutral-200">
                      Key name
                    </label>
                    <input
                      id="api-key-name"
                      value={keyName}
                      onChange={(event) => setKeyName(event.target.value)}
                      disabled={Boolean(activeKey) || createApiKeyMutation.isPending}
                      className="w-full rounded-lg border-2 border-neutral-700 bg-neutral-900/50 px-4 py-3 text-white placeholder:text-neutral-500 transition-all focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/30 disabled:cursor-not-allowed disabled:opacity-50"
                    />
                  </div>
                  <Button
                    type="button"
                    onClick={() => createApiKeyMutation.mutate()}
                    disabled={Boolean(activeKey) || createApiKeyMutation.isPending}
                  >
                    {createApiKeyMutation.isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <KeyRound className="h-4 w-4" />
                    )}
                    Create Key
                  </Button>
                </div>

                {createApiKeyMutation.isError && (
                  <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">
                    {createApiKeyMutation.error instanceof Error
                      ? createApiKeyMutation.error.message
                      : 'Failed to create API key'}
                  </div>
                )}

                {createdKey && (
                  <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4">
                    <div className="mb-2 flex items-center justify-between gap-3">
                      <p className="text-sm font-medium text-amber-200">New API key</p>
                      <Button type="button" size="sm" variant="outline" onClick={handleCopyKey}>
                        {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                        {copied ? 'Copied' : 'Copy'}
                      </Button>
                    </div>
                    <code className="block overflow-x-auto rounded-md bg-neutral-950 p-3 text-sm text-amber-100">
                      {createdKey}
                    </code>
                  </div>
                )}

                <div className="rounded-lg border border-neutral-800 bg-neutral-950/40 p-4">
                  <div className="mb-3 flex items-center justify-between gap-4">
                    <div className="flex items-center gap-2 text-sm font-medium text-white">
                      <Activity className="h-4 w-4 text-primary-400" />
                      Today
                    </div>
                    <span className="text-sm text-neutral-300">
                      {activeUsage.used} / {activeUsage.quota} queries
                    </span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-neutral-800">
                    <div
                      className="h-full rounded-full bg-primary-400 transition-all"
                      style={{ width: `${usagePercent}%` }}
                    />
                  </div>
                </div>

                <div className="space-y-3">
                  {apiKeysQuery.isLoading ? (
                    <div className="flex items-center gap-2 text-sm text-neutral-400">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Loading keys...
                    </div>
                  ) : keys.length === 0 ? (
                    <p className="text-sm text-neutral-400">No API key created yet.</p>
                  ) : (
                    keys.map((key) => (
                      <div
                        key={key.id}
                        className="flex flex-col gap-3 rounded-lg border border-neutral-800 bg-neutral-950/40 p-4 sm:flex-row sm:items-center sm:justify-between"
                      >
                        <div>
                          <div className="flex items-center gap-2">
                            <p className="font-medium text-white">{key.name}</p>
                            <span className="rounded-full border border-neutral-700 px-2 py-0.5 text-xs text-neutral-300">
                              {key.status}
                            </span>
                          </div>
                          <p className="mt-1 font-mono text-xs text-neutral-500">
                            {key.key_prefix}...
                          </p>
                          <p className="mt-1 text-xs text-neutral-500">
                            Last used {key.last_used_at || 'never'}
                          </p>
                        </div>
                        {key.status === 'active' && (
                          <Button
                            type="button"
                            variant="destructive"
                            size="sm"
                            onClick={() => revokeApiKeyMutation.mutate(key.id)}
                            disabled={revokeApiKeyMutation.isPending}
                          >
                            <Trash2 className="h-4 w-4" />
                            Revoke
                          </Button>
                        )}
                      </div>
                    ))
                  )}
                </div>
              </CardContent>
            </Card>
          </motion.div>

          {/* Security */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4 }}
          >
            <Card>
              <CardHeader>
                <div className="flex items-center gap-3">
                  <Shield className="w-5 h-5 text-primary-400" />
                  <div>
                    <CardTitle>Security</CardTitle>
                    <CardDescription>Password and authentication settings</CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <p className="text-neutral-400 text-sm">
                  Sign-in, MFA, and password settings are managed through Berlayar identity.
                </p>
              </CardContent>
            </Card>
          </motion.div>

          {/* Note */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.5 }}
          >
            <Card className="bg-primary-500/10 border-primary-500/30">
              <CardContent className="p-6">
                <p className="text-sm text-primary-300">
                  <strong>Impact tracking:</strong> API searches record usage events and the artwork
                  IDs returned, so result exposure can be aggregated per artwork.
                </p>
              </CardContent>
            </Card>
          </motion.div>
        </div>
      </div>
    </div>
  );
}
