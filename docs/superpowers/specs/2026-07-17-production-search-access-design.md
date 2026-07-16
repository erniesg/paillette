# Production Search Access Design

## Goal

Protect Paillette production search data behind working authentication and explicit approval while keeping the public search page visually discoverable. Anonymous and unapproved visitors may see the search interface and synthetic blurred demo tiles, but no real artwork result, metadata, image URL, result count, cache payload, or asset response may reach their browser.

The first and only approved person is the account whose WorkOS-verified email is `hello@ernie.sg`. On that account's first successful login, Paillette binds the approval to the immutable WorkOS issuer and subject. Later authorization uses that external identity rather than email alone.

## Scope and rollout order

1. Introduce a provider-neutral authentication and authorization boundary.
2. Integrate WorkOS AuthKit for the web login/session flow and API token verification.
3. Gate every production search data path on server-side access policy.
4. Show synthetic blurred demo tiles and sign-in/access-pending calls to action without fetching real results.
5. Verify the complete behavior in staging.
6. Prepare a separate, approval-gated production cutover and rollback. Deployment, production secret entry, billing activation, and infrastructure changes are not part of the portable implementation lane.

## Access policy

Paillette exposes one server-side `SEARCH_ACCESS_MODE` with three valid values:

- `allowlist`: only authenticated identities with an active approval may receive real search data. This is the initial staging and production mode.
- `authenticated`: every valid logged-in user may receive real search data. Existing approvals remain stored but are not required while this mode is active.
- `public`: real public search is allowed. This mode is reserved for a later deliberate reopening and must not be selected during the initial rollout.

Production fails closed. A missing, empty, or invalid mode is treated as `allowlist`, never `public`. The mode is evaluated on the server for every protected request; client state cannot widen access.

## Identity and approval model

Paillette uses a stable internal user ID and stores provider identities separately. The identity record contains provider name, issuer, subject, normalized email, email-verification state, and binding timestamps. The approval record references the internal user, records active/revoked state, and includes audit timestamps.

The initial bootstrap rule is narrowly fixed to normalized email `hello@ernie.sg` with `email_verified = true`. On first login:

1. Verify the WorkOS token's issuer, signature, audience, expiry, subject, email, and email-verification claim.
2. Resolve or create the stable internal user.
3. If no external identity is already bound to the bootstrap approval, bind the WorkOS issuer and subject to it.
4. Once bound, ignore email matching for authorization. A different subject cannot inherit approval by presenting the same email.
5. Preserve the binding if the approved user later changes email.

The bootstrap path is idempotent and concurrency-safe. Ambiguous identity state fails closed and emits a security-safe audit event without token contents or personal data beyond the normalized approved email already present in configuration.

## Authentication architecture

The web application uses WorkOS AuthKit's server-supported React Router flow for sign in, sign up, callback, session refresh, sign out, and recovery. Staging and production use separate WorkOS environments, credentials, redirect URLs, cookie secrets, and API audiences.

The API accepts bearer access tokens and verifies them locally using configured issuer, JWKS URI, and audience. Authentication produces a provider-neutral principal containing the external issuer/subject and resolved internal user ID. Authorization then evaluates `SEARCH_ACCESS_MODE` and the approval record.

Personal Paillette API keys remain a separate authentication mechanism. They do not automatically grant public web search access; their existing API scopes and ownership behavior remain unchanged. The server-side public-search API key may only be used after the web proxy has authenticated and authorized the browser request.

## Protected data boundary

Protection applies to every route capable of revealing real search content, including:

- text, colour, and image search proxies;
- browse/infinite-scroll proxies;
- individual artwork detail routes and dialogs;
- asset/image content routes reachable from search responses;
- idle showcases, suggested-query prefetches, cached result reads, and usage payloads containing result metadata;
- NGS, NGA, collection, gallery, and alias routes that expose the same underlying records.

Each web proxy receives the user's WorkOS session or access token, resolves access server-side, and only then uses the internal public-search credential to call the API. Unauthorized requests return a typed access response and do not read or populate result caches. Cache keys and responses must not allow an unauthorized request to receive payloads created by an approved request.

