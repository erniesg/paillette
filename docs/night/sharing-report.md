# Sharing lane — report

Branch `night/sharing`, cut from `night/integration`.

**A real, working, cold-openable short link on staging:**

> ## https://paillette-stg.berlayar.ai/e/MKwsxHy

Six works, four agent-written labels, opened in a browser profile with no
session, no cookies and no local storage. Screenshot:
`docs/night/shots/share-cold-open.png`.

---

## 1. What was actually wrong

### `/exhibition` 404 on staging — not what the brief thought

The brief says `/exhibition` returned 404 on staging and that a share feature
whose target does not resolve is not a feature. Both true, but the cause was
not a deploy or routing fault. Measured before touching anything:

| Request | Before |
| --- | --- |
| `GET /exhibition` | **404** |
| `GET /exhibition?e=<valid payload>` | **200**, with correct `og:title`, `og:description`, `og:image` |

The route was deployed and working the whole time. The 404 was its own
no-parameter branch — `if (!encoded) throw new Response('Not found', {status: 404})`.
Correct status code, useless page: the only person who lands on a bare
`/exhibition` is someone whose link lost its query string passing through a
chat client, and a dead end tells them nothing.

It now `302`s to `/nga/search`. Verified on staging:
`status=302 location=https://paillette-stg.berlayar.ai/nga/search`.

### The clipboard bug

`share-link.tsx` threw when `navigator.clipboard` was missing. The catch set
`state = 'failed'` but — in the version the brief describes — the label never
read that state, so the human clicked and nothing happened.

By the time this lane branched, `night/integration` already had the label
reading `'Copy failed'`, so `share-link.test.tsx` was **passing** when I
started, not failing. The word alone is still not a fix: it says the copy
failed and gives no way to get the link. There is now a visible, focused,
pre-selected read-only field containing the URL, so it can be copied by hand —
which is what the brief asked for. It does not clear on a timer; clearing it
out from under someone mid-drag is the original bug in another coat.

---

## 2. Schema

`packages/database/migrations/0022_shareable_exhibitions.sql`, applied to
staging D1 (`paillette-db-stg`). It was the only pending migration.

```sql
CREATE TABLE IF NOT EXISTS exhibitions (
  code               TEXT PRIMARY KEY,
  collection_id      TEXT NOT NULL,
  title              TEXT,
  statement          TEXT,
  title_by_agent     INTEGER NOT NULL DEFAULT 0 CHECK (title_by_agent IN (0,1)),
  statement_by_agent INTEGER NOT NULL DEFAULT 0 CHECK (statement_by_agent IN (0,1)),
  works              TEXT NOT NULL,   -- [{artworkId, label, labelByAgent}], hanging order
  created_at         TEXT NOT NULL DEFAULT (datetime('now')),
  view_count         INTEGER NOT NULL DEFAULT 0 CHECK (view_count >= 0)
);
CREATE INDEX IF NOT EXISTS idx_exhibitions_created_at ON exhibitions (created_at);
```

Two decisions worth stating:

- **`works` is JSON, not a child table.** A hang is read whole, written once,
  and never queried across — nobody asks "which exhibitions contain this
  artwork". A row per work buys an index nothing uses and costs a join on the
  one read path that matters. Order is array order; there is no sequence
  column because the array already is one.
- **No owner column.** The whole NGA surface is anonymous, so there is no
  account to hang a show off. See §6 on what that costs.

Storing server-side removes both problems `HANDOFF.md` §5.4 flagged: the ~60-id
URL cap (now a deliberate 24-work editorial cap, not a transport limit) and the
session-resolvability problem — the ids are resolved server-side against the
public catalogue either way, but now nothing about that is encoded in the URL.

---

## 3. Short codes

`packages/types/src/share-codes.ts` — in `@paillette/types` because the API and
the web loader both need the same answer to "is this a code", and two copies of
an alphabet is a bug waiting for someone to edit one.

- **57 characters**: base62 minus `0 O 1 l I`. Seven long → 57⁷ ≈ 1.95 × 10¹².
- **Rejection-sampled** from `crypto.getRandomValues`. 256 is not a multiple of
  57, so a plain modulo would make the first 28 characters come up 5/4 as often
  as the rest. Tested with a uniformity check over 70,000 characters.
