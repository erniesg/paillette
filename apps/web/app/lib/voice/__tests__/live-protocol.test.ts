/**
 * The live session's decisions, which are the part that can be checked here.
 *
 * A microphone, a peer connection and a media track cannot be exercised on a
 * headless machine, so `live-session.ts` is deliberately thin and everything
 * worth asserting lives in the protocol. What follows is the contract the
 * session keeps with the provider: push-to-talk expressed as `turn_detection:
 * null`, tools in Realtime's shape rather than Chat Completions', and the
 * modality of a reply following the modality of the question.
 */

import { describe, expect, it } from 'vitest';
import {
  buildItemDelete,
  buildResponseCreate,
  buildSessionUpdate,
  buildToolResult,
  buildUserText,
  partitionCalls,
  readLiveEvent,
  toRealtimeTools,
} from '../live-protocol';

describe('the session configuration', () => {
  it('turns the provider’s voice detection off, because push-to-talk is decided', () => {
    const update = buildSessionUpdate([]);
    // Every realtime example defaults to server VAD, which is an open
    // microphone. On a public page that is an unbounded cost with no natural
    // end and is indistinguishable from normal use while it runs.
    expect(update.session.audio.input.turn_detection).toBeNull();
  });

  it('asks for input transcription, because the grace window needs text to edit', () => {
    // Without a transcript, releasing the button would commit audio nobody can
    // correct — and the 1.2s window would have nothing to show.
    expect(buildSessionUpdate([]).session.audio.input.transcription).toEqual({
      model: 'gpt-live-transcribe',
    });
  });

  it('offers tools in Realtime’s flat shape, not Chat Completions’ nested one', () => {
    // The nested `{function:{...}}` form is accepted and then silently
    // ignored: the session connects, works, and never calls anything.
    const [tool] = toRealtimeTools([
      {
        name: 'search_artworks',
        description: 'Search the collection.',
        inputSchema: { type: 'object', properties: { query: { type: 'string' } } },
      },
    ]);

    expect(tool).toEqual({
      type: 'function',
      name: 'search_artworks',
      description: 'Search the collection.',
      parameters: { type: 'object', properties: { query: { type: 'string' } } },
    });
    expect(tool).not.toHaveProperty('function');
  });

  it('gives a schema-less tool something valid rather than nothing', () => {
    const tool = toRealtimeTools([{ name: 'redeal' }])[0]!;
    expect(tool.parameters).toEqual({ type: 'object', properties: {} });
    expect(tool.description).toBe('');
  });

  it('passes the page’s own tools through untouched', () => {
    // The same twenty-five tools the human drives by hand. Nothing about the
    // tool surface is restated for the session's benefit — a second,
    // agent-only list is how the two operators start disagreeing.
    const names = ['search_artworks', 'redeal', 'set_exhibition'];
    expect(
      buildSessionUpdate(names.map((name) => ({ name }))).session.tools.map(
        (tool) => tool.name
      )
    ).toEqual(names);
  });
});

describe('text in, text out; voice in, voice out', () => {
  it('asks for audio when the question was spoken', () => {
    expect(buildResponseCreate(true).response.output_modalities).toEqual(['audio']);
  });

  it('asks for text when it was typed', () => {
    expect(buildResponseCreate(false).response.output_modalities).toEqual(['text']);
  });

  it('puts a typed sentence into the same conversation the speech is in', () => {
    // This is the whole feature: not a second path that also reaches the
    // model, but the same session receiving a different kind of turn.
    expect(buildUserText('warmer')).toEqual({
      type: 'conversation.item.create',
      item: {
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text: 'warmer' }],
      },
    });
  });
});

