# Live voice: one session, and the meter that lets it be public

Branch `night/live-voice`, cut from `night/integration`.

- `d4f2596` — `feat(live-audio)`: the audio-minute quota gate (071)
- `ecbe71e` — `feat(live-voice)`: the live session (070)
- `506525d` — `fix(live-voice)`: hardening found by running the page, and the copy audit
- `6b5330c` — `test(demo)`: make the no-microphone check able to fail
- `f67dbe1` — `test(demo)`: verify the §9 voice clause on a browser, both halves
- `9a9b7b5` — `test(demo)`: check what the voice loop does when the agent is down

---

## 0. For the submission lane — the two sentences, and the line between them

**Safe to write.** The page has one utterance bar that takes typing or speech.
Hold to talk; the transcript lands in that same editable field; a 1.2-second
countdown drains under it, during which the words can be corrected by keyboard;
the agent's reply is spoken back **only** when the turn began in speech, and
shown as a wall label either way. Every beat of the loop works with speech
turned off entirely. All of that is verified on a browser, repeatedly, and the
verifier fails when the behaviour is broken.

**Not safe to write.** Anything describing the *live realtime session* —
speech-to-speech, barge-in, a typed message answered in audio mid-session — as
working. It is built and unit-tested, its API routes are not deployed, and no
part of its audio path has ever met a microphone or the provider. The demo
today does not use it; it uses the recogniser loop above, which is what the
verification covers.

Those are two different mechanisms living in one lane, and the failure mode
this report exists to prevent is a public description that merges them.

---

**One correction to the previous version of this report.** It claimed "text in,
text out" was measured. It was not: the probe set `window.speechSynthesis = stub`,
which silently no-ops because that is a readonly accessor on `Window`, so the
real synthesiser stayed in charge and the assertion passed for the wrong
reason. Re-collected properly with `Object.defineProperty`, and the verifier
now refuses to report unless it can confirm its own stubs installed. The claim
happens to be true; the earlier evidence for it was worthless.

---

## 1. What is demonstrably true

Everything in this section was measured on a running browser against a running
server, not inferred from unit tests.

### 1.1 Text first — three consecutive clean runs

`scripts/demo/verify-demo-path.mjs` deletes `SpeechRecognition` and
`webkitSpeechRecognition` from the window before the page loads, and counts
requests to `/api/public-agent/turn`. Against this branch on a local dev server:

```
14 pass · 0 fail · 1 skip
```

Identical on three consecutive runs. Every check:

```
PASS  host.installs                    document.modelContext present, stubbed=false
PASS  tools.register                   25 tools, stable
PASS  tools.noDuplicates               every name unique
PASS  agent.rendersHeadless            agent input present under ?webmcp-debug
PASS  agent.noMicWithoutSpeech         no speech, no WebRTC: no mic, bar still typeable
PASS  context.readable                 keys: ok, page, humanSearch, humanResults, …
PASS  context.reportsFlags             `flags` present
PASS  flags.rejectsStaleId             ARTWORK_NOT_IN_SESSION
PASS  resilience.unknownId             ARTWORK_NOT_IN_SESSION
PASS  resilience.badArgs               rejected without throwing internals
PASS  agent.typedTriggerFires          2 turn(s) from typed input
PASS  agent.toolsExecuteFromTypedTurn  1–2 tool call(s) attributable to the typed turn
skip  flags.roundTrip                  no artwork loaded (search needs credentials here)
PASS  redeal.noModelCall               0 model calls (redeal ran)
PASS  glyph.rendersActivity            glyph present, log still closed
```

**The agentic trigger fires from a typed instruction alone, with no recogniser
in the page**, and **redeal runs with zero model calls**. Both measured.

`agent.noMicWithoutSpeech` was rewritten this round (`6b5330c`) because it
could not fail. It looked for a control named "speak your request" and asserted
there were none — no such control exists in this build, so it counted zero of
a thing that was never there and passed on every build, including ones that do
render a microphone. It now opens a page with the recogniser *and*
`RTCPeerConnection` removed and asserts the real invariant: with neither way
in, there is no mic and the bar is still typeable. The previous five clean runs
included a vacuous PASS; these three do not.

Two operational notes for anyone re-running this:

