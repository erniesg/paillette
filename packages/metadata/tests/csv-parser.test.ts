import { describe, it, expect } from 'vitest';
import { CSVParser } from '../src/csv-parser';

describe('CSVParser', () => {
  it('should parse valid CSV with all columns', async () => {
    const csv = `artwork_id,title,artist,year,medium,description
art-001,Starry Night,Vincent van Gogh,1889,Oil on canvas,Famous painting of night sky
art-002,Mona Lisa,Leonardo da Vinci,1503,Oil on poplar,Iconic portrait`;

    const result = await CSVParser.parse(csv);

    expect(result.success).toBe(true);
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0].artwork_id).toBe('art-001');
    expect(result.rows[0].title).toBe('Starry Night');
    expect(result.rows[0].artist).toBe('Vincent van Gogh');
    expect(result.rows[0].year).toBe(1889);
    expect(result.errors).toHaveLength(0);
    expect(result.stats.totalRows).toBe(2);
    expect(result.stats.validRows).toBe(2);
    expect(result.stats.invalidRows).toBe(0);
  });

  it('should parse CSV with optional columns missing', async () => {
    const csv = `title,artist
Artwork Without Year,Unknown Artist
Simple Title,`;

    const result = await CSVParser.parse(csv);

    expect(result.success).toBe(true);
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0].title).toBe('Artwork Without Year');
    expect(result.rows[0].year).toBeUndefined();
    expect(result.rows[1].artist).toBe('');
  });

  it('should validate column types and reject invalid year', async () => {
    const csv = `artwork_id,title,year
art-001,Test Artwork,not-a-number`;

    const result = await CSVParser.parse(csv);

    expect(result.success).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].row).toBe(2);
    expect(result.errors[0].column).toBe('year');
    expect(result.errors[0].message).toContain('Expected number');
    expect(result.errors[0].value).toBe('not-a-number');
  });

  it('should handle UTF-8 special characters (Chinese, Tamil)', async () => {
    const csv = `title,artist,description
《星夜》,文森特·梵高,著名的夜空画
விண்மீன் இரவு,வின்சென்ட் வான் கோ,இரவு வானத்தின் புகழ்பெற்ற ஓவியம்`;

    const result = await CSVParser.parse(csv);

    expect(result.success).toBe(true);
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0].title).toBe('《星夜》');
    expect(result.rows[0].artist).toBe('文森特·梵高');
    expect(result.rows[1].title).toBe('விண்மீன் இரவு');
  });

  it('should reject missing required title column', async () => {
    const csv = `artwork_id,artist
art-001,Test Artist`;

    const result = await CSVParser.parse(csv);

    expect(result.success).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].column).toBe('title');
    expect(result.errors[0].message).toContain('Required');
  });

  it('should reject title exceeding 500 characters', async () => {
    const longTitle = 'A'.repeat(501);
    const csv = `title,artist
${longTitle},Test Artist`;

    const result = await CSVParser.parse(csv);

    expect(result.success).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].column).toBe('title');
    expect(result.errors[0].message).toMatch(/at most 500 character/i);
  });

  it('should reject invalid dimensions_unit', async () => {
    const csv = `title,dimensions_height,dimensions_width,dimensions_unit
Test Artwork,100,80,invalid_unit`;

    const result = await CSVParser.parse(csv);

    expect(result.success).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].column).toBe('dimensions_unit');
  });

  it('should handle empty CSV', async () => {
    const csv = `title,artist`;

    const result = await CSVParser.parse(csv);

    expect(result.success).toBe(true);
    expect(result.rows).toHaveLength(0);
    expect(result.stats.totalRows).toBe(0);
  });

  it('should skip empty lines', async () => {
    const csv = `title,artist
Test Artwork 1,Artist 1

Test Artwork 2,Artist 2

`;

    const result = await CSVParser.parse(csv);

    expect(result.success).toBe(true);
    expect(result.rows).toHaveLength(2);
  });

  it('should handle quoted fields with commas', async () => {
    const csv = `title,artist,description
"Artwork, The First","Artist, John","Description with, commas, everywhere"`;

    const result = await CSVParser.parse(csv);

    expect(result.success).toBe(true);
    expect(result.rows[0].title).toBe('Artwork, The First');
    expect(result.rows[0].artist).toBe('Artist, John');
    expect(result.rows[0].description).toBe('Description with, commas, everywhere');
  });

  it('should coerce string numbers to integers', async () => {
    const csv = `title,year,dimensions_height
Test Artwork,"2024","150.5"`;

    const result = await CSVParser.parse(csv);

    expect(result.success).toBe(true);
    expect(result.rows[0].year).toBe(2024);
    expect(typeof result.rows[0].year).toBe('number');
    expect(result.rows[0].dimensions_height).toBe(150.5);
  });

  it('should collect multiple validation errors per row', async () => {
    const csv = `title,year,dimensions_height
Too long ${'X'.repeat(501)},invalid_year,-100`;

    const result = await CSVParser.parse(csv);

    expect(result.success).toBe(false);
    expect(result.errors.length).toBeGreaterThan(1);
    // Should have errors for title (too long), year (invalid), dimensions_height (negative)
  });
});
