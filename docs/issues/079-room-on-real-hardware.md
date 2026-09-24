# The room on real hardware

depends-on: 072

## Goal

Every frame-rate number in the room report was measured on SwiftShader, a
software renderer on four vCPUs: 20 to 31 fps, never 60, never a phone, never a
GPU. The texture budget is 96 MiB with an observed peak of 70.4 MiB on a
thirty-work show. Whether a mid-range phone can walk a thirty-work show is not
known, and the reports say so.

This needs a machine with a GPU and a phone. It is the one lane the trusted VM
cannot run; do it from a laptop with a real browser and at least one phone.

## Acceptance tests

- Frame rate for the six-, twelve- and thirty-work shows on: a laptop with a
  discrete or integrated GPU in Chrome, the same in Safari, and one Android or
  iOS phone, portrait and landscape. Report renderer string, fps p50 and worst
  one-second window, and peak texture bytes, in the same `measurements.json`
  shape as the room lane.
- Any device below 30 fps p50 on the twelve-work show gets a fix or a documented
  fallback (lower `NEAR_WIDTH`, fewer near textures, smaller pixel ratio), and
  the fix is re-measured on that device.
- `prefers-reduced-motion` on a phone: no camera bob, snap turns, teleport on
  tap. Confirm by video or by the measured camera path.
- Touch: the walk controls from PR #72 work one-handed in portrait.

## Validation command

```bash
pnpm --filter web build
cd apps/web && pnpm test:e2e -- --grep room
```

## Allowed secrets

None.

## Artifact outputs

- `docs/night/room-hardware-report.md` with the table of devices and numbers,
  and `docs/night/shots/room-hardware/` with one screenshot per device.
- A PR into `night/integration` only if a fix was needed.

## Stop conditions

Stop before shipping a fallback that hides the room on a device that can run it.

## Human clarification protocol

Needs a human with the devices. The owner's laptop and phone are the obvious
pair; say which devices were used.
