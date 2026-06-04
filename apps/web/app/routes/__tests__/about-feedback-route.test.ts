import { describe, expect, it, vi, afterEach } from 'vitest';

import { action } from '../about';

const makeFeedbackRequest = (body: Record<string, string>) =>
  new Request('https://paillette.test/about', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body),
  });

const contextWithEnv = (env: Record<string, string | undefined>) =>
  ({
    cloudflare: {
      env,
    },
  }) as any;

describe('about feedback action', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('rejects incomplete feedback before sending anything', async () => {
    const mockFetch = vi.fn<typeof globalThis.fetch>();
    vi.stubGlobal('fetch', mockFetch);

    const response = await action({
      context: contextWithEnv({
        RESEND_API_KEY: 'test-resend-key',
        CODEX_DISCORD_WEBHOOK_URL: 'https://discord.test/webhook',
      }),
      params: {},
      request: makeFeedbackRequest({
        name: 'Visitor',
        email: 'not-an-email',
        message: '',
      }),
    } as any);
    const payload = (await response.json()) as { status: string };

    expect(response.status).toBe(400);
    expect(payload.status).toBe('error');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('sends visitor acknowledgement, owner email, and Discord notification', async () => {
    const mockFetch = vi.fn<typeof globalThis.fetch>(async (url) => {
      if (String(url).includes('resend.com')) {
        return new Response(JSON.stringify({ id: 'email_123' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      return new Response(null, { status: 204 });
    });
    vi.stubGlobal('fetch', mockFetch);

    const response = await action({
      context: contextWithEnv({
        RESEND_API_KEY: 'test-resend-key',
        CODEX_DISCORD_WEBHOOK_URL: 'https://discord.test/webhook',
        PAILLETTE_FEEDBACK_FROM: 'Paillette <noreply@berlayar.ai>',
        PAILLETTE_FEEDBACK_TO: 'owner@example.com',
      }),
      params: {},
      request: makeFeedbackRequest({
        name: 'Visitor',
        email: 'visitor@example.com',
        message: 'This search is useful. Could you add filters?',
      }),
    } as any);
    const payload = (await response.json()) as { status: string };
    const resendCalls = mockFetch.mock.calls.filter(([url]) =>
      String(url).includes('resend.com')
    );
    const visitorEmail = JSON.parse(
      resendCalls[0]?.[1]?.body as string
    ) as Record<string, any>;
    const ownerEmail = JSON.parse(
      resendCalls[1]?.[1]?.body as string
    ) as Record<string, any>;
    const discordCall = mockFetch.mock.calls.find(([url]) =>
      String(url).includes('discord.test')
    );
    const discordPayload = JSON.parse(
      discordCall?.[1]?.body as string
    ) as Record<string, any>;

    expect(response.status).toBe(200);
    expect(payload.status).toBe('success');
    expect(resendCalls).toHaveLength(2);
    expect(visitorEmail).toMatchObject({
      from: 'Paillette <noreply@berlayar.ai>',
      to: ['visitor@example.com'],
      subject: 'Thanks for your Paillette feedback',
    });
    expect(visitorEmail.text).toContain('open source');
    expect(visitorEmail.text).toContain('contribute');
    expect(visitorEmail.text).toContain('https://github.com/erniesg/paillette');
    expect(ownerEmail).toMatchObject({
      to: ['owner@example.com'],
      reply_to: 'visitor@example.com',
      subject: 'New Paillette feedback from Visitor',
    });
    expect(discordPayload.username).toBe('Paillette Feedback');
    expect(discordPayload.embeds[0].title).toBe('New Paillette feedback');
    expect(discordPayload.embeds[0].fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'From', value: 'Visitor <visitor@example.com>' }),
        expect.objectContaining({
          name: 'Message',
          value: 'This search is useful. Could you add filters?',
        }),
      ])
    );
  });
});
