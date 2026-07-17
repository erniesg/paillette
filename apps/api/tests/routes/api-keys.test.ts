import { describe, expect, it } from 'vitest';
import {
  MAX_ACTIVE_API_KEYS,
  hasReachedApiKeyLimit,
} from '../../src/routes/api-keys';

describe('API key limits', () => {
  it('allows a separate docs key alongside an existing integration key', () => {
    expect(MAX_ACTIVE_API_KEYS).toBeGreaterThan(1);
    expect(hasReachedApiKeyLimit(1)).toBe(false);
    expect(hasReachedApiKeyLimit(MAX_ACTIVE_API_KEYS)).toBe(true);
  });
});
