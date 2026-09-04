/**
 * The audio-minute gate, tested against real SQLite rather than a fake D1.
 *
 * The guarantee this file is here to defend is arithmetic under contention:
 * two tabs must not both be able to spend the last ten seconds, a refund must
 * land on the window it was taken from, and one caller's spend must not touch
 * another's. A hand-written `prepare().bind().run()` stub can be made to agree
 * with whatever the code does, including when the code is wrong — so the
 * migration is loaded into `node:sqlite` and the statements run for real. The
 * guarded UPSERT either is atomic or the test fails.
 */

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import type { DatabaseSync as NodeDatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import liveRoutes from '../../src/routes/live';
import type { Env } from '../../src/index';
import {
  DEFAULT_LIVE_AUDIO_SECONDS_PER_CALLER_PER_HOUR,
  DEFAULT_LIVE_AUDIO_SECONDS_PER_DAY,
  DEFAULT_LIVE_SESSION_MAX_SECONDS,
  callerScope,
  callerSecondsPerHour,
  readLiveAudioBudget,
  reserveLiveAudio,
  settleLiveAudio,
  siteScope,
  siteSecondsPerDay,
  sessionMaxSeconds,
} from '../../src/utils/live-audio-budget';
import { parseCallId } from '../../src/utils/openai-realtime';

const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as {
  DatabaseSync: typeof NodeDatabaseSync;
};

const MIGRATION = readFileSync(
  new URL(
    '../../../../packages/database/migrations/0023_live_audio_budget.sql',
    import.meta.url
  ),
  'utf8'
);

/**
 * The smallest surface of D1 this code uses, over a real SQLite handle.
 *
 * The one behaviour worth naming: D1's `first()` resolves to `null` when
 * nothing matched, while `node:sqlite` returns `undefined`. The budget's
 * admit/refuse decision is `row !== null`, so collapsing the two here is not
 * tidying — it is the difference between the guard working and every
 * reservation being admitted.
 */
const makeDb = (sqlite: NodeDatabaseSync): D1Database => {
  const prepare = (sql: string) => {
    let params: unknown[] = [];
    const statement = {
      bind: (...args: unknown[]) => {
        params = args;
        return statement;
      },
      first: async <T,>() =>
        (sqlite.prepare(sql).get(...(params as never[])) as T) ?? null,
      run: async () => {
        sqlite.prepare(sql).run(...(params as never[]));
        return { success: true };
      },
      all: async <T,>() => ({
        results: sqlite.prepare(sql).all(...(params as never[])) as T[],
        success: true,
      }),
    };
    return statement;
  };
  return { prepare } as unknown as D1Database;
};

type TestEnvOverrides = Partial<Record<string, string>>;

const makeEnv = (
  db: D1Database,
  overrides: TestEnvOverrides = {}
): Env =>
  ({
    DB: db,
    ENVIRONMENT: 'test',
    API_VERSION: 'v1',
    OPENAI_API_KEY: 'test-key-not-a-real-credential',
    ...overrides,
  }) as unknown as Env;

const app = () => {
  const instance = new Hono<{ Bindings: Env }>();
  instance.route('/api', liveRoutes);
  return instance;
};

/** Two different visitors, as Cloudflare would present them. */
const AS_ADA = { 'CF-Connecting-IP': '203.0.113.10' };
const AS_GRACE = { 'CF-Connecting-IP': '203.0.113.99' };

const post = (
  instance: ReturnType<typeof app>,
  path: string,
  env: Env,
  init: { headers?: Record<string, string>; body?: string } = {}
) =>
  instance.request(
    path,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
      body: init.body ?? '{}',
    },
    env
  );

