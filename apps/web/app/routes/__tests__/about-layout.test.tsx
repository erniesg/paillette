import { describe, expect, it } from 'vitest';
import {
  ABOUT_BODY_GROUP_CLASS_NAME,
  ABOUT_MAIN_CLASS_NAME,
  TECHNICAL_DETAILS_CTA,
  TECHNICAL_DETAILS_HREF,
} from '../about';

describe('about page layout', () => {
  it('matches the centered production editorial frame', () => {
    expect(ABOUT_MAIN_CLASS_NAME).toBe(
      'mx-auto max-w-7xl px-5 py-14 lg:px-8 lg:py-20'
    );
    expect(ABOUT_BODY_GROUP_CLASS_NAME).toBe('mt-5 max-w-4xl space-y-5');
    expect(TECHNICAL_DETAILS_HREF).toBe('/technical');
    expect(TECHNICAL_DETAILS_CTA).toBe(
      'See architecture, retrieval flow, and performance evidence'
    );
  });
});
