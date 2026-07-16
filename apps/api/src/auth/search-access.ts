export type SearchAccessMode = 'allowlist' | 'authenticated' | 'public';

export type ExternalIdentity = {
  provider: 'workos' | string;
  issuer: string;
  subject: string;
  email: string;
  emailVerified: boolean;
  name?: string;
};

export type SearchAccessDecision =
  | {
      granted: true;
      internalUserId: string | null;
      reason: 'approved' | 'authenticated' | 'public';
    }
  | {
      granted: false;
      status: 401 | 403;
      code:
        | 'AUTHENTICATION_REQUIRED'
        | 'ACCESS_PENDING'
        | 'IDENTITY_BINDING_REQUIRED';
    };

export interface SearchAccessRepository {
  findIdentityUserId(
    identity: Pick<ExternalIdentity, 'issuer' | 'subject'>
  ): Promise<string | null>;
  findUserIdByEmail(email: string): Promise<string | null>;
  bindIdentity(
    identity: ExternalIdentity,
    userId: string
  ): Promise<'created' | 'existing' | 'conflict'>;
  ensureIdentityUser(identity: ExternalIdentity): Promise<string>;
  hasActiveApproval(userId: string): Promise<boolean>;
}

const normalizeEmail = (email: string) => email.trim().toLowerCase();

const normalizeIssuer = (issuer: string) => issuer.trim().replace(/\/+$/, '');

const normalizeIdentity = (identity: ExternalIdentity): ExternalIdentity => ({
  ...identity,
  issuer: normalizeIssuer(identity.issuer),
  subject: identity.subject.trim(),
  email: normalizeEmail(identity.email),
});

export const parseSearchAccessMode = (
  value: string | undefined
): SearchAccessMode => {
  if (value === 'authenticated' || value === 'public') return value;
  return 'allowlist';
};

const decideForUser = async (
  repository: SearchAccessRepository,
  userId: string,
  mode: SearchAccessMode
): Promise<SearchAccessDecision> => {
  if (mode === 'authenticated') {
    return {
      granted: true,
      internalUserId: userId,
      reason: 'authenticated',
    };
  }

  if (await repository.hasActiveApproval(userId)) {
    return { granted: true, internalUserId: userId, reason: 'approved' };
  }

  return { granted: false, status: 403, code: 'ACCESS_PENDING' };
};

export const resolveSearchAccess = async (
  repository: SearchAccessRepository,
  rawIdentity: ExternalIdentity | null,
  mode: SearchAccessMode,
  bootstrapEmail: string
): Promise<SearchAccessDecision> => {
  if (mode === 'public') {
    return { granted: true, internalUserId: null, reason: 'public' };
  }

  if (!rawIdentity) {
    return {
      granted: false,
      status: 401,
      code: 'AUTHENTICATION_REQUIRED',
    };
  }

  const identity = normalizeIdentity(rawIdentity);
  const existingUserId = await repository.findIdentityUserId(identity);
  if (existingUserId) {
    return decideForUser(repository, existingUserId, mode);
  }

  const normalizedBootstrapEmail = normalizeEmail(bootstrapEmail);
  if (
    identity.emailVerified &&
    normalizedBootstrapEmail &&
    identity.email === normalizedBootstrapEmail
  ) {
    const bootstrapUserId =
      await repository.findUserIdByEmail(normalizedBootstrapEmail);
    if (bootstrapUserId) {
      const binding = await repository.bindIdentity(identity, bootstrapUserId);
      if (binding === 'conflict') {
        return {
          granted: false,
          status: 403,
          code: 'IDENTITY_BINDING_REQUIRED',
        };
      }

      return decideForUser(repository, bootstrapUserId, mode);
    }
  }

  const userId = await repository.ensureIdentityUser(identity);
  return decideForUser(repository, userId, mode);
};

type IdentityRow = { user_id: string };

export class D1SearchAccessRepository implements SearchAccessRepository {
  constructor(private readonly db: D1Database) {}

  async findIdentityUserId(
    identity: Pick<ExternalIdentity, 'issuer' | 'subject'>
  ) {
    const row = await this.db
      .prepare(
        `SELECT user_id FROM auth_identities WHERE issuer = ? AND subject = ?`
      )
      .bind(normalizeIssuer(identity.issuer), identity.subject.trim())
      .first<IdentityRow>();
    return row?.user_id ?? null;
  }

  async findUserIdByEmail(email: string) {
    const row = await this.db
      .prepare(`SELECT id AS user_id FROM users WHERE lower(email) = ?`)
      .bind(normalizeEmail(email))
      .first<IdentityRow>();
    return row?.user_id ?? null;
  }

  async bindIdentity(identity: ExternalIdentity, userId: string) {
    const normalized = normalizeIdentity(identity);
    const current = await this.findIdentityUserId(normalized);
    if (current) return current === userId ? 'existing' : 'conflict';

    const userBinding = await this.db
      .prepare(
        `SELECT user_id FROM auth_identities WHERE user_id = ? AND provider = ? LIMIT 1`
      )
      .bind(userId, normalized.provider)
      .first<IdentityRow>();
    if (userBinding) return 'conflict';

    await this.db
      .prepare(
        `
          INSERT INTO auth_identities (
            provider, issuer, subject, user_id, email, email_verified,
            created_at, updated_at, last_seen_at
          ) VALUES (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'), datetime('now'))
          ON CONFLICT(issuer, subject) DO NOTHING
        `
      )
      .bind(
        normalized.provider,
        normalized.issuer,
        normalized.subject,
        userId,
        normalized.email,
        normalized.emailVerified ? 1 : 0
      )
      .run();

    const winningUserId = await this.findIdentityUserId(normalized);
    return winningUserId === userId ? 'created' : 'conflict';
  }

  async ensureIdentityUser(identity: ExternalIdentity) {
    const normalized = normalizeIdentity(identity);
    const existing = await this.findIdentityUserId(normalized);
    if (existing) return existing;

    const userId = crypto.randomUUID();
    const emailOwner = await this.findUserIdByEmail(normalized.email);
    const storedEmail = emailOwner
      ? `${normalized.provider}+${normalized.subject}@identity.paillette.local`
      : normalized.email;
    const name = normalized.name?.trim() || normalized.email.split('@')[0];

    await this.db.batch([
      this.db
        .prepare(
          `
            INSERT INTO users (id, email, password_hash, name, role, last_login_at)
            VALUES (?, ?, 'external-identity', ?, 'viewer', datetime('now'))
          `
        )
        .bind(userId, storedEmail, name),
      this.db
        .prepare(
          `
            INSERT INTO auth_identities (
              provider, issuer, subject, user_id, email, email_verified,
              created_at, updated_at, last_seen_at
            ) VALUES (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'), datetime('now'))
          `
        )
        .bind(
          normalized.provider,
          normalized.issuer,
          normalized.subject,
          userId,
          normalized.email,
          normalized.emailVerified ? 1 : 0
        ),
    ]);

    return (await this.findIdentityUserId(normalized)) ?? userId;
  }

  async hasActiveApproval(userId: string) {
    const row = await this.db
      .prepare(
        `SELECT user_id FROM search_access_approvals WHERE user_id = ? AND status = 'active'`
      )
      .bind(userId)
      .first<IdentityRow>();
    return Boolean(row);
  }
}
