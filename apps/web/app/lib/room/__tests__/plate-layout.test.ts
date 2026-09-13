import { describe, expect, it } from 'vitest';
import { layoutPlate } from '~/lib/room/plate-layout';

const measure = (text: string) => text.length * 10;

describe('layoutPlate', () => {
  it('keeps a long title intact by wrapping it in a distinct serif face', () => {
    const layout = layoutPlate(
      {
        title: 'A long title that belongs on more than one line',
        artist: 'Carmen Herrera, whose name is longer than the old forty-character catalogue cut',
        date: '1959',
        label: null,
      },
      measure
    );

    const title = layout.lines.filter((line) => line.colorRole === 'title');
    expect(title.map((line) => line.text).join(' ')).toBe(
      'A long title that belongs on more than one line'
    );
    expect(title).toHaveLength(2);
    expect(title[0]?.font).toContain('serif');
    expect(
      layout.lines
        .filter((line) => line.colorRole === 'metadata')
        .map((line) => line.text)
        .join(' ')
    ).toBe('Carmen Herrera, whose name is longer than the old forty-character catalogue cut · 1959');
  });

  it('breaks an unbroken title without discarding any characters', () => {
    const title = 'Supercalifragilisticexpialidocious'.repeat(5);
    const layout = layoutPlate({ title, artist: null, date: null, label: null }, measure);

    expect(
      layout.lines
        .filter((line) => line.colorRole === 'title')
        .map((line) => line.text)
        .join('')
    ).toBe(title);
    expect(layout.lines.length).toBeGreaterThan(1);
    expect(layout.lines.every(line => measure(line.text) <= 464)).toBe(true);
  });

  it('uses no reserved description space when a work has no label', () => {
    const withoutDescription = layoutPlate(
      { title: 'Nocturne', artist: 'James McNeill Whistler', date: '1875', label: null },
      measure
    );
    const withDescription = layoutPlate(
      {
        title: 'Nocturne',
        artist: 'James McNeill Whistler',
        date: '1875',
        label: 'A painted description that needs a second line to demonstrate its space.',
      },
      measure
    );

    expect(withoutDescription.lines.some((line) => line.colorRole === 'description')).toBe(false);
    expect(withoutDescription.heightPx).toBeLessThan(withDescription.heightPx);
  });

  it('wraps every character of a 320-character description', () => {
    const label = `${'a'.repeat(160)} ${'b'.repeat(159)}`;
    const layout = layoutPlate(
      { title: 'Study', artist: null, date: null, label },
      measure
    );

    expect(
      layout.lines
        .filter((line) => line.colorRole === 'description')
        .map((line) => line.text)
        .join('')
    ).toBe(label.replace(/\s+/g, ''));
    expect(layout.heightPx).toBeGreaterThan(100);
    expect(layout.lines.every(line => measure(line.text) <= 464)).toBe(true);
  });
});
