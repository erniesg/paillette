# Iteration-4 end-to-end shots

Flip through in filename order. Everything here is deployed staging
(`https://paillette-stg.berlayar.ai`, web `76f4f6b7`, api `b1e32e84`), at
1440×900, typed, with the mic never pressed. The script that produced each shot
is named so it can be re-run.

## The loop, in the order §9 asks for it — `scripts/demo/e2e4/loop.mjs`

| shot | what it shows |
| --- | --- |
| `00-cold-load.png` | `/nga/search?q=warm landscape&webmcp-debug` cold. The agent bar is on the page; focus is on `BODY`, so `P`/`X` are live immediately. |
| `01-after-instruction.png` | The typed sofa instruction alone dealt this board and wrote the cyan wall label above it. Two inks, one frame. |
| `01b-activity-log.png` | The activity log opened by hand: the seven tool calls that produced the board, with arguments and durations. |
| `02-flagged.png` | `X` on two works, `P` on one. Graphite hairline frames, corner badges, no model call. |
| `03-after-redeal.png` | After Enter on an empty bar. Twelve cards, the two rejects in the left tray — **and the agent's sentence is gone**, which is finding A in the report. |
| `04-second-redeal.png` | The second Enter. This is the clean one: the pick holds the exact same pixels. |
| `05-compare-room.png` | The two-up at ~1.2 s. Both pictures are still downloading — a top strip only. Finding C. |
| `06-after-compare-choice.png` | After clicking the left work: room closed, winner picked, loser rejected. |

## §9's third clause, three times — `scripts/demo/e2e4/notes.mjs`

| shot | what it shows |
| --- | --- |
| `10-note-run1.png` | *"Moving away from the rejected firelit harvest scene and red-chalk landscape…"* |
| `10-note-run2.png` | *"You rejected two warm landscape drawings with brown-and-ochre palettes…"* |
| `10-note-run3.png` | *"Moving away from the rejected peach and flask: their saturated amber-brown object studies…"* |
| `10-note-run3-error.png` | The unpaced first attempt: **"Search is busy right now."** and `NO WORKS`, with 412/1000 free searches still on the clock. This is the ten-per-minute limiter, finding B. |

## Why the board jumps on the first human redeal — `scripts/demo/e2e4/note-shift.mjs`

| shot | what it shows |
| --- | --- |
| `20-note-shift-before.png` | Agent's note present, 26 px tall, board under it. |
| `21-note-shift-after.png` | One Enter later: note gone, cards 15% taller, first row 56 px higher. Same slot, same scroll position. |

## The two-up in detail — `compare-room.mjs`, `compare-cold.mjs`, `compare-exits.mjs`

| shot | what it shows |
| --- | --- |
| `30-compare-room-loaded.png` | The room as it should look: full frame, question in serif between two works, nothing else on screen. |
| `31-compare-after-choice.png` | The board after choosing. |
| `32-compare-opening-board.png` | Works that were already on screen: both pictures painted at **131 ms**. |
| `32-compare-freshly-dealt.png` | Works a redeal just brought in: both pictures painted at **1879 ms**. |
| `33-compare-neither-clicked.png` | "Neither" clicked — the room is still open, because the word becomes a line you write on. |

## Voice, and the harness

| shot | what it shows |
| --- | --- |
| `40-voice-off-typed-turn.png` | A typed turn with `speechSynthesis.speak` instrumented: note on screen, **0 utterances, 0 recognisers started**. |
| `50-capture-final.png` | The last frame of `scripts/demo/capture.mjs`'s recording — the finished board, alongside `capture.mp4` and `beats.json`. |