Direct API routes enforce equivalent authorization so bypassing the web proxy does not reveal data. Asset URLs are not treated as protection by obscurity; protected assets require an authorized request or a short-lived, access-checked delivery mechanism.

## Public and pending experience

Anonymous visitors see the real search controls plus a fixed local set of synthetic demo tiles. The tiles contain no copied production titles, creators, accession numbers, thumbnails, color palettes, counts, or source links. Their appearance is intentionally blurred and labeled as a preview. Submitting a search asks the visitor to sign in and preserves a safe same-origin return path.

Authenticated but unapproved visitors see an `Access pending` state. The client stops all search, browse, prefetch, detail, asset, and result-usage requests. The server remains the decisive boundary if a modified client sends those requests anyway.

Approved visitors see the current full search experience. Switching `SEARCH_ACCESS_MODE` to `authenticated` makes the same full experience available to every authenticated user without a code change.

## Error handling

- Authentication provider unavailable: show `Sign-in is temporarily unavailable`; never fall back to public search or development headers.
- Missing or invalid access mode: enforce `allowlist` and record a configuration error.
- Valid login without approval in `allowlist`: return `403 ACCESS_PENDING`.
- Missing or invalid login: return `401 AUTHENTICATION_REQUIRED`.
- Identity bootstrap conflict: return `403 IDENTITY_BINDING_REQUIRED` and require operator review.
- WorkOS/JWKS failure during API verification: return `401` or `503` according to whether the token is invalid or verification infrastructure is unavailable; never disclose token details.
- Search backend failure after authorization: preserve the existing search error behavior without substituting synthetic tiles as if they were live results.

## Monitoring and audit evidence

Health monitoring distinguishes web availability, API health, WorkOS OIDC/JWKS availability, sign-in initiation, approval evaluation, canonical search-route availability, and one bounded approved-user search. Public health responses must not reveal the approved-user list.

Audit events cover access granted/denied, bootstrap identity binding, approval activation/revocation, and access-mode changes. Logs exclude bearer tokens, cookies, API keys, WorkOS secrets, and raw result payloads.

## Data migration and rollback

Before production cutover, inventory current Logto subjects and all references to `users.id`, including personal API keys, roles, quotas, usage, collections, and owned records. Introduce stable internal IDs/external identities without orphaning those records.

The production cutover keeps the prior Logto identity mapping available for rollback but disables Logto as the active login provider. Rollback restores the prior provider configuration without deleting WorkOS bindings or approval records. No production migration or deploy occurs without the repository's protected auth/deploy approval.

## Testing strategy

All behavior is developed test-first.

Unit tests cover access-mode parsing and fail-closed defaults, verified-email bootstrap, immutable subject binding, email-change behavior, conflicting subject rejection, and typed authorization decisions.

Route tests prove that anonymous and unapproved requests cannot trigger upstream search calls, cache reads/writes, detail fetches, asset delivery, prefetches, or result-bearing usage events. Approved requests work in `allowlist`; any authenticated request works in `authenticated`; `public` behavior remains explicit and separately tested.

UI tests prove that anonymous users see only synthetic tiles, unapproved users see `Access pending`, approved users see real results, and login return paths remain same-origin.

Staging end-to-end evidence covers sign in, callback, refresh, sign out, recovery, first binding for `hello@ernie.sg`, an approved search, an unapproved denial, anonymous network inspection showing no real result payload, and access-mode transition from `allowlist` to `authenticated`.

The repository's lint, type-check, test, build, and `scripts/agent-evidence` gates must pass before a release handoff.

## Explicit non-goals

- No admin approval UI in the first release; approvals are managed through a bounded operator workflow.
- No automatic approval based only on an unverified email or email domain.
- No CSS-only blur over real production results.
- No production deployment, secret entry, WorkOS billing activation, DNS change, or custom-domain purchase in the portable implementation lane.
- No replacement of personal API keys or the public-search proxy's internal service credential.