- **Warm the dev server first.** A first run against a cold one reports ~6
  failures as Vite's dependency re-optimization forces a reload mid-run and
  `window.__paillette_webmcp` vanishes between checks.
- **Use the Vite dev server, not `wrangler dev` on the built worker.** On the
  wrangler-served build `/api/public-agent/turn` returns 404 (the web worker's
  own config does not reach the API the way `.dev.vars` does), so
  `agent.toolsExecuteFromTypedTurn` fails for reasons that have nothing to do
  with this branch. The page shows that 404 readably rather than crashing.

### 1.1b The §9 voice clause, and what happens when the agent is down

> "A voice utterance lands in the editable field; the note is spoken only after
> voice input."

`scripts/demo/verify-voice-symmetry.mjs` (`f67dbe1`, `9a9b7b5`), on a real
browser:

```
PASS  voice.landsInField       field held "something warm for above the sofa" before release
PASS  voice.noteOnWall         the note is above the board
PASS  voice.spokenBack         spoken: ["These share a low horizon."]
PASS  text.noteOnWall          the note is above the board
PASS  text.staysSilent         spoken: []
PASS  outage.staysUsable       1 error(s), typeable=true, mic=true, grace cleared=true
PASS  outage.saysNothingAloud  spoken: []
PASS  outage.recovers          next utterance spoken: ["These share a low horizon."]
8 pass · 0 fail
```

No microphone required: the recogniser is a stub emitting a settled transcript,
which the page cannot distinguish from Chrome doing it, and the agent's reply is
served by the script so the check measures the channel rule rather than whether
this machine can reach the catalogue.

The last three matter more than they look. Staging's agent route is down today,
so the path most likely to be on screen during a take was the one nobody had
exercised. What is asserted is not that an error appears — it is that the page
**comes back**: one error in one sentence, the bar still typeable, the mic
still there, the countdown cleared, nothing spoken aloud (a failure is not a
wall label), and then the *next* utterance working and being spoken back.

**Mutation-checked, not trusted.** With `shouldSpeakReply` forced to `false`,
`voice.spokenBack` fails and the other seven pass. With the `finally` that
clears `busy` removed, `outage.staysUsable` fails with `typeable=false` and
`outage.recovers` fails with nothing spoken, while the five §9 assertions still
pass — the right shape, since that mutation breaks recovery and not the rule.

Two traps that silently invalidate any browser probe of this, both hit here
before being fixed — worth knowing for any lane doing similar work:

- `window.speechSynthesis = stub` **does nothing.** It is a readonly accessor
  on `Window`; the assignment no-ops and the real synthesiser stays in charge,
  so `spoken` stays empty and every assertion against it passes for the wrong
  reason. `Object.defineProperty` is required.
- Chromium ships an **unprefixed** `window.SpeechRecognition`, and the page
  reads `SpeechRecognition ?? webkitSpeechRecognition`. Stubbing only the
  prefixed name leaves the native recogniser in charge, and a native recogniser
  in a headless browser hears nothing at all.

### 1.2 A live session that refuses degrades silently to typing

Driven on a real browser with the recogniser deleted. The API routes are not
deployed yet, so `/api/public-live/token` genuinely 404s — a real refusal, not
a stub:

```
mic before hold      : 1
mic after refusal    : 0        ← withdrawn, not left dead
alerts painted       : []       ← nothing narrated
bar still there      : 1  disabled=false
typed turns fired    : 3
glyph data-live      : off
```

Repeated, identical. This is also the honest answer to "what happens with a
stale API deploy": the microphone withdraws and the page is the typed page.

### 1.3 The gate, over real HTTP against real D1

`wrangler dev` with migration `0023` applied to a local D1. Not unit tests —
actual requests:

| What | Result |
|---|---|
| Mint twice with an invalid provider key | `503 LIVE_UNAVAILABLE`, and `seconds_spent: 0` — **the grant was returned** |
| Mint with the per-caller hour spent | `429 LIVE_BUDGET_SPENT` · "No live audio left this hour." |
| Mint as a *different* visitor with the day spent | `429 LIVE_BUDGET_SPENT` · "No live audio left today." |
| Heartbeat on a session past its grant | `200 {open:false, reason:"Live audio time is up."}` and the row closed server-side: `close_reason='expired'`, `spent_seconds=90` |

