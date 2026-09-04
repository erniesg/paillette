# Live agent session: one conversation, text or speech, either way

depends-on: 071

## Goal

Replace the turn-based voice cascade with a single live session that accepts
text **and** speech as input and returns text **or** speech as output, without
the human choosing a mode.

Today the page runs two separate paths joined by a rule:
`webkitSpeechRecognition` → text → `gpt-5.6-terra` → `speechSynthesis`, with
"text in, text out; voice in, voice out" deciding which. It works, but it is
turn-based: there is no barge-in, the recogniser is browser-dependent and cannot
run headless, and the two paths can drift apart because they are two paths.

A live speech-to-speech session with native function calling collapses them. The
seam disappears because there stops being two things to join. A typed message can
be injected into an active audio session and answered in audio; speech can be
answered in text. That mixed modality inside one session is the reason to do
this — more than latency, more than interruption handling.

**This does not replace the typed path.** Text stays primary and the loop must
work with the session closed, disconnected, or unsupported. Live is a mode the
human opts into, not the mechanism.

## Why it suits this project specifically

The tools live in the browser on `document.modelContext`. A live session emits
function calls, the browser executes them against the same 25 tools the human
drives by hand, and results return to the session. The voice agent becomes
another operator of the same tool surface rather than a second, parallel way in
— which is the WebMCP argument the submission already rests on, made stronger.

## Provider decision — needs a human choice before build

Two candidates, same shape: native audio in/out with function calling in one
session. **Push-to-talk is decided** (see Interaction notes); only the provider
is open.

- **OpenAI Realtime.** The repo already runs on OpenAI (`gpt-5.6-terra`,
  `gpt-5.6-luna`) and the key is already provisioned, so no new vendor.
- **Google Gemini Live.** Comparable capability; adds a second provider and a
  second key to manage.

Verify current model identifiers, modality support and per-minute pricing
against the provider's own documentation at build time rather than from memory
— these move, and the cost model is the part that decides whether this can be
public at all.

Label `rucksack-needs-decision` until a provider is chosen.

## Acceptance tests

- With the session closed, every existing beat still works by typing: search,
  `P`/`X`/`U`, Enter-on-empty-bar redeal, exhibition drafting. No regression.
- Opening the session requires no API key in the browser; the client receives a
  short-lived token minted server-side (see 071).
- A typed message sent during an open audio session is answered in the session,
  not by the old text path.
- A spoken request that requires a tool results in a real call against
  `document.modelContext`, executed in the browser, with the result visible on
  the page.
- Interrupting the agent mid-utterance stops playback within 300ms.
- Press-and-hold starts capture, release ends it, and the transcript lands in
  the same editable field the keyboard uses. Releasing does not immediately
  commit: the existing grace window still applies, so a spoken utterance can be
  corrected by typing before it is sent.
- The agent's spoken reply stays within one sentence; the board carries the rest.
- Closing the session, losing the network, or an unsupported browser degrades to
  the typed path with a readable state, never a dead control.
- `prefers-reduced-motion` and screen-reader behaviour of the connection control
  are unchanged from the existing mic affordance.

## Interaction notes

- The connection state belongs on the existing activity glyph, which already
  animates for tool activity. A connected state is one more thing it can show —
  not new chrome, and not a labelled panel.
- Per the house rule, no helper text explaining what live mode is.
- **Push-to-talk, decided.** Hold to talk, release to send. Not open-mic: on a
  public unauthenticated page an open microphone is an unbounded cost with no
  natural end, and it is indistinguishable from normal use while it runs. Hold
  also gives the human an unambiguous "the agent is listening now", which an
  always-on mic never does.
- Keep the existing 1.2s grace bar on release: the utterance is editable as text
  before it commits. That is what makes the two modalities one conversation
  rather than two — you can start by speaking and finish by typing.

## Validation command

```bash
pnpm --filter web typecheck
pnpm --filter web test
pnpm --filter api test
```

Live audio cannot be verified headlessly. State plainly in the evidence which
parts were exercised against a real session on a real machine and which were
only unit-tested.

## Allowed secrets

Names only, never values: `OPENAI_API_KEY` (already present) or
`GEMINI_API_KEY` if Google is chosen. The browser must never receive either.

## Stop conditions

Stop before shipping a live session to an unauthenticated public page without
the quota gate in 071 landing first; before putting any long-lived provider key
in client code; and before making the typed path depend on the session existing.

## Human clarification protocol

Ask before choosing the provider. Push-to-talk is already decided; do not switch
to open-mic without asking, whatever the provider's examples default to.
