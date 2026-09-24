# Wall labels the human can author anywhere, and regions the human can name

depends-on: 072

## Goal

The exhibition object already keeps who wrote what: a human-edited field is
held, and an agent write onto it becomes a dashed proposal the human accepts or
declines. But the human's side is incomplete:

- On the working board, `WallLabel` returns `null` when a work has no label, so
  a human cannot start a label; they can only edit one the agent wrote.
- There is no human control to name a region or move a work between regions;
  only the agent can (`annotate_atlas`).
- The published `/e/:code` page is read-only on `night/integration`; PR #72
  adds a label editor there, but it saves drafts to localStorage and shares by
  posting a new copy.
- Provenance is shown only by colour on the shared page (sharing report §9.8).
- The number of works dropped as unresolvable is returned by the API but never
  shown to the curator (sharing report §9.2).

## Acceptance tests

- On the board, every work on the hang has a label slot; an empty slot is a
  click target that opens the same `EditableText`. A label written there is
  held (human) and survives redeals, like existing labels.
- The human can name a region and drag or key a work into it on the board;
  the result lands in `exhibition.regions` and round-trips through
  `set_exhibition` / `get_exhibition` without the agent's help. The agent's
  later `annotate_atlas` on a human-named region becomes a proposal, not an
  overwrite.
- The title, statement, each label and each region label carry a visible,
  non-colour provenance mark (`data-provenance` already exists; add a glyph or
  a one-word mono tag), readable by a screen reader.
- Publishing reports "N works could not be resolved and were left out" in the
  copy-link flow when `missing > 0`.
- The shared page's editor (from PR #72) states plainly that saving publishes a
  new link and does not change the one you opened.
- Tests cover: creating a label on an unlabelled work, naming a region by hand,
  agent proposal onto a human-named region, and the missing-works notice.

## Validation command

```bash
pnpm --filter web build && pnpm --filter web typecheck
pnpm --filter web test
```

## Allowed secrets

None.

## Artifact outputs

- PR into `night/integration`.
- Screenshots: empty label slot, human-named region, provenance marks, the
  missing-works notice, under `docs/night/shots/labels/`.

## Stop conditions

Stop if the change would let the agent overwrite a human-held field. Stop
before adding helper text that explains the interface; the house style forbids it.

## Human clarification protocol

None expected.
