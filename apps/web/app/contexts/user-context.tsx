import { createContext, useContext, type ReactNode } from 'react';

interface User {
  id: string;
  email: string;
  name: string;
  avatar?: string;
}

type AuthRedirectOptions = { returnTo?: string };

interface UserContextType {
  user: User | null;
  isLoading: boolean;
  login: (options?: AuthRedirectOptions) => Promise<void>;
  logout: () => Promise<void>;
  resetPassword: (options?: AuthRedirectOptions) => Promise<void>;
  signup: (options?: AuthRedirectOptions) => Promise<void>;
  isAuthenticated: boolean;
  isWorkOSConfigured: boolean;
  searchAccess: 'anonymous' | 'pending' | 'approved';
  getAccessToken: () => Promise<string | undefined>;
}

const UserContext = createContext<UserContextType | undefined>(undefined);

export function UserProvider({
  children,
  initialUser,
  isWorkOSConfigured,
  searchAccess,
}: {
  children: ReactNode;
  initialUser: {
    id: string;
    email: string;
    firstName?: string | null;
    lastName?: string | null;
    profilePictureUrl?: string | null;
  } | null;
  isWorkOSConfigured: boolean;
  searchAccess: 'anonymous' | 'pending' | 'approved';
}) {
  const user: User | null = initialUser
    ? {
        id: initialUser.id,
        email: initialUser.email,
        name:
          [initialUser.firstName, initialUser.lastName]
            .filter(Boolean)
            .join(' ') ||
          initialUser.email.split('@')[0] ||
          initialUser.id,
        avatar: initialUser.profilePictureUrl ?? undefined,
      }
    : null;

  const ensureConfigured = () => {
    if (!isWorkOSConfigured) {
      throw new Error('WorkOS is not configured for this environment.');
    }
  };

  const startAuth = (screen: 'sign-in' | 'sign-up', returnTo?: string) => {
    ensureConfigured();
    const params = new URLSearchParams({ screen });
    if (returnTo) params.set('returnTo', returnTo);
    window.location.assign(`/auth/start?${params.toString()}`);
  };

  const login = async (options: AuthRedirectOptions = {}) => {
    startAuth('sign-in', options.returnTo);
  };

  const logout = async () => {
    ensureConfigured();
    const form = document.createElement('form');
    form.method = 'post';
    form.action = '/auth/logout';
    document.body.appendChild(form);
    form.submit();
  };

  const signup = async (options: AuthRedirectOptions = {}) => {
    startAuth('sign-up', options.returnTo);
  };

  const resetPassword = async (options: AuthRedirectOptions = {}) => {
    startAuth('sign-in', options.returnTo);
  };

  return (
    <UserContext.Provider
      value={{
        user,
        isLoading: false,
        login,
        logout,
        resetPassword,
        signup,
        isAuthenticated: Boolean(user),
        isWorkOSConfigured,
        searchAccess,
        // Browser requests use a same-origin proxy; tokens never reach JS.
        getAccessToken: async () =>
          user ? 'same-origin-workos-session' : undefined,
      }}
    >
      {children}
    </UserContext.Provider>
  );
}

export function useUser() {
  const context = useContext(UserContext);
  if (context === undefined) {
    throw new Error('useUser must be used within a UserProvider');
  }
  return context;
}
