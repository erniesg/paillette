export type HolidaySearchSuggestion = {
  type: 'occasion';
  label: string;
  query: string;
  dot: string;
  date: string;
  detail: string;
  source: 'mom' | 'fallback';
};

type SingaporeHoliday = {
  date: string;
  name: string;
  source: 'mom' | 'fallback';
};

const MOM_PUBLIC_HOLIDAYS_URL =
  'https://www.mom.gov.sg/employment-practices/public-holidays';

const CACHE_TTL_MS = 12 * 60 * 60 * 1000;

const HOLIDAY_DOTS: Record<string, string> = {
  "New Year's Day": '#cda636',
  'Chinese New Year': '#bf5631',
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

const formatHolidayDate = (date: string) =>
  new Intl.DateTimeFormat('en-SG', {
    day: 'numeric',
    month: 'short',
  }).format(new Date(`${date}T00:00:00.000Z`));

const getHolidayQuery = (name: string) => {
  if (name === 'National Day') return 'Singapore National Day celebration';
  if (name === 'Chinese New Year')
    return 'Chinese New Year reunion and festivity';
  if (name === 'Hari Raya Haji') return 'Hari Raya Haji gathering and devotion';
  if (name === 'Hari Raya Puasa') return 'Hari Raya Puasa celebration';
  if (name === 'Vesak Day') return 'Vesak Day serenity and light';
  if (name === 'Deepavali') return 'Deepavali light and celebration';
  if (name === 'Christmas Day') return 'Christmas gathering and festivity';
  if (name === 'Good Friday') return 'Good Friday reflection';
  if (name === 'Labour Day') return 'workers and everyday labour';
  return name;
};

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
  const today = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate()
  );

  return uniqueByName(
    holidays
      .filter((holiday) => dateToTime(holiday.date) >= today)
      .sort((a, b) => dateToTime(a.date) - dateToTime(b.date))
  )
    .slice(0, 4)
    .map((holiday) => ({
      type: 'occasion' as const,
      label: holiday.name,
      query: getHolidayQuery(holiday.name),
      dot: HOLIDAY_DOTS[holiday.name] || '#cdbfa2',
      date: holiday.date,
      detail: formatHolidayDate(holiday.date),
      source: holiday.source,
    }));
};
