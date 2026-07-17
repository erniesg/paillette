# Production Search Access Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable WorkOS account creation and gate production search/API data to approved accounts, initially only the verified `hello@ernie.sg` identity, while showing anonymous visitors synthetic blurred previews.

**Architecture:** WorkOS AuthKit owns hosted account creation and sessions. Paillette resolves WorkOS issuer/subject pairs to stable internal users, evaluates a fail-closed `SEARCH_ACCESS_MODE`, and enforces the decision inside API data routes and Remix server proxies before any real result or cache access. A one-time verified-email bootstrap binds `hello@ernie.sg` to its immutable WorkOS identity.

**Tech Stack:** Remix 2.17.5 on Cloudflare Workers, React 18, Hono, D1/SQLite, WorkOS AuthKit Remix 0.17.0, JOSE, Vitest, TypeScript.

## Global Constraints

- Initial production mode is `allowlist`; missing or invalid mode also resolves to `allowlist`.
- Initial bootstrap email is exactly `hello@ernie.sg`, normalized case-insensitively, and requires a verified WorkOS email.
- After first binding, authorization uses WorkOS issuer + subject; email alone cannot transfer approval.
- Anonymous and unapproved clients receive no real result metadata, image/asset URLs, counts, cache entries, prefetches, or result-bearing usage events.
- Later switching to `authenticated` admits all valid logged-in users without a code change.
- `public` exists only as an explicit future mode; it is never a default.
- Personal API keys only authorize data access when their owning internal user is approved in `allowlist` mode.
- No secrets, bearer tokens, cookies, or API keys are committed or logged.
- No deployment, production migration, dashboard mutation, billing activation, DNS change, or infrastructure apply occurs in the portable lane.

---

### Task 1: Stable identities, approvals, and fail-closed policy

**Files:**
- Create: `packages/database/migrations/0015_auth_identities_search_access.sql`
- Modify: `packages/database/src/schema.sql`
- Create: `apps/api/src/auth/search-access.ts`
- Create: `apps/api/tests/auth/search-access.test.ts`

**Interfaces:**
- Produces: `SearchAccessMode = 'allowlist' | 'authenticated' | 'public'`.
- Produces: `parseSearchAccessMode(value): SearchAccessMode` with `allowlist` fallback.
- Produces: `resolveSearchAccess(db, identity, mode, bootstrapEmail): Promise<SearchAccessDecision>`.
- `SearchAccessDecision` is `{ granted: true; internalUserId: string; reason: 'approved' | 'authenticated' | 'public' }` or `{ granted: false; status: 401 | 403; code: 'AUTHENTICATION_REQUIRED' | 'ACCESS_PENDING' | 'IDENTITY_BINDING_REQUIRED' }`.

- [ ] **Step 1: Write failing policy tests**

Add tests proving invalid/missing modes become `allowlist`, `authenticated` accepts any verified identity, and `public` is only selected explicitly.

```ts
expect(parseSearchAccessMode(undefined)).toBe('allowlist');
expect(parseSearchAccessMode('typo')).toBe('allowlist');
expect(parseSearchAccessMode('authenticated')).toBe('authenticated');
expect(parseSearchAccessMode('public')).toBe('public');
```

- [ ] **Step 2: Write failing binding tests**

Use a small in-memory D1-style fake to prove the first verified `hello@ernie.sg` identity binds, repeat login is idempotent, email changes retain access, an unverified email is pending, and a different subject with the same email gets `IDENTITY_BINDING_REQUIRED`.

- [ ] **Step 3: Run tests and verify RED**

Run: `pnpm --filter @paillette/api test -- tests/auth/search-access.test.ts`

Expected: FAIL because `apps/api/src/auth/search-access.ts` does not exist.

- [ ] **Step 4: Add migration and schema**

Create `auth_identities` keyed by `(issuer, subject)` and `search_access_approvals` keyed by stable `user_id`, with unique provider identity, status checks, timestamps, and indexes. Seed a deterministic internal bootstrap user for `hello@ernie.sg` plus its active approval, but seed no provider subject. The first verified login binds its WorkOS issuer and subject to that existing internal user transactionally.

