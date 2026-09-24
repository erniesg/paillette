# Merge the room-aesthetics lane into `night/integration` and put it on staging

## Goal

PR #72 (`codex/room-aesthetics`, merged into `night/room` on 2026-09-17) holds
the textured walk-through room, corner-joined frames, on-screen walk controls
for touch, and the label editor on the published `/e/:code` page. None of it is
on `night/integration`, and none of it is on staging: `night/integration` is 37
commits ahead of `night/room` and lacks exactly one commit, `c1af8a0c`.

Staging today shows a bare grey box with every work at the same fallback size
and hairline labels (`docs/night/shots/room/six.png`). The merged tree is what
the walkable gallery is supposed to look like.

## Acceptance tests

- `git merge-base --is-ancestor c1af8a0c night/integration` exits 0 after the
  merge, and `git log night/integration..night/room` is empty.
- `pnpm --filter web build && pnpm --filter web typecheck` pass, and
  `pnpm --filter web test` does not drop below the file and test counts measured
  on `night/integration` before the merge (record both numbers in the PR).
- `pnpm --filter api test` passes.
- On staging, `/e/MKwsxHy?v=room` renders textured walls and floor, framed works,
  and visible walk controls; `/e/MKwsxHy` (no `v`) still opens the flat page.
- On the published page a wall label can be edited in place and the edit
  survives a reload of the same browser (PR #72 stores drafts client-side).
- Screenshots of the six-work show, the thirty-work show and the phone viewport
  under `docs/night/shots/room-merged/`, with the same `measurements.json` shape
  the room lane wrote, so the two trees can be compared cell by cell.
- No file over 10 MB enters the tree; the four material PNGs total about 600 KB.

## Validation command

```bash
pnpm install --frozen-lockfile
pnpm --filter web build && pnpm --filter web typecheck
pnpm --filter web test
pnpm --filter api test
pnpm --filter web deploy:staging
(cd apps/api && npx wrangler deploy --env staging)
```

## Allowed secrets

None new. Staging deploys use the existing Cloudflare login on the trusted VM.
Production is never deployed from this issue.

## Artifact outputs

- A PR from a fresh branch into `night/integration` with the merge and any
  conflict resolutions explained commit by commit.
- `docs/night/shots/room-merged/*.png` and `measurements.json`.
- The before/after test counts in the PR body.

## Stop conditions

Stop if the merge needs a change to `room-scene.ts` beyond conflict resolution;
report the conflict instead of redesigning. Stop before any `wrangler deploy`
without `--env staging`.

## Human clarification protocol

None expected. If `night/room` has moved past `c1af8a0c` when you start, merge
its head and say so.
