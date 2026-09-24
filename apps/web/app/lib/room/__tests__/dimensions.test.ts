import { describe, expect, it } from 'vitest';
import { dimensionColumns } from '@paillette/types/dimensions';
import {
  MAX_BELIEVABLE_CM,
  measureDimensionText,
  parseDimensions,
} from '~/lib/room/dimensions';

/**
 * The point of these is the refusals.
 *
 * A parser that reads the easy strings is not the risk; a parser that reads
 * `24 5/8 x 38 1/8 in.` as `8 × 38` is, because the result is a plausible
 * number that hangs a drawing at three metres and nothing downstream can tell
 * it apart from a measurement. The fraction is now read — whole, as 24.625 —
 * and the tests below pin that it is never read in part. Every `toBeNull` is a
 * case that must stay unreadable.
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

  it('reads inches-only text with its fractions whole, never a numerator', () => {
    // 24.625 in and 38.125 in, not 8 × 38.
    expect(parseDimensions('24 5/8 x 38 1/8 in.')).toEqual({
      heightCm: 62.55,
      widthCm: 96.84,
    });
    expect(parseDimensions('5/8 x 1 1/2 in.')).toEqual({
      heightCm: 1.59,
      widthCm: 3.81,
    });
  });

  it('refuses a fraction it cannot read whole', () => {
    expect(parseDimensions('24 5/0 x 38 in.')).toBeNull();
    expect(parseDimensions('24 5/8/3 x 38 in.')).toBeNull();
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

  it('refuses a structured record with only one of height and width', () => {
    expect(parseDimensions({ height: 62.5, width: null, unit: 'cm' })).toBeNull();
    expect(parseDimensions({ height: null, width: 96.8, unit: 'cm' })).toBeNull();
  });
});

/**
 * The shapes the NGA catalogue actually writes, from `objects.csv` at the
 * commit the ingest pinned. These are what the ingest stores in the columns.
 */
describe('measureDimensionText on NGA catalogue text', () => {
  it('reads the overall form, depth absent', () => {
    expect(
      measureDimensionText('overall: 62.5 x 96.8 cm (24 5/8 x 38 1/8 in.)')
    ).toEqual({
      heightCm: 62.5,
      widthCm: 96.8,
      depthCm: null,
      qualifier: 'overall',
    });
  });

  it('takes the sheet over the image on a print, whichever comes first', () => {
    const text =
      'image: 20.3 × 13.3 cm (8 × 5 1/4 in.)\nsheet: 32.1 × 24.6 cm (12 5/8 × 9 11/16 in.)';
    expect(measureDimensionText(text)).toMatchObject({
      heightCm: 32.1,
      widthCm: 24.6,
      qualifier: 'sheet',
    });
    const reversed = text.split('\n').reverse().join('\n');
    expect(measureDimensionText(reversed)).toMatchObject({ qualifier: 'sheet' });
  });

  it('reads millimetres, including with no space before the unit', () => {
    expect(measureDimensionText('Image: 305 x 457 mm')).toMatchObject({
      heightCm: 30.5,
      widthCm: 45.7,
    });
    expect(measureDimensionText('Image:305 x 457mm')).toMatchObject({
      heightCm: 30.5,
      widthCm: 45.7,
    });
  });

  it('keeps a depth when the catalogue gives one', () => {
    expect(
      measureDimensionText('overall: 50.8 x 40.6 x 2.5 cm (20 x 16 x 1 in.)')
    ).toMatchObject({ heightCm: 50.8, widthCm: 40.6, depthCm: 2.5 });
  });

  it('never hangs a watercolour at the size of the chair it depicts', () => {
    expect(
      measureDimensionText('original IAD object: 90 x 45 cm (35 7/16 x 17 11/16 in.)')
    ).toBeNull();
    expect(
      measureDimensionText(
        'overall: 35.5 x 27.9 cm (14 x 11 in.)\noriginal IAD object: 90 x 45 cm'
      )
    ).toMatchObject({ heightCm: 35.5, qualifier: 'overall' });
  });

  it('reads a work measured without its base, but never the base alone', () => {
    expect(measureDimensionText('overall without base: 40 x 20 x 10 cm')).toMatchObject({
      heightCm: 40,
    });
    expect(measureDimensionText('base: 10 x 30 x 30 cm')).toBeNull();
  });

  it('refuses a diameter and a lone height rather than inventing the other side', () => {
    expect(measureDimensionText('overall (diameter): 30.5 cm (12 in.)')).toBeNull();
    expect(measureDimensionText('height: 30.5 cm (12 in.)')).toBeNull();
  });

  it('returns null, never a guess, on text it cannot read', () => {
    expect(measureDimensionText('dimensions unknown')).toBeNull();
    expect(measureDimensionText('overall: 62.5 x 96.8')).toBeNull();
    expect(measureDimensionText('gross weight: 12 x 3 kg')).toBeNull();
    expect(measureDimensionText(null)).toBeNull();
  });
});

describe('dimensionColumns', () => {
  it('writes all four columns in centimetres when the text parses', () => {
    expect(dimensionColumns('overall: 62.5 x 96.8 cm (24 5/8 x 38 1/8 in.)')).toEqual({
      dimensions_height: 62.5,
      dimensions_width: 96.8,
      dimensions_depth: null,
      dimensions_unit: 'cm',
    });
  });

  it('writes none of them when it does not', () => {
    expect(dimensionColumns('overall (diameter): 30.5 cm (12 in.)')).toEqual({
      dimensions_height: null,
      dimensions_width: null,
      dimensions_depth: null,
      dimensions_unit: null,
    });
  });
});
