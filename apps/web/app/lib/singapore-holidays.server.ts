export type HolidaySearchSuggestion = {
  type: 'occasion';
  label: string;
  query: string;
  dot: string;
  date: string;
  detail: string;
  isToday: boolean;
  source: HolidaySuggestionSource;
};

type HolidaySuggestionSource = 'mom' | 'fallback' | 'chinese-festival';

type SingaporeHoliday = {
  date: string;
  name: string;
  source: HolidaySuggestionSource;
};

const MOM_PUBLIC_HOLIDAYS_URL =
  'https://www.mom.gov.sg/employment-practices/public-holidays';

const CACHE_TTL_MS = 12 * 60 * 60 * 1000;
const MAX_OCCASION_SUGGESTIONS = 10;

const HOLIDAY_DOTS: Record<string, string> = {
  "New Year's Day": '#cda636',
  'Chinese New Year': '#bf5631',
  'Lantern Festival': '#d04c3f',
  'Qing Ming Festival': '#8a9a7a',
  'Dragon Boat Festival': '#365f9c',
  'Qixi Festival': '#c477a4',
  'Mid-Autumn Festival': '#cda636',
  'Hari Raya Puasa': '#8a9a7a',
  'Good Friday': '#cdbfa2',
  'Labour Day': '#6e8ea8',
  'Hari Raya Haji': '#8a9a7a',
  'Vesak Day': '#cda636',
  'National Day': '#bf5631',
  Deepavali: '#d2853a',
  'Christmas Day': '#cdbfa2',
};

const HOLIDAY_NAMES = Object.keys(HOLIDAY_DOTS);

const FALLBACK_HOLIDAYS: SingaporeHoliday[] = [
  { date: '2026-01-01', name: "New Year's Day", source: 'fallback' },
  { date: '2026-02-17', name: 'Chinese New Year', source: 'fallback' },
  { date: '2026-02-18', name: 'Chinese New Year', source: 'fallback' },
  { date: '2026-03-21', name: 'Hari Raya Puasa', source: 'fallback' },
  { date: '2026-04-03', name: 'Good Friday', source: 'fallback' },
  { date: '2026-05-01', name: 'Labour Day', source: 'fallback' },
  { date: '2026-05-27', name: 'Hari Raya Haji', source: 'fallback' },
  { date: '2026-05-31', name: 'Vesak Day', source: 'fallback' },
  { date: '2026-08-09', name: 'National Day', source: 'fallback' },
  { date: '2026-11-08', name: 'Deepavali', source: 'fallback' },
  { date: '2026-12-25', name: 'Christmas Day', source: 'fallback' },
];

const CHINESE_FESTIVALS: SingaporeHoliday[] = [
  { date: '2026-02-17', name: 'Chinese New Year', source: 'chinese-festival' },
  { date: '2026-03-03', name: 'Lantern Festival', source: 'chinese-festival' },
  {
    date: '2026-04-05',
    name: 'Qing Ming Festival',
    source: 'chinese-festival',
  },
  {
    date: '2026-06-19',
    name: 'Dragon Boat Festival',
    source: 'chinese-festival',
  },
  { date: '2026-08-19', name: 'Qixi Festival', source: 'chinese-festival' },
  {
    date: '2026-09-25',
    name: 'Mid-Autumn Festival',
    source: 'chinese-festival',
  },
  { date: '2027-02-06', name: 'Chinese New Year', source: 'chinese-festival' },
  { date: '2027-02-20', name: 'Lantern Festival', source: 'chinese-festival' },
  {
    date: '2027-04-05',
    name: 'Qing Ming Festival',
    source: 'chinese-festival',
  },
  {
    date: '2027-06-09',
    name: 'Dragon Boat Festival',
    source: 'chinese-festival',
  },
  { date: '2027-08-08', name: 'Qixi Festival', source: 'chinese-festival' },
  {
    date: '2027-09-15',
    name: 'Mid-Autumn Festival',
    source: 'chinese-festival',
  },
  { date: '2028-01-26', name: 'Chinese New Year', source: 'chinese-festival' },
  { date: '2028-02-09', name: 'Lantern Festival', source: 'chinese-festival' },
  {
    date: '2028-04-04',
    name: 'Qing Ming Festival',
    source: 'chinese-festival',
  },
  {
    date: '2028-05-28',
    name: 'Dragon Boat Festival',
    source: 'chinese-festival',
  },
  { date: '2028-08-26', name: 'Qixi Festival', source: 'chinese-festival' },
  {
    date: '2028-10-03',
    name: 'Mid-Autumn Festival',
    source: 'chinese-festival',
  },
];

const HOLIDAY_QUERY_OVERRIDES: Record<string, string> = {
  "New Year's Day": 'new year',
  'Chinese New Year': 'lantern',
  'Lantern Festival': 'lantern',
  'Qing Ming Festival': 'spring landscape',
  'Dragon Boat Festival': 'boat',
  'Qixi Festival': 'weaving',
  'Mid-Autumn Festival': 'moon',
  'Hari Raya Puasa': 'mosque',
  'Good Friday': 'crucifixion',
  'Labour Day': 'workers',
  'Hari Raya Haji': 'mosque',
  'Vesak Day': 'Buddha',
  'National Day': 'National Day',
  Deepavali: 'lamp',
  'Christmas Day': 'nativity',
};

const SOURCE_PRIORITY: Record<HolidaySuggestionSource, number> = {
  mom: 0,
  fallback: 1,
  'chinese-festival': 2,
};

