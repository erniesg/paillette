# Submission evidence

The trail behind `docs/webmcp-vo-script-v2.md`, `docs/webmcp-devpost-v2.md` and
`docs/night/shot-list.md`. Every substantive claim in those files appears here
with its source and its tier.

The build was moving while these were written. **Keep this file current when the
build changes**; it is what makes the other three revisable rather than
rewritable.

## Tiers

- **PROVEN** — a report, a committed transcript or a live measurement attests to
  it. Usable without qualification.
- **BUILT, UNVERIFIED** — the code exists and often has unit tests, but nothing
  has demonstrated it end to end. Drafted around, marked in the script, and the
  shot may not exist.
- **WANTED, ABSENT** — I would like to say it and cannot. Not in the script.
  §4 is the list, and it is the useful half of this document: it says what is
  worth building or shooting next.

Where a report was vague I read the code. Where a number could not be verified I
dropped the claim rather than softening it — §5.

---

# 1. Verified first-hand tonight

Against the deployed build at `https://paillette-stg.berlayar.ai`, 2026-09-04,
headless Chromium, **no `?webmcp-debug`**, zero model calls unless noted. These
are the strongest rows in the table because they were not taken from a report.

| # | What | Result |
| --- | --- | --- |
| V1 | `(await document.modelContext.getTools()).length` on `/nga/search` | **25**, all names read off |
| V2 | Utterance bar without the debug flag | `[aria-label="Ask the agent"]` present and visible; `window.__paillette_webmcp` **absent** |
| V3 | `warm landscape` | **30** results |
| V4 | Focus at cold load | `BODY` — culling keys live |
| V5 | Hover + `X`,`X`,`P` | flags land, `data-flag-by="human"` |
| V6 | Enter on the empty bar | **1** POST `/api/public-search/nga/exemplars`, **0** to `/public-agent/turn` |
| V7 | The dealt board | `{"cards":12,"fullyVisible":12,"gridHeight":724,"viewport":1000}` |
| V8 | The reject tray | `.lt-tray` present, **2** items, after both redeals |
| V9 | Second Enter (board → board) | same again; 12/12 visible, 0 model calls |
| V10 | Whole run's API traffic | `quota`, `text`, `exemplars` ×2, `usage` — **no agent route** |
| V11 | `.lt-enter-armed` | absent before the first flag; `"↵"` after |
| V12 | The screen-reader line | `sr-only[role="status"]` = *"Enter on the empty bar redeals the board from your flags."* |
| V13 | The activity glyph at rest | `.pa-activity-glyph`, text `·····`, **68 × 33 px**, with no agent on the page |
| V14 | Clicking the glyph | panel 460 × 276 px: `document.modelContext · 25` then all 25 names. **0 model calls.** |
| V15 | `C` on a hovered card | `{"box":{"x":0,"y":0,"w":1440,"h":1000},"portalled":true,"chromeVisible":[],"askedBy":"human"}` |
| V16 | Keyboard-only flagging | **23** Tabs from cold load reach `BUTTON` / `"Pick Environs de Cremieu (P)"`; `[data-hovered="true"]` set by focus; `x` flags it `by:"human"`; `aria-pressed` reflects it |
| V17 | The exhibition head after one pick | `1 WORK` / `COPY LINK` — no placeholder prose |
| V18 | `GET /e/MKwsxHy` | `200`, 16,862 bytes |
| V19 | `/e/MKwsxHy` cold in a fresh context | `<h1>` *Everything the Light Left Behind*; colophon `4 of 6 labels written by an agent`; **0 localStorage keys read** |
| V20 | Open Graph, Slackbot UA | `og:title`, `og:description`, `og:url`, `og:image` on `api.nga.gov/iiif/…`, `twitter:card = summary_large_image` |
| V21 | `GET /exhibition` with no payload | `302 → /nga/search` |
| V22 | `pageerror` across every run above | **zero** |
| V23 | Artwork dialog on a cold NGA work | buttons `["Laurent de La Hyre","Public metadata","Copy"]` — **no read-aloud control** |
| V24 | A **deterministic** redeal produces no wall label | `{"label":null,"swatches":0}` — so the swatch strips only ever appear beside an agent note. Correct per §5b, and it means the frame costs model calls. |
| V25 | The note with its swatches, captured | `shots/50-note-with-swatches.png`. Note verbatim, swatch colours, strip flags in `e2e-evidence/note-swatches.json`. 3 model calls, 0 page errors. |
| V26 | The inverted condition | flags set correctly (`by: human`), turn returned **`429 AGENT_RATE_LIMITED`** — *"You have used this hour's shared agent budget."* No frame. `e2e-evidence/note-swatches-inverted.json`. |
| V27 | What the page shows on a 429 | **nothing.** No note, no error, no `pageerror`. `grep -r AGENT_RATE_LIMITED apps/web/app` → no UI branch. |
| V28 | `U` clears a flag it set | `{"flag":"none","by":"none"}` — the one key no earlier harness pressed |
| V29 | Flags survive an **in-page** search | `{"picks":1,"rejects":2,"modelCalls":0}`. A `page.goto` is a reload and loses them, which is documented behaviour, not a defect. |
| V30 | `get_view_context` flag entries carry visual facts | `{"picks":1,"rejects":2,"palette":["#B89E81","#644F3F","#F4E8D6","#DCB17F"],"medium":"watercolor and graphite on laid paper"}` |
| V31 | Two colours of ink, off computed styles | human: `box-shadow rgb(230,227,220) 0 0 0 1px`, `outline-style: none`, `provisional false`. agent: `outline-style: dashed`, `by: agent`, `provisional true`. |
| V32 | `flag_artworks` / `compare_artworks` / `lookup_artwork` on ids that do not resolve | structured errors with hints — `ARTWORK_NOT_IN_SESSION`, `INVALID_INPUT`. No throw, no empty room. |
| V33 | Enter with no flags at all | page does not blank, no error, `↵` correctly absent, **zero requests made** |
| V34 | The whole of the above, three times | **64 checks, 0 failures, no flakiness.** `e2e-evidence/demo-path.json`, `docs/night/verify-demo-path.mjs`. |