The site-wide ceiling refusing a visitor who has spent nothing of their own is
the independence property, demonstrated rather than asserted.

`LIVE_UNIDENTIFIED` (no connecting address) could **not** be reached locally —
`wrangler dev` injects a `CF-Connecting-IP` of its own. Unit-tested only.

### 1.4 The symmetric channel rule

Both halves, superseded by §1.1b above. The previous version of this report
claimed only the negative half and said the positive half "needs a microphone".
That was wrong twice over: the positive half does not need one, and the
negative half's evidence was invalid because the stub never installed.

### 1.5 Checks

```
pnpm --filter web typecheck   clean
pnpm --filter web test        99 files, 1250 tests, all pass
pnpm --filter api test        47 files,  888 tests, all pass
```

**Baseline discrepancy, stated plainly.** The ground rules quote web 59/593 and
api 41/770. Measured on this branch's own starting commit before any of my
work: **web 97 files / 1201 tests, api 46 / 857.** The quoted baseline is from
an earlier round. Against what I actually measured, this branch adds 2 web
files / 49 tests and 1 api file / 31 tests, and regresses nothing.

Two scripts under `scripts/demo/` are also this branch's and are the two things
to run before filming:

```
node scripts/demo/verify-demo-path.mjs      http://localhost:5183/nga/search
node scripts/demo/verify-voice-symmetry.mjs http://localhost:5183/nga/search
```

**Soak, this round: both scripts, six consecutive rounds, zero failures.**

```
run 1 | demo-path: 14 pass · 0 fail · 1 skip | voice: 8 pass · 0 fail
run 2 | demo-path: 14 pass · 0 fail · 1 skip | voice: 8 pass · 0 fail
run 3 | demo-path: 14 pass · 0 fail · 1 skip | voice: 8 pass · 0 fail
run 4 | demo-path: 14 pass · 0 fail · 1 skip | voice: 8 pass · 0 fail
run 5 | demo-path: 14 pass · 0 fail · 1 skip | voice: 8 pass · 0 fail
run 6 | demo-path: 14 pass · 0 fail · 1 skip | voice: 8 pass · 0 fail
```

**One unreproduced API flake, recorded rather than buried.** On the first
`pnpm --filter api test` of this round the suite reported `1 failed | 887
passed`. Seven consecutive runs afterwards all reported 888 passed, and no run
printed a failing test name I could capture, so I cannot say which test it was
or why. No API source was touched this round. It is one observation in eight
and I could not make it happen again; it is written here because a flake nobody
recorded is a flake that surprises somebody during a take.

One caveat: on a clean checkout `pnpm --filter web typecheck` and one web test
file fail because `worker.ts` imports `./build/server/index.js`, a build
artifact. Run `pnpm --filter web build` first. Pre-existing, unrelated.

Two pre-existing lint errors remain in `app/lib/webmcp/tools.ts` and
`app/components/board/deal-board.tsx` — neither file is in this branch's diff.
A third, a dead `toolNames` helper in `verify-demo-path.mjs`, was also
pre-existing and is removed (`9a9b7b5`) since that file was being edited
anyway; `scripts/demo/` now lints clean.

---

## 2. What shipped

### 2.1 The gate (071)

Four anonymous routes at `/api/public-live/*`: `token` (checks both budgets and
**debits the grant**), `call` (proxies the SDP, captures the provider call id),
`heartbeat` (enforces the grant mid-call, hangs up at the provider),
`close` (settles, refunding the remainder).

Three properties carry the ceiling:

- **Debited up front.** A tab that vanishes mid-sentence has already paid;
  settlement can only ever refund. The ceiling holds against a page that closes
  without saying so — the common case, not the hostile one.
- **Atomic.** A guarded `UPSERT` in D1, mirroring `nga_public_search_quota`.
  Two tabs cannot both spend the last ten seconds.
- **Two independent ceilings.** A per-caller limit alone is not a spend limit;
  it is a spend limit multiplied by however many people turn up.

Storage is D1 (`0023_live_audio_budget.sql`). `live_audio_sessions` is the
ledger — granted, spent, call id, close reason — so a filmed rehearsal's cost
is readable afterwards.