- [ ] **Step 5: Implement minimal policy and binding transaction**

Normalize issuer and email, create a stable internal user ID rather than using provider subject, bind the bootstrap exactly once, and return typed decisions. Handle uniqueness conflicts by re-reading the winning binding and failing closed if it differs.

- [ ] **Step 6: Run focused and database tests**

Run: `pnpm --filter @paillette/api test -- tests/auth/search-access.test.ts && pnpm --filter @paillette/database test`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/database apps/api/src/auth/search-access.ts apps/api/tests/auth/search-access.test.ts
git commit -m "feat: add approved search identity policy"
```

---

### Task 2: Provider-neutral API authentication and approval enforcement

**Files:**
- Modify: `apps/api/src/index.ts`
- Modify: `apps/api/src/middleware/auth.ts`
- Create: `apps/api/tests/auth/workos-auth.test.ts`
- Modify: `apps/api/tests/routes/search.test.ts`
- Modify: `apps/api/tests/routes/color-search.test.ts`
- Modify: `apps/api/tests/routes/management-api.test.ts`

**Interfaces:**
- Consumes: `parseSearchAccessMode`, `resolveSearchAccess`.
- Produces: principal fields `externalIssuer`, `externalSubject`, `internalUserId`, `searchAccess`.
- Produces: `requireApprovedDataAccess` middleware.
- Environment: `AUTH_ISSUER`, `AUTH_JWKS_URI`, `AUTH_CLIENT_ID`, `SEARCH_ACCESS_MODE`, `SEARCH_ACCESS_BOOTSTRAP_EMAIL`.

- [ ] **Step 1: Write failing token and decision tests**

Generate local JOSE test keys and prove valid WorkOS-style JWTs authenticate; wrong issuer, `client_id`, signature, and expiry fail. Require namespaced email and email-verification JWT-template claims. Prove an authenticated but unapproved request returns `403 ACCESS_PENDING` and no route handler executes.

- [ ] **Step 2: Write failing personal API-key owner test**

Prove an API key whose owner lacks active approval is rejected in `allowlist`, while the same key works in `authenticated` and an approved owner's key works in `allowlist`.

- [ ] **Step 3: Run focused tests and verify RED**

Run: `pnpm --filter @paillette/api test -- tests/auth/workos-auth.test.ts tests/routes/search.test.ts tests/routes/color-search.test.ts`

Expected: FAIL because provider-neutral bindings and approval middleware do not exist.

- [ ] **Step 4: Refactor authentication names and JWT verification**

Replace active Logto-specific verifier/middleware names with provider-neutral equivalents. Verify issuer, client-specific JWKS, `client_id`, expiry, subject, and namespaced verified-email claims. Resolve the stable internal user and access decision before setting the Hono principal. Keep temporary `LOGTO_*` fallback only outside production and mark it for removal after cutover.

- [ ] **Step 5: Enforce approved data access**

Apply `requireApprovedDataAccess` to search, color search, artwork list/detail, and asset content routes. Health, OAuth metadata, login callbacks, and typed access-status endpoints remain public. Personal API keys resolve their owner before approval evaluation.

- [ ] **Step 6: Add `/api/v1/me/access`**

Return only `{ authenticated, access: 'approved' | 'pending', mode, user }` for a valid bearer session. Do not return the approval list or bootstrap configuration.

- [ ] **Step 7: Run API suite**

Run: `pnpm --filter @paillette/api test`

Expected: all API tests pass.

- [ ] **Step 8: Commit**

```bash
git add apps/api
git commit -m "feat: enforce approved API data access"
```

---

### Task 3: WorkOS AuthKit account creation and server sessions

**Files:**
- Modify: `apps/web/package.json`
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `apps/web/worker.ts`
- Modify: `apps/web/app/root.tsx`
- Create: `apps/web/app/lib/auth.server.ts`
- Create: `apps/web/app/lib/__tests__/auth.server.test.ts`
- Create: `apps/web/app/routes/auth.workos.login.ts`
- Create: `apps/web/app/routes/auth.workos.signup.ts`
- Create: `apps/web/app/routes/auth.workos.callback.ts`
- Create: `apps/web/app/routes/auth.workos.logout.ts`
- Modify: `apps/web/app/contexts/user-context.tsx`
- Modify: `apps/web/app/routes/auth.login.tsx`
- Modify: `apps/web/app/routes/auth.signup.tsx`
- Remove after replacement: `apps/web/app/components/auth/logto-callback.tsx`
- Remove after replacement: `apps/web/app/routes/api.logto.callback.tsx`
- Remove after replacement: `apps/web/app/routes/callback.tsx`

**Interfaces:**
- Environment: `WORKOS_API_KEY`, `WORKOS_CLIENT_ID`, `WORKOS_COOKIE_PASSWORD`, `WORKOS_REDIRECT_URI`.
- Produces: `getAuthSession(request, env)` returning user, access token, and session headers.
- Produces: login/signup/callback/logout routes using same-origin validated `returnTo`.
- Produces: root auth state `{ user, authenticated, access }`.

- [ ] **Step 1: Upgrade compatible Remix packages and install AuthKit**

Run:

```bash
pnpm --filter @paillette/web add @workos-inc/authkit-remix@0.17.0
pnpm --filter @paillette/web add @remix-run/cloudflare@2.17.5 @remix-run/react@2.17.5
pnpm --filter @paillette/web add -D @remix-run/dev@2.17.5
```

Update other direct Remix packages in the workspace to `2.17.5` so the lockfile contains one compatible line.

- [ ] **Step 2: Write failing session/security tests**

Test missing configuration, same-origin return paths, rejected cross-origin return paths, sign-up screen selection, callback error handling, secure cookie attributes in production, and redacted provider failures.

- [ ] **Step 3: Run tests and verify RED**

Run: `pnpm --filter @paillette/web test -- app/lib/__tests__/auth.server.test.ts`

Expected: FAIL because `auth.server.ts` does not exist.

- [ ] **Step 4: Implement AuthKit Remix routes and session helper**

Use `getSignInUrl`, `getSignUpUrl`, `authLoader`, and `authkitLoader` from `@workos-inc/authkit-remix`. Configure the SDK from Worker env inside request handling, preserve only same-origin return paths, and expose access tokens only to server loaders/actions.

- [ ] **Step 5: Replace Logto client context**

Root loader returns WorkOS session state and `/api/v1/me/access` result. User context becomes a provider-neutral view of loader data; login/signup/logout perform navigation to server routes and no provider token is stored in browser state.

- [ ] **Step 6: Verify Cloudflare compatibility**

Run: `pnpm --filter @paillette/web test && pnpm --filter @paillette/web typecheck && pnpm --filter @paillette/web build`

Expected: PASS with no Node builtin/runtime bundling errors.

- [ ] **Step 7: Commit**

```bash
git add package.json pnpm-lock.yaml apps/web
git commit -m "feat: add WorkOS account sessions"
```

---

### Task 4: Gate every Remix search proxy before cache/upstream access

**Files:**
- Modify: `apps/web/app/lib/public-search.server.ts`
- Modify: `apps/web/app/lib/__tests__/public-search.server.test.ts`
- Modify: `apps/web/app/routes/api.public-search.$orgId.text.ts`
- Modify: `apps/web/app/routes/api.public-search.$orgId.image.ts`
- Modify: `apps/web/app/routes/api.public-search.$orgId.browse.ts`
- Modify: `apps/web/app/routes/api.public-usage.$orgId.ts`
- Modify: `apps/web/app/routes/__tests__/public-search-text-route.test.ts`
- Create: `apps/web/app/routes/__tests__/public-search-access-routes.test.ts`

**Interfaces:**
- Consumes: `getAuthSession` and API `me/access` decision.
- Produces: `requireSearchAccess(request, context)` returning approved access token or typed `401/403` response.
- Produces: upstream headers using the user's bearer access token, not anonymous service-key authorization.

- [ ] **Step 1: Write failing no-leak route tests**

For anonymous and pending sessions, assert `401`/`403`, `fetch` not called, `caches.default.match` not called, `caches.default.put` not called, and usage logging not called across text, image, browse, and usage routes.

- [ ] **Step 2: Run tests and verify RED**

Run: `pnpm --filter @paillette/web test -- app/routes/__tests__/public-search-access-routes.test.ts app/routes/__tests__/public-search-text-route.test.ts`

Expected: FAIL because current routes call cache/upstream anonymously.

- [ ] **Step 3: Implement access-first proxy flow**

Resolve the server session before parsing query payloads or touching cache. Forward the server-held bearer token to API data routes. Return `Cache-Control: private, no-store` for denials and prevent approved payloads from entering a cache namespace reachable without an approved decision.

- [ ] **Step 4: Verify all proxy tests**

Run: `pnpm --filter @paillette/web test -- app/routes/__tests__/public-search-access-routes.test.ts app/routes/__tests__/public-search-text-route.test.ts app/lib/__tests__/public-search.server.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/lib/public-search.server.ts apps/web/app/lib/__tests__/public-search.server.test.ts apps/web/app/routes
git commit -m "feat: gate server search proxies"
```

---

### Task 5: Synthetic anonymous preview and pending UI

**Files:**
- Create: `apps/web/app/components/search/search-access-preview.tsx`
- Create: `apps/web/app/components/search/search-access-preview.test.tsx`
- Create: `apps/web/app/lib/search-access-preview.ts`
- Create: `apps/web/app/lib/__tests__/search-access-preview.test.ts`
- Modify: `apps/web/app/routes/galleries.$galleryId.search.tsx`
- Modify: `apps/web/app/routes/$orgId.search.tsx`
- Modify: `apps/web/app/routes/collections.$collectionId.search.tsx`
- Modify: `apps/web/app/routes/$orgId.artworks.$artworkId.tsx`
- Modify: `apps/web/app/routes/__tests__/search-masonry-layout.test.ts`

**Interfaces:**
- Produces: constant synthetic tiles containing only local labels and CSS gradients.
- Consumes: root auth state `anonymous | pending | approved`.

- [ ] **Step 1: Write failing preview tests**

Assert synthetic tile objects contain no `id`, `imageUrl`, `thumbnailUrl`, accession, source, artist, title copied from an artwork, or fetchable URL. Render tests assert anonymous state shows `Sign in to view results`, pending state shows `Access pending`, and neither mounts live result components.

- [ ] **Step 2: Run tests and verify RED**

Run: `pnpm --filter @paillette/web test -- app/components/search/search-access-preview.test.tsx app/lib/__tests__/search-access-preview.test.ts`

Expected: FAIL because preview modules do not exist.

- [ ] **Step 3: Implement synthetic tiles and client query shutdown**

Render six fixed gradient/shape tiles with blur and preview labels. Disable all React Query search, browse, idle-showcase, suggestion-prefetch, detail, asset, and usage calls unless access is approved. Search submission in anonymous state navigates to login with a same-origin return path; pending submission remains on the access screen.

- [ ] **Step 4: Protect detail entry points**

Anonymous and pending detail routes render the same gated state without fetching artwork data. Approved users retain current dialogs and detail pages.

- [ ] **Step 5: Run web suite**

Run: `pnpm --filter @paillette/web test && pnpm --filter @paillette/web typecheck`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/app/components/search apps/web/app/lib apps/web/app/routes
git commit -m "feat: show gated synthetic search preview"
```

