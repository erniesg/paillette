/**
 * What can honestly be said about voice on a machine with no microphone.
 *
 * Headless Chromium cannot do speech recognition — Chrome ships the audio to
 * Google's service and there is no audio here — so the spoken path cannot be
 * proven on this VM and this script does not pretend to. What it *can* prove is
 * the half the brief actually depends on: that with voice switched off, the
 * typed loop is untouched by any of it.
 *
 * Specifically, §5's symmetric channel rule — "spoken only if the human's last
 * turn was spoken" — has a negative half that is testable without a microphone.
 * `speechSynthesis.speak` is wrapped before the page runs, so a typed turn that
 * speaks its note would be caught rather than argued about.
 *
 *   node apps/web/scripts/e2e-voice-off-probe.mjs <baseUrl> <outDir>
 */
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';

const BASE = process.argv[2] ?? 'https://paillette-stg.berlayar.ai';
const OUT = process.argv[3] ?? '/tmp/e2e6/voice';
const BAR = 'input[aria-label="Ask the agent"]';
const SOFA =
  'I want something to hang above the sofa in my living room. Warm, not busy, nothing grim.';

mkdirSync(`${OUT}/shots`, { recursive: true });
const log = [];
const say = (ok, label, detail = '') => {
  const line = `${ok === null ? 'NOTE' : ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`;
  log.push(line); console.log(line);
};
const save = (n, v) => writeFileSync(`${OUT}/${n}`, typeof v === 'string' ? v : JSON.stringify(v, null, 2));

const main = async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  // Before any page script: record every attempt to speak, and note whether
  // recognition exists at all in this browser.
  await page.addInitScript(() => {
    window.__spoken = [];
    window.__speechAvailable = {
      synthesis: typeof window.speechSynthesis !== 'undefined',
      utterance: typeof window.SpeechSynthesisUtterance === 'function',
      recognition: Boolean(window.SpeechRecognition ?? window.webkitSpeechRecognition),
    };
    if (window.speechSynthesis?.speak) {
      const real = window.speechSynthesis.speak.bind(window.speechSynthesis);
      window.speechSynthesis.speak = (u) => { window.__spoken.push(u?.text ?? '(no text)'); return real(u); };
    }
  });

  await page.goto(`${BASE}/nga/search?webmcp-debug`, { waitUntil: 'domcontentloaded' });
  let bar = null;
  const t0 = Date.now();
  while (!bar && Date.now() - t0 < 25_000) { bar = await page.$(BAR); if (!bar) await page.waitForTimeout(400); }

  const avail = await page.evaluate(() => window.__speechAvailable);
  save('speech-availability.json', avail);
  say(null, 'what this browser actually has', JSON.stringify(avail));
  /*
   * The constructor is *present* in this Chromium, which is not the same as
   * recognition working — Chrome streams the audio to a Google service and
   * there is no microphone here. So do not assert either way: hold the control
   * and record what the page actually does, including any recogniser error.
   */
  say(null, 'a SpeechRecognition constructor exists in this browser',
    `${avail.recognition} — presence is not the same as a working recogniser, so it is exercised below`);

  // The mic control is present and the page did not fall over without a mic.
  const mic = await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find((x) =>
      /speak|listening/i.test(x.getAttribute('aria-label') ?? ''));
    return b ? { label: b.getAttribute('aria-label'), disabled: b.disabled } : null;
  });
  say(Boolean(mic), 'the push-to-talk control is on the page', JSON.stringify(mic));

  // Hold it, and see what the recogniser does with no microphone behind it.
  await page.evaluate(() => {
    window.__recog = [];
    const Ctor = window.SpeechRecognition ?? window.webkitSpeechRecognition;
    if (!Ctor) return;
    const Wrapped = function () {
      const r = new Ctor();
      for (const ev of ['start', 'error', 'end', 'result', 'nomatch', 'audiostart']) {
        r.addEventListener(ev, (e) => window.__recog.push({ ev, error: e?.error ?? null }));
      }
      return r;
    };
    window.SpeechRecognition = Wrapped;
    window.webkitSpeechRecognition = Wrapped;
  });
  const micBtn = await page.$('button[aria-label="Hold to speak"]');
  if (micBtn) {
    const box = await micBtn.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(2500);
    await page.mouse.up();
    await page.waitForTimeout(3000);
  }
  const recog = await page.evaluate(() => window.__recog ?? []);
  const barAfterHold = await page.inputValue(BAR).catch(() => null);
  save('recognition-events.json', { recog, barAfterHold });
  say(null, 'holding the mic on this machine',
    `recogniser events: ${JSON.stringify(recog)}; the field afterwards: ${JSON.stringify(barAfterHold)}`);
  await page.screenshot({ path: `${OUT}/shots/v0-after-holding-mic.png` });

  // A typed turn, start to finish.
  await bar.click();
  await page.keyboard.type(SOFA, { delay: 8 });
  await page.keyboard.press('Enter');
  for (let k = 0; k < 150 && (await page.$$('.paillette-card')).length < 4; k += 1) {
    await page.waitForTimeout(1000);
  }
  await page.waitForTimeout(8000);

  const note = await page.evaluate(() =>
    document.querySelector('[data-board-note] .paillette-wall-label')?.textContent?.trim() ?? null);
  const spoken = await page.evaluate(() => window.__spoken);
  say(Boolean(note), 'the typed turn produced a note', JSON.stringify(note?.slice(0, 110)));
  say(spoken.length === 0,
    'and the page never tried to speak it — §5\'s symmetric rule, negative half',
    `speechSynthesis.speak called ${spoken.length} times: ${JSON.stringify(spoken)}`);
  await page.screenshot({ path: `${OUT}/shots/v1-typed-turn-silent.png` });

  save('log.txt', log.join('\n'));
  await context.close();
  await browser.close();
};

main().catch((e) => { console.error(e); process.exit(2); });
