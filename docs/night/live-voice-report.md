# Live voice: one session, and the meter that lets it be public

Branch `night/live-voice`, cut from `night/integration`. Two commits, in the
order the issues demand — the gate first, then the thing it gates.

- `d4f2596` — `feat(live-audio)`: the audio-minute quota gate (071)
- `ecbe71e` — `feat(live-voice)`: the live session (070)

---

## What shipped

### 071 — the gate

`AGENT_MODEL_CALLS_PER_HOUR` counts requests to `/api/public-agent/turn`. A
realtime session does not go through that route: it is billed for every second
its connection is open, so the existing counter reads zero for the whole of the
expensive thing. A second meter now runs in **seconds of session wall-clock**.

Four routes, mounted anonymous alongside their neighbours at `/api`:

| Route | What it does |
|---|---|
| `POST /api/public-live/token` | Checks both budgets, **debits the grant**, mints a 60s ephemeral credential |
| `POST /api/public-live/call` | Proxies the SDP offer, captures the provider call id |
| `POST /api/public-live/heartbeat` | Enforces the grant mid-call; hangs up at the provider when it is spent |
| `POST /api/public-live/close` | Settles, refunding the unused remainder |

Three properties carry the ceiling:

**Debited up front.** The grant comes out of both budgets at mint, not at
close. A tab that vanishes mid-sentence has already paid; settlement can only
ever refund. This is what makes the ceiling hold against the *common* case — a
page that closes without saying so — rather than only against a hostile one.

**Atomic.** A guarded `UPSERT` in D1, mirroring `nga_public_search_quota`'s
guarded `UPDATE`. KV's read-modify-write loses concurrent increments, which is
a fine trade for counting requests and a bad one for money: two tabs must not
both be able to spend the last ten seconds. Tested against real SQLite, not a
stubbed D1 — see *Testing* below.

**Two independent ceilings.** Per-caller stops one visitor; site-wide stops a
handful of visitors between them. A per-caller limit alone is not a spend
limit, it is a spend limit multiplied by however many people show up.

Storage is D1 (`0023_live_audio_budget.sql`): `live_audio_budget` is the two
meters, `live_audio_sessions` is the ledger — what was granted, what was used,
and the provider call id. That table *is* the spend event 071 asks for, so the
cost of a filmed rehearsal is readable afterwards rather than inferred from an
invoice.

### 070 — the session

One WebRTC session replaces the `webkitSpeechRecognition` → `gpt-5.6-terra` →
`speechSynthesis` cascade. The "text in, text out; voice in, voice out" rule
survives — it is now `output_modalities` on a request rather than a branch
between two subsystems — but the seam it was patching is gone.

The mixed modality works in both directions, and the interesting one is
mid-utterance. Releasing the button commits the audio **without** asking for a
reply. That is what produces the transcript; the transcript lands in the same
field the keyboard writes to and the existing 1.2s grace bar runs. Send it as
heard and the session answers its own audio. Type over it — "any in us in
here" into "Inness" — and the audio item is withdrawn with
`conversation.item.delete` and the corrected sentence takes its place. Esc does
the same withdrawal. That substitution is the whole reason the grace window had
to survive into the live path.

Tool calls execute in the browser against `document.modelContext` — the same
twenty-five tools, offered exactly as registered, with reads batched and writes
ordered the same way the typed loop does it. No second, agent-only path.

Connection state is on the activity glyph. An open session wakes the resting
mark from `·····` to `·∙∙∙·` — same width, so nothing on the row moves.
Connecting breathes; listening converges *inward*, the opposite direction to
`scan`'s traversal, because one is the page working and the other is the page
waiting on you. Tool work outranks the connection in both motion and screen
reader announcement. No panel, no label, no explanatory sentence.

---

## Provider facts, verified 2026-09-04

Read from OpenAI's own documentation and pricing page on **4 September 2026**,
not from memory. **OpenAI Realtime, as the brief defaults to** — nothing in 070
requires anything it cannot do, so no vendor question arose.

**Models.** `gpt-realtime-2.1` is the current flagship; `gpt-realtime-2.1-mini`
is the cheap tier. Also live: `gpt-realtime-2`, `gpt-realtime-1.5`,
`gpt-realtime-translate`, `gpt-live-transcribe`. Default here is
`gpt-realtime-2.1`, overridable via `LIVE_SESSION_MODEL`.

**Pricing**, per 1M tokens:

| Model | Audio in | Cached audio in | Audio out | Text in | Text out |
|---|---|---|---|---|---|
| `gpt-realtime-2.1` | $32.00 | $0.40 | $64.00 | $4.00 | $24.00 |
| `gpt-realtime-2.1-mini` | $10.00 | $0.30 | $20.00 | $0.60 | $2.40 |

