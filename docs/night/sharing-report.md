# Sharing lane — report

Branch `night/sharing`. Cut from `night/integration`, and merged back up to it
at iteration 2 so this branch contains their work as well as mine.

**Real, working, cold-openable short links on staging:**

> ## https://paillette-stg.berlayar.ai/e/exYNx8X
> Three works, mixed provenance — two labels the agent wrote, one the human
> did — so both inks are visible on one page.
>
> ## https://paillette-stg.berlayar.ai/e/QWwJnL5
> Twelve works. Assembled by **typing** *"something warm for above the sofa,
> and write me a title and statement"* into the prompt bar with the speech
> APIs deleted from the page, then clicking Copy link. Title *"The Warm Side
> of Light"* and its statement are the agent's.
>
> ## https://paillette-stg.berlayar.ai/e/MKwsxHy
> Six works, four agent labels. Screenshot:
> `docs/night/shots/share-cold-open.png`.

All opened in browser contexts with no session, no cookies and no local
storage.

### For the submission lane — the one-paragraph version

> An exhibition assembled in Paillette gets a permanent seven-character URL.
> Anyone can open it — no account, no session, nothing carried over — and it
> renders the full show server-side: title, statement, every work with its
> catalogue data, every wall label, and a credit line saying how many of those
> labels an agent wrote. Pasted into Slack or WhatsApp the link unfurls with
> the exhibition's title, its statement and its lead artwork.

Every clause of that is measured below. Do not extend it — in particular do
not call these links private or say anything was tested in a real Slack
workspace, because neither is true. See §6 and §9.

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

| Caller | Response | Measured on staging (`/e/exYNx8X`) |
| --- | --- | --- |
| Chrome UA + `Accept: text/html` | The app | `200 text/html`, 12,313 bytes, 1.96 s |
| `Slackbot-LinkExpanding` | Preview document | `200 text/html`, **2,649 bytes**, 0.32 s |
| `Accept: application/json` | The facts | `200 application/json`, 1,452 bytes, 0.11 s |

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

### The budget, and the bug staging found in it

Deadlines were added in iteration 2 because every fetch on these paths was
unbounded: a catalogue that accepted the connection and then stopped talking
would hold twenty-four concurrent requests and the whole page behind them — a
blank tab until the browser gave up, which is worse than any error page. A slow
record now drops out and is counted in `missing`, exactly like an absent one.

The first version of the crawler budget was **wrong, and only measuring caught
it**. It was 1500 ms applied *per fetch*, which failed in both directions:

- The preview makes two calls in sequence, so the real worst case was double
  the number written down.
- Against staging the lookup alone ran 0.13–1.50 s, so ordinary traffic was
  tripping its own deadline. Roughly **1 request in 6** silently fell through
  and served the 12 kB app shell instead of the 2.6 kB preview.

It is now one wall clock over the whole path (2.5 s), shared by both calls, so
a slow lookup leaves the records less time rather than adding to it. Re-measured
after the fix, **0 fall-throughs in 20 crawler fetches and 0 in 20 probe
fetches**, where the same measurement before the fix caught it repeatedly.

That failure mode was always a *degradation* rather than a break — the route
server-renders the same tags, so the card still worked, just slower and bigger.
But it defeated the point of having the fast path at all.

---

## 5b. Text first, and cutting the words

Both constraints arrived mid-run and both were applied to work already built.

### Text first — verified, not assumed

Nothing in this lane touches speech: `grep -niE "speech|speak|voice|mic|utterance|recognition"`
across all nine files of the lane returns nothing. The share control is a
button, publishing is a `fetch`, the page is server-rendered HTML.

That is the weak version of the claim, so the strong one was measured. In a
headless Chromium with `webkitSpeechRecognition`, `SpeechRecognition` and
`speechSynthesis` **deleted before any app code ran**:

1. `window` reports no speech APIs (`false`).
2. Typed *"something warm for above the sofa, and write me a title and
   statement"* into the prompt bar and pressed Enter. No microphone permission
   was granted in the run and no speech control was clicked.
3. The agent assembled a twelve-work board and wrote the title *"The Warm Side
   of Light"* and a statement.
4. The share button appeared, was clicked, returned `201`, and the clipboard
   held `https://paillette-stg.berlayar.ai/e/QWwJnL5`.
5. That URL opens cold: 12 works, agent-inked statement.

So every beat of the share half works by typing with voice absent.