---

### Task 6: Configuration contracts, migration proof, and release evidence

**Files:**
- Modify: `apps/api/wrangler.toml`
- Modify: `apps/web/wrangler.jsonc`
- Modify: `apps/api/tests/wrangler-config.test.ts`
- Create: `scripts/auth-access-smoke.mjs`
- Create: `scripts/__tests__/auth-access-smoke.test.mjs`
- Create: `docs/runbooks/workos-auth-cutover.md`
- Modify: `.agent/commands.yaml`

**Interfaces:**
- Produces: smoke command accepting base URLs and test credentials only through environment variables.
- Produces: cutover/rollback checklist with exact staging and production callback URLs.

- [ ] **Step 1: Write failing config and smoke tests**

Assert staging/production declare provider-neutral non-secret vars, `allowlist` mode, and `hello@ernie.sg` bootstrap; assert no API keys/cookie secrets appear in config. Smoke fixture tests cover anonymous denial without result payload, pending denial, approved search success, and health/auth dependency separation.

- [ ] **Step 2: Run tests and verify RED**

Run: `pnpm --filter @paillette/api test -- tests/wrangler-config.test.ts && node --test scripts/__tests__/auth-access-smoke.test.mjs`

Expected: FAIL because new config and smoke script are absent.

- [ ] **Step 3: Add non-secret config and runbook**

