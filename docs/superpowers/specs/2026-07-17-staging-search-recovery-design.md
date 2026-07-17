# Staging Search Recovery Design

## Scope

Restore authenticated artwork images, make colour selection refine an active
text query, and make the API docs open on a runnable search workflow.

## Authenticated artwork images

Artwork metadata continues to contain canonical API asset URLs. The web app
must convert those URLs to its existing same-origin `/api/backend/*` proxy
before assigning them to `img` elements. The proxy validates the WorkOS web
session, forwards the bearer token to the API, and streams the upstream body and
image content type. Anonymous and unapproved users must not gain a public asset
URL as a side effect of this fix.

The conversion applies only to asset URLs on the configured Paillette API
origin. External catalogue URLs and unrelated URLs are not rewritten.

## Additive colour refinement

Selecting a colour while a text query is active keeps the committed text query
and adds the colour as a visual refinement. Text retrieval remains the candidate
set; colour similarity re-ranks those candidates. There is no colour threshold
that removes candidates.

The URL retains both `q` and the colour parameter. The search control and active
state show both the text query and colour chip. Clearing colour restores the
same text search. Starting from an empty query may still run the existing
colour-only search.

## Search-first API docs

The docs landing content presents a compact "Try search" console before the
long-form authentication reference. It defaults to staging and the primary text
search endpoint, accepts a query, uses the API key already created or pasted in
the top bar, and shows status plus formatted JSON inline.

Authentication remains documented once in the reference and in concise
endpoint badges. Repeated scope prose must not obscure the runnable request.
The existing endpoint reference, generated code samples, REST routes, and MCP
documentation remain available.

## Error handling

- Image proxy responses preserve upstream status and content type and remain
  private/no-store.
- Missing or invalid sessions return the existing structured auth errors.
- The API playground reports missing keys and API errors next to the run control.
- Colour refinement falls back to the existing text ranking if colour scoring
  is unavailable rather than discarding the text results.

## Verification

- Unit tests prove API asset URLs are rewritten to the authenticated web proxy
  and unrelated URLs are unchanged.
- Route tests prove image bytes/content type and auth failures are preserved.
- Search state tests prove `q` survives colour selection and clearing colour
  restores text-only search.
- Docs tests prove the landing page exposes a runnable text-query control and
  avoids duplicating the full authentication explanation.
- Staging smoke tests verify rendered images, additive text-plus-colour results,
  authenticated REST search, MCP tools/list, and anonymous/unapproved denial.
