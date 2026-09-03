/**
 * Prove the provenance ink actually lands on the shared-state lane's markup.
 *
 * That lane ships the flag logic and writes its own attribute vocabulary onto
 * the tiles. Its own source says the provenance hooks are "drawn entirely in
 * CSS, with no JavaScript here needing to know which colour the agent got" —
 * so the CSS is this lane's job, and if the two vocabularies do not meet, the
 * ink renders on nothing and the central visual claim of the submission is
 * false on the real page.
 *
 * Unit tests cannot catch that: jsdom does not run the cascade, and neither
 * lane imports the other. So this loads the real stylesheet in a real browser,
 * injects the exact markup that lane emits, and reads back computed styles.
 *
 * It checks both vocabularies, so it also guards against a merge that keeps
 * this lane's names instead.
 *
 * Usage:
 *   pnpm --filter web dev --port 5212
 *   node scripts/verify-ink-contract.mjs [baseUrl]
 *
 * Exits non-zero on the first failed assertion.
 */

import { createRequire } from 'node:module';

const require = createRequire(
  new URL('../apps/web/package.json', import.meta.url)
);
const { chromium } = require('@playwright/test');

const baseUrl = process.argv[2] ?? 'http://localhost:5212';

const fails = [];
const passes = [];
const check = (cond, label) => (cond ? passes : fails).push(label);