Reproduce: the scripts are ad-hoc but every check maps onto a committed harness
in `scripts/demo/`. The browser driver on this VM needs
`PLAYWRIGHT_CORE=/opt/rucksack-app/production/erniesg-remora/releases/manual-20260630131336/node_modules/playwright-core/index.mjs`
and `executablePath: ~/.cache/ms-playwright/chromium-1194/chrome-linux/chrome`
(the bundled driver wants build 1208; only 1194 is installed).

---

# 2. PROVEN

## 2.1 The deterministic loop

| Claim | Source |
| --- | --- |
| Enter on an empty bar redeals from the human's flags with **no model call** | **27 separate redeals across five harnesses in e2e iteration 2, each with its own negative check, zero POSTs to `/api/public-agent/turn`**, counted off the wire. Plus V6, V9 first-hand. Asserted negatively, so it fails if a call ever appears. |
| The entire deterministic run is four requests | `e2e-evidence/deterministic-network.json` — quota, text, exemplars, exemplars. Re-derived live (V10). |
| Both paths work — caret in the empty bar, and nothing focused | `e2e-report.md` §2.3: `isEmptyUtteranceBar` and `isBareBoardEnter`. |
| It works with **no WebMCP host at all** | `e2e-report.md` §2.3 / `e2e-17-no-host-deterministic-redeal.png`: `no prompt bar without a host: count=0`; `Enter on the bare board redeals, with no agent anywhere`. |
| It works with the model route hard-refusing **429** | `verify-agentless-loop.mjs` — 9 checks, three runs in a row (`shared-state-report.md`, `critique-iteration-1.md` §1). |
| Picks hold their exact slot | Integration iter 2: `220,144 → 220,144` and `500,144 → 500,144`, **zero pixels**. `e2e-report.md` §1.2: `{"page":{"dx":0,"dy":0},"board":{"dx":0,"dy":0}}`. |
| It deals rather than cuts | **Fourteen board-to-board redeals: 16 19 21 22 22 22 24 24 24 25 25 27 28 28** distinct layouts (e2e iteration 2 §3 step 6). First redeals measure 3–18. A jump cut is **4–5**. |
| The loop stays correct as the board empties | e2e iteration 2 §4, 18 rounds across two queries: **zero rejects ever on the board, the rendered board matched `board.order` every time, the pick held every time, zero model calls.** |
| ⚠ **but the board runs out after ~5 redeals in one tab** | e2e iteration 2 §4. Fifth Enter is the last full board; seventh is one card; Enter then dead. Cause is arithmetic in `apps/api/src/routes/search.ts` — a fixed ~66-work candidate pool minus everything already dealt. **Not a defect in the loop; a hard limit on a take.** Reload between takes. |
| Twelve cards, all visible | V7, V9. Fix log §8: `{"cards":12,"visible":12,"gridHeight":724,"viewport":1000}`. |
| Rejects go to a visible, restorable tray | V8. Fix log §8. |
| Flagging fires no model call | `e2e-report.md` §2.2: "3 requests during flagging, none to the agent route". |
| `P`/`X`/`U` are suppressed while a text field holds the caret | `board-keyboard.ts:131`, `isTextEntry`. |
| The scoring route makes no embedding call | `shared-state-report.md`: every vector is already indexed; asserted by `exemplar-search.test.ts`. |
| The negative term is `max`, not `mean` | `shared-state-report.md`, live probe: under `mean` the rejected calm bay climbs back to third; under `max` the board stays stormy. |

