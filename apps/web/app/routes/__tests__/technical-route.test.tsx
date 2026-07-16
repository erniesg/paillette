import { expect, it } from 'vitest';
import { RETRIEVAL_CHANNELS, TECHNICAL_EVIDENCE } from '../technical';

it('separates retrieval channels and evidence levels', () => {
  expect(RETRIEVAL_CHANNELS.map((item) => item.name)).toEqual([
    'Keyword',
    'Metadata',
    'Captions',
    'Image embeddings',
    'Colour',
  ]);
  expect(TECHNICAL_EVIDENCE.map((item) => item.level)).toEqual([
    'Measured',
    'Test-backed',
    'Structural',
    'Pending',
  ]);
  expect(TECHNICAL_EVIDENCE[1].value).toBe('100 + 10');
  expect(TECHNICAL_EVIDENCE[2].value).toBe('2 × 1,024D');
  expect(TECHNICAL_EVIDENCE[3].value).toBe('p50 / p95 / p99');
  expect(TECHNICAL_EVIDENCE[3].description).toMatch(/not yet measured/i);
});
