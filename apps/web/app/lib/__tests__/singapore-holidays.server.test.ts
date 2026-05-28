import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  __resetSingaporeHolidayCacheForTests,
  getUpcomingSingaporeHolidaySuggestions,
} from '../singapore-holidays.server';

const holidayRow = (
  date: string,
  weekday: string,
  name: string,
  alert = ''
) => `
  <tr>
    <td>${date}</td>
    <td>${weekday}</td>
    <td><img alt="${name}" /></td>
    <td class="cell-holiday-name">
      ${name}
      <span class="text-date-mobile">${date}, ${weekday}</span>
      ${alert ? `<em class="cell-holiday-alert">${alert}</em>` : ''}
    </td>
  </tr>
`;

describe('getUpcomingSingaporeHolidaySuggestions', () => {
  afterEach(() => {
    __resetSingaporeHolidayCacheForTests();
    vi.unstubAllGlobals();
  });

  it('pairs MOM holiday names with the date from the same table row', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        text: async () => `
          <table>
            ${holidayRow('27 May 2026', 'Wednesday', 'Hari Raya Haji')}
            ${holidayRow(
              '31 May 2026',
              'Sunday',
              'Vesak Day',
              'Monday, 1 June 2026, will be a public holiday if your rest day falls on 31 May 2026.'
            )}
            ${holidayRow(
              '9 August 2026',
              'Sunday',
              'National Day',
              'Monday, 10 August 2026, will be a public holiday if your rest day falls on 9 August 2026.'
            )}
            ${holidayRow(
              '8 November 2026',
              'Sunday',
              'Deepavali',
              'Monday, 9 November 2026, will be a public holiday if your rest day falls on 8 November 2026.'
            )}
            ${holidayRow('25 December 2026', 'Friday', 'Christmas Day')}
          </table>
        `,
      }))
    );

    const suggestions = await getUpcomingSingaporeHolidaySuggestions(
      new Date('2026-05-24T00:00:00.000Z')
    );

    expect(suggestions.slice(0, 2)).toEqual([
      expect.objectContaining({
        label: 'Hari Raya Haji',
        query: 'Hari Raya Haji',
        detail: '27 May',
        isToday: false,
        source: 'mom',
      }),
      expect.objectContaining({
        label: 'Vesak Day',
        query: 'Vesak Day',
        detail: '31 May',
        isToday: false,
        source: 'mom',
      }),
    ]);
    expect(suggestions.map((suggestion) => suggestion.label)).toEqual([
      'Hari Raya Haji',
      'Vesak Day',
      'Dragon Boat Festival',
    ]);
  });

  it('uses the Singapore calendar day for today and removes past holidays', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        text: async () => `
          <table>
            ${holidayRow('26 May 2026', 'Tuesday', 'Labour Day')}
            ${holidayRow('27 May 2026', 'Wednesday', 'Hari Raya Haji')}
            ${holidayRow('31 May 2026', 'Sunday', 'Vesak Day')}
          </table>
        `,
      }))
    );

    const suggestions = await getUpcomingSingaporeHolidaySuggestions(
      new Date('2026-05-26T16:30:00.000Z')
    );

    expect(suggestions.map((suggestion) => suggestion.label)).not.toContain(
      'Labour Day'
    );
    expect(
      suggestions.slice(0, 2).map((suggestion) => suggestion.label)
    ).toEqual(['Hari Raya Haji', 'Vesak Day']);
    expect(suggestions[0]).toMatchObject({
      label: 'Hari Raya Haji',
      detail: 'Today',
      isToday: true,
    });
  });

  it('adds upcoming Chinese festivals for the cycling showcase', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        text: async () => `
          <table>
            ${holidayRow('31 May 2026', 'Sunday', 'Vesak Day')}
            ${holidayRow('9 August 2026', 'Sunday', 'National Day')}
          </table>
        `,
      }))
    );

    const suggestions = await getUpcomingSingaporeHolidaySuggestions(
      new Date('2026-05-28T00:00:00.000Z')
    );

    expect(suggestions.map((suggestion) => suggestion.label)).toEqual([
      'Vesak Day',
      'Dragon Boat Festival',
      'National Day',
    ]);
    expect(suggestions).toContainEqual(
      expect.objectContaining({
        label: 'Dragon Boat Festival',
        query: 'Dragon Boat Festival',
        detail: '19 Jun',
        source: 'chinese-festival',
      })
    );
    expect(suggestions.map((suggestion) => suggestion.label)).not.toContain(
      'Mid-Autumn Festival'
    );
  });
});
