import { afterEach, describe, expect, it, vi } from 'vitest';

import { getUpcomingSingaporeHolidaySuggestions } from '../singapore-holidays.server';

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

    expect(
      suggestions.map((suggestion) => [
        suggestion.label,
        suggestion.detail,
        suggestion.source,
      ])
    ).toEqual([
      ['Hari Raya Haji', '27 May', 'mom'],
      ['Vesak Day', '31 May', 'mom'],
      ['National Day', '9 Aug', 'mom'],
      ['Deepavali', '8 Nov', 'mom'],
    ]);
  });
});
