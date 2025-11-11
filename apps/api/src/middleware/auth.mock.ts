/**
 * Mock Authentication Middleware for Development
 * Provides a simple mock auth for Sprint 1 development
 * IMPORTANT: Replace with real auth (Cloudflare Access, Auth0, etc.) in production
 */

import type { Context, Next } from 'hono';
import type { Env } from '../index';

export interface AuthContext {
  userId: string;
  email: string;
  role: 'admin' | 'curator' | 'viewer';
  galleryId?: string;
}

/**
 * Mock authentication middleware
 * In development, accepts X-User-Id header or uses default test user
 * In production, this should be replaced with real auth
 */
export async function mockAuth(
  c: Context<{ Bindings: Env }>,
  next: Next
) {
  // Check environment
  const isDevelopment = c.env.ENVIRONMENT !== 'production';

  if (!isDevelopment) {
    // In production, reject requests without proper auth
    return c.json(
      {
        success: false,
        error: {
          code: 'AUTH_NOT_CONFIGURED',
          message: 'Authentication is not properly configured',
        },
      },
      500
    );
  }

  // Mock auth for development
  // Check for X-User-Id header first
  const userId = c.req.header('X-User-Id') || 'mock-user-dev-123';
  const email = c.req.header('X-User-Email') || 'dev@paillette.local';
  const role = (c.req.header('X-User-Role') as AuthContext['role']) || 'admin';

  // Store auth context in request context
  c.set('auth', {
    userId,
    email,
    role,
  });

  await next();
}

/**
 * Require authentication middleware
 * Returns 401 if no auth context exists
 */
export async function requireAuth(
  c: Context<{ Bindings: Env }>,
  next: Next
) {
  const auth = c.get('auth') as AuthContext | undefined;

  if (!auth) {
    return c.json(
      {
        success: false,
        error: {
          code: 'UNAUTHORIZED',
          message: 'Authentication required',
        },
      },
      401
    );
  }

  await next();
}

/**
 * Require specific role middleware
 */
export function requireRole(...roles: AuthContext['role'][]) {
  return async (c: Context<{ Bindings: Env }>, next: Next) => {
    const auth = c.get('auth') as AuthContext | undefined;

    if (!auth) {
      return c.json(
        {
          success: false,
          error: {
            code: 'UNAUTHORIZED',
            message: 'Authentication required',
          },
        },
        401
      );
    }

    if (!roles.includes(auth.role)) {
      return c.json(
        {
          success: false,
          error: {
            code: 'FORBIDDEN',
            message: `Requires one of: ${roles.join(', ')}`,
          },
        },
        403
      );
    }

    await next();
  };
}

/**
 * Helper to get auth context from request
 */
export function getAuth(c: Context<{ Bindings: Env }>): AuthContext | null {
  return c.get('auth') || null;
}
