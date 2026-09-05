import { describe, expect, it } from 'vitest';
import {
  MAX_BELIEVABLE_CM,
  parseDimensions,
} from '~/lib/room/dimensions';

/**
 * The point of these is the refusals.
 *
 * A parser that reads the easy strings is not the risk; a parser that reads
 * `24 5/8 x 38 1/8 in.` as `8 × 38` is, because the result is a plausible
 * number that hangs a drawing at three metres and nothing downstream can tell
 * it apart from a measurement. Every `toBeNull` below is a case that must stay
 * unreadable.
 */
describe('parseDimensions', () => {
  it('reads the NGA catalogue form, metric half first', () => {
    expect(
      parseDimensions('overall: 62.5 x 96.8 cm (24 5/8 x 38 1/8 in.)')
    ).toEqual({ heightCm: 62.5, widthCm: 96.8 });
  });

  it('reads height before width, the way a museum writes it', () => {
    // Not symmetric, so a transposition would show. 30 tall, 20 wide.
    expect(parseDimensions('30 × 20 cm')).toEqual({ heightCm: 30, widthCm: 20 });
  });

  it('refuses fractions rather than reading a numerator as a dimension', () => {
    expect(parseDimensions('24 5/8 x 38 1/8 in.')).toBeNull();
  });

  it('refuses a pair with no unit', () => {
    expect(parseDimensions('62.5 x 96.8')).toBeNull();
  });

  it('converts the units it does recognise', () => {
    expect(parseDimensions('305 x 457 mm')).toEqual({
      heightCm: 30.5,
      widthCm: 45.7,
    });
    expect(parseDimensions('10 x 8 in.')).toEqual({ heightCm: 25.4, widthCm: 20.32 });
    expect(parseDimensions('1.2 x 0.9 m')).toEqual({ heightCm: 120, widthCm: 90 });
  });

  it('consumes a depth without letting it become a dimension', () => {
    expect(parseDimensions('overall: 50 x 40 x 3 cm')).toEqual({
      heightCm: 50,
      widthCm: 40,
    });
  });

  it('prefers the overall measurement over the framed one', () => {
    const size = parseDimensions(
      'framed: 80 x 60 cm; overall: 62.5 x 42 cm'
    );
    expect(size).toEqual({ heightCm: 62.5, widthCm: 42 });
  });

  it('prefers the support over the image when both are given', () => {
    expect(parseDimensions('image: 20 x 15 cm; support: 30 x 24 cm')).toEqual({
      heightCm: 30,
      widthCm: 24,
    });
  });

  it('falls back to a framed measurement rather than nothing', () => {
    expect(parseDimensions('framed: 80 x 60 cm')).toEqual({
      heightCm: 80,
      widthCm: 60,
    });
  });

  it('refuses measurements outside what hangs on a wall', () => {
    expect(parseDimensions('0.4 x 0.3 cm')).toBeNull();
    expect(parseDimensions(`${MAX_BELIEVABLE_CM + 1} x 100 cm`)).toBeNull();
  });

  it('reads the structured record the API actually returns', () => {
    expect(
      parseDimensions({ height: 62.5, width: 96.8, depth: null, unit: 'cm' })
    ).toEqual({ heightCm: 62.5, widthCm: 96.8 });
  });

  /**
   * This is the shape every ingested NGA record has in this deployment, and it
   * is why the report's parsed count is zero rather than something flattering.
   */
  it('refuses the empty structured record the NGA ingest leaves behind', () => {
    expect(
      parseDimensions({ height: null, width: null, depth: null, unit: null })
    ).toBeNull();
  });

  it('refuses a structured record whose unit nobody wrote down', () => {
    expect(parseDimensions({ height: 62.5, width: 96.8, unit: null })).toBeNull();
    expect(
      parseDimensions({ height: 62.5, width: 96.8, unit: 'furlongs' })
    ).toBeNull();
  });

  it('refuses the things that are not a measurement at all', () => {
    expect(parseDimensions(null)).toBeNull();
    expect(parseDimensions(undefined)).toBeNull();
    expect(parseDimensions('')).toBeNull();
    expect(parseDimensions('unknown')).toBeNull();
    expect(parseDimensions(42)).toBeNull();
    expect(parseDimensions(['30 x 20 cm'])).toBeNull();
  });
});
