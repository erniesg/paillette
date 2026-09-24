# Board defects recorded in the night runs and not yet fixed

## Goal

Four small defects were measured, written down, and left. Each one is a paper
cut in the curation loop that the end-to-end experience will hit.

- `set_results` is not capped at 12 cards and empties the reject tray
  (integration report iteration 4, §6.1).
- The exhibition strip is 104 px tall and moves cards up to 96 px on the first
  `P`; measured and deliberately deferred (blockers report §2).
- A redeal clears the agent's provisional flags off the board, because only
  human picks pin; the page now nudges the agent to re-mark, which costs a
  model round (integration report §6.2).
- The account chrome and the sort/view rows stay on screen while a board is
  dealt (integration report §6.3).

## Acceptance tests

- `set_results` clips to 12 and leaves the reject tray alone; a test asserts
  both.
- The first `P` moves no card: the strip reserves its height from the first
  deal or overlays without reflow. Measure with the existing 0 px board-to-board
  check and extend it to the first flag.
- Provisional agent flags on works that survive a redeal survive with them; a
  test deals twice and counts marks.
- Chrome and sort/view rows retire while a deal is in flight and return when it
  settles, with `prefers-reduced-motion` respected.

## Validation command

```bash
pnpm --filter web build && pnpm --filter web typecheck && pnpm --filter web test
```

## Allowed secrets

None.

## Artifact outputs

- PR into `night/integration` with before/after screenshots of the first-`P`
  jump under `docs/night/shots/board/`.

## Stop conditions

Stop before changing redeal's scoring; only what survives the redeal changes,
not what the redeal chooses.

## Human clarification protocol

None expected.