**The single strongest claim in the submission**, in the critique's own words:
it is the only one asserted negatively.

## 2.2 The agent's narration is grounded in the pictures

| Claim | Source |
| --- | --- |
| Every flagged work reaches the agent with its four indexed swatches, medium, year and classification | `negative-control.json` → `flagsTheAgentSaw.rejects[]` carries `palette`, `medium`, `year`, `classification`. `toAgentVisualFacts`, `artwork-summary.ts`; `describeFlags` in `tools.ts`; `visualsOf` in `turn.ts`. |
| One prompt line tells the model to name the visual property in the record, not a mood | `apps/api/src/routes/agent.ts:73`, verbatim in §6 below. |
| The tool result repeats it | `tools.ts:910` — *"each entry carries the palette, medium and date printed on its card: say what those show, not what you remember about the artist."* |
| Two inverted conditions, four notes, and the two conditions **never produced the same note** | Fix log §2. |
| Three of the four name the rejected works' actual colour, correctly and differently in each direction | Fix log §2 — "brown-and-ochre" for the dark pair; "tan-and-cream" and "muted beige and umber" for the pale pair. |
| The fourth describes the board without referring to the rejects | Fix log §2, Run B darkest: *"Warm colour in four registers: sunset gold, ember rust, peach, and softened terracotta."* Not wrong; not the beat. **Represent this honestly.** |
| The swatches the note was written from are drawn under it | `negative-control.json`: `swatchesBesideTheNote: 2`, `rejectSwatches: 2`. `NoteSwatches` mounted at `galleries.$galleryId.search.tsx:2932`. **Proven in the DOM; see §3 for the frame.** |
| Picks whole, rejects struck through, no words | `note-swatches.tsx` — `data-flag`, titles carried in `title`/`aria-label` only. |
| The agent's note is one sentence | Every recorded note across the e2e runs, the sofa runs and the negative control. |

**Verbatim, the pair the film uses** — captured tonight, `note-swatches.json`,
frame at `shots/50-note-with-swatches.png`:

> *"You said warm; you kept the bone-and-umber etching and rejected the darker,
> greener palettes — following the picks."*

The three strips under it, from the same capture:

| | work | leading swatches | the word |
| --- | --- | --- | --- |
| pick | *A Rocky Pond* | `#EBD8BC` `#907F6A` `#695943` | "bone-and-umber" |
| reject | *Environs de Cremieu* | `#B89E81` `#644F3F` `#F4E8D6` | — |
| reject | *Flying Shadows* | `#47502B` `#9A8B57` | "darker, greener" |

**The inversion, on one work** — `open-access-art:nga:52306`, Berthe Morisot,
*Landscape*, colored pencils, palette `#D4C7A2 #B6A385 #9A886C`. Archived in
`iteration-2/run3-loop.json` at `"to":"pick"` and `run4-loop.json` at
`"to":"reject"`:

> *picked* — "You kept the pale ochre pencil landscape and rejected the darker
> peach palette — following its quiet, airy warmth."
>
> *rejected* — "Following your warm oil-on-wood fruit pick and moving away from
> the pale colored-pencil landscape you rejected."

Same work, same palette, described the same way, moved to the other side of the
sentence. **This supersedes the negative-control pair** used in the first draft,
which survived only as a console transcript.

**Four runs, four notes, all naming content** (e2e iteration 2 §3 step 4). Three
of the four name the rejected work specifically enough to recognise on screen.
Run 1 — *"darker, crowded scenes"* — is the weak one: accurate, but generic on
camera. **If a take produces one of those, shoot it again.**