**Defaults**

| Setting | Production | Staging |
|---|---|---|
| `LIVE_AUDIO_SECONDS_PER_CALLER_PER_HOUR` | 180 | 1800 |
| `LIVE_AUDIO_SECONDS_PER_DAY` | 3600 | 7200 |
| `LIVE_SESSION_MAX_SECONDS` | 90 | 300 |
| `LIVE_SESSION_MODEL` | `gpt-realtime-2.1` | same |

≈ $0.36 per visitor per hour, ≈ $7/day site-wide in production; ≈ $14/day
staging. Production runs on code defaults, as it does for
`AGENT_MODEL_CALLS_PER_HOUR`.

**These numbers are my decision, not the owner's.** 071 asks for them as a
spending decision; the brief said to make the call and keep going. One line of
config each — review before filming.

### 2.2 The session (070)

One WebRTC session replaces the recogniser → `gpt-5.6-terra` →
`speechSynthesis` cascade. The rule survives as `output_modalities` on a
request rather than a branch between two subsystems.

Releasing the button commits the audio **without** asking for a reply. That
produces the transcript; the transcript lands in the field the keyboard writes
to and the 1.2s grace bar runs. Send it as heard and the session answers its
own audio. Type over it and the audio item is withdrawn
(`conversation.item.delete`) and the corrected sentence takes its place.

Push-to-talk against every provider example: `turn_detection: null`, and the
microphone track is created disabled and enabled only between press and
release.

Tool calls execute in the browser against `document.modelContext` — the same 25
tools, reads batched and writes ordered as the typed loop does it.

Connection state is on the activity glyph: `·····` → `·∙∙∙·` when open, same
width. Connecting breathes; listening converges inward. Tool work outranks the
connection in both motion and announcement. No panel, no label.

### 2.3 Hardening (`506525d`), all found by running the page

- **A dead microphone.** A browser with WebRTC and no recogniser showed a mic
  on the strength of the session; if that refused, holding did nothing at all.
  It now withdraws. The headless check missed this because it looks for a
  control named "speak your request" and this one is "Hold to speak".
- **An unbounded handshake.** No step of a WebRTC connection fails fast. There
  is now an 8s deadline over the mint, the SDP exchange, and the data channel
  *opening* — the answer arriving is not the same as the session working.
- **A leaked session on unmount** mid-handshake.
- **`response.cancel` with nothing to cancel** returns an error event, which
  this page paints. Now tracked and only sent when something is in flight.

### 2.4 The copy audit (§5b)

"Typing still works" is gone from every string. It is the page reassuring you
about a field you are looking at with a caret in it. What is left is one clause
each:

| Before | Now |
|---|---|
| "You've used this hour's live-audio budget. Typing still works." | "No live audio left this hour." |
| "Today's shared live-audio budget is spent. Typing still works." | "No live audio left today." |
| "Live audio time is up. Typing still works." | "Live audio time is up." |
| "The live connection dropped. Typing still works." | "Live audio disconnected." |

Only one refusal is painted at all — a spent budget, which is the visitor's own
business. A refused permission, a blocked media path, a provider outage: all
silent. The microphone withdrawing is the message. That decision moved from
sniffing message text for "budget" to a `LiveRefusedError` carrying a code,
because the old version broke the moment anyone reworded a sentence — which is
exactly what this commit did.

Screen-reader announcements: `connecting` and `listening` only. An open session
is silent, because a reader announcing "live session open" on every re-render
is the audible form of helper text.

---

## 3. What is NOT verified, and why

**The distinction that matters for the submission:** the *existing* voice path —
push-to-talk, transcript into the editable field, grace bar, spoken reply — is
verified on a browser (§1.1b). The **live realtime session** is a separate,
newer mechanism, and none of it has met a real microphone or the provider.

The demo, as it stands today, runs on the verified path: the API routes for the
live session are not deployed, so the session refuses and the page uses the
recogniser cascade that §1.1b measures. **A submission can safely describe the
voice loop. It cannot safely describe the realtime session as working.**

This machine is headless. The transport is deliberately thin and every decision
worth asserting was pushed into pure functions, but the following are
documentation-derived and have never round-tripped against the live API:

1. **That a session connects at all.** `getUserMedia`, `RTCPeerConnection`, the
   SDP exchange, `setRemoteDescription`.
2. **That the provider accepts our `session.update`** — model id, the flat tool
   shape, `turn_detection: null`, `audio.input.transcription`.
3. **Event names.** If the transcription event name differs in practice, **the
   grace window silently never starts** — the field stays empty after a
   release. Most likely thing to be wrong; check it first.
4. **Interruption within 300ms.** Mechanism is wired; the timing is unmeasured.
5. **Audio playback.** The `<audio>` element is attached to the remote track but
   never inserted into the document; autoplay-while-detached needs checking on
   real Safari and Chrome.
6. **Server-side hangup against a real call.** The heartbeat *closes the session
   and settles the meter* over real HTTP (§1.3); the provider hangup itself was
   stubbed.
7. **Cost per minute in practice.** Arithmetic over published prices, not
   measured spend.

**Also not deployed.** The API routes exist on this branch and are not on the
deployed API. Until they are, the live session refuses on staging and the page
is the typed page — which §1.2 shows is a clean degrade, not a break.

---

## 4. Provider facts, verified 2026-09-04

Read from OpenAI's own documentation and pricing page on **4 September 2026**.
**OpenAI Realtime**, per the brief's default; nothing in 070 required anything
it cannot do.

**Models:** `gpt-realtime-2.1` (flagship, default here), `gpt-realtime-2.1-mini`,
`gpt-realtime-2`, `gpt-realtime-1.5`, `gpt-realtime-translate`,
`gpt-live-transcribe`.

**Pricing**, per 1M tokens:

| Model | Audio in | Cached audio in | Audio out | Text in | Text out |
|---|---|---|---|---|---|
| `gpt-realtime-2.1` | $32.00 | $0.40 | $64.00 | $4.00 | $24.00 |
| `gpt-realtime-2.1-mini` | $10.00 | $0.30 | $20.00 | $0.60 | $2.40 |

At ~600 audio tokens per minute in / ~1200 out, a minute of wall-clock costs at
most ~$0.12 on the flagship, less under push-to-talk.

**Session limits.** Sessions run up to **60 minutes**. Ephemeral credential
expiry is 10–7200s (60 here). **Token expiry gates *starting* a session and
does nothing to one already connected.** That single fact is why the SDP offer
is proxied through the Worker: the answer's `Location` header carries the call
id, and hangup is the only server-side stop that exists. Letting the page
connect directly would mean asking it to report its own id.

**Wire shape that bites.** Realtime tools are **flat**
(`{type, name, description, parameters}`), not nested under `function`. The
nested form is accepted and silently ignored — the session connects, works, and
never calls anything. Pinned by a test.

---

## 5. What I cut

- **Open-mic.** Decided by 070; not revisited. Worth noting every provider
  example ships with server VAD on, so `turn_detection: null` is an active
  choice with a test defending it.
- **Voice-activity barge-in.** Interruption is on pointer-down and on grabbing
  the microphone — push-to-talk's honest equivalent.
- **A `usage_events` row per session.** `api_usage_events.user_id` is `NOT NULL`
  and this surface has no user. `live_audio_sessions` answers the same question
  more directly.
- **A scheduled sweep.** A Worker has no timer without a Durable Object.
  Expired sessions are swept on the next mint or heartbeat. Cost is accounted
  for either way — the grant was debited up front.
- **The gesture payload on the live path.** The typed loop sends
  `describeHumanTurn`'s prose with every request; the live session reads flags
  through `get_view_context` instead. A real asymmetry, and the most worthwhile
  next thing to close.

---

## 6. Observed, not mine to fix

On this machine `search_artworks` returns
`{"ok":false,"error":{"code":"UNAUTHORIZED"}}` — the local dev server has no
search credentials. The refusal is readable rather than a crash, which is the
resilience property working. But it means a typed goal turn runs its loop,
fails every search, and **ends with no note on the wall at all**. The prompt
says never to leave an empty board with a note about finding nothing; here
there is no note. On a credentialed environment this does not arise, and
`verify-demo-path` skips `flags.roundTrip` for the same reason. Recording it
because if it ever happens with working credentials it is a demo-killer, and it
belongs to the turn loop rather than to this lane.