**One honest caveat:** that run produced 0 wall labels — the agent wrote a
title and statement but did not call `write_labels` for this instruction. The
mixed-provenance rendering was therefore verified on a separately published
show (`/e/exYNx8X`) rather than on the typed one.

### Cutting the words — §5b applied to my own surfaces

Audited against §5b after re-reading how museum labels and Lightroom's culling
view handle density. The finding that mattered: **every agent-written label
carried a `··` glyph with both `title` and `aria-label` reading "Label written
by an agent"** — a tooltip restating a mark that existed only in order to need
the tooltip. Two pieces of chrome for one bit of information, and exactly what
§5b rules out.

Provenance is **ink** now, which is what §7.2 asks for. The rule down the left
of each label is drawn in the agent's ink or the human's, off the same
`data-provenance` attribute the statement, the wall label and the region heads
already use — a convention learned long before anyone reaches this page, so it
needs no legend. Verified on staging: 2 agent-inked labels, 1 human-inked, and
`exhibition-mark` / "Label written by an agent" both absent from the served
HTML. Both inks captured in one page:
`docs/night/shots/share-provenance-ink.png`.

| Was | Is | Why |
| --- | --- | --- |
| `··` + `title` + `aria-label` on every agent label | coloured rule on the label | A mark and a colour, not a word. §5b, §7.2 |
| "N works in this link could not be resolved in the catalogue" | "2 works unavailable" | Narrated a mechanism the visitor cannot act on |
| Button: `Copy link → Copying… → Copied → Copy link` | `Copy link → Copied → Copy link` | "Copying…" narrated the round trip and made one click flicker through three words in under a second. It is dimmed and disabled while working — a state, not a word |

**Not cut, deliberately:** the rights line stays long. It is the institution's
own credit line rather than our chrome, and the licence is the part a reuser
acts on. The colophon's "2 of 3 labels written by an agent" also stays — a
museum prints who wrote its labels once, at the bottom, and it doubles as the
non-colour statement of a fact the ink otherwise carries by colour alone.

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

Baseline (before this lane) vs. now, both measured on this machine. "Now" is
after merging `night/integration`, so it includes other lanes' tests too:

| Suite | Baseline | Now |
| --- | --- | --- |
| `pnpm --filter web test` | 92 files / 1157 tests, **1 file failed to collect** | **95 files / 1181 tests, all pass** |
| `pnpm --filter api test` | 44 files / 815 tests, all pass | **46 files / 849 tests, all pass** |
| `pnpm --filter web typecheck` | 1 error | **clean** |

Two notes on the baseline:

- The brief and `HANDOFF.md` §2 both record the baseline as "web 59 files / 593
  tests · api 41 / 770". Those numbers are stale by a wide margin; the figures
  above are what the commands actually printed on this machine, before and
  after. Nothing regressed.
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
- **Deadlines and hangs** — `app/lib/__tests__/exhibition-page-deadline.test.ts`
  (7): a record that never answers drops out while the rest render; the hang
  being *first* does not block the ones behind it; all-hang gives null not an
  empty room; the lookup hanging gives up; and the crawler budget caps the
  whole path once rather than per hop. The stubs honour the abort signal the
  way a real socket does, and the first test asserts the promise is **still
  pending** just before the deadline and settled just after — without both
  halves it would pass against a stub that never hung and prove nothing.
- **Cold open, live** — `apps/web/e2e/cold-share-link.spec.ts`, 4 tests, run
  against staging and passing. Not part of the default suites (it needs a
  published code):
  `PAILLETTE_SHARE_CODE=exYNx8X npx playwright test e2e/cold-share-link.spec.ts`.

Three bugs were caught by tests I had just written, before any of this shipped,
and all three were mine:

- The glyph "repair" in §3.1 — the normaliser mapped `0`/`O` onto `o`, which is
  a valid character, so it would have resolved a mistyped code to a real
  stranger's exhibition.
- `c.executionCtx` **throws** in Hono when there is no execution context rather
  than returning `undefined`, so `c.executionCtx?.waitUntil(…)` turned every
  successful `GET` into a 500 off-Worker. Caught because the read test asserted
  a status rather than just parsing the body.
- A test asserting the deadline "worked" would have passed against a stub that
  never hung at all. Adding the still-pending-just-before assertion is what
  made it mean anything.

A fourth was caught only by **measuring staging**, and no unit test would ever
have found it: the crawler budget was too tight and silently fell through on
roughly 1 request in 6. See §5.

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
  "4 of 6 labels written by an agent", matching the 4 sent as agent-written.