**Two caveats.**

1. **The strips do not carry `data-flag-by`** — they show *that* a work was
   flagged, not by which hand. The one place the two-colour contract is not
   carried (e2e iteration 2 §7.1).
2. **The inverted frame does not exist.** I set the flags correctly and the turn
   came back `429 AGENT_RATE_LIMITED`. Two agent turns and a fresh budget hour
   would produce it.

**What this does *not* prove.** The agent never called `lookup_artwork` or
`describe_artwork` in any recorded run — zero across all three e2e runs
(`agent-runs.json`, critique §2). It is grounded in indexed colour, medium and
date, which is a real improvement on titles and artist names, and is *not* the
same as looking at the picture. Do not write "the agent looks at the work".

## 2.3 Gestures outrank words

| Claim | Source |
| --- | --- |
| Every human turn carries `{ text, flagsDelta, selection, hovered, compareChoice }` | `turn.ts`. Verbatim first-request body in `e2e-report.md` §2.4. |
| The agent names the said/chose gap | `shared-state-report.md`, nine consecutive runs: *"You said warm; you picked the grey harbour and rejected the golds — following the picks."* Two of three e2e runs also name it. |
| Flags survive a deterministic redeal and are still in the delta for the next turn | `e2e-report.md` §2.4 — `peekTurn` reports gestures without spending them. Verified, not assumed. |
| A compare choice rides the next turn rather than firing one | `compare-turn-payload.json` — the winner, loser and question arrive in the next request body. Deliberate; documented in `turn.ts`. |

**⚠ The behaviour comes from the system prompt, not from the payload.** The
shared-state lane says so itself: *"Do not claim the payload is what makes the
agent follow the picks."* The payload's job is narrower — it puts the gesture
delta, with titles and visual facts, into the first request of a turn. The
Devpost text is written to respect that distinction.

**⚠ The nine-run said/chose evidence used eight fixture works with invented
titles, not the NGA.** The behaviour is real; those pictures are not. The
three NGA e2e runs are the ones to cite for real works.

## 2.4 Curation

| Claim | Source |
| --- | --- |
| The agent drafts a title, a statement and a label per work | Curation walk on the deployed build, **11 of 11 pass** (fix log §5). `curation-walk.json`. |
| Committing the statement is itself the turn | Fix log §7 — **2 POSTs to `/public-agent/turn`** after the edit. Before the fix nothing called `submitHumanTurn` at all; the correction sat in the journal. |
| It re-selects and rewrites every label against the correction | Fix log §7: **18 of 18 rewritten**. Curation report Batch 2: **3 of 3** runs. `curation-walk.json` holds both label sets verbatim. |
| It does not overwrite the human's sentence | Fix log §7. Curation report: statement returns `by:"human", theirs:true`; an agent write onto an edited field is parked under `deferred`. |
| The same work gets a different label under a different statement | `labels-ab.json` — same six works, two statements, live model, **0 of 6 byte-identical**, and not paraphrases. |
| A captioned work produces a picture-grounded contextual pair | `curation-report.md`, Bruegel, `source: caption`. |
| The defect this found first | Curation report Batch 1: in runs 2 and 3 the agent re-selected and **never called `write_labels`**, leaving labels written against the rejected theme. Fixed by putting `write_labels` first in the correction prompt (`2c68575`). |

**⚠ All twelve labels in the A/B were `writtenFrom: "catalogue"`** — those six
works have no stored caption. The prose is contextual and it is grounded in the
catalogue record, not in the image. This is the weakest point of the "searchable
by what the pictures look like" promise and the script must not paper over it.

## 2.5 The shareable exhibition

| Claim | Source |
| --- | --- |
| `https://paillette-stg.berlayar.ai/e/MKwsxHy` resolves and opens cold | V18, V19. Sharing report; `shots/share-cold-open.png`. |
| Nothing to hydrate — the loader re-fetches every record by id on the server | Curation report. All six `<img>` reached `complete === true` with `naturalWidth > 0` (sharing report). |
| Real Open Graph tags, `og:image` on the NGA's own IIIF endpoint | V20. Sharing report fetched the image directly: `200 image/jpeg, 246,943 bytes`. |
| The colophon is counted from the data | V19 — `4 of 6 labels written by an agent`, matching the four sent as agent-written. |
| `/exhibition` with no payload redirects rather than 404s | V21. Sharing report: `status=302 location=…/nga/search`. |
| `/exhibition?e=…` still renders — the show also travels in the URL | Sharing report. Curation report measured the payload: 12 works ≈ 2,150 chars, 24 works ≈ 3,280 chars. |
| Ids are validated before the row is written | Sharing report, live: a show with one real and one fake id returned `{"works":1,"dropped":1}`. |
| Short codes are rejection-sampled from `crypto.getRandomValues` over a 57-character alphabet | `share-codes.test.ts`, uniformity check over 70,000 characters. |

