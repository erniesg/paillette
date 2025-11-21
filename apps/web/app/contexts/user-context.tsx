/**
 * User Context
 * Manages user authentication state (mock implementation for now)
 */

import { createContext, useContext, useState, useEffect, type ReactNode } from 'react';

interface User {
  id: string;
  email: string;
  name: string;
  avatar?: string;
}

interface UserContextType {
  user: User | null;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  signup: (email: string, password: string, name: string) => Promise<void>;
}

const UserContext = createContext<UserContextType | undefined>(undefined);

export function UserProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Load user from localStorage on mount
  useEffect(() => {
    const storedUser = localStorage.getItem('paillette_user');
    if (storedUser) {
      try {
        setUser(JSON.parse(storedUser));
      } catch (e) {
        console.error('Failed to parse stored user:', e);
      }
    }
    setIsLoading(false);
  }, []);

  const login = async (email: string, password: string) => {
    // Mock login - in production, this would call your auth API
    await new Promise((resolve) => setTimeout(resolve, 500)); // Simulate network delay

    const mockUser: User = {
      id: 'mock-user-id',
      email,
      name: email.split('@')[0], // Use email prefix as name
      avatar: `https://ui-avatars.com/api/?name=${encodeURIComponent(email)}&background=random`,
    };

    setUser(mockUser);
    localStorage.setItem('paillette_user', JSON.stringify(mockUser));
  };

  const logout = () => {
    setUser(null);
    localStorage.removeItem('paillette_user');
  };

  const signup = async (email: string, password: string, name: string) => {
    // Mock signup - in production, this would call your auth API
    await new Promise((resolve) => setTimeout(resolve, 500)); // Simulate network delay

    const mockUser: User = {
      id: 'mock-user-id',
      email,
      name,
      avatar: `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=random`,
    };

    setUser(mockUser);
    localStorage.setItem('paillette_user', JSON.stringify(mockUser));
  };

  return (
    <UserContext.Provider value={{ user, isLoading, login, logout, signup }}>
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