- **Collisions retry** five times, then 503.

Three deliberate deviations from the obvious implementation, each with a test:

1. **It does not repair ambiguous glyphs.** My first draft mapped a typed `O`
   onto its intended neighbour. That is actively wrong here: only `0 O 1 l I`
   were dropped, so **lowercase `o` and `i` are valid characters** — the
   "repair" would have silently handed the visitor a different curator's show.
   A mistype now fails validation and they are told the link is wrong.
2. **It does not truncate.** Clipping an over-long string to eight characters
   turns `abcdefghi` into `abcdefgh` — valid, and somebody else's. Length is a
   validation question.
3. **It does not case-fold**, which the brief's word "normalise (case-fold,
   trim)" asks for. The alphabet is mixed-case base62, so folding would collapse
   `aB3xk9m` and `Ab3Xk9M` and cut the keyspace to ~4 × 10¹⁰. Case is carried
   exactly as generated. Normalisation is trim plus stripping the punctuation a
   link picks up in a chat client (`<…>`, a trailing full stop, stray quotes).

Both API 404 paths — malformed code and unknown code — return an identical
`NOT_FOUND`. A `400` for "not a code" and a `404` for "that code is free" would
tell an enumerator which shapes are worth trying.

---

## 4. Routes

| Route | What it is |
| --- | --- |
| `POST /api/exhibitions` | Web resource route. Proxies to the API, returns `{code, path, url, works, dropped}`. |
| `GET /e/:code` | The exhibition page. |
| `POST /api/public-exhibitions` (API worker) | Persists. Anonymous, capped, rate-limited. |
| `GET /api/public-exhibitions/:code` (API worker) | The exhibition as JSON, increments `view_count`. |
| `GET /exhibition?e=…` | Unchanged and still working — the self-contained fallback. |
| `GET /exhibition` | Now `302` → `/nga/search`. |

The absolute URL is assembled in the **web** proxy, not the API. The API stores
the show and knows its code but not which origin the curator is looking at;
guessing would hand out a staging link from production or the reverse.

`/e/:code` and `/exhibition?e=…` share one loader
(`app/lib/exhibition-page.server.ts`) and one renderer
(`app/components/exhibition/exhibition-view.tsx`), so the two ways of naming an
exhibition cannot drift into two different pages.

### Bounds on the anonymous write path

Open-access NGA collection only · ≤24 works · title ≤90 chars · statement ≤800 ·
label ≤320 · 20 publishes per caller per hour (KV, SHA-256 of the connecting
address; the raw address never reaches storage) · **every artwork id checked
against the catalogue before the row is written**, with unresolvable works
dropped and the count returned. That last one is not strictness — a stored show
whose ids do not resolve is a 404 that arrives days later, in front of whoever
the curator sent it to. Verified live: a show with one real and one fake id
returned `{"works":1,"dropped":1}`.

---

## 5. Open Graph and the crawler branch

Copied from aether's design, not its code. `/e/:code` is three things depending
on who asks, resolved in `worker.ts` **ahead of Remix**:

| Caller | Response | Measured on staging |
| --- | --- | --- |
| Chrome UA + `Accept: text/html` | The app | `200 text/html`, 17,605 bytes |
| `Slackbot-LinkExpanding` | Preview document | `200 text/html`, **3,622 bytes** |
| `Accept: application/json` | The facts | `200 application/json`, 2,772 bytes |

A bot unfurling a link is not a browser: it fetches once, reads the `<head>`,
runs no scripts and gives up quickly. Serving it the app shell mostly works and
is a bad bet — the tags sit behind kilobytes of preload hints, and a fetch that
times out renders as a bare URL.

Actual tags returned to Slackbot for `/e/MKwsxHy`:

```
<title>Everything the Light Left Behind — Paillette</title>
<link rel="canonical" href="https://paillette-stg.berlayar.ai/e/MKwsxHy"/>
<meta property="og:type" content="article"/>
<meta property="og:title" content="Everything the Light Left Behind"/>
<meta property="og:description" content="It is not about weather. It is about leaving. …"/>
<meta property="og:url" content="https://paillette-stg.berlayar.ai/e/MKwsxHy"/>
<meta property="og:image" content="https://api.nga.gov/iiif/0018e0aa-…/full/1200,/0/default.jpg"/>
<meta property="og:image:width" content="1200"/>
<meta property="og:image:alt" content="Everything the Light Left Behind"/>
<meta name="twitter:card" content="summary_large_image"/>
<meta name="twitter:title" …/> <meta name="twitter:description" …/> <meta name="twitter:image" …/>
```