**⚠ No unfurl has ever been rendered in a real client.** Tags and image were
fetched with curl and a headless browser; nothing was pasted into Slack,
WhatsApp or X.

**⚠ No delete, no expiry, no moderation, and `view_count` counts crawler hits.**
Staging only. Do not imply production-readiness.

## 2.6 WebMCP surface and instrumentation

| Claim | Source |
| --- | --- |
| **25** tools on `document.modelContext` | V1, V14. `PAILLETTE_TOOL_COUNT` derives it from one list; `registry.test.ts:424` asserts 25. Fix log §11: counted live against the deployed build. |
| The utterance bar renders with no `?webmcp-debug` | V2. Fix log §10: the stub host is claimed on every visit; only `window.__paillette_webmcp` stays behind the flag. |
| The glyph is five cells at rest and animates by tool kind | V13. Activity report: six motions — `scan`, `look`, `deal`, `mark`, `build`, `read` — asserted by 32 checks across three consecutive runs. |
| The log shows tool name, arguments, duration, one-line result, expandable to full JSON | `shots/activity/08-log-row-expanded.png`, `07b-log-detail.png`. |
| No chrome narrating the mechanism | Fix log §9: "AGENT ACTIVITY", "WEBMCP CONNECTED", "PINNED BY THE AGENT", "TOOL CALLS" grep to nothing but one `aria-label`. Placeholder, "Ask", "Search", `/ 0MS` cut. Verified live: `placeholder: ""`. V17. |
| The registry feature-detects `document.modelContext` then `navigator.modelContext`, returns a no-op disposer when neither exists, reference-counts by name, and probes three teardown paths | `registry.ts:1–90`. |
| The remount race is real and was fixed | `registry.ts` — the per-name queue outlives the entry. Review lane measured `before: 0 / after: 17` tools in a headless browser. |
| `compare_artworks` is a room: portalled to `document.body`, all other body children hidden | V15. Fix log §3: `box {top:0,left:0,w:1440,h:1000}`, `portalled: true`, `chromeVisible: []`. Was ~1,700 px below the fold two iterations ago. |
| The deal board outranks `set_view` | Fix log §4 — `dealtBoard` is the first branch in `ResultsLayout`; the grid survives salon, atlas, table and masonry. |
| Every tool in the culling loop wraps a key the human presses | V5, V6, V15, V16 — `flag_artworks`↔P/X/U, `redeal`↔Enter, `compare_artworks`↔C, all driven from the keyboard with zero model calls. |

## 2.6b Failure paths and empty states

| Claim | Source |
| --- | --- |
| A tool called with ids the page never loaded fails loudly | V32. `flag_artworks` → `{"ok":false,"error":{"code":"ARTWORK_NOT_IN_SESSION","message":"None of those ids have been loaded by this page.","hint":"Search or read get_view_context first…"}}`. `compare_artworks` names both offending ids and does **not** open an empty room. |
| Pressing the headline key before it means anything costs nothing | V33 — Enter with no flags makes **zero requests**, shows no error, and the `↵` affordance is correctly absent until a flag exists. |
| A deterministic redeal that fails says so in one sentence | `paillette-deal-error`, *"The deal didn't run; your flags are unchanged."* `galleries.$galleryId.search.tsx:2905`. |
| ⚠ **An agent turn that fails says nothing at all** | V26, V27. `429 AGENT_RATE_LIMITED` → no note, no error, no page error. No UI branch exists. The asymmetry with the row above is the finding. |

## 2.7 Accessibility

