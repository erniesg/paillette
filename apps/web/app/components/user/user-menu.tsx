/**
 * User Menu Component
 * Dropdown menu in top-right corner for user auth/profile
 */

import { useState, useRef, useEffect } from 'react';
import { Link } from '@remix-run/react';
import { motion, AnimatePresence } from 'framer-motion';
import { User, Settings, LogOut, LogIn, UserPlus, LayoutDashboard } from 'lucide-react';
import { useUser } from '~/contexts/user-context';
import { Button } from '~/components/ui/button';

export function UserMenu() {
  const { user, logout } = useUser();
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isOpen]);

  const handleLogout = () => {
    logout();
    setIsOpen(false);
  };

  return (
    <div className="relative" ref={menuRef}>
      {/* User Avatar/Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-neutral-800/50 transition-colors"
      >
        {user ? (
          <>
            {/* User Avatar */}
            <div className="w-8 h-8 rounded-full bg-gradient-accent flex items-center justify-center text-white font-semibold text-sm">
              {user.name.charAt(0).toUpperCase()}
            </div>
            <span className="hidden sm:inline text-sm font-medium text-white">
              {user.name}
            </span>
          </>
        ) : (
          <>
            {/* Login Icon */}
            <div className="w-8 h-8 rounded-full bg-neutral-800 flex items-center justify-center text-neutral-400">
              <User className="w-4 h-4" />
            </div>
            <span className="hidden sm:inline text-sm text-neutral-400">
              Sign In
            </span>
          </>
        )}
      </button>

      {/* Dropdown Menu */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: -10, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -10, scale: 0.95 }}
            transition={{ duration: 0.15 }}
            className="absolute right-0 mt-2 w-64 bg-neutral-900 border border-neutral-800 rounded-lg shadow-xl overflow-hidden z-50"
          >
            {user ? (
              /* Logged In Menu */
              <>
                {/* User Info */}
                <div className="px-4 py-3 border-b border-neutral-800">
                  <p className="text-sm font-medium text-white">{user.name}</p>
                  <p className="text-xs text-neutral-400 truncate">{user.email}</p>
                </div>

                {/* Menu Items */}
                <div className="py-2">
                  <Link
                    to="/galleries"
                    onClick={() => setIsOpen(false)}
                    className="flex items-center gap-3 px-4 py-2 hover:bg-neutral-800/50 transition-colors text-neutral-300 hover:text-white"
                  >
                    <LayoutDashboard className="w-4 h-4" />
                    <span className="text-sm">My Galleries</span>
                  </Link>
                  <Link
                    to="/account/settings"
                    onClick={() => setIsOpen(false)}
                    className="flex items-center gap-3 px-4 py-2 hover:bg-neutral-800/50 transition-colors text-neutral-300 hover:text-white"
                  >
                    <Settings className="w-4 h-4" />
                    <span className="text-sm">Account Settings</span>
                  </Link>
                </div>

                {/* Logout */}
                <div className="border-t border-neutral-800 py-2">
                  <button
                    onClick={handleLogout}
                    className="flex items-center gap-3 px-4 py-2 w-full hover:bg-neutral-800/50 transition-colors text-neutral-300 hover:text-red-400"
                  >
                    <LogOut className="w-4 h-4" />
                    <span className="text-sm">Sign Out</span>
                  </button>
                </div>
              </>
            ) : (
              /* Logged Out Menu */
              <div className="py-2">
                <Link
                  to="/auth/login"
                  onClick={() => setIsOpen(false)}
                  className="flex items-center gap-3 px-4 py-3 hover:bg-neutral-800/50 transition-colors text-neutral-300 hover:text-white"
                >
                  <LogIn className="w-4 h-4" />
                  <span className="text-sm font-medium">Sign In</span>
                </Link>
                <Link
                  to="/auth/signup"
                  onClick={() => setIsOpen(false)}
                  className="flex items-center gap-3 px-4 py-3 hover:bg-neutral-800/50 transition-colors text-neutral-300 hover:text-white"
                >
                  <UserPlus className="w-4 h-4" />
                  <span className="text-sm font-medium">Create Account</span>
                </Link>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