describe('reading what the session says back', () => {
  it('hands the transcript over with the item it belongs to', () => {
    // The item id is what lets an utterance be withdrawn if the human types
    // over it during the grace window.
    expect(
      readLiveEvent({
        type: 'conversation.item.input_audio_transcription.completed',
        item_id: 'item_9',
        transcript: '  something warm for above the sofa  ',
      })
    ).toEqual([
      {
        kind: 'transcript',
        text: 'something warm for above the sofa',
        itemId: 'item_9',
      },
    ]);
  });

  it('ignores an empty transcript rather than starting a countdown on nothing', () => {
    const event = readLiveEvent({
      type: 'conversation.item.input_audio_transcription.completed',
      transcript: '   ',
    })[0]!;
    expect(event.kind).toBe('ignored');
  });

  it('reads a function call out of a completed response', () => {
    expect(
      readLiveEvent({
        type: 'response.done',
        response: {
          output: [
            {
              type: 'function_call',
              name: 'search_by_color',
              call_id: 'call_1',
              arguments: '{"query":"harbour","hex":"#1b2a4a"}',
            },
          ],
        },
      })
    ).toEqual([
      {
        kind: 'tool',
        callId: 'call_1',
        name: 'search_by_color',
        args: { query: 'harbour', hex: '#1b2a4a' },
      },
      { kind: 'response-done' },
    ]);
  });

  it('lets the tool reject malformed arguments rather than guessing at them', () => {
    const [call] = readLiveEvent({
      type: 'response.done',
      response: {
        output: [
          { type: 'function_call', name: 'redeal', call_id: 'c', arguments: '{oh' },
        ],
      },
    });
    expect(call).toEqual({ kind: 'tool', callId: 'c', name: 'redeal', args: {} });
  });

  it('reads several calls from one response, in the order they were asked for', () => {
    const events = readLiveEvent({
      type: 'response.done',
      response: {
        output: [
          { type: 'function_call', name: 'get_view_context', call_id: 'a', arguments: '{}' },
          { type: 'function_call', name: 'search_artworks', call_id: 'b', arguments: '{}' },
          { type: 'function_call', name: 'set_results', call_id: 'c', arguments: '{}' },
        ],
      },
    });
    expect(events.filter((e) => e.kind === 'tool').map((e) => e.callId)).toEqual([
      'a',
      'b',
      'c',
    ]);
    // The completion signal comes last, so results and "it has stopped" can
    // never arrive out of order with each other.
    expect(events[events.length - 1]).toEqual({ kind: 'response-done' });
  });

  it('surfaces the sentence whether it was spoken or typed', () => {
    // A spoken reply arrives as a transcript beside its audio; a typed one as
    // text. The wall label above the board is not optional just because the
    // answer happened to be audible.
    const spoken = readLiveEvent({
      type: 'response.done',
      response: {
        output: [
          {
            type: 'message',
            content: [{ type: 'output_audio', transcript: 'Following the picks.' }],
          },
        ],
      },
    });
    const typed = readLiveEvent({
      type: 'response.done',
      response: {
        output: [
          { type: 'message', content: [{ type: 'output_text', text: 'Following the picks.' }] },
        ],
      },
    });

    expect(spoken[0]).toEqual({ kind: 'reply', text: 'Following the picks.' });
    expect(typed[0]).toEqual({ kind: 'reply', text: 'Following the picks.' });
  });

  it('reports an error in the provider’s own words when it has any', () => {
    expect(
      readLiveEvent({ type: 'error', error: { message: 'Session expired.' } })
    ).toEqual([{ kind: 'error', message: 'Session expired.' }]);
  });

  it('ignores the traffic it has no opinion about', () => {
    // Most of what a realtime session emits is deltas. Treating an unknown
    // event as anything but noise is how a page starts acting on half a word.
    for (const type of [
      'response.output_audio.delta',
      'response.output_audio_transcript.delta',
      'input_audio_buffer.committed',
      'rate_limits.updated',
      'conversation.item.added',
    ]) {
      expect(readLiveEvent({ type })).toEqual([{ kind: 'ignored' }]);
    }
    expect(readLiveEvent(null)).toEqual([{ kind: 'ignored' }]);
    expect(readLiveEvent('nonsense')).toEqual([{ kind: 'ignored' }]);
  });

  it('reports the session ready only once it is configured', () => {
    // `session.updated` is the acknowledgement that the tools and the
    // push-to-talk setting actually landed. Treating `session.created` as
    // ready would open the microphone into a session still running server VAD.
    expect(readLiveEvent({ type: 'session.updated' })).toEqual([{ kind: 'ready' }]);
    expect(readLiveEvent({ type: 'session.created' })).toEqual([{ kind: 'ignored' }]);
  });
});

describe('handing results back', () => {
  it('keys a result to the call that asked for it', () => {
    expect(buildToolResult('call_1', { ok: true, count: 12 })).toEqual({
      type: 'conversation.item.create',
      item: {
        type: 'function_call_output',
        call_id: 'call_1',
        output: '{"ok":true,"count":12}',
      },
    });
  });

  it('clips a large result, because a live session pays for its context again', () => {
    const huge = buildToolResult('c', { works: 'x'.repeat(9000) });
    expect(huge.item.output.length).toBe(4000);
  });

  it('withdraws audio the human decided against', () => {
    expect(buildItemDelete('item_9')).toEqual({
      type: 'conversation.item.delete',
      item_id: 'item_9',
    });
  });
});

describe('partitionCalls', () => {
  it('keeps reads together and writes apart', () => {
    // Same rule as the typed loop: two `set_results` in flight leave the board
    // showing whichever returned last rather than what was asked for.
    const readOnly = new Set(['get_view_context', 'search_artworks']);
    const { reads, writes } = partitionCalls(
      [
        { name: 'get_view_context' },
        { name: 'set_results' },
        { name: 'search_artworks' },
      ],
      (name) => readOnly.has(name)
    );

    expect(reads.map((call) => call.name)).toEqual([
      'get_view_context',
      'search_artworks',
    ]);
    expect(writes.map((call) => call.name)).toEqual(['set_results']);
  });
});
