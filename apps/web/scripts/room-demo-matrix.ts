/**
 * The demo path, across the conditions a visitor actually arrives in.
 *
 * One green run on a 1440×900 desktop with default motion and a browser that
 * can speak is one green run, not a working feature. This sweeps the
 * dimensions that turned out to matter — screen shape, motion preference,
 * whether speech exists at all, and how big the show is — and prints a grid.
 *
 * Every cell is the full twenty-six-step visit in `room-demo-path.ts`. It runs
 * them in series rather than in parallel, because a software rasteriser on four
 * vCPUs is the bottleneck and racing them would measure the machine.
 *
 *   PAILLETTE_ORIGIN=https://paillette-stg.berlayar.ai \
 *   CODE=Gt7HNyF ROUNDS=2 pnpm --filter web exec tsx scripts/room-demo-matrix.ts
 *
 * Exits non-zero if any cell fails, and prints the failing beat.
 */

import { spawn } from 'node:child_process';

const ROUNDS = Number(process.env.ROUNDS ?? 1);

interface Cell {
  name: string;
  env: Record<string, string>;
}

/**
 * The four dimensions, one at a time rather than a full cross product.
 *
 * A phone with reduced motion and no speech is a real visitor, but the full
 * cross product is sixteen runs of a minute each and the failures so far have
 * all been single-dimension. The two combined cells at the end are the ones
 * worth the wall-clock: the most-constrained visitor, and the largest show.
 */
const CELLS: Cell[] = [
  { name: 'desktop', env: {} },
  { name: 'phone, touch only', env: { VIEWPORT: 'phone' } },
  { name: 'reduced motion', env: { MOTION: 'reduce' } },
  { name: 'no speech APIs', env: { SPEECH: 'off' } },
  {
    name: 'phone + reduced motion + no speech',
    env: { VIEWPORT: 'phone', MOTION: 'reduce', SPEECH: 'off' },
  },
];

const run = (cell: Cell): Promise<{ ok: boolean; steps: number; failure: string }> =>
  new Promise((resolve) => {
    const child = spawn(
      'node',
      ['--import', 'tsx', 'scripts/room-demo-path.ts'],
      { env: { ...process.env, ...cell.env }, stdio: ['ignore', 'pipe', 'pipe'] }
    );
    let out = '';
    child.stdout.on('data', (chunk) => (out += chunk));
    child.stderr.on('data', (chunk) => (out += chunk));
    child.on('close', (code) => {
      const steps = (out.match(/^ {2}ok /gm) ?? []).length;
      const failure =
        out.match(/^ {2}FAIL +\d+\. (.+?) {2}/m)?.[1]?.trim() ??
        out.match(/Error: (.+)/)?.[1]?.slice(0, 70) ??
        '';
      resolve({ ok: code === 0, steps, failure });
    });
  });

const main = async () => {
  console.log(
    `\n${process.env.PAILLETTE_ORIGIN ?? 'http://localhost:5199'}  code ${process.env.CODE ?? '(default)'}  ×${ROUNDS}\n`
  );
  const failures: string[] = [];

  for (let round = 1; round <= ROUNDS; round += 1) {
    for (const cell of CELLS) {
      const result = await run(cell);
      console.log(
        `  ${result.ok ? 'ok  ' : 'FAIL'} ${cell.name.padEnd(38)} ${String(result.steps).padStart(2)} steps` +
          (result.failure ? `  ← ${result.failure}` : '')
      );
      if (!result.ok) failures.push(`round ${round}, ${cell.name}: ${result.failure}`);
    }
    if (ROUNDS > 1) console.log('');
  }

  if (failures.length) {
    console.log(`\n${failures.length} failing cell(s):`);
    for (const failure of failures) console.log(`  ${failure}`);
    process.exitCode = 1;
  } else {
    console.log(`\n  ${CELLS.length * ROUNDS} of ${CELLS.length * ROUNDS} cells green\n`);
  }
};

void main();