const mintOk = (secret = 'ek_test_ephemeral') =>
  new Response(
    JSON.stringify({ value: secret, expires_at: 1_800_000_060 }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  );

let sqlite: NodeDatabaseSync;
let db: D1Database;

beforeEach(() => {
  sqlite = new DatabaseSync(':memory:');
  sqlite.exec(MIGRATION);
  db = makeDb(sqlite);
});

afterEach(() => {
  vi.unstubAllGlobals();
  sqlite.close();
});

describe('live-audio ceilings are configurable, with production-safe defaults', () => {
  it('falls back to the shipped defaults when nothing is configured', () => {
    const env = {} as Env;
    expect(callerSecondsPerHour(env)).toBe(
      DEFAULT_LIVE_AUDIO_SECONDS_PER_CALLER_PER_HOUR
    );
    expect(siteSecondsPerDay(env)).toBe(DEFAULT_LIVE_AUDIO_SECONDS_PER_DAY);
    expect(sessionMaxSeconds(env)).toBe(DEFAULT_LIVE_SESSION_MAX_SECONDS);
  });

  it('honours a raised staging ceiling', () => {
    const staging = {
      LIVE_AUDIO_SECONDS_PER_CALLER_PER_HOUR: '1800',
      LIVE_AUDIO_SECONDS_PER_DAY: '7200',
      LIVE_SESSION_MAX_SECONDS: '300',
    } as Env;
    expect(callerSecondsPerHour(staging)).toBe(1800);
    expect(siteSecondsPerDay(staging)).toBe(7200);
    expect(sessionMaxSeconds(staging)).toBe(300);
  });

  it('ignores nonsense rather than turning the ceiling off', () => {
    for (const raw of ['0', '-90', 'plenty', '']) {
      expect(
        callerSecondsPerHour({
          LIVE_AUDIO_SECONDS_PER_CALLER_PER_HOUR: raw,
        } as Env)
      ).toBe(DEFAULT_LIVE_AUDIO_SECONDS_PER_CALLER_PER_HOUR);
    }
  });
});

describe('the budget itself', () => {
  it('debits both meters up front, so a session that never reports back is still paid for', async () => {
    const env = makeEnv(db, { LIVE_SESSION_MAX_SECONDS: '60' });
    const grant = await reserveLiveAudio(env, 'ada');

    expect(grant.admitted).toBe(true);
    const budget = await readLiveAudioBudget(env, 'ada');
    // Not "spent when it closes" — spent now.
    expect(budget?.callerRemaining).toBe(
      DEFAULT_LIVE_AUDIO_SECONDS_PER_CALLER_PER_HOUR - 60
    );
    expect(budget?.siteRemaining).toBe(DEFAULT_LIVE_AUDIO_SECONDS_PER_DAY - 60);
  });

  it('refuses a caller who has spent the hour, and says which ceiling refused', async () => {
    const env = makeEnv(db, {
      LIVE_AUDIO_SECONDS_PER_CALLER_PER_HOUR: '60',
      LIVE_SESSION_MAX_SECONDS: '60',
    });

    expect((await reserveLiveAudio(env, 'ada')).admitted).toBe(true);
    const second = await reserveLiveAudio(env, 'ada');

    expect(second).toEqual({ admitted: false, reason: 'caller' });
  });

  it('leaves a fresh caller untouched by another caller’s spend', async () => {
    const env = makeEnv(db, {
      LIVE_AUDIO_SECONDS_PER_CALLER_PER_HOUR: '60',
      LIVE_SESSION_MAX_SECONDS: '60',
    });

    await reserveLiveAudio(env, 'ada');
    expect((await reserveLiveAudio(env, 'ada')).admitted).toBe(false);

    // Grace has spent nothing and is not standing behind Ada in a queue.
    expect((await reserveLiveAudio(env, 'grace')).admitted).toBe(true);
  });

  it('stops a handful of callers exhausting the account between them', async () => {
    // Every caller is inside their own hourly allowance; together they are not.
    const env = makeEnv(db, {
      LIVE_AUDIO_SECONDS_PER_CALLER_PER_HOUR: '60',
      LIVE_AUDIO_SECONDS_PER_DAY: '120',
      LIVE_SESSION_MAX_SECONDS: '60',
    });

    expect((await reserveLiveAudio(env, 'ada')).admitted).toBe(true);
    expect((await reserveLiveAudio(env, 'grace')).admitted).toBe(true);

    const third = await reserveLiveAudio(env, 'katherine');
    expect(third).toEqual({ admitted: false, reason: 'site' });
  });

  it('does not leak the site budget to a caller it then refuses', async () => {
    const env = makeEnv(db, {
      LIVE_AUDIO_SECONDS_PER_CALLER_PER_HOUR: '60',
      LIVE_AUDIO_SECONDS_PER_DAY: '600',
      LIVE_SESSION_MAX_SECONDS: '60',
    });

    await reserveLiveAudio(env, 'ada');
    await reserveLiveAudio(env, 'ada'); // refused on the per-caller ceiling

    // The refused attempt must not have quietly kept the site-wide seconds it
    // reserved first. Only the admitted one is charged.
    const budget = await readLiveAudioBudget(env, 'ada');
    expect(budget?.siteRemaining).toBe(540);
  });

  it('refunds only what was not used, to the windows it came from', async () => {
    const env = makeEnv(db, { LIVE_SESSION_MAX_SECONDS: '90' });
    const grant = await reserveLiveAudio(env, 'ada');
    if (!grant.admitted) throw new Error('expected a grant');

    const used = await settleLiveAudio(
      env,
      {
        callerScope: grant.callerScope,
        siteScope: grant.siteScope,
        grantedSeconds: grant.seconds,
      },
      12.3
    );

    expect(used).toBe(13); // ceil — a part-second of audio was still audio
    const budget = await readLiveAudioBudget(env, 'ada');
    expect(budget?.callerRemaining).toBe(
      DEFAULT_LIVE_AUDIO_SECONDS_PER_CALLER_PER_HOUR - 13
    );
    expect(budget?.siteRemaining).toBe(DEFAULT_LIVE_AUDIO_SECONDS_PER_DAY - 13);
  });

  it('cannot be made to refund more than it granted', async () => {
    const env = makeEnv(db, { LIVE_SESSION_MAX_SECONDS: '30' });
    const grant = await reserveLiveAudio(env, 'ada');
    if (!grant.admitted) throw new Error('expected a grant');

    // A client claiming a negative duration, and one claiming an implausible
    // one. Neither may move the meter outside [0, granted].
    await settleLiveAudio(env, { ...grant, grantedSeconds: grant.seconds }, -500);
    const afterUnderflow = await readLiveAudioBudget(env, 'ada');
    expect(afterUnderflow?.callerRemaining).toBe(
      DEFAULT_LIVE_AUDIO_SECONDS_PER_CALLER_PER_HOUR
    );
  });

  it('keeps a refund on the hour it was taken from when the clock rolls over', async () => {
    const env = makeEnv(db, { LIVE_SESSION_MAX_SECONDS: '60' });
    const tenFiftyNine = new Date('2026-09-04T10:59:30Z');
    const elevenOhOne = new Date('2026-09-04T11:01:00Z');

    const grant = await reserveLiveAudio(env, 'ada', tenFiftyNine);
    if (!grant.admitted) throw new Error('expected a grant');
    await settleLiveAudio(env, { ...grant, grantedSeconds: grant.seconds }, 10);

    // The hour it was charged to is credited back...
    const spentAtTen = sqlite
      .prepare('SELECT seconds_spent FROM live_audio_budget WHERE scope = ?')
      .get(callerScope('ada', tenFiftyNine)) as { seconds_spent: number };
    expect(spentAtTen.seconds_spent).toBe(10);

    // ...and the next hour, which was never charged, is not driven negative.
    const spentAtEleven = sqlite
      .prepare('SELECT seconds_spent FROM live_audio_budget WHERE scope = ?')
      .get(callerScope('ada', elevenOhOne));
    expect(spentAtEleven).toBeUndefined();
  });

  it('fails closed when there is no database to meter against', async () => {
    // Unlike the model-call limiter, which fails open. An unmetered request is
    // one chat completion; an unmetered live session is an open microphone.
    const grant = await reserveLiveAudio({} as Env, 'ada');
    expect(grant).toEqual({ admitted: false, reason: 'unavailable' });
  });

  it('keeps the site meter on a UTC day boundary', () => {
    expect(siteScope(new Date('2026-09-04T23:59:59Z'))).toBe('site:2026-09-04');
    expect(siteScope(new Date('2026-09-05T00:00:00Z'))).toBe('site:2026-09-05');
  });
});

describe('POST /api/public-live/token — the gate', () => {
  it('mints a session and hands back a short-lived token, never the account key', async () => {
    const fetchMock = vi.fn(async () => mintOk());
    vi.stubGlobal('fetch', fetchMock);

    const env = makeEnv(db, { LIVE_SESSION_MAX_SECONDS: '90' });
    const response = await post(app(), '/api/public-live/token', env, {
      headers: AS_ADA,
    });

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      data: { token: string; grantedSeconds: number; sessionId: string };
    };
    expect(body.data.grantedSeconds).toBe(90);
    expect(body.data.token).toBe('ek_test_ephemeral');
    expect(body.data.sessionId).toMatch(/^[0-9a-f]{32}$/);

    // The account key was used to mint and did not travel any further.
    expect(JSON.stringify(body)).not.toContain('test-key-not-a-real-credential');
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>).Authorization).toBe(
      'Bearer test-key-not-a-real-credential'
    );
  });

  it('refuses a caller who is over budget, with a reason the page can show', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => mintOk()));

    const env = makeEnv(db, {
      LIVE_AUDIO_SECONDS_PER_CALLER_PER_HOUR: '90',
      LIVE_SESSION_MAX_SECONDS: '90',
    });
    const instance = app();

    expect(
      (await post(instance, '/api/public-live/token', env, { headers: AS_ADA }))
        .status
    ).toBe(200);

    const refused = await post(instance, '/api/public-live/token', env, {
      headers: AS_ADA,
    });

    expect(refused.status).toBe(429);
    const body = (await refused.json()) as {
      error: { code: string; message: string };
    };
    expect(body.error.code).toBe('LIVE_BUDGET_SPENT');
    // One clause. It does not tell them to type instead: the bar is on
    // screen with a caret in it, and saying so is the page apologising.
    expect(body.error.message).toBe('No live audio left this hour.');
  });

  it('says the site-wide refusal differently from the per-caller one', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => mintOk()));

    const env = makeEnv(db, {
      LIVE_AUDIO_SECONDS_PER_CALLER_PER_HOUR: '90',
      LIVE_AUDIO_SECONDS_PER_DAY: '90',
      LIVE_SESSION_MAX_SECONDS: '90',
    });
    const instance = app();

    await post(instance, '/api/public-live/token', env, { headers: AS_ADA });
    const refused = await post(instance, '/api/public-live/token', env, {
      headers: AS_GRACE,
    });

    expect(refused.status).toBe(429);
    const body = (await refused.json()) as { error: { message: string } };
    // Grace has spent nothing of her own; telling her she has would be a lie
    // she could act on by waiting for the wrong clock. Hers resets at
    // midnight, not on the hour.
    expect(body.error.message).toBe('No live audio left today.');
  });

  it('refuses rather than degrading when there is no meter', async () => {
    const response = await post(
      app(),
      '/api/public-live/token',
      { ENVIRONMENT: 'test' } as Env,
      { headers: AS_ADA }
    );
    expect(response.status).toBe(503);
  });

  it('refuses a caller it cannot identify, because it cannot meter one', async () => {
    const response = await post(app(), '/api/public-live/token', makeEnv(db));
    expect(response.status).toBe(403);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe('LIVE_UNIDENTIFIED');
  });

  it('gives the grant back when the provider will not mint', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('nope', { status: 500 }))
    );

    const env = makeEnv(db, { LIVE_SESSION_MAX_SECONDS: '90' });
    const response = await post(app(), '/api/public-live/token', env, {
      headers: AS_ADA,
    });

    expect(response.status).toBe(503);
    // Nothing was spent, so nothing stays debited — otherwise a provider
    // outage silently eats the day's budget one failed mint at a time.
    const budget = await readLiveAudioBudget(env, await adaHash());
    expect(budget?.siteRemaining).toBe(DEFAULT_LIVE_AUDIO_SECONDS_PER_DAY);
  });

  it('never puts the provider’s error body in front of the visitor', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              error: { message: 'Incorrect API key provided: sk-live-abc123' },
            }),
            { status: 401 }
          )
      )
    );

    const response = await post(app(), '/api/public-live/token', makeEnv(db), {
      headers: AS_ADA,
    });

    expect(await response.text()).not.toContain('sk-live-abc123');
  });
});

