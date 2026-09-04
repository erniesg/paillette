/**
 * The held graphics.
 *
 * Rendered as HTML in the same browser that shot the footage, so the type and
 * the ground match the product rather than approximating it. Every card is
 * 1440 x 900 at 2x, which is the frame the rest of the film is cut in.
 *
 * Two inks, as on the board: graphite `#E6E3DC` for the human's side and cyan
 * `#5EC8D8` for the agent's. Nothing here invents a number — each card's
 * source is named in the comment above it and in the video report.
 *
 *   node scripts/demo/film/cards.mjs [out-dir]
 */

import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from '../browser.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..', '..');
const OUT = process.argv[2] ?? path.join(REPO, 'docs', 'night', 'video', 'cards');

const SHELL = (body, extra = '') => `<!doctype html><meta charset="utf-8">
<style>
  @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=EB+Garamond:ital,wght@0,400;0,500;1,400&display=swap');
  * { margin:0; padding:0; box-sizing:border-box; }
  html,body { width:1440px; height:900px; }
  body {
    background:#141414; color:#E6E3DC;
    font-family:'EB Garamond', Georgia, serif;
    display:flex; align-items:center; justify-content:center;
    -webkit-font-smoothing:antialiased;
  }
  .wrap { width:1120px; }
  .mono { font-family:'IBM Plex Mono', ui-monospace, Menlo, monospace; }
  .agent { color:#5EC8D8; }
  .dim { color:#8A8781; }
  .rule { height:1px; background:#3A3936; margin:34px 0; }
  ${extra}
</style>
<div class="wrap">${body}</div>`;

/**
 * Beat 2 — the request log.
 *
 * Not a devtools screenshot: a set graphic, so the two lines can be read at a
 * glance. Both numbers come from this film's own take —
 * `clips/b2-empty-bar/b2-empty-bar.json` recorded `firstExemplarAfterEnterMs:
 * 13` and `modelCallsAfterEnter: 0` off the wire, in the footage being cut.
 */
const REQUEST_LOG = SHELL(
  `<div class="mono" style="font-size:30px; line-height:2.35">
     <div><span class="dim">POST</span> /api/public-search/nga/exemplars
       <span class="agent" style="margin-left:26px">&#8592; Enter, +13 ms</span></div>
     <div><span class="dim">POST</span> /api/public-agent/turn
       <span class="agent" style="margin-left:26px">&#8592; 0</span></div>
   </div>
   <div class="rule"></div>
   <div class="mono dim" style="font-size:19px; letter-spacing:.06em">
     EVERY REQUEST THE PAGE MADE AFTER THE KEYPRESS
   </div>`
);

/** Beat 4 — scale. `total: 63253`, re-derived from the browse API tonight. */
const SCALE = SHELL(
  `<div style="text-align:center">
     <div class="mono" style="font-size:104px; letter-spacing:.02em">63,253</div>
     <div style="font-size:34px; margin-top:26px; letter-spacing:.03em">
       works &middot; National Gallery of Art &middot; CC0
     </div>
   </div>`
);

/**
 * Beat 5 — one label, under two statements.
 *
 * Verbatim from `docs/night/shots/crit5/show-x4-before.json` and
 * `show-x4-after.json`, both committed on this branch. Same work, same call;
 * only the wall statement changed. The second statement reads back
 * `"by": "human", "theirs": true`.
 */
const TWO_LABELS = SHELL(
  `<div style="font-size:20px; line-height:1.62">
     <div style="display:flex; gap:56px">
       <div style="flex:1">
         <div class="mono agent" style="font-size:15px; letter-spacing:.09em; margin-bottom:16px">
           UNDER &ldquo;WEATHER AT SEA&rdquo;
         </div>
         <div>Gray wash and dense linework give wind and cloud as much force as
         the two ships, which pitch through choppy water. The distant vessel
         underscores how quickly the storm has swallowed the open sea.</div>
       </div>
       <div style="width:1px; background:#3A3936"></div>
       <div style="flex:1">
         <div class="mono agent" style="font-size:15px; letter-spacing:.09em; margin-bottom:16px">
           UNDER &ldquo;LEAVING&rdquo;
         </div>
         <div>Two ships strain through choppy water while a smaller vessel
         recedes in the distance. The ink and gray wash hold them at the
         uncertain point between departure and disappearance.</div>
       </div>
     </div>
     <div class="rule"></div>
     <div class="dim" style="font-size:19px; font-style:italic; text-align:center">
       Petrus Johannes Schotel, Ships in a Stormy Sea, 1835 &mdash; the same work, twice
     </div>
   </div>`
);

/**
 * Beat 7 — the two hands.
 *
 * Each of the three culling tools wraps a key the human presses. `redeal` and
 * Enter are verifiably one function: `submitHumanTurn` (`turn.ts:278`) and the
 * `redeal` tool (`tools.ts:1645`) both call `runRedeal`.
 */
const KEYS = SHELL(
  `<div class="mono" style="font-size:34px; line-height:2.4">
     <div><span class="agent">flag_artworks</span>
       <span style="float:right">P &middot; X &middot; U</span></div>
     <div><span class="agent">redeal</span>
       <span style="float:right">&#8629;</span></div>
     <div><span class="agent">compare_artworks</span>
       <span style="float:right">C</span></div>
   </div>
   <div class="rule"></div>
   <div class="mono dim" style="font-size:19px; letter-spacing:.06em; text-align:center">
     THE LOOP HAS NO AGENT-ONLY PATH
   </div>`,
  '.wrap{width:820px}'
);

/** Beat 8 — the end card. Silent, over the finished hang. */
const END = SHELL(
  `<div style="text-align:center; font-size:42px; line-height:1.6">
     For everything you can&rsquo;t name.<br>And everything you can&rsquo;t see.
   </div>`
);

/**
 * Beat 6 — lower-third captions.
 *
 * Both strings are read off the running page, not composed here: the
 * accessible name of the focused control, and the `sr-only[role="status"]`
 * line the board announces. This film's own take recorded both — see
 * `clips/b6-keyboard/b6-keyboard.json`.
 */
const caption = (text) =>
  SHELL(
    `<div class="mono" style="font-size:26px; text-align:center">${text}</div>`,
    'body{background:#0A0A0A}'
  );

const CARDS = {
  'c2-request-log': REQUEST_LOG,
  'c4-scale': SCALE,
  'c5-two-labels': TWO_LABELS,
  'c7-keys': KEYS,
  'c8-end': END,
  'c6-caption-control': caption('Pick Environs de Cremieu (P)'),
  'c6-caption-status': caption('Enter on the empty bar redeals the board from your flags.'),
};

await mkdir(OUT, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 2,
});

for (const [name, html] of Object.entries(CARDS)) {
  await page.setContent(html, { waitUntil: 'networkidle' });
  // Webfonts, or the card renders in a fallback and the type does not match.
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(OUT, `${name}.png`) });
  process.stdout.write(`${name}.png\n`);
}

await browser.close();
