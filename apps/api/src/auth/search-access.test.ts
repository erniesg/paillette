import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import type { DatabaseSync as NodeDatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import {
  D1SearchAccessRepository,
  resolveSearchAccess,
  type SearchAccessRepository,
} from './search-access';

const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as {
  DatabaseSync: typeof NodeDatabaseSync;
};

const readMigration = (name: string) =>
  readFileSync(
    new URL(`../../../../packages/database/migrations/${name}`, import.meta.url),
    'utf8'
  );

const d1For = (sqlite: NodeDatabaseSync) =>
  ({
    prepare(sql: string) {
      const statement = sqlite.prepare(sql);
      let params: unknown[] = [];
      return {
        bind(...values: unknown[]) {
          params = values;
          return this;
        },
        async first<T>() {
          return (statement.get(...(params as never[])) as T | undefined) ?? null;
        },
        async all<T>() {
          return {
            success: true,
            results: statement.all(...(params as never[])) as T[],
          };
        },
      };
    },
  }) as unknown as D1Database;

const externalIdentity = {
  provider: 'workos',
  issuer: 'https://issuer.example',
  subject: 'workos-user',
  email: 'HELLO@ERNIE.SG',
  emailVerified: true,
};

describe('WorkOS email identity binding', () => {
  it('reports a case-variant duplicate email lookup as ambiguous', async () => {
    const sqlite = new DatabaseSync(':memory:');
    sqlite.exec(readMigration('0001_initial_schema.sql'));
    sqlite.prepare(
      "INSERT INTO users (id, email, password_hash, name, role) VALUES (?, ?, 'x', 'User', 'viewer')"
    ).run('first-user', 'hello@ernie.sg');
    sqlite.prepare(
      "INSERT INTO users (id, email, password_hash, name, role) VALUES (?, ?, 'x', 'User', 'viewer')"
    ).run('second-user', 'HELLO@ERNIE.SG');

    const repository = new D1SearchAccessRepository(d1For(sqlite));
    await expect(repository.findUserIdByEmail('hello@ernie.sg')).resolves.toBe(
      'ambiguous'
    );
    sqlite.close();
  });

  it('does not bind an external identity when the bootstrap email is ambiguous', async () => {
    let bindAttempts = 0;
    const repository: SearchAccessRepository = {
      async findIdentityUserId() { return null; },
      async findUserIdByEmail() { return 'ambiguous'; },
      async bindIdentity() {
        bindAttempts += 1;
        return 'created';
      },
      async ensureIdentityUser() { return 'new-user'; },
      async hasActiveApproval() { return true; },
    };

    await expect(
      resolveSearchAccess(repository, externalIdentity, 'authenticated', 'hello@ernie.sg')
    ).resolves.toEqual({
      granted: false,
      status: 403,
      code: 'IDENTITY_BINDING_REQUIRED',
    });
    expect(bindAttempts).toBe(0);
  });

  it('accepts the same user when a concurrent binding already won the race', async () => {
    let ensured = false;
    const repository: SearchAccessRepository = {
      async findIdentityUserId() { return null; },
      async findUserIdByEmail() { return 'bootstrap-user'; },
      async bindIdentity() { return 'existing'; },
      async ensureIdentityUser() {
        ensured = true;
        return 'new-user';
      },
      async hasActiveApproval(userId) { return userId === 'bootstrap-user'; },
    };

    await expect(
      resolveSearchAccess(repository, externalIdentity, 'authenticated', 'hello@ernie.sg')
    ).resolves.toEqual({
      granted: true,
      internalUserId: 'bootstrap-user',
      reason: 'authenticated',
    });
    expect(ensured).toBe(false);
  });

  it('migration 0017 rejects future case-variant user emails without changing bootstrap rows', () => {
    const sqlite = new DatabaseSync(':memory:');
    sqlite.exec(readMigration('0001_initial_schema.sql'));
    sqlite.exec(readMigration('0017_workos_auth_identities_search_access.sql'));

    expect(
      sqlite
        .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = ?")
        .get('uq_users_email_casefold')
    ).toEqual({ name: 'uq_users_email_casefold' });
    expect(() =>
      sqlite.prepare(
        "INSERT INTO users (id, email, password_hash, name, role) VALUES (?, ?, 'x', 'User', 'viewer')"
      ).run('case-variant-user', 'HELLO@ERNIE.SG')
    ).toThrow();
    expect(
      sqlite
        .prepare('SELECT id, email, role FROM users WHERE id = ?')
        .get('user-bootstrap-hello-ernie-sg')
    ).toEqual({
      id: 'user-bootstrap-hello-ernie-sg',
      email: 'hello@ernie.sg',
      role: 'admin',
    });
    sqlite.close();
  });
});
