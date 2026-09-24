import { describe, expect, it } from 'vitest';
import { callerAddress } from './caller-address';

const request = (headers: Record<string, string>, key = 'server-key') => ({
  req: { header: (name: string) => headers[name] },
  env: { PAILLETTE_PUBLIC_SEARCH_API_KEY: key },
});

describe('callerAddress', () => {
  it('counts a visitor behind the web proxy as themselves, not as the proxy', () => {
    expect(
      callerAddress(
        request({
          'CF-Connecting-IP': '2a06:98c0:3600::103',
          'X-API-Key': 'server-key',
          'X-Paillette-Visitor-Ip': '203.0.113.9',
        })
      )
    ).toBe('203.0.113.9');
  });

  it('ignores a relayed address from anyone without the key', () => {
    expect(
      callerAddress(
        request({ 'CF-Connecting-IP': '198.51.100.4', 'X-Paillette-Visitor-Ip': '203.0.113.9' })
      )
    ).toBe('198.51.100.4');
    expect(
      callerAddress(
        request({
          'CF-Connecting-IP': '198.51.100.4',
          'X-API-Key': 'guessed',
          'X-Paillette-Visitor-Ip': '203.0.113.9',
        })
      )
    ).toBe('198.51.100.4');
  });

  it('ignores a relayed value that is not an address', () => {
    expect(
      callerAddress(
        request({
          'CF-Connecting-IP': '198.51.100.4',
          'X-API-Key': 'server-key',
          'X-Paillette-Visitor-Ip': 'everyone',
        })
      )
    ).toBe('198.51.100.4');
  });

  it('never trusts the header on a deployment with no key configured', () => {
    expect(
      callerAddress(
        request(
          { 'CF-Connecting-IP': '198.51.100.4', 'X-API-Key': '', 'X-Paillette-Visitor-Ip': '203.0.113.9' },
          ''
        )
      )
    ).toBe('198.51.100.4');
  });
});