That `og:image` was fetched directly: `200 image/jpeg, 246,943 bytes, 3.1s`. It
is the lead work through the existing public NGA IIIF URL, resized in the path
to 1200px — the card's own width. The master file is several megabytes and every
unfurler has a fetch budget measured in low seconds.

The same tags are also server-rendered by the route itself, so this path is an
**optimisation with a fallback, not the authority on what exists**. It returns
null — falling through to Remix untouched — for any other path, any human, any
write method, and any failure (API down, unknown code, no works resolved). It
cannot turn a working link into a 500.

The statement is prose a stranger typed and it lands inside `content="…"`. One
unescaped double quote there ends the attribute and the rest becomes markup on
a page served from this domain. It is escaped, with a test that says why.

---

## 6. Unguessable is not private

Stating this plainly because the brief asked for it and because it is the one
thing about this design someone could reasonably be surprised by later.

**The code is a capability, not a credential.** Anyone holding it can open the
show. There is no access control behind it, no owner, no login, no revocation.
That is what a link you can paste *is* — but it means:

- An "unlisted" exhibition is **unlisted, not secret**. 57⁷ ≈ 1.95 × 10¹² makes
  enumeration impractical, not impossible, and impractical-to-guess is not the
  same property as not-permitted-to-read.
- A code that leaks — forwarded, screenshotted, indexed by a crawler that
  followed it — is public from then on, permanently. **There is no way to
  delete or expire an exhibition.** No retention policy, no unpublish.
- Anything a curator puts in a title or statement should be treated as
  published to the open internet the moment they press the button.
- **There is no moderation.** This route lets an anonymous stranger publish
  prose under `paillette.berlayar.ai`. Length caps and a 20/hour per-caller
  budget bound the blast radius; they are not review, and there is none.

---

## 7. Tests

Baseline (before this lane) vs. now, both measured on this machine:

| Suite | Baseline | Now |
| --- | --- | --- |
| `pnpm --filter web test` | 92 files / 1157 tests, **1 file failed to collect** | **94 files / 1171 tests, all pass** |
| `pnpm --filter api test` | 44 files / 815 tests, all pass | **46 files / 849 tests, all pass** |
| `pnpm --filter web typecheck` | 1 error | **clean** |

Two notes on the baseline:

- `HANDOFF.md` §2 records the baseline as "web 59 files / 593 tests · api 41 /
  770". Those numbers are stale; the figures above are what the commands
  actually printed.
- The failing web file was `__tests__/worker-cache-control.test.ts`, which
  imports `worker.ts`, which imports `./build/server/index.js`. It fails to
  collect on a tree that has not been built and passes after `pnpm --filter web
  build`. Pre-existing, unrelated to this lane, and not fixed here — the same
  missing artifact was the sole `typecheck` error.

New coverage, all of it requested by the brief:

- **Code generation and normalisation** — `apps/api/src/utils/share-codes.test.ts`
  (12): alphabet composition, length, uniformity over 70k characters, no
  collisions over 5k draws, mistyped-glyph rejection, over-long rejection,
  case preservation, wrapper stripping.
- **Collision retry** — `apps/api/src/routes/exhibitions.test.ts`: forces the
  first draw to reproduce a taken code and asserts the second insert attempt
  used it and the third succeeded.
- **404 paths** — same file and `app/routes/__tests__/short-exhibition-route.test.ts`:
  unknown code, malformed code, API unreachable, wrong collection, zero
  resolvable works, and that a malformed code never reaches storage.
- **The crawler branch** — `app/lib/share/__tests__/preview.test.ts` (21) and
  `crawler.server.test.ts` (17): 8 crawler UAs recognised, 3 browsers not, path
  matching, all three response kinds, attribute escaping, and every
  fall-through case.
- **The clipboard fallback** — `app/components/exhibition/__tests__/share-link.test.tsx`
  (12): the field appears, holds the URL, is read-only, is selected, persists,
  and is absent on success.