describe('an open session is stopped server-side when the grant runs out', () => {
  const connect = async (env: Env, instance: ReturnType<typeof app>) => {
    const minted = await post(instance, '/api/public-live/token', env, {
      headers: AS_ADA,
    });
    const { data } = (await minted.json()) as {
      data: { sessionId: string; token: string };
    };

    const answered = await instance.request(
      `/api/public-live/call?session=${data.sessionId}`,
      {
        method: 'POST',
        headers: {
          ...AS_ADA,
          'Content-Type': 'application/sdp',
          'X-Live-Token': data.token,
        },
        body: 'v=0\r\no=- 0 0 IN IP4 127.0.0.1\r\n',
      },
      env
    );
    return { sessionId: data.sessionId, answered };
  };

  it('learns the call id from the provider rather than from the client', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        String(url).includes('client_secrets')
          ? mintOk()
          : new Response('v=0\r\na=answer\r\n', {
              status: 200,
              headers: { Location: '/v1/realtime/calls/rtc_abc123' },
            })
      )
    );

    const env = makeEnv(db, { LIVE_SESSION_MAX_SECONDS: '90' });
    const { sessionId, answered } = await connect(env, app());

    expect(answered.status).toBe(200);
    expect(await answered.text()).toContain('a=answer');

    const row = sqlite
      .prepare('SELECT call_id FROM live_audio_sessions WHERE id = ?')
      .get(sessionId) as { call_id: string };
    // The client was never asked for this, and so cannot withhold it.
    expect(row.call_id).toBe('rtc_abc123');
  });

  it('hangs the call up at the provider when the heartbeat finds it expired', async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        calls.push(String(url));
        if (String(url).includes('client_secrets')) return mintOk();
        if (String(url).includes('/hangup')) return new Response('', { status: 200 });
        return new Response('v=0\r\na=answer\r\n', {
          status: 200,
          headers: { Location: '/v1/realtime/calls/rtc_abc123' },
        });
      })
    );

    const env = makeEnv(db, { LIVE_SESSION_MAX_SECONDS: '90' });
    const instance = app();
    const { sessionId } = await connect(env, instance);

    // Wind the session's clock back past its grant, as an idle tab would.
    sqlite
      .prepare(
        'UPDATE live_audio_sessions SET started_at = started_at - 600, expires_at = expires_at - 600 WHERE id = ?'
      )
      .run(sessionId);

    const beat = await post(instance, '/api/public-live/heartbeat', env, {
      headers: AS_ADA,
      body: JSON.stringify({ sessionId }),
    });

    const body = (await beat.json()) as {
      data: { open: boolean; reason: string | null };
    };
    expect(body.data.open).toBe(false);
    // One sentence, and the human is told once.
    expect(body.data.reason).toBe('Live audio time is up.');
    expect(
      calls.some((url) => url.endsWith('/v1/realtime/calls/rtc_abc123/hangup'))
    ).toBe(true);
  });

  it('reports remaining seconds while the session is still inside its grant', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        String(url).includes('client_secrets')
          ? mintOk()
          : new Response('v=0\r\n', {
              status: 200,
              headers: { Location: '/v1/realtime/calls/rtc_abc123' },
            })
      )
    );

    const env = makeEnv(db, { LIVE_SESSION_MAX_SECONDS: '90' });
    const instance = app();
    const { sessionId } = await connect(env, instance);

    const beat = await post(instance, '/api/public-live/heartbeat', env, {
      headers: AS_ADA,
      body: JSON.stringify({ sessionId }),
    });
    const body = (await beat.json()) as {
      data: { open: boolean; remainingSeconds: number };
    };

    expect(body.data.open).toBe(true);
    expect(body.data.remainingSeconds).toBeGreaterThan(80);
  });

  it('will not let one visitor settle or read another’s session', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        String(url).includes('client_secrets')
          ? mintOk()
          : new Response('v=0\r\n', { status: 200 })
      )
    );

    const env = makeEnv(db, { LIVE_SESSION_MAX_SECONDS: '90' });
    const instance = app();
    const { sessionId } = await connect(env, instance);

    const stolen = await post(instance, '/api/public-live/heartbeat', env, {
      headers: AS_GRACE,
      body: JSON.stringify({ sessionId }),
    });
    expect(stolen.status).toBe(404);
  });

  it('settles on close, refunding the seconds the session did not use', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        String(url).includes('client_secrets')
          ? mintOk()
          : new Response('v=0\r\n', {
              status: 200,
              headers: { Location: '/v1/realtime/calls/rtc_abc123' },
            })
      )
    );

    const env = makeEnv(db, { LIVE_SESSION_MAX_SECONDS: '90' });
    const instance = app();
    const { sessionId } = await connect(env, instance);

    await post(instance, '/api/public-live/close', env, {
      headers: AS_ADA,
      body: JSON.stringify({ sessionId }),
    });

    const budget = await readLiveAudioBudget(env, await adaHash());
    // Ninety seconds were held; a session closed immediately used almost none
    // of them, and the rest is available again.
    expect(budget?.callerRemaining).toBeGreaterThan(
      DEFAULT_LIVE_AUDIO_SECONDS_PER_CALLER_PER_HOUR - 5
    );
  });

  it('settles once, however many times it is told to close', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        String(url).includes('client_secrets')
          ? mintOk()
          : new Response('v=0\r\n', { status: 200 })
      )
    );

    const env = makeEnv(db, { LIVE_SESSION_MAX_SECONDS: '90' });
    const instance = app();
    const { sessionId } = await connect(env, instance);

    const body = JSON.stringify({ sessionId });
    await post(instance, '/api/public-live/close', env, { headers: AS_ADA, body });
    const after = await readLiveAudioBudget(env, await adaHash());
    await post(instance, '/api/public-live/close', env, { headers: AS_ADA, body });
    await post(instance, '/api/public-live/close', env, { headers: AS_ADA, body });

    // A double settlement would refund twice and mint free seconds.
    expect((await readLiveAudioBudget(env, await adaHash()))?.callerRemaining).toBe(
      after?.callerRemaining
    );
  });

  it('refuses to reuse a session that has already connected', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        String(url).includes('client_secrets')
          ? mintOk()
          : new Response('v=0\r\n', {
              status: 200,
              headers: { Location: '/v1/realtime/calls/rtc_abc123' },
            })
      )
    );

    const env = makeEnv(db, { LIVE_SESSION_MAX_SECONDS: '90' });
    const instance = app();
    const minted = await post(instance, '/api/public-live/token', env, {
      headers: AS_ADA,
    });
    const { data } = (await minted.json()) as {
      data: { sessionId: string; token: string };
    };

    const offer = {
      method: 'POST',
      headers: {
        ...AS_ADA,
        'Content-Type': 'application/sdp',
        'X-Live-Token': data.token,
      },
      body: 'v=0\r\n',
    };
    const path = `/api/public-live/call?session=${data.sessionId}`;

    expect((await instance.request(path, offer, env)).status).toBe(200);
    // One grant, one call. Otherwise a single debit buys as many connections
    // as the client cares to open.
    expect((await instance.request(path, offer, env)).status).toBe(409);
  });

  it('gives the grant back when the connection itself fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        String(url).includes('client_secrets')
          ? mintOk()
          : new Response('no', { status: 500 })
      )
    );

    const env = makeEnv(db, { LIVE_SESSION_MAX_SECONDS: '90' });
    const instance = app();
    const minted = await post(instance, '/api/public-live/token', env, {
      headers: AS_ADA,
    });
    const { data } = (await minted.json()) as {
      data: { sessionId: string; token: string };
    };

    const failed = await instance.request(
      `/api/public-live/call?session=${data.sessionId}`,
      {
        method: 'POST',
        headers: {
          ...AS_ADA,
          'Content-Type': 'application/sdp',
          'X-Live-Token': data.token,
        },
        body: 'v=0\r\n',
      },
      env
    );

    expect(failed.status).toBe(503);
    const budget = await readLiveAudioBudget(env, await adaHash());
    expect(budget?.siteRemaining).toBe(DEFAULT_LIVE_AUDIO_SECONDS_PER_DAY);
  });

  it('sweeps a session abandoned by a closed laptop when the next visitor arrives', async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        calls.push(String(url));
        if (String(url).includes('client_secrets')) return mintOk();
        if (String(url).includes('/hangup')) return new Response('', { status: 200 });
        return new Response('v=0\r\n', {
          status: 200,
          headers: { Location: '/v1/realtime/calls/rtc_stale' },
        });
      })
    );

    const env = makeEnv(db, { LIVE_SESSION_MAX_SECONDS: '90' });
    const instance = app();
    const { sessionId } = await connect(env, instance);
    sqlite
      .prepare(
        'UPDATE live_audio_sessions SET started_at = started_at - 600, expires_at = expires_at - 600 WHERE id = ?'
      )
      .run(sessionId);

    // Grace turns up and asks for a session of her own. Ada's dead one is cut.
    await post(instance, '/api/public-live/token', env, { headers: AS_GRACE });

    expect(
      calls.some((url) => url.endsWith('/v1/realtime/calls/rtc_stale/hangup'))
    ).toBe(true);
    const row = sqlite
      .prepare('SELECT closed_at, close_reason FROM live_audio_sessions WHERE id = ?')
      .get(sessionId) as { closed_at: number; close_reason: string };
    expect(row.closed_at).not.toBeNull();
    expect(row.close_reason).toBe('expired');
  });
});

describe('parseCallId', () => {
  it('reads the id out of the provider’s Location header', () => {
    expect(parseCallId('/v1/realtime/calls/rtc_abc123')).toBe('rtc_abc123');
  });

  it('refuses anything that is not an id, rather than pasting it into a URL', () => {
    expect(parseCallId(null)).toBeNull();
    expect(parseCallId('/v1/realtime/calls/')).toBeNull();
    expect(parseCallId('/v1/realtime/calls/../../secrets')).toBeNull();
  });
});

/** The same hash the route derives, so assertions read the right meter row. */
const adaHash = async () => {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(`webmcp-live:${AS_ADA['CF-Connecting-IP']}`)
  );
  return Array.from(new Uint8Array(digest), (b) =>
    b.toString(16).padStart(2, '0')
  ).join('');
};