const MONTHS: Record<string, number> = {
  january: 0,
  february: 1,
  march: 2,
  april: 3,
  may: 4,
  june: 5,
  july: 6,
  august: 7,
  september: 8,
  october: 9,
  november: 10,
  december: 11,
};

const SINGAPORE_DATE_FORMAT = new Intl.DateTimeFormat('en-SG', {
  timeZone: 'Asia/Singapore',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

let holidayCache:
  | {
      expiresAt: number;
      holidays: SingaporeHoliday[];
    }
  | undefined;

const decodeHtml = (value: string) =>
  value
    .replace(/&amp;/g, '&')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, ' ');

const toIsoDate = (day: string, month: string, year: string) => {
  const monthIndex = MONTHS[month.toLowerCase()];
  if (monthIndex === undefined) return null;
  const date = new Date(Date.UTC(Number(year), monthIndex, Number(day)));
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
};

const stripHtml = (html: string) =>
  decodeHtml(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
  );

const parseHolidayName = (rowHtml: string) => {
  const cell = rowHtml.match(
    /<td[^>]*class=["'][^"']*cell-holiday-name[^"']*["'][^>]*>([\s\S]*?)<\/td>/i
  )?.[1];
  if (!cell) return null;

  const text = stripHtml(
    cell
      .replace(
        /<span[^>]*class=["']text-date-mobile["'][^>]*>[\s\S]*?<\/span>/gi,
        ' '
      )
      .replace(
        /<em[^>]*class=["']cell-holiday-alert["'][^>]*>[\s\S]*?<\/em>/gi,
        ' '
      )
  ).trim();
  return HOLIDAY_NAMES.find(
    (holidayName) => holidayName.toLowerCase() === text.toLowerCase()
  );
};

const parseMomHolidays = (html: string): SingaporeHoliday[] => {
  const datePattern =
    /\b(\d{1,2})\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+(20\d{2})\b/gi;
  const holidays = new Map<string, SingaporeHoliday>();
  const rows = html.match(/<tr\b[\s\S]*?<\/tr>/gi) ?? [];

  for (const row of rows) {
    const match = datePattern.exec(row);
    datePattern.lastIndex = 0;
    if (!match) continue;

    const [day, month, year] = match.slice(1, 4);
    if (!day || !month || !year) continue;

    const isoDate = toIsoDate(day, month, year);
    if (!isoDate) continue;

    const name = parseHolidayName(row);
    if (!name) continue;

    holidays.set(`${isoDate}-${name}`, {
      date: isoDate,
      name,
      source: 'mom',
    });
  }

  return [...holidays.values()];
};

const dateToTime = (date: string) =>
  new Date(`${date}T00:00:00.000Z`).getTime();

const toSingaporeIsoDate = (date: Date) => {
  const parts = SINGAPORE_DATE_FORMAT.formatToParts(date).reduce<
    Record<string, string>
  >((result, part) => {
    if (part.type !== 'literal') {
      result[part.type] = part.value;
    }
    return result;
  }, {});

  return `${parts.year}-${parts.month}-${parts.day}`;
};

const formatHolidayDate = (date: string) =>
  new Intl.DateTimeFormat('en-SG', {
    day: 'numeric',
    month: 'short',
  }).format(new Date(`${date}T00:00:00.000Z`));

const uniqueByName = (holidays: SingaporeHoliday[]) => {
  const seen = new Set<string>();
  return holidays.filter((holiday) => {
    if (seen.has(holiday.name)) return false;
    seen.add(holiday.name);
    return true;
  });
};

export const getUpcomingSingaporeHolidaySuggestions = async (
  now = new Date()
): Promise<HolidaySearchSuggestion[]> => {
  const nowTime = Date.now();
  if (holidayCache && holidayCache.expiresAt > nowTime) {
    return buildSuggestions(holidayCache.holidays, now);
  }

  let holidays: SingaporeHoliday[] = [];
  try {
    const response = await fetch(MOM_PUBLIC_HOLIDAYS_URL, {
      headers: {
        Accept: 'text/html',
      },
    });
    if (response.ok) {
      holidays = parseMomHolidays(await response.text());
    }
  } catch {
    holidays = [];
  }

  if (!holidays.length) {
    holidays = FALLBACK_HOLIDAYS;
  }

  holidayCache = {
    expiresAt: nowTime + CACHE_TTL_MS,
    holidays,
  };

  return buildSuggestions(holidays, now);
};

const buildSuggestions = (holidays: SingaporeHoliday[], now: Date) => {
  const today = toSingaporeIsoDate(now);

  return uniqueByName(
    [...holidays, ...CHINESE_FESTIVALS]
      .filter((holiday) => holiday.date >= today)
      .sort(
        (a, b) =>
          dateToTime(a.date) - dateToTime(b.date) ||
          SOURCE_PRIORITY[a.source] - SOURCE_PRIORITY[b.source]
      )
  )
    .slice(0, MAX_OCCASION_SUGGESTIONS)
    .map((holiday) => {
      const isToday = holiday.date === today;

      return {
        type: 'occasion' as const,
        label: holiday.name,
        query: HOLIDAY_QUERY_OVERRIDES[holiday.name] || holiday.name,
        dot: HOLIDAY_DOTS[holiday.name] || '#cdbfa2',
        date: holiday.date,
        detail: isToday ? 'Today' : formatHolidayDate(holiday.date),
        isToday,
        source: holiday.source,
      };
    });
};

export const __resetSingaporeHolidayCacheForTests = () => {
  holidayCache = undefined;
};
