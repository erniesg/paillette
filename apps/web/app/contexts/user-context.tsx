import {
  createContext,
  useContext,
  useState,
  useEffect,
  type ReactNode,
} from 'react';
import { useLogto, type UserInfoResponse } from '@logto/react';
import {
  getLogtoPostSignInUri,
  getLogtoPostSignOutUri,
  getLogtoRedirectUri,
} from '~/lib/logto';

interface User {
  id: string;
  email: string;
  name: string;
  avatar?: string;
}

type AuthRedirectOptions = {
  returnTo?: string;
};

interface UserContextType {
  user: User | null;
  isLoading: boolean;
  login: (options?: AuthRedirectOptions) => Promise<void>;
  logout: () => Promise<void>;
  resetPassword: (options?: AuthRedirectOptions) => Promise<void>;
  signup: (options?: AuthRedirectOptions) => Promise<void>;
  isAuthenticated: boolean;
  isLogtoConfigured: boolean;
  getAccessToken: (resource?: string) => Promise<string | undefined>;
}

const UserContext = createContext<UserContextType | undefined>(undefined);

const buildUser = (profile: UserInfoResponse): User => {
  const email = profile.email ?? '';
  const name =
    profile.name ??
    profile.username ??
    (email ? email.split('@')[0] : undefined) ??
    profile.sub;

  return {
    id: profile.sub,
    email,
    name,
    avatar: profile.picture ?? undefined,
  };
};

export function UserProvider({
  children,
  isLogtoConfigured,
  apiResource,
}: {
  children: ReactNode;
  isLogtoConfigured: boolean;
  apiResource?: string;
}) {
  const {
    fetchUserInfo,
    getAccessToken,
    isAuthenticated,
    isLoading: isLogtoLoading,
    signIn,
    signOut,
  } = useLogto();
  const [user, setUser] = useState<User | null>(null);
  const [isProfileLoading, setIsProfileLoading] = useState(false);

  useEffect(() => {
    if (!isAuthenticated) {
      setUser(null);
      return;
    }

    let isMounted = true;
    setIsProfileLoading(true);

    void fetchUserInfo()
      .then((profile) => {
        if (isMounted && profile) {
          setUser(buildUser(profile));
        }
      })
      .catch((error) => {
        console.error('Failed to fetch Logto user profile:', error);
        if (isMounted) {
          setUser(null);
        }
      })
      .finally(() => {
        if (isMounted) {
          setIsProfileLoading(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, [fetchUserInfo, isAuthenticated]);

  const ensureConfigured = () => {
    if (!isLogtoConfigured) {
      throw new Error('Logto is not configured for this environment.');
    }
  };

  const login = async (options: AuthRedirectOptions = {}) => {
    ensureConfigured();
    await signIn({
      redirectUri: getLogtoRedirectUri(),
      postRedirectUri: getLogtoPostSignInUri(options.returnTo),
    });
  };

  const logout = async () => {
    ensureConfigured();
    await signOut(getLogtoPostSignOutUri());
  };

  const signup = async (options: AuthRedirectOptions = {}) => {
    ensureConfigured();
    await signIn({
      redirectUri: getLogtoRedirectUri(),
      postRedirectUri: getLogtoPostSignInUri(options.returnTo),
      firstScreen: 'register',
    });
  };

  const resetPassword = async (options: AuthRedirectOptions = {}) => {
    ensureConfigured();
    await signIn({
      redirectUri: getLogtoRedirectUri(),
      postRedirectUri: getLogtoPostSignInUri(options.returnTo),
      firstScreen: 'reset_password',
      identifiers: ['email'],
    });
  };

  const getConfiguredAccessToken = (resource?: string) =>
    getAccessToken(resource || apiResource || undefined);

  return (
    <UserContext.Provider
      value={{
        user,
        isLoading: isLogtoLoading || isProfileLoading,
        login,
        logout,
        resetPassword,
        signup,
        isAuthenticated,
        isLogtoConfigured,
        getAccessToken: getConfiguredAccessToken,
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
