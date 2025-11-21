/**
 * Account Settings Page
 * User profile and settings management
 */

import type { MetaFunction } from '@remix-run/cloudflare';
import { Link } from '@remix-run/react';
import { motion } from 'framer-motion';
import { ArrowLeft, User, Mail, Shield } from 'lucide-react';
import { useUser } from '~/contexts/user-context';
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
  const { user } = useUser();

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
                  Email notification settings will be available soon.
                </p>
              </CardContent>
            </Card>
          </motion.div>

          {/* Security */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
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
                  Security settings will be available when authentication is fully implemented.
                </p>
              </CardContent>
            </Card>
          </motion.div>

          {/* Note */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4 }}
          >
            <Card className="bg-primary-500/10 border-primary-500/30">
              <CardContent className="p-6">
                <p className="text-sm text-primary-300">
                  <strong>Note:</strong> This is a demo account. Full account management features
                  will be available when authentication is fully implemented.
                </p>
              </CardContent>
            </Card>
          </motion.div>
        </div>
      </div>
    </div>
  );
}
