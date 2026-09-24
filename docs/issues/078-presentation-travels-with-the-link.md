# The presentation travels with the link, and the agent may propose it

depends-on: 072

## Goal

The room is chosen by `?v=room` on the URL and nowhere else. `stripTemplate`
removes it from the canonical URL, so the link the copy button gives out always
opens the flat page, and a curator who built a three-room show cannot share it
as a room. The frame choice from PR #72 (`?frame=`) has the same problem. The
`exhibitions` record stores no presentation. And `set_view` still governs only
the results grid, so the agent cannot suggest "this one wants to be walked".

Keep the handoff's rule: the flat page stays the default a cold link opens into,
and a device that cannot run the room gets the page with no dead control.

## Acceptance tests

- `exhibitions.works` JSON (or a new column, with a migration) stores
  `presentation: {template: 'page' | 'room', frame?: string}` as the curator's
  choice at publish time. Old records without it behave exactly as today.
- The copy-link flow offers "share as page" or "share as room" when the room is
  available on this device; the produced URL carries the choice and the record
  stores it. Opening a room link on a device that fails `canRenderRoom` opens
  the page, with the template switch hidden rather than disabled.
- `set_view` gains `exhibition: 'page' | 'room'` alongside the grid layouts,
  described honestly in its tool description. An agent call sets a proposal the
  human accepts with one click, never the choice itself.
- The crawler unfurl (title, description, image) is identical for page and
  room links, so a room link previews as well as a page link.
- Tests: presentation round-trips through publish and load; legacy record
  without presentation loads; the tool proposal is visible and declinable.

## Validation command

```bash
pnpm --filter api test
pnpm --filter web build && pnpm --filter web typecheck && pnpm --filter web test
```

## Allowed secrets

None.

## Artifact outputs

- PR into `night/integration`.
- Two short-link examples on staging, one page and one room, in the PR body.

## Stop conditions

Stop if the change would make a cold link open in the room by default for a
device that has not opted in.

## Human clarification protocol

None expected.