At the commonly-cited conversion (~600 audio tokens per minute of speech in,
~1200 out), a minute of wall-clock costs at most about **$0.12** on
`gpt-realtime-2.1` with the whole minute spent talking, and materially less
under push-to-talk where the microphone is open only while a button is held.
The mini variant at roughly a third is the obvious lever if the budget binds;
it is not the default because this session drives 25 tools and tool-call
accuracy is what shows on camera.

**Modality support.** `output_modalities` accepts `["text"]` or `["audio"]` and
can be set per response, which is exactly what the house rule needs. Input
transcription is configured under `audio.input.transcription`.

**Session limits.** A realtime session runs up to **60 minutes**. The ephemeral
credential's `expires_after.seconds` is 10–7200 (default 600); this repo uses
60. **Critically: token expiry gates *starting* a session and does nothing to
one already connected** — OpenAI's docs are explicit. That single fact shaped
the whole design (see below).

**Endpoints.** `POST /v1/realtime/client_secrets` mints; `POST
/v1/realtime/calls` takes an SDP offer and returns the call id in the
`Location` header; `POST /v1/realtime/calls/{call_id}/hangup` ends an active
call "whether it was initiated over SIP or WebRTC".

**Wire shapes that bite.** Realtime tools are **flat**
(`{type, name, description, parameters}`), not nested under `function` the way
Chat Completions does it. The nested form is accepted and then silently
ignored — the session connects, works, and never calls anything. There is a
test pinning this specifically.

### The one design consequence worth stating

Because token expiry cannot stop a running session, the browser's SDP offer is
**proxied through the Worker** rather than posted straight to OpenAI. The
answer's `Location` header carries the call id, and that id is the only handle
that can end a session from the server. Letting the page connect directly would
mean asking it to report its own id — which is the same as having no stop at
all. Media still flows peer-to-peer; only the one-shot SDP exchange takes the
extra hop.

---

## Budget shape and defaults

| Setting | Production (code default) | Staging (`wrangler.toml`) |
|---|---|---|
| `LIVE_AUDIO_SECONDS_PER_CALLER_PER_HOUR` | 180 (3 min) | 1800 (30 min) |
| `LIVE_AUDIO_SECONDS_PER_DAY` | 3600 (1 h) | 7200 (2 h) |
| `LIVE_SESSION_MAX_SECONDS` | 90 | 300 |
| `LIVE_SESSION_MODEL` | `gpt-realtime-2.1` | same |

Worst-case cost at the verified rates: **~$0.36 per visitor per hour**, **~$7
per day site-wide** in production; **~$14 per day** on staging. Production is
deliberately absent from `wrangler.toml` and runs on the code defaults, exactly
as it does for `AGENT_MODEL_CALLS_PER_HOUR`. Staging is raised because to a
counter a filmed retake is indistinguishable from abuse.

**These numbers are my call, not the owner's.** 071's clarification protocol
asks for the ceilings as a spending decision; the brief says to make the call
and state the assumption rather than stop. I set them low on the principle that
being wrong upward costs an invoice and being wrong downward costs a visitor
pressing the button again. **They are one line of config each and should be
reviewed before filming.**

Grants are 90s rather than the whole per-caller budget because a grant is
debited whole and refunded only on a clean close — a large grant is a large
amount to lose to a crashed browser. The page re-mints transparently.

---

## What is NOT verified — read this before relying on it

**No part of the live audio path has met a real microphone.** This machine is
headless. Specifically unverified:

1. **That a session connects at all.** `getUserMedia`, `RTCPeerConnection`, the
   SDP exchange through the Worker, and `setRemoteDescription` have never run.
2. **That the provider accepts our `session.update`.** Model id, the flat tool
   shape, `turn_detection: null`, and `audio.input.transcription` with
   `gpt-live-transcribe` are all correct *per the documentation I read on
   2026-09-04*; none has been round-tripped against the live API.
3. **Every event name.** `readLiveEvent` handles `session.updated`,
   `conversation.item.input_audio_transcription.completed`, `response.done` and
   `error`. If the transcription event name differs in practice, **the grace
   window silently never starts** — the field stays empty after a release. This
   is the single most likely thing to be wrong and the first thing to check.
4. **Interruption within 300ms.** `response.cancel` +
   `output_audio_buffer.clear` are the documented mechanism and are wired to
   pointer-down and to grabbing the microphone. The *timing* is unmeasured.
5. **Audio playback.** The `<audio>` element is created and attached to the
   remote track but never inserted into the document; whether autoplay works
   detached needs checking on real Safari and Chrome.
6. **Server-side hangup against a real call.** The endpoint and call-id parsing
   are unit-tested against a stubbed provider; a real `rtc_...` has never been
   hung up.
