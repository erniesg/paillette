import { expect, it } from 'vitest';
import { loader } from '../technical';

it('redirects the retired technical page to the architecture on About', () => {
  const response = loader();

  expect(response.status).toBe(301);
  expect(response.headers.get('Location')).toBe('/about#technical-details');
});
