import { describe, expect, it } from 'vitest';
import {
  ABOUT_BODY_GROUP_CLASS_NAME,
  ABOUT_MAIN_CLASS_NAME,
  TECHNICAL_DETAILS_CTA,
  TECHNICAL_DETAILS_HREF,
} from '../about';

describe('about page layout', () => {
  it('uses the viewport and links technical details', () => {
    expect(ABOUT_MAIN_CLASS_NAME).toContain('w-full');
    expect(ABOUT_MAIN_CLASS_NAME).not.toContain('max-w-7xl');
    expect(ABOUT_BODY_GROUP_CLASS_NAME).not.toContain('max-w-');
    expect(TECHNICAL_DETAILS_HREF).toBe('/technical');
    expect(TECHNICAL_DETAILS_CTA).toBe(
      'See architecture, retrieval flow, and performance evidence'
    );
  });
});