7. **Cost per minute in practice.** The per-minute figures are arithmetic over
   published token prices, not measured spend. The `live_audio_sessions` table
   exists so the first rehearsal produces real numbers.

**What *is* verified headlessly:** every budget decision (against real SQLite),
every protocol message this page constructs, every server event it parses, and
the component's whole half of the interaction — where a transcript lands, what
happens to audio when somebody types over it, tool execution and result
round-trip, interruption, and that the typed path is untouched when none of it
is available.

---

## Testing

```
pnpm --filter api test        47 files, 888 tests, all pass   (baseline 46/857)
pnpm --filter web typecheck   clean
pnpm --filter web test        99 files, 1248 tests, all pass  (baseline 97/1201)
```

Baseline note: `pnpm --filter web typecheck` and one web test file fail on a
clean checkout because `worker.ts` imports `./build/server/index.js`, a build
artifact. `pnpm --filter web build` first and both go green. That is
pre-existing and unrelated to this work.

Two pre-existing lint errors remain in `app/lib/webmcp/tools.ts` and
`app/components/board/deal-board.tsx`. Neither file is in this branch's diff.

**The budget tests load the migration into `node:sqlite` and run the real
statements.** A hand-written `prepare().bind().run()` fake can be made to agree
with whatever the code does, including when the code is wrong, and the
guarantee here is arithmetic under contention. The guarded UPSERT either is
atomic or the test fails. This found nothing, but it is why I trust the result.

The suite covers 071's four named cases — token refused when over budget,
session terminated mid-call, site-wide ceiling independent of per-caller, and a
fresh caller unaffected by another's spend — plus refund-to-the-right-window
across an hour boundary, double-settlement, and the grant being returned when
the provider fails to mint.

**One real bug was caught by its own test**: `parseCallId` took the last path
segment, so a `Location` ending in a slash yielded the call id `"calls"` —
which is not an error until it is interpolated into a hangup URL and quietly
stops being able to end anything. It is anchored on `/calls/` now.

**Two more were caught in self-review and are pinned by mutation-checked
tests** (both new tests fail if the fix is reverted): `busy` was being cleared
on `response.done` even when that response carried tool calls, re-enabling the
field mid-deal; and `busy` blocked grabbing the microphone to interrupt, which
made the live session's one real advantage unreachable.

---

## What I cut, and why

**Open-mic.** Never on the table — 070 decides push-to-talk and I did not
revisit it. Worth recording that every realtime example ships with server VAD
on, so `turn_detection: null` is an active choice with a test defending it.

**Barge-in during the agent's own sentence via voice activity.** Interruption
is wired to pointer-down and to grabbing the microphone, which is push-to-talk's
honest equivalent. True barge-in needs an open mic.

**A `usage_events` row per session.** `api_usage_events.user_id` is `NOT NULL`
and this surface has no user; inventing a sentinel to satisfy a column felt
worse than the ledger I built instead. `live_audio_sessions` records granted,
spent, and close reason per session, which answers the same question — what did
the rehearsal cost — more directly.

**A scheduled sweep.** A Worker has no timer of its own without a Durable
Object. Expired sessions are swept on the next mint or heartbeat, so a session
abandoned by a closed laptop is cut when the next visitor arrives rather than
the instant it expires. Its cost is accounted for either way, because the grant
was debited up front — the sweep is about not paying for silence, not about the
ceiling holding. A Durable Object with an alarm is the correct fix and is more
than tonight is worth.

**Deictic chips inside the spoken path.** Chips still resolve against the field
as text, typed or spoken. What is *not* wired is passing the resolved
referents into the live session as structured context — the session gets them
through `get_view_context` like any other operator, which is enough, but the
annotated-utterance enrichment the typed path does is not replicated.

**The gesture payload.** The typed loop sends `describeHumanTurn`'s prose with
every request — "you said warm; you've picked three cool ones". The live
session does not: it reads flags through `get_view_context` when it chooses to.
That is a real asymmetry between the two paths and the most worthwhile next
thing to close.

---

## Assumptions stated, per the brief

1. **Ceilings are mine, not the owner's** (above). Review before filming.
2. **The first hold opens the session** and runs on the old recogniser while it
   connects, so no words are lost to a one-second negotiation. From the second
   hold on, it is live. There is no separate connect control, because the brief
   forbids one.
3. **Voice `marin`**, as reading more like a gallery than an assistant.
4. **The Worker keeps and uses the ephemeral credential** for the proxied SDP
   exchange, and the page holds a copy as its bearer for that one hop. The
   account key never leaves the Worker.
5. **Live instructions extend the turn route's system prompt** rather than
   sitting beside it, so the spoken and typed halves cannot drift on what a
   pick means.