- **Cold open, live** — `apps/web/e2e/cold-share-link.spec.ts`, 4 tests, run
  against staging and passing. Not part of the default suites (it needs a
  published code):
  `PAILLETTE_SHARE_CODE=MKwsxHy npx playwright test e2e/cold-share-link.spec.ts`.

Two bugs were caught by tests I had just written, before any of this shipped,
and both were mine:

- The glyph "repair" in §3.1 — the normaliser mapped `0`/`O` onto `o`, which is
  a valid character, so it would have resolved a mistyped code to a real
  stranger's exhibition.
- `c.executionCtx` **throws** in Hono when there is no execution context rather
  than returning `undefined`, so `c.executionCtx?.waitUntil(…)` turned every
  successful `GET` into a 500 off-Worker. Caught because the read test asserted
  a status rather than just parsing the body.

---

## 8. What was verified on staging

Deployed: `apps/api` via `npx wrangler deploy --env staging`, `apps/web` via
`pnpm --filter web deploy:staging`. Production untouched.

Against `https://paillette-stg.berlayar.ai/e/MKwsxHy`, in a Chromium context
with empty `storageState`:

- `localStorage` 0 keys, `sessionStorage` 0 keys, `document.cookie` empty — so
  everything on screen came off the wire.
- Title and statement render.
- All **6** works render; all 6 `<img>` reached `complete === true` with
  `naturalWidth > 0` — actually decoded, not just present in the markup.
- All **6** labels render, with per-field provenance intact: the colophon reads
  "·· 4 of 6 labels written by an agent", matching the 4 sent as agent-written.
- Colophon carries the institution and the open-access rights line.
- Hanging order preserved end to end (checked against the JSON probe).
- `GET /e/zzzzzzz` → 404. `GET /exhibition` → 302 → `/nga/search`.
- `GET /exhibition?e=<old payload>` → 200, renders. The fallback is intact.
- `view_count` incremented correctly across visits.

### The button, clicked for real

Not just its tests. Driven in a headless Chromium against staging, assembling a
show through the WebMCP debug hook (`?webmcp-debug` → `search_artworks` →
`set_results` → `set_exhibition`) and then clicking the actual control:

- Button is absent with nothing hanging, and appears once a show exists.
- Label sequence on click: **`Copying… → Copied → Copy link`** — the working
  state is visible, and the success state resets after 2.4s as designed.
- One `POST /api/exhibitions` → **201**.
- `navigator.clipboard.readText()` returned
  **`https://paillette-stg.berlayar.ai/e/wycy7SS`**.
- That link opens: `200`, `<title>Leaving — Paillette</title>`, all 3 works and
  3 images rendered.

One correction against my own working notes: an intermediate check appeared to
show this link rendering only 1 of 3 works. That was a bad measurement —
`grep -c` counts matching *lines*, and the served HTML is a single line, so it
returns 1 for any page with at least one work. Counted properly, all 3 render.

---

## 9. Still broken / not done

1. **No delete, no expiry, no moderation.** §6. The largest gap, and the one
   that would matter if this went to production rather than staging.
2. **The clipboard fallback has only been proven in jsdom.** The no-clipboard
   branch is covered by five unit tests, but every real browser I could drive
   has a working `navigator.clipboard` over HTTPS, so the visible selected
   field has not been seen in a real browser. It would appear on an insecure
   origin or where the permission is denied.
3. **The `dropped` count is returned but not shown.** The API says how many
   works it could not resolve; the button ignores it. A curator whose show
   quietly loses a work finds out by counting.
4. **Only the NGA collection.** Codes for `/try` sandbox collections are
   refused. Those records are not publicly readable, so a cold link would not
   render anyway — but it means a `/try` user cannot share.
5. **No unfurl confirmed in a real client.** The document, the tags and the
   image were all fetched and checked with curl, and the image returns a real
   JPEG. Nothing was actually pasted into Slack, WhatsApp or X to see the card
   render.
6. **`view_count` is written on every resolve** including crawler and probe
   hits, so it counts unfurls as visits.
7. **The pre-existing `worker.ts` → `build/server/index.js` coupling** still
   makes `typecheck` and one test file fail on an unbuilt tree. Not mine, not
   fixed.