| Claim | Source |
| --- | --- |
| Focus, not only hover, sets the flag anchor | V16. `flag-controls.tsx:147` — `onFocus: point`, `onBlur: unpoint`, with the comment saying exactly why. |
| The flag control's accessible name carries the work and the key | V16 — `"Pick Environs de Cremieu (P)"`, `"Reject Environs de Cremieu (X)"`, with `aria-pressed`. |
| The headline beat is announced to a screen reader | V12. The visible affordance is a mark (`↵`); the sentence exists once, `sr-only`. |
| The swatch strips carry title and flag in `aria-label` and no visible words | `note-swatches.tsx`. |
| The grace bar's countdown is a visually hidden `role="status"` | Voice-loop report. |

## 2.8 Scale and corpus

| Claim | Source |
| --- | --- |
| 63,253 open-access works | `docs/HANDOFF.md` — paged `/api/public-search/nga/browse` to the last record. Rendered live on `/about`. **Not re-derived tonight.** |
| `warm landscape` returns 30 | V3. Fix log §10 measured it four times, plus nine other queries at 30. |
| `storm at sea` returns 4 | Fix log §10 — the prompt's own example of a *goal* rather than a query. |
| The anonymous model budget is 40 calls per client per hour | `MAX_AGENT_MODEL_CALLS_PER_CLIENT_PER_HOUR`. A typed instruction costs 3–6; a curation walk 10–14. |

## 2.9 Voice — proven in a browser, but typed

| Claim | Source |
| --- | --- |
| A typed instruction alone fires the agent, no microphone | Voice-loop report; e2e §2.1; three runs. |
| *"more like this one"* binds to the pointed-at work and draws a chip with its thumbnail — typed, mic absent | Voice-loop report, verified in the browser. |
| *"something between these two"* binds to a shift-click selection and draws both thumbnails, with no "2 works" caption | Voice-loop report, verified in the browser. |
| The referent survives the cursor leaving the card | Voice-loop report. |
| The *plumbing* of the spoken path works in a real browser | `verify-definition-of-done.mjs`, **12/12** on the deployed build (integration iter 2): a transcript lands in the editable field, the grace commits it as one turn, and `speechSynthesis.speak` is called after a spoken turn and **not** after a typed one. |

**⚠ That 12/12 is not evidence that speech works.** The harness stubs both
`SpeechRecognition` and `speechSynthesis`, and says so itself: *"This does not
make the speech real. It makes the plumbing real in a real browser."* Real
recognition returns nothing on this VM and there are no voices to speak with.
The claim that is earned is narrow and worth having — **the wiring is right, and
the symmetric rule is a contrast that has actually been observed** — but it is
not a spoken take.

## 2.10 Provenance ink

| Claim | Source |
| --- | --- |
| Two colours of ink are visible in every state | `verify-definition-of-done.mjs`, **11/11** on the deployed build (integration iter 2) — §9's fifth clause. |
| Graphite for the human, a coloured ink for the agent, dashed for provisional | Visuals report; `03-agent-provisional.png`, `03b-ink-detail.png`, `04-agent-confirmed.png`. Live: `data-flag-by="human"` on every key-pressed flag. |
| An agent's flag is a proposal until the human confirms it with the same key | `flag_artworks` description, `tools.ts:1341`; provisional flags do not move the exemplars the deterministic redeal runs on. |
| Provenance is ink, not a caption | Shared-state report: the *"assembled by the agent"* caption was removed and replaced by `data-provenance` on the wall label. Verified live — no such string on the page. |

---

# 3. BUILT, UNVERIFIED

Marked in the script. **The shot may not exist.**

