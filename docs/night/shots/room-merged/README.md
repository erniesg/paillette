# Room, merged: staging after #75

`night/integration` 1d71881 merged with `night/room` c1af8a0 (PR #72) and
deployed to paillette-stg as web version `e56ed2ba`, served as
`exhibition-view-DyWviQv4.js`. Every file here came from that build. Staging is
shared with other lanes, so the bundle hash was checked before and after each
run, and Cloudflare's deployment history shows nothing else deployed between
14:32:19Z and the last shot at 15:05:23Z.

- `*.png` and `measurements.json`: `apps/web/scripts/room-shots.ts`, unchanged
  from the room lane apart from choosing the browser binary. The shows are the
  same links from `room-demo-links.ts`, and the short-code shots use `u4G4Gkv`.
- `checks.json`: `apps/web/scripts/room-merged-checks.ts`, 9 passed, 0 failed.
- `checks-sabotage.json`: the same script with `SABOTAGE=1` against the same
  build, 0 passed, 9 failed. This run came first.

## Against `../room/measurements.json`

Same renderer string in both: SwiftShader, software rendering on a VM with no
usable GPU.

| six works | room lane | merged |
| --- | --- | --- |
| fps | 31 | 5 |
| texture bytes | 49,289,185 | 44,191,189 |
| works at full resolution | 6 | 4 |
| renderer textures | 12 | 15 |
| position | room 0, 1.4 m | room 0, 1.4 m |

Across the whole file:

- Frame rates fall in every shot, from 24–31 to 1–6.
- Where the number of full-resolution works holds at 6 (or 1 for `one`),
  texture bytes rise by 3.1–6.4 MB in all ten cells, e.g. `one` 7.9 → 13.7 MB.
  That fits the four material maps.
- The full-resolution count drops in three cells: six 6 → 4,
  `shortcode-regions-first` 6 → 3, `shortcode-regions-second` 6 → 4. Texture
  bytes fall there. This is the scene shedding resolution under a low frame
  rate, not a smaller budget.
- Renderer textures rise by 2–4 in eight cells and fall by 2–4 in five
  (`thirty-third-room`, `thirtyAfterWalk`, `regions-second` and both
  short-code shots).
- The walk into thirty's second and third rooms and into `regions-second`
  stopped 0.5–0.8 m shorter than the room lane's did, so those cells are not
  the same view.
- The phone's pixel ratio went from 1 to 1.5.

Do not read the frame rates as a regression measurement. The machine was
running three lanes' browsers and Python jobs at the time: the load average was
10.14 / 9.84 (1 and 5 min) on 4 cores at 15:06:26, a minute after the run
ended. The room lane's numbers were not taken under a recorded load. Textured,
normal-mapped surfaces cost more under software rendering, but these two runs
cannot say how much of the drop is the materials and how much is the machine.

## Not shown

- A framed room. Works hang unframed by default (`Frame: No frame`). The
  `frames` check shows `?frame=oak` changes 7,365 of 1,296,000 canvas pixels,
  where two identical renders differ by 0 and 196, but no shot was taken with a
  frame. Staging had moved to another lane's build before this was noticed.
- The plaster maps load (4/4 materials returned 200) but barely read on the
  walls at 1440×900. The oak floor is obvious.
