# WorkOS AuthKit cutover

This runbook configures Paillette's fail-closed WorkOS sessions without storing secret values in Git.

## Required WorkOS environments

Use one WorkOS project with its built-in, fully isolated staging and production
environments. Configure the default AuthKit application in each environment;
their API keys, client IDs, users, redirect URIs, and branding do not carry
over automatically.

| Environment | Callback URL | Post-logout URL |
| --- | --- | --- |
| Staging | `https://paillette-stg.berlayar.ai/callback` | `https://paillette-stg.berlayar.ai/` |
| Production | `https://paillette.berlayar.ai/callback` | `https://paillette.berlayar.ai/` |

Enable account creation and email verification. Configure the access-token JWT template with these claims:

```json
{
  "https://paillette.berlayar.ai/claims/email": {{ user.email }},
  "https://paillette.berlayar.ai/claims/email_verified": {{ user.email_verified }}
}
```

The API rejects tokens that omit either claim and only uses a verified email for the one-time bootstrap binding.

AuthKit's hosted sign-in page owns password recovery. From Paillette, open
`/auth/login`, choose **Reset password**, enter the account email, and follow
the emailed WorkOS link. Operators must never receive, enter, or store the new
password. The reset response is deliberately non-enumerating: it reports that
instructions will arrive if the account exists.

## Worker bindings

Web Worker, per environment:

- `WORKOS_CLIENT_ID`
- `WORKOS_REDIRECT_URI`
- secret `WORKOS_API_KEY`
- secret `WORKOS_COOKIE_PASSWORD` (at least 32 random characters)

API Worker, per environment:

- `AUTH_CLIENT_ID` = the matching WorkOS client ID
- `AUTH_ISSUER` = the exact `iss` value from that application's access token
- `AUTH_JWKS_URI` = `https://api.workos.com/sso/jwks/<WORKOS_CLIENT_ID>`
- `SEARCH_ACCESS_MODE` = `allowlist`
- `SEARCH_ACCESS_BOOTSTRAP_EMAIL` = `hello@ernie.sg`

Never put the WorkOS API key, cookie password, access token, refresh token, or user session cookie in source, shell history, logs, issues, or deployment output.

## Database migration

Before applying `0015_auth_identities_search_access.sql`, capture a restorable D1 export for the target environment. Apply and verify the migration before deploying either Worker.

Verification queries:

```sql
SELECT name FROM sqlite_master
WHERE type = 'table'
  AND name IN ('auth_identities', 'search_access_approvals');

SELECT u.email, a.status
FROM users u
JOIN search_access_approvals a ON a.user_id = u.id
WHERE lower(u.email) = 'hello@ernie.sg';
```

The first successful login with verified `hello@ernie.sg` binds the seeded internal user to the immutable WorkOS issuer and subject. A different subject cannot claim that user after binding.

## Deployment order

1. Configure the staging WorkOS application and bindings.
2. Back up staging D1 and apply migration `0015`.
3. Deploy API staging, then web staging.
4. Verify anonymous, pending, approved, refresh, logout, and direct-API scenarios.
5. Repeat the backup/migration/API/web sequence for production under protected deployment approval.

Do not deploy the web Worker before the API Worker and migration are ready: the web app intentionally treats an unconfirmed account as pending.

## Smoke matrix

| Scenario | Expected result |
| --- | --- |
| Anonymous text/image/browse search | Synthetic locked tiles; no upstream data/cache read |
| Anonymous `/api/backend/*` | `401 AUTHENTICATION_REQUIRED` |
| Signed-in, unapproved account | `403 ACCESS_PENDING`; pending UI |
| Verified `hello@ernie.sg` first login | Identity binds once; real results available |
| Approved account after email change | Access remains bound to issuer + subject |
| Wrong issuer/client/signature/expired token | `401` |
| Health and OAuth discovery | Public |

## API and MCP compatibility

The WorkOS cutover does not change the API or MCP transport URLs:

- REST API: `https://paillette-api-stg.berlayar.ai/api/v1` in staging and
  `https://paillette-api.berlayar.ai/api/v1` in production.
- MCP: `POST /api/v1/mcp` using streamable HTTP JSON-RPC.
- OAuth discovery: `GET /.well-known/oauth-protected-resource` and
  `GET /.well-known/oauth-protected-resource/api/v1/mcp`.

Both WorkOS bearer tokens and existing personal Paillette API keys continue to
authenticate API and MCP requests. Authorization is now evaluated after
authentication: in `allowlist` mode, the WorkOS identity or API-key owner must
have an active approval; in `authenticated` mode, any valid signed-in WorkOS
identity or personal API-key owner is accepted. Anonymous MCP requests retain a
`401` response with `WWW-Authenticate` resource metadata and the required
`mcp:read` scope.

Minimum redacted live checks:

```bash
curl -fsS https://paillette-api-stg.berlayar.ai/health
curl -fsS https://paillette-api-stg.berlayar.ai/.well-known/oauth-protected-resource
curl -sS -i https://paillette-api-stg.berlayar.ai/api/v1/mcp \
  -H 'Content-Type: application/json' \
  --data '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

The final command must return `401 AUTHENTICATION_REQUIRED` without a
credential. Repeat it with either `Authorization: Bearer <token>` or
`X-API-Key: <personal-key>` only from a trusted shell; never paste the
credential into docs, screenshots, issues, or command output.

After the approved account signs in, verify all of the following before
production promotion:

1. `/api/v1/me/access` reports `access: "approved"`.
2. A bounded web search returns real results.
3. A bounded REST search returns `200` with the normal rate-limit headers.
4. MCP `initialize` and `tools/list` return JSON-RPC success.
5. A second signed-in but unapproved identity receives `403 ACCESS_PENDING`
   from both REST and MCP and cannot cause result/cache/usage writes.

## Later open-to-members toggle

Set `SEARCH_ACCESS_MODE=authenticated` on the API Worker to allow every valid signed-in WorkOS account. No code change or approval-row migration is required. Set it back to `allowlist` to restore explicit approval enforcement.