| Claim | What exists | What is missing |
| --- | --- | --- |
| **The inverted note, as a frame** | Both notes archived verbatim with their `"to":"pick"` / `"to":"reject"` payloads (`iteration-2/run3-loop.json`, `run4-loop.json`) | No frame. Attempted tonight; the turn returned `429 AGENT_RATE_LIMITED`. Two agent turns in a fresh budget hour would produce it. *(The non-inverted frame is now **PROVEN** — see V25.)* |
| **Read-aloud** | `SpeakButton`, label *"Read this aloud"*, feature-detected, mounted at `galleries.$galleryId.search.tsx:4827` and `try.tsx:1257`, reading `caption \|\| rootsDescriptionDetails.text` | It renders **only where the work has a stored caption or description**. V23: a cold NGA work offered no read-aloud control. Headless Chromium here has **zero voices**. No audio has ever been produced from this build. |
| The whole spoken path | Push-to-talk on the mic or Space; a 1.2 s grace bar; Esc restores; the note spoken back only after a spoken turn | `recognition.start()` returns nothing on this VM — no `onresult`, `onerror` or `onend`. Zero voices for output. Voice-loop's own words: *"No audio has been produced on this machine."* The 1.2 s is the brief's number, not a tested one. |
| A cold agentic run landing on the deal board | `dealtBoard` is now the first branch in `ResultsLayout`; fix log measured it surviving `set_view` | **No capture of a cold agentic instruction since that fix.** The one committed frame is the run where the agent chose salon and the board lost its grid. |
| `prefers-reduced-motion` holds a pick's slot | 25 layouts at `no-preference` vs 4 at `reduce`; the pick held `0,0` | Only spot-checked with a pick **already in slot 0**. A pick starting at slot 5 is untested — the exact case the integration lane worried about. |
| The clipboard fallback | Five unit tests over the no-clipboard branch; a visible, focused, pre-selected read-only field | Never seen in a real browser — every browser drivable here has a working `navigator.clipboard` over HTTPS. |
| `describe_artwork` has a human path | The tool is registered and works | No "generate a description" control was found in the UI. Unresolved; do not claim it in the two-operator table. |

---

# 4. WANTED, ABSENT

Things I would have written and did not. **This list is a deliverable.** Ordered
by what it buys. Items 1 and 2 of the previous draft are struck — the frame was
captured tonight and the inversion is archived.

1. **A UI branch for `AGENT_RATE_LIMITED`.** When the hourly budget is spent the
   turn 429s and **the page shows nothing at all** — no note, no error, no page
   error. `grep -r AGENT_RATE_LIMITED apps/web/app` finds no handler. The
   deterministic path already has exactly this affordance
   (`paillette-deal-error`: *"The deal didn't run; your flags are unchanged."*),
   so the fix is one branch in the same shape. **This is the most likely way a
   take gets wasted, and the most likely way a judge concludes the demo is
   broken.** I hit it myself tonight, mid-capture. *One line of UI.*

2. **A bigger exemplar candidate pool.** Five clean redeals per pick set per tab,
   then the board thins to one card and Enter goes dead. Diagnosed precisely in
   e2e iteration 2 §4: `topK × 6` capped at 100, minus a growing exclusion list.
   Filmable as-is if you reload; not survivable by a judge who sits and presses
   Enter, which is exactly what the `↵` affordance now invites them to do.

3. **The inverted note, framed.** The text is archived on both sides
   (`run3-loop.json` / `run4-loop.json`, the same Morisot at pick and at reject).
   Two agent turns in a fresh budget hour and beat 3's second card is real.

4. **`data-flag-by` on the swatch strips.** The one place on the page where the
   two-colour contract is not carried. Invisible in the film; a real gap.

5. **The agent actually looking at a work.** `lookup_artwork` and
   `describe_artwork` were called **zero** times across every recorded run, in
   both iterations. The narration is grounded in indexed colour, medium, year and
   classification — a real improvement on titles, and not the same as seeing the
   picture. Today I cannot write "the agent looks at the work" and I have not.

6. **The ledger filmstrip on `/nga/search`.** Built, tested, imported only by
   `/night/deal`. It is §7.5 — *"version history reused as conversation record"* —
   and the answer to "where did the chat go". Until it is on the product page it
   cannot be filmed.

7. **An affordance for `P`/`X`/`U`.** Enter has one now and it is good. The keys
   that arm it have nothing, so a judge still cannot find the loop cold.

8. **A human control behind `write_labels` and `annotate_atlas`.** The only two
   of twenty-five with no key or click behind them, and the one dent in "the loop
   has no agent-only path". A *draft this* button closes it.

9. **A read-aloud take on a work that has a caption.** The control is real and
   the argument is good, but on the NGA collection most rows have no caption and
   the button does not render (V23). Find one, or cut the beat.

10. **A visible failure for push-to-talk with no microphone.** It enters
    *"Listening — release to send"* and on release nothing lands and nothing is
    reported (e2e iteration 2 §6). Same silent-failure shape as item 1.

11. **A spoken take.** Not shootable on this VM. Nothing in the script depends on
    it — but a submission about human–agent collaboration with no human voice is
    leaving something on the table.

12. **A raised model cap for the filming machine.** 40/hour, 5–7 per cold
    instruction, 8–12 per loop: three or four takes an hour. It blocked me
    tonight and it blocked the fix lane's third negative-control run.

