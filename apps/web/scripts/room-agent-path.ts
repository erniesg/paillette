/**
 * From the agent's tool call to a room you can walk.
 *
 * The report claims that the groups an agent names on the board become the
 * rooms a stranger walks through. This is that claim, executed: the agent
 * deals a set, writes the show, writes the labels and names the groups; the
 * *human* presses the share button; and the short code that comes back opens
 * as two named rooms.
 *
 * **What this proves and what it does not.** The tools are driven through
 * `window.__paillette_webmcp.call`, which is the developer's back door, so
 * this demonstrates that the tools work and that their effects reach the
 * published show — not that a language model chooses to call them. The leg
 * from a typed instruction to a tool call belongs to the culling lane and is
 * not exercised here. Everything downstream of `annotate_atlas` is the real
 * product: the share button is clicked, the code is real, and the room is
 * loaded from it cold.
 *
 *   pnpm --filter web exec tsx scripts/room-agent-path.ts
 *
 * Prints the code it published, which `room-demo-path.ts` can then walk.
 */

import { chromium, type Page } from '@playwright/test';

const ORIGIN = process.env.PAILLETTE_ORIGIN ?? 'http://localhost:5199';

/** Labels in the register the app writes them in: one sentence, no preamble. */
const LABELS = [
  'The valley empties of light before anyone has decided to go.',
  'A stopping place, which is not the same as an arrival.',
  'The route drawn as though the drawing were the journey.',
  'Two people sitting for a picture that will outlast the room.',
  'A benefit performance: everyone present, nobody staying.',
  'Mine.',
  'The harbour works whether or not anybody is watching it.',
  'Weather standing in for a decision nobody wants to name.',
  'A shore with the tide out and the boats on their sides.',
  'The last light on the water, and nothing on the water.',
  'A stopping place that was never a destination.',
  'What is left when the job stops.',
];

const say = (label: string, value: unknown) =>
  console.log(`  ${label.padEnd(30)} ${String(value)}`);

const call = (page: Page, name: string, args: unknown) =>
  page.evaluate(
    ([toolName, toolArgs]) =>
      (
        window as Window & {
          __paillette_webmcp: { call: (n: string, a: unknown) => Promise<unknown> };
        }
      ).__paillette_webmcp.call(toolName as string, toolArgs),
    [name, args] as const
  ) as Promise<{ ok?: boolean; error?: { message?: string } } & Record<string, unknown>>;

const must = async (page: Page, name: string, args: unknown) => {
  const result = await call(page, name, args);
  if (!result?.ok) {
    throw new Error(`${name}: ${result?.error?.message ?? JSON.stringify(result)}`);
  }
  return result;
};

const main = async () => {
  const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(String(error).slice(0, 200)));

  console.log(`\n${ORIGIN}\n`);

  await page.goto(`${ORIGIN}/nga/search?webmcp-debug`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2500);
  say(
    'tools registered',
    await page.evaluate(
      () =>
        (
          window as Window & {
            __paillette_webmcp?: { call?: unknown };
          }
        ).__paillette_webmcp?.call !== undefined
    )
  );

  // The agent finds works and deals them onto the shared canvas.
  const browsed = (await must(page, 'browse_collection', { limit: 12 })) as {
    results: { id: string }[];
  };
  const ids = browsed.results.map((work) => work.id);
  await must(page, 'set_results', {
    artworkIds: ids,
    note: 'Twelve from the harbour, split by whether anyone is working.',
  });
  await page.waitForTimeout(1500);
  say('works dealt to the board', ids.length);

  // It writes the show, then a label per work against that statement.
  await must(page, 'set_exhibition', {
    title: 'The Working Harbor, The Empty Shore',
    statement:
      'Twelve works in two rooms. The first is a place with a job to do; the second is what is left when the job stops. The wall between them is the argument.',
  });
  await must(page, 'set_exhibition', {
    works: ids.map((id, index) => ({ artworkId: id, label: LABELS[index % LABELS.length] })),
  });
  say('labels written', ids.length);

  // And it names the groups. This is the call the walkable view turns into
  // separate rooms — the whole reason this script exists.
  const annotated = (await must(page, 'annotate_atlas', {
    regions: [
      { label: 'The Working Harbor', artworkIds: ids.slice(0, 6) },
      { label: 'The Empty Shore', artworkIds: ids.slice(6, 12) },
    ],
  })) as { regions: { label: string; artworkIds: string[] }[] };
  say(
    'regions named by the agent',
    annotated.regions.map((region) => `${region.label} (${region.artworkIds.length})`).join(', ')
  );

  await page.screenshot({ path: '../../docs/night/shots/room/agent-board.png' });

  // The human shares it. The actual button, not a fetch.
  const share = page.getByRole('button', { name: /copy link/i });
  if (!(await share.count())) throw new Error('the share button is not on the page');
  await share.first().click();
  await page.waitForTimeout(5000);

  const url = await page.evaluate(() => {
    const field = document.querySelector<HTMLInputElement>('input[readonly]');
    return field?.value ?? null;
  });
  const shared =
    url ??
    (await page.evaluate(() =>
      navigator.clipboard ? navigator.clipboard.readText().catch(() => null) : null
    ));
  const code = typeof shared === 'string' ? shared.split('/e/')[1] : null;
  if (!code) throw new Error('publishing did not hand back a short code');
  say('published as', `/e/${code}`);

  // And the show that comes back has the agent's groups in it.
  const opened = await page.evaluate(async (target: string) => {
    const response = await fetch(`/e/${target}?_data=routes%2Fe.%24code`);
    return response.ok ? await response.json() : null;
  }, code);
  const regions = (opened as { regions?: { label: string }[] } | null)?.regions ?? [];
  say('regions on the published page', regions.map((region) => region.label).join(', ') || 'NONE');
  if (regions.length !== 2) {
    throw new Error(`expected two named rooms on /e/${code}, got ${regions.length}`);
  }

  say('page errors', errors.length ? errors.join(' | ') : 'none');
  console.log(`\n  walk it:  CODE=${code} pnpm --filter web exec tsx scripts/room-demo-path.ts\n`);
  await browser.close();
};

void main();