Set `SEARCH_ACCESS_MODE = "allowlist"` and `SEARCH_ACCESS_BOOTSTRAP_EMAIL = "hello@ernie.sg"`. Document WorkOS staging and production environment creation, callback/sign-out URLs, secret names, D1 migration backup/apply/verify/rollback, initial identity binding, later `authenticated` toggle, and Logto rollback. Do not include secret values.

- [ ] **Step 4: Implement safe smoke script**

Check web/API health, auth discovery, anonymous `401`, pending `403`, approved search `200`, and absence of real-result fields in denial bodies. Redact authorization headers from all output.

- [ ] **Step 5: Run complete validation**

Run:

```bash
pnpm run lint
pnpm run typecheck
pnpm run test
pnpm run build
scripts/agent-evidence
```

Expected: all required gates pass and `.agent/evidence/*/manifest.json` records success.

- [ ] **Step 6: Commit**

```bash
git add apps/api/wrangler.toml apps/web/wrangler.jsonc apps/api/tests/wrangler-config.test.ts scripts docs/runbooks .agent/commands.yaml
git commit -m "docs: add WorkOS auth cutover evidence"
```

---

### Task 7: Protected staging and production activation

**Files:**
- No repository file changes expected unless live verification finds a defect.

**Interfaces:**
- Consumes: WorkOS dashboard, Cloudflare secret store, D1 migration tooling, deploy workflow, and `scripts/auth-access-smoke.mjs`.