- Colophon carries the institution and the CC0 rights line.
- Hanging order preserved end to end (checked against the JSON probe).
- `GET /e/zzzzzzz` → 404. `GET /exhibition` → 302 → `/nga/search`.
- `GET /exhibition?e=<old payload>` → 200, renders. The fallback is intact.
- `view_count` incremented correctly across visits.

### The button, clicked for real

Not just its tests. Driven in a headless Chromium against staging, assembling a
show through the WebMCP debug hook (`?webmcp-debug` → `search_artworks` →
`set_results` → `set_exhibition`) and then clicking the actual control:

- Button is absent with nothing hanging, and appears once a show exists.
- Label sequence on click was **`Copying… → Copied → Copy link`**. The middle
  state has since been cut to `Copy link (dimmed) → Copied → Copy link` — see
  §5b.
- One `POST /api/exhibitions` → **201**.
- `navigator.clipboard.readText()` returned
  **`https://paillette-stg.berlayar.ai/e/wycy7SS`**.
- That link opens: `200`, `<title>Leaving — Paillette</title>`, all 3 works and
  3 images rendered.

One correction against my own working notes: an intermediate check appeared to
show this link rendering only 1 of 3 works. That was a bad measurement —
`grep -c` counts matching *lines*, and the served HTML is a single line, so it
returns 1 for any page with at least one work. Counted properly, all 3 render.

### Iteration 2, re-measured after the merge and the fixes

Re-deployed both workers and re-ran everything against `/e/exYNx8X`:

| Check | Result |
| --- | --- |
| Three request paths | app 12,313 B / preview 2,649 B / JSON 1,452 B — all `200`, correct content types |
| Crawler fall-through rate | **0 / 20** (was ~1 in 6 before the budget fix) |
| Probe fall-through rate | **0 / 20** |
| `og:title`, `og:image` (1200px), `twitter:card` | present and correct in the preview document |
| Provenance ink | 2 agent-inked labels, 1 human-inked; `exhibition-mark` and "Label written by an agent" both **absent** |
| `/e/zzzzzzz`, `/e/abcdef0`, `/e/abc`, `/e/abcdefghij` | all `404` |
| `/exhibition` | `302` → `/nga/search` |
| Legacy `/exhibition?e=…` | `200`, renders |
| Cold e2e, 4 tests | all pass |

**One thing worth knowing rather than fixing:** `/e/..` returns `200` and the
home page rather than a `404`. Cloudflare's edge normalises the path to `/`
before the Worker ever sees it, so the code never receives `..` as a code. Not
a traversal — it resolves to a legitimate route — and the unit test asserting
`readShortLinkCode('/e/..')` is null still holds for the case where such a
string does reach the function.

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
   fixed. Run `pnpm --filter web build` first and both go green.
8. **Provenance ink is colour-only per label.** The agent/human distinction on
   an individual wall label is carried by the colour of its left rule and
   nothing else, which is the app-wide convention (`data-provenance` on the
   statement, the wall label, the region heads) rather than something this lane
   introduced. The colophon states the count in text, so the fact is not
   *only* in colour on the page — but a colour-blind visitor cannot tell which
   specific label came from which hand. A dashed-vs-solid rule would fix it
   without adding a word; not done tonight.
9. **The typed end-to-end run produced no wall labels**, because the agent did
   not call `write_labels` for that instruction. Labels and their ink were
   verified on a separately published show instead. The two have not been
   demonstrated in a single unbroken run.

---

## 10. Where this lane stands against the brief

§8's triage list and §9's definition of done are the **culling loop** — flags,
`get_view_context`, Enter-on-empty-bar redeal, gesture payloads, the deal
animation, compare, the ledger. None of those are this lane, and this lane has
not touched them. This lane is the last bullet of §5c: *"what is left is a
shareable, properly designed exhibition page"*, and the §5.4 item in
`HANDOFF.md`.

Measured against the six things this lane was actually asked for, all six are
done and demonstrable on staging: D1-backed exhibitions, short codes, the
routes including `/e/:code` and the `/exhibition` fix, OG tags with a crawler
branch, the one-control share affordance with a working no-clipboard fallback,
and an end-to-end proof from a cold browser.

Iteration 2 added no scope. It merged `night/integration`, applied the two
mid-run constraints to what already existed, hardened the failure paths that
had no deadlines, and fixed the one bug that only appeared under real latency.