13. **A social unfurl, rendered.** Tags right, image real, nobody has pasted it
    into Slack.

14. **`prefers-reduced-motion` with a pick starting at slot 5.**

15. **A compare choice that sends a turn immediately.** The build defers it to the
    next turn, which I think is right and the brief's P4 says otherwise. Known and
    documented — but on camera a compare answered in silence needs the next
    utterance to become visible.

# 5. Claims I dropped rather than softened

- **"The agent sees the pictures."** It sees four hex swatches, a medium, a
  year and a classification. Real, checkable, and not the same thing.
- **"Labels are written from the image."** Twelve of twelve in the A/B were
  written from the catalogue.
- **Any percentage or hit-rate for the negative control.** Four notes across two
  runs is not a rate. The script says *three of four*, which is what happened.
- **"No agent-only API."** Two tools have no human path. The script says *"the
  loop has no agent-only path"*, which is true and checkable.
- **Anything about the ledger, the atlas regions, or `/night/deal`.**
- **Any claim about voice being demonstrated.**
- **A total test count.** The reports give 59/593 → 68/737 → 91/1112 → 94/1171
  for web across the night as lanes merged. The number in the Devpost is
  qualified with *"at the last full run"* rather than asserted.
- **"Sixty-three thousand works, narrowed to five."** The board is twelve and the
  recorded show was six. If a line needs a count, count it on the day.

---

# 6. Verbatim, for whoever revises this

**The prompt line that grounds the note** (`apps/api/src/routes/agent.ts:73`):

> "Every flagged work reaches you with the palette, medium and date printed on
> its card. Name the visual property you can see in that record — the colour
> they threw out, the medium they kept — not a mood you associate with the
> artist's name. 'You rejected the two darkest palettes' is checkable against
> the swatches beside the note; 'leaving the pastoral behind' is a guess about a
> name, and on an artist neither of us knows it is a guess that will be wrong on
> camera."

**The 25 tools**, read off the deployed build tonight:

```
add_to_collection  annotate_atlas      browse_collection   compare_artworks
create_collection  describe_artwork    flag_artworks       get_exhibition
get_index_status   get_search_quota    get_view_context    index_folder
index_zip          list_collections    lookup_artwork      redeal
search_artworks    search_by_color     search_by_exemplars search_by_image
set_exhibition     set_results         set_view            show_artwork
write_labels
```

**What `get_view_context` hands the agent about a flagged work**
(`get_view_context.json`, fix iteration 1):

```json
{ "id": "open-access-art:nga:50295", "title": "Peaceful Valley",
  "artist": "Alexander Helwig Wyant",
  "palette": ["#DEB585", "#3B2F1F", "#715023", "#B09176"],
  "medium": "oil on canvas", "year": 1872, "classification": "Painting",
  "by": "human", "onBoard": false }
```

---

# 7. Stale facts in the repo, as of this writing

Do not copy from these without correcting them.

| Where | What is wrong |
| --- | --- |
| `docs/webmcp-devpost-fields.md` (×3) | "seventeen tools". It is **25**. |
| `docs/webmcp-vo-script-final.md` | The whole framing — delegation, *"eyes and ears"*, a board that ends the interaction. Superseded, deliberately left in place. |
| `docs/night/e2e-report.md` | **Now carries iteration 2 first, then iteration 1 below it.** Read the top half. Iteration 1's three blockers — compare below the fold, `set_view` outranking the board, twelve cards not fitting — are all fixed and were each re-checked in iteration 2. Iteration 1 also reports **21** tools and *"warm landscape returns zero works"*; both are wrong now. |
| `docs/webmcp-vo-script-v2.md`, `docs/night/shot-list.md` before commit `20b9192` | Cited 35 s for a cold instruction (it is 42–59 s), "twelve" for the agent's first board (8–12), and said the note-with-swatches frame did not exist (it does — `shots/50-note-with-swatches.png`). |
| `docs/night/critique-iteration-1.md`, `verdict.json` | The verdict is **FAIL** against iteration 1. Nine of its eleven blocking items are addressed in `fix-log.md`; its `nice_to_have` list is untouched and is the source of §4 items 5, 6, 7, 12 and 13. |
| Lane reports saying "21 tools" | True when written. The exhibition tools took it to 25. |
| The brief's baseline of web 59/593, api 41/770 | Predates the curation, activity and review merges. |