- [ ] **Step 1: Obtain explicit deploy/auth approval**

Record approval before dashboard, secrets, D1, deploy, rollback, DNS, billing, or infrastructure actions.

- [ ] **Step 2: Configure WorkOS staging**

Create the staging application, enable account creation, configure `https://paillette-stg.berlayar.ai/auth/workos/callback` and staging sign-out URL, and place secret values only in the approved staging secret store.

- [ ] **Step 3: Back up and migrate staging D1**

Capture a restorable backup, apply migration `0015`, verify identity/approval tables, and leave `SEARCH_ACCESS_MODE=allowlist`.

- [ ] **Step 4: Deploy and verify staging**

Run the live smoke plus browser evidence for anonymous synthetic preview, account creation, first `hello@ernie.sg` binding, approved search/API access, and a second unapproved account denial.

- [ ] **Step 5: Configure and migrate production**

After staging evidence is accepted, create the separate WorkOS production application, add billing details required by WorkOS, configure `https://paillette.berlayar.ai/auth/workos/callback`, store production secrets, back up production D1, and apply migration `0015`.

- [ ] **Step 6: Deploy and verify production**

Use the protected production workflow. Prove account creation, `hello@ernie.sg` binding, approved search and personal API access, anonymous synthetic-only network behavior, unapproved denial, and rollback readiness.

- [ ] **Step 7: Close incident only after live proof**

Update issue #38 with the exact deployed revision, evidence manifest, redacted smoke output, WorkOS environment separation, D1 migration proof, and remaining decision on custom domain/SLA.
