const clean = (value) =>
  String(value ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\u2010-\u2015]/g, '-')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

const SEARCH_MIN_YEAR = 1000;
const SEARCH_MAX_YEAR = 2100;
const QUALIFIER_PATTERN =
  '(?:first quarter|second quarter|third quarter|fourth quarter|first half|second half|1st half|2nd half|early|mid|late)';

const boundedRange = (startYear, endYear) => {
  const start = Math.max(SEARCH_MIN_YEAR, startYear);
  const end = Math.min(SEARCH_MAX_YEAR, endYear);
  return start <= end ? { startYear: start, endYear: end } : null;
};

const intersectRanges = (ranges) =>
  boundedRange(
    Math.max(...ranges.map((range) => range.startYear)),
    Math.min(...ranges.map((range) => range.endYear))
  );

const boundaryRange = (text) => {
  const matches = [
    ...text.matchAll(/\b(before|after)\s+(1[0-9]{3}|20[0-9]{2})\b/g),
  ];
  if (!matches.length) return undefined;
  let startYear = SEARCH_MIN_YEAR;
  let endYear = SEARCH_MAX_YEAR;
  for (const match of matches) {
    const year = Number(match[2]);
    if (match[1] === 'after') startYear = Math.max(startYear, year + 1);
    if (match[1] === 'before') endYear = Math.min(endYear, year - 1);
  }
  return boundedRange(startYear, endYear);
};

const centuryRange = (century, qualifier) => {
  const start = (century - 1) * 100;
  if (qualifier === 'early') return { startYear: start, endYear: start + 33 };
  if (qualifier === 'mid')
    return { startYear: start + 34, endYear: start + 66 };
  if (qualifier === 'late')
    return { startYear: start + 67, endYear: start + 99 };
  if (qualifier === 'first quarter')
    return { startYear: start, endYear: start + 24 };
  if (qualifier === 'second quarter')
    return { startYear: start + 25, endYear: start + 49 };
  if (qualifier === 'third quarter')
    return { startYear: start + 50, endYear: start + 74 };
  if (qualifier === 'fourth quarter')
    return { startYear: start + 75, endYear: start + 99 };
  if (qualifier === 'first half' || qualifier === '1st half')
    return { startYear: start, endYear: start + 49 };
  if (qualifier === 'second half' || qualifier === '2nd half')
    return { startYear: start + 50, endYear: start + 99 };
  return { startYear: start, endYear: start + 99 };
};

const centuryComponentPattern = new RegExp(
  `\\b(?:(${QUALIFIER_PATTERN})(?:\\s+of(?:\\s+the)?)?\\s+)?` +
    '(\\d{1,2})(?:st|nd|rd|th)' +
    '(?=\\s*(?:century\\b|[/\\-]|\\bor\\b|\\band\\b))',
  'g'
);

export function deriveNgaDisplayDateRange(value) {
  const text = clean(value);
  if (!text || /\b(?:undated|date unknown|unknown date)\b/.test(text))
    return null;

  const ranges = [];
  if (/\bcentury\b/.test(text)) {
    const centuryRanges = [...text.matchAll(centuryComponentPattern)]
      .map((match) => ({
        century: Number(match[2]),
        qualifier: match[1],
      }))
      .filter(({ century }) => century >= 1 && century <= 21)
      .map(({ century, qualifier }) => centuryRange(century, qualifier));
    if (centuryRanges.length) {
      const range = boundedRange(
        Math.min(...centuryRanges.map((range) => range.startYear)),
        Math.max(...centuryRanges.map((range) => range.endYear))
      );
      if (range === null) return null;
      ranges.push(range);
    }
  }

  const bounded = boundaryRange(text);
  if (bounded !== undefined) {
    if (bounded === null) return null;
    ranges.push(bounded);
  }
  if (ranges.length) return intersectRanges(ranges);

  const decade = text.match(/\b((?:1[0-9]|20)[0-9])0s\b/);
  if (decade) {
    const startYear = Number(`${decade[1]}0`);
    return boundedRange(startYear, startYear + 9);
  }

  const years = [...text.matchAll(/\b(1[0-9]{3}|20[0-9]{2})\b/g)].map(
    (match) => Number(match[1])
  );
  if (!years.length) return null;
  return boundedRange(Math.min(...years), Math.max(...years));
}