/** Their tile, exactly as `ResultCard` renders it on that branch. */
const THEIR_CARD = (attrs) => `
  <article class="paillette-card relative break-inside-avoid overflow-hidden"
           data-artwork-id="w1" ${attrs}>
    <div class="absolute right-2 top-2 z-10">
      <div class="paillette-flag-badge flex items-center gap-1"
           data-flag="pick" data-flag-by="agent" data-flag-provisional="true">
        <button class="paillette-flag-button border px-1.5 py-0.5"
                data-flag-action="pick" aria-pressed="true">P</button>
        <button class="paillette-flag-button border px-1.5 py-0.5"
                data-flag-action="reject" aria-pressed="false">X</button>
      </div>
    </div>
    <img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" alt="" />
  </article>`;

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage();

  // The real page, so the real compiled stylesheet is in force.
  await page.goto(`${baseUrl}/nga/search`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);

  const probe = async (html) =>
    page.evaluate((markup) => {
      const host = document.createElement('div');
      host.className = 'lt-ground';
      host.innerHTML = markup;
      document.body.appendChild(host);

      const card = host.querySelector('article, p');
      const img = host.querySelector('img');
      const pressed = host.querySelector('[aria-pressed="true"]');
      const cs = getComputedStyle(card);
      const out = {
        boxShadow: cs.boxShadow,
        outlineStyle: cs.outlineStyle,
        outlineColor: cs.outlineColor,
        colour: cs.color,
        borderLeftColor: cs.borderLeftColor,
        imgFilter: img ? getComputedStyle(img).filter : null,
        pressedBg: pressed ? getComputedStyle(pressed).backgroundColor : null,
      };
      host.remove();
      return out;
    }, html);

  const HUMAN = 'rgb(230, 227, 220)';
  const AGENT = 'rgb(94, 200, 216)';

  // --- their vocabulary -----------------------------------------------------

  const unflagged = await probe(
    THEIR_CARD('data-flag="none" data-flag-by="none" data-flag-provisional="false"')
  );
  check(
    !unflagged.boxShadow.includes(HUMAN) && !unflagged.boxShadow.includes(AGENT),
    'an unflagged card wears no ink (their "none" sentinel is inert)'
  );
  check(
    unflagged.outlineStyle !== 'dashed',
    'a card with data-flag-provisional="false" is not dashed'
  );

  const humanPick = await probe(
    THEIR_CARD('data-flag="pick" data-flag-by="human" data-flag-provisional="false"')
  );
  check(
    humanPick.boxShadow.includes(HUMAN),
    'a human pick is framed in graphite'
  );

  const agentPick = await probe(
    THEIR_CARD('data-flag="pick" data-flag-by="agent" data-flag-provisional="false"')
  );
  check(
    agentPick.boxShadow.includes(AGENT),
    'an agent pick is framed in the agent ink'
  );
  check(
    humanPick.boxShadow !== agentPick.boxShadow,
    'the two hands are actually distinguishable on their markup'
  );

  const agentProvisional = await probe(
    THEIR_CARD('data-flag="pick" data-flag-by="agent" data-flag-provisional="true"')
  );
  check(
    agentProvisional.outlineStyle === 'dashed',
    "an agent's unconfirmed pick is dashed"
  );
  check(
    agentProvisional.outlineColor === AGENT,
    "the dash is in the agent's ink"
  );

  const reject = await probe(
    THEIR_CARD('data-flag="reject" data-flag-by="human" data-flag-provisional="false"')
  );
  check(
    (reject.imgFilter ?? '').includes('saturate'),
    'a reject desaturates the picture'
  );

  check(
    agentProvisional.pressedBg === 'rgba(0, 0, 0, 0)',
    "a provisional flag button is outlined rather than filled"
  );

  // --- their wall label -----------------------------------------------------

  const agentLabel = await probe(
    '<p class="paillette-wall-label" data-provenance="agent">note</p>'
  );
  const humanLabel = await probe(
    '<p class="paillette-wall-label" data-provenance="human">note</p>'
  );
  check(agentLabel.colour === AGENT, "the agent's note is in the agent's ink");
  check(
    humanLabel.colour === HUMAN,
    'a note about a board the human redealt is in graphite, not the agent ink'
  );
  check(
    agentLabel.borderLeftColor !== humanLabel.borderLeftColor,
    'the wall label rule changes colour with the hand'
  );

  // --- this lane's own vocabulary still works -------------------------------

  const mineAgent = await probe(
    '<article class="lt-slide" data-flag="pick" data-hand="agent"></article>'
  );
  const mineHuman = await probe(
    '<article class="lt-slide" data-flag="pick" data-hand="human"></article>'
  );
  check(
    mineAgent.boxShadow.includes(AGENT) && mineHuman.boxShadow.includes(HUMAN),
    'the original data-hand vocabulary is unregressed'
  );

  const mineProvisional = await probe(
    '<article class="lt-slide" data-flag="pick" data-hand="agent" data-provisional></article>'
  );
  check(
    mineProvisional.outlineStyle === 'dashed',
    'the original data-provisional vocabulary is unregressed'
  );

  // --- mixed, which is what a merge will actually produce -------------------

  const mixed = await probe(
    '<article class="lt-slide paillette-card" data-flag="pick" data-flag-by="agent" data-flag-provisional="true"></article>'
  );
  check(
    mixed.outlineStyle === 'dashed' && mixed.outlineColor === AGENT,
    'a tile carrying both class names and their attributes still reads correctly'
  );

  // --- their compare overlay ------------------------------------------------

  const compare = await page.evaluate(() => {
    const host = document.createElement('div');
    host.innerHTML = `
      <div class="paillette-compare fixed inset-0 flex flex-col items-center
                  justify-center gap-6 bg-neutral-950/95 p-8"
           data-asked-by="agent">
        <p class="max-w-2xl text-center font-display text-xl text-white">Which one?</p>
        <div class="flex w-full flex-1 items-center justify-center gap-8">
          <button class="paillette-compare-work flex flex-col border border-white/10 p-4"
                  data-side="left">
            <img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" alt="" />
            <span>A title</span><span>An artist</span>
          </button>
        </div>
        <button class="border border-white/15 px-3 py-1">Neither</button>
      </div>`;
    document.body.appendChild(host);
    const room = host.querySelector('.paillette-compare');
    const work = host.querySelector('.paillette-compare-work');
    const q = host.querySelector('.paillette-compare > p');
    const caption = host.querySelectorAll('.paillette-compare-work span');
    const out = {
      roomBg: getComputedStyle(room).backgroundColor,
      questionFont: getComputedStyle(q).fontFamily.split(',')[0],
      questionColour: getComputedStyle(q).color,
      workBorder: getComputedStyle(work).borderTopWidth,
      captionFont: getComputedStyle(caption[1]).fontFamily.split(',')[0],
    };
    host.remove();
    return out;
  });

  check(
    compare.roomBg === 'rgb(26, 26, 29)',
    'their compare room is the opaque light-table ground, not a scrim'
  );
  check(
    compare.questionFont.includes('EB Garamond'),
    'their compare question is set in the wall serif'
  );
  check(
    compare.questionColour === AGENT,
    "their compare question takes the asking hand's ink"
  );
  check(
    compare.workBorder === '0px',
    'their compare works lose the box that competed with the painting'
  );
  check(
    compare.captionFont.includes('IBM Plex Mono'),
    'their compare caption sets catalogue data in the mono face'
  );

  // --- light theme, where every token flips ---------------------------------

  await page.evaluate(() => {
    document.documentElement.dataset.theme = 'light';
  });
  await page.waitForTimeout(400);

  const LIGHT_HUMAN = 'rgb(23, 22, 26)';
  const LIGHT_AGENT = 'rgb(10, 95, 107)';

  const lightHuman = await probe(
    THEIR_CARD('data-flag="pick" data-flag-by="human" data-flag-provisional="false"')
  );
  const lightAgent = await probe(
    THEIR_CARD('data-flag="pick" data-flag-by="agent" data-flag-provisional="false"')
  );
  check(
    lightHuman.boxShadow.includes(LIGHT_HUMAN),
    'light theme: a human pick is framed in graphite-on-paper'
  );
  check(
    lightAgent.boxShadow.includes(LIGHT_AGENT),
    'light theme: an agent pick is framed in the agent ink'
  );
  check(
    lightHuman.boxShadow !== lightAgent.boxShadow,
    'light theme: the two hands are still distinguishable'
  );

  // A picture of the merged result, so the integrator can judge it without
  // checking out both branches and resolving a conflict first.
  await page.evaluate(() => {
    document.documentElement.dataset.theme = 'dark';
    document.body.innerHTML = '';
    document.body.className = 'lt-ground';
    const states = [
      ['none', 'none', 'false', 'unflagged'],
      ['pick', 'human', 'false', 'human pick'],
      ['reject', 'human', 'false', 'human reject'],
      ['pick', 'agent', 'true', 'agent pick, unconfirmed'],
      ['reject', 'agent', 'true', 'agent reject, unconfirmed'],
      ['pick', 'agent', 'false', 'agent pick, confirmed'],
    ];
    const grid = document.createElement('div');
    grid.style.cssText =
      'display:grid;grid-template-columns:repeat(3,1fr);gap:28px;padding:40px';
    grid.innerHTML = states
      .map(
        ([flag, by, prov, label]) => `
        <div>
          <article class="paillette-card" data-artwork-id="w"
                   data-flag="${flag}" data-flag-by="${by}"
                   data-flag-provisional="${prov}"
                   style="padding:10px">
            <div style="position:absolute;right:8px;top:8px;z-index:10">
              <div class="paillette-flag-badge" style="display:flex;gap:4px"
                   data-flag="${flag}" data-flag-by="${by}"
                   data-flag-provisional="${prov}">
                <button class="paillette-flag-button" style="border-width:1px;padding:2px 6px"
                        aria-pressed="${flag === 'pick'}">P</button>
                <button class="paillette-flag-button" style="border-width:1px;padding:2px 6px"
                        aria-pressed="${flag === 'reject'}">X</button>
                <button class="paillette-flag-button" style="border-width:1px;padding:2px 6px">U</button>
              </div>
            </div>
            <img alt="" style="width:100%;height:150px;object-fit:cover"
                 src="https://api.nga.gov/iiif/a0eb9fb8-28a3-4446-b28d-70a4cc50c6e5/full/400,/0/default.jpg" />
          </article>
          <p class="lt-catalogue" style="padding-top:8px">${label}</p>
        </div>`
      )
      .join('');
    document.body.appendChild(grid);

    const label = document.createElement('p');
    label.className = 'paillette-wall-label';
    label.dataset.provenance = 'agent';
    label.style.cssText = 'margin:0 40px 40px';
    label.textContent =
      'You said warm; you have picked three cool ones. I am following the picks.';
    document.body.appendChild(label);
  });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: 'docs/night/shots/30-flag-lane-markup.png' });
  console.log('  → docs/night/shots/30-flag-lane-markup.png');

  await browser.close();

  console.log('\nPASS');
  for (const p of passes) console.log('  ✓', p);
  if (fails.length) {
    console.log('\nFAIL');
    for (const f of fails) console.log('  ✗', f);
  }
  console.log(`\n${passes.length} passed, ${fails.length} failed`);
  process.exit(fails.length ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
