/**
 * Working out what the columns of a stranger's CSV sidecar actually mean.
 *
 * WHY IT LOOKS LIKE THIS
 *
 * `data/samples/sample-art-100.zip` carries a CSV whose columns we chose, so
 * matching them is trivial. A judge's own export does not: the Met writes
 * `Artist Display Name` and `Object Date`, Cleveland writes `creation_date`,
 * a French museum writes `Titre`, and a spreadsheet somebody typed by hand
 * writes whatever they felt like. Dropping those columns silently and falling
 * back to a filename-derived title is the worst outcome, because the archive
 * still indexes and nobody notices the catalogue is gone.
 *
 * So the mapping is decided in three passes, cheapest first:
 *
 *   1. HEADER  — score every (column, field) pair against a wide alias list
 *                and assign greedily. Handles exact names, synonyms, museum
 *                phrasings, camelCase and a handful of non-English headers.
 *   2. CONTENT — for roles still empty, infer from what is *in* the column
 *                (a sample of its rows, not the whole file): values that name
 *                images this archive actually holds are the filename column;
 *                values that are nothing but a date are the year; and so on.
 *   3. SUPPLIED — an explicit `column -> field` map from the caller overrides
 *                both. This is the path an agent uses after it has looked at
 *                the unmapped headers and the sample rows this module hands
 *                back, and had the human confirm the result.
 *
 * Every pass records how it decided, and columns nobody claimed are reported
 * rather than dropped. A mapping the human can see and correct is worth more
 * than one that happens to guess right.
 */

// ---------------------------------------------------------------------------
// Contract
// ---------------------------------------------------------------------------

/** The catalogue roles a sidecar column can fill. */
export type MetadataField =
  | 'title'
  | 'artist'
  | 'year'
  | 'medium'
  | 'classification'
  | 'description'
  | 'credit_line'
  | 'accession_number';

/** A role, plus the column that says which image a row is about. */
export type MappedRole = MetadataField | 'filename';

export type MappingVia = 'exact' | 'synonym' | 'content' | 'supplied';

export type ColumnDecision = {
  /** The header exactly as it appears in the file. */
  column: string;
  /** The role it fills, or null when nothing claimed it. */
  field: MappedRole | null;
  /** How the decision was reached. Null for an ignored column. */
  via: MappingVia | null;
};

export type MetadataMappingReport = {
  columns: ColumnDecision[];
  /** Role -> the header that fills it. Only the roles that were resolved. */
  mapped: Partial<Record<MappedRole, string>>;
  /** Headers no role claimed. Named, never dropped in silence. */
  ignored: string[];
  /**
   * Whether the mapping came from this module's rules or from a caller —
   * which, on the WebMCP path, means an agent proposed it and the human
   * approved it. This is the "was a model consulted" answer.
   */
  source: 'rules' | 'supplied';
  /** Data rows in the sidecar. */
  rowCount: number;
  /**
   * True when columns are still unclaimed *and* a role that matters is empty,
   * so it is worth asking rather than proceeding. False for the common case of
   * a couple of extra id/url columns nobody needs.
   */
  needsReview: boolean;
  /**
   * The header row plus up to three sample values, restricted to the columns
   * that went unmapped. This is the whole payload a model needs to propose a
   * mapping — the rest of the file never has to leave the page.
   */
  samples: Array<Record<string, string>>;
  /** One sentence a human or an agent can read without decoding the rest. */
  summary: string;
};

/** A caller-supplied override: header -> role, or `'ignore'` to force-drop it. */
export type SuppliedColumnMapping = Record<string, MappedRole | 'ignore'>;

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

/** Tie-break order: the roles a wrong guess hurts most come first. */
const FIELD_ORDER: MappedRole[] = [
  'filename',
  'title',
  'artist',
  'year',
  'medium',
  'classification',
  'description',
  'credit_line',
  'accession_number',
];

export const ALL_ROLES: readonly MappedRole[] = FIELD_ORDER;

/**
 * Aliases are matched against the normalised header, as whole tokens, and as
 * substrings. Non-English entries are deliberately few and common: enough that
 * a European or CJK export is not dead on arrival, not a translation project.
 */
const ALIASES: Record<MappedRole, string[]> = {
  filename: [
    'filename',
    'file',
    'filepath',
    'path',
    'image',
    'imagefile',
    'imagename',
    'imgfile',
    'img',
    'photo',
    'picture',
    'asset',
    'assetname',
    'primaryimage',
    'localfile',
    'fichier',
    'archivo',
    'imagen',
    'datei',
    'bild',
    'immagine',
    'afbeelding',
    'imagem',
    'ficheiro',
    '文件名',
    '图片',
    '影像',
    'ファイル名',
    '画像',
  ],
  title: [
    'title',
    'worktitle',
    'arttitle',
    'artworktitle',
    'objecttitle',
    'itemtitle',
    'displaytitle',
    'preferredtitle',
    'caption',
    'label',
    'objectname',
    'artworkname',
    'workname',
    'titre',
    'titulo',
    'titel',
    'titolo',
    'tajuk',
    'judul',
    '标题',
    '题名',
    '作品名',
    '名称',
    'タイトル',
    '作品名称',
  ],
  artist: [
    'artist',
    'creator',
    'author',
    'maker',
    'artistname',
    'artistdisplayname',
    'creatorname',
    'photographer',
    'painter',
    'sculptor',
    'attributedto',
    'byline',
    'artiste',
    'auteur',
    'kunstler',
    'kuenstler',
    'autor',
    'artista',
    'pelukis',
    'seniman',
    '艺术家',
    '作者',
    '画家',
    '作家',
  ],
  year: [
    'year',
    'date',
    'dated',
    'datecreated',
    'creationdate',
    'objectdate',
    'objectbegindate',
    'yearcreated',
    'created',
    'dateofwork',
    'displaydate',
    'periode',
    'annee',
    'ano',
    'anno',
    'jahr',
    'datum',
    'fecha',
    'tahun',
    '年份',
    '年代',
    '制作年代',
    '創作年',
    '年',
  ],
  medium: [
    'medium',
    'materials',
    'material',
    'technique',
    'support',
    'mediumdescription',
    'materialsandtechniques',
    'materiaux',
    'materiale',
    'tecnica',
    'tecnicas',
    'werkstoff',
    'bahan',
    '材质',
    '媒材',
    '材料',
    '技法',
  ],
  classification: [
    'classification',
    'objecttype',
    'objectclass',
    'type',
    'category',
    'genre',
    'class',
    'department',
    'form',
    'kategorie',
    'categorie',
    'categoria',
    'tipo',
    'jenis',
    'kategori',
    '类别',
    '分类',
    '種類',
  ],
  description: [
    'description',
    'desc',
    'notes',
    'note',
    'summary',
    'abstract',
    'comment',
    'commentary',
    'remarks',
    'inscription',
    'beschreibung',
    'descripcion',
    'descrizione',
    'descricao',
    'keterangan',
    '描述',
    '说明',
    '簡介',
    '説明',
  ],
  credit_line: [
    'creditline',
    'credit',
    'creditlines',
    'acquisition',
    'acquisitioncredit',
    'provenance',
    'donor',
    'bequest',
    'rightsandreproduction',
  ],
  accession_number: [
    'accessionnumber',
    'accession',
    'accessionno',
    'objectnumber',
    'objectid',
    'inventorynumber',
    'inventoryno',
    'invno',
    'inv',
    'refno',
    'reference',
    'catalognumber',
    'catalogueno',
    'numeroinventaire',
    'inventarnummer',
    '藏品编号',
    '登录号',
  ],
};

/**
 * Tried only when nothing stronger claimed the role, and capped well below a
 * real match, so a file with both `name` and `title` never confuses them.
 */
const WEAK_ALIASES: Partial<Record<MappedRole, string[]>> = {
  filename: ['name', 'id', 'key', 'src', 'url'],
  title: ['name', 'subject', 'work', 'object', 'item'],
  description: ['text', 'body', 'about'],
};

/**
 * Museum exports carry whole families of columns around one word — the Met
 * alone ships `Artist Nationality`, `Artist Begin Date`, `Artist ULAN URL`.
 * A token here disqualifies the column for that role outright, so `artist`
 * lands on `Artist Display Name` rather than on whichever family member came
 * first in the file.
 */
const DISQUALIFYING_TOKENS: Partial<Record<MappedRole, string[]>> = {
  artist: [
    'nationality',
    'gender',
    'role',
    'prefix',
    'suffix',
    'bio',
    'begin',
    'end',
    'ulan',
    'wikidata',
    'url',
    'uri',
    'id',
    'count',
    'active',
    'birth',
    'death',
    'nation',
  ],
  title: ['url', 'uri', 'sort', 'id', 'count', 'alternate', 'former', 'series'],
  year: ['id', 'url', 'uri', 'modified', 'updated', 'accessioned', 'entered'],
  filename: ['count', 'size', 'width', 'height', 'bytes', 'format'],
  description: ['url', 'uri', 'id'],
  classification: ['url', 'uri', 'id', 'count'],
  medium: ['url', 'uri', 'id', 'count'],
};

// ---------------------------------------------------------------------------
// Normalisation
// ---------------------------------------------------------------------------

/**
 * Drop diacritics but keep the letter. `Künstler` and `Année` are the same
 * words as `Kunstler` and `Annee`, and requiring the alias list to carry both
 * spellings of every accented term would guarantee it carries neither. Han,
 * Kana and Hangul do not decompose, so CJK headings pass through untouched.
 */
const foldDiacritics = (value: string) =>
  value.normalize('NFD').replace(/\p{M}+/gu, '');

/**
 * Fold a header to its comparable form. Unicode letters and digits survive, so
 * a CJK header is still something rather than the empty string it became when
 * this stripped everything outside `[a-z0-9]`.
 */
export const normalizeColumnName = (value: string) =>
  foldDiacritics(value.toLowerCase()).replace(/[^\p{L}\p{N}]+/gu, '');

/** `Artist Display Name` and `artistDisplayName` are the same three words. */
export const tokenizeColumnName = (value: string) =>
  foldDiacritics(
    value.replace(/([\p{Ll}\p{N}])(\p{Lu})/gu, '$1 $2').toLowerCase()
  )
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);

const isAscii = (value: string) => !/[^\x20-\x7e]/.test(value);

/**
 * How well one alias fits one header. 0 means no fit at all — never a weak
 * "well, maybe", because a wrong confident mapping is worse than an unmapped
 * column the human gets asked about.
 */
const scoreAlias = (
  normalized: string,
  tokens: string[],
  alias: string,
  rank: number,
  weak: boolean
) => {
  // Aliases are listed canonical-first, and the gap between them is small but
  // decisive: a Met export has both `Classification` and `Department`, and
  // only one of them is what we mean by classification.
  const specificity = Math.min(9, rank) * 0.5;

  // An exact match is exact however many words it took: `credit_line` is not a
  // vaguer answer than `medium` just because it has two.
  if (normalized === alias) {
    const exact = 100 - specificity;
    return weak ? Math.min(exact, 25) : exact;
  }

  let base: number;
  if (tokens.includes(alias)) base = tokens[0] === alias ? 70 : 55;
  // Short ASCII aliases ("id", "type") are substrings of far too much
  // ("identifier", "prototype") to be trusted outside a token match. CJK has
  // no token boundaries at all, so substring is the only thing it has.
  else if ((alias.length >= 4 || !isAscii(alias)) && normalized.includes(alias))
    base = 35;
  else return 0;

  // A longer header is less likely to be the plain field: `Title` beats
  // `Title Of The Series It Belongs To`.
  const score =
    base - specificity - Math.min(18, Math.max(0, tokens.length - 1) * 3);
  return weak ? Math.min(score, 25) : score;
};

// ---------------------------------------------------------------------------
// Pass 1 — headers
// ---------------------------------------------------------------------------

type Candidate = { field: MappedRole; column: number; score: number };

const headerCandidates = (headers: string[]): Candidate[] => {
  const candidates: Candidate[] = [];

  headers.forEach((header, column) => {
    const normalized = normalizeColumnName(header);
    if (!normalized) return;
    const tokens = tokenizeColumnName(header);

    for (const field of FIELD_ORDER) {
      const banned = DISQUALIFYING_TOKENS[field];
      if (banned && tokens.some((token) => banned.includes(token))) continue;

      let best = 0;
      ALIASES[field].forEach((alias, rank) => {
        best = Math.max(best, scoreAlias(normalized, tokens, alias, rank, false));
      });
      (WEAK_ALIASES[field] ?? []).forEach((alias, rank) => {
        best = Math.max(best, scoreAlias(normalized, tokens, alias, rank, true));
      });
      if (best > 0) candidates.push({ field, column, score: best });
    }
  });

  return candidates;
};

/**
 * Assign best-scoring pairs first, so the order columns happen to appear in
 * cannot change the outcome. One column fills at most one role and one role
 * takes at most one column.
 */
const assignByScore = (
  candidates: Candidate[],
  taken: Map<MappedRole, number>,
  usedColumns: Set<number>
) => {
  const sorted = [...candidates].sort(
    (a, b) =>
      b.score - a.score ||
      FIELD_ORDER.indexOf(a.field) - FIELD_ORDER.indexOf(b.field) ||
      a.column - b.column
  );

  const via = new Map<MappedRole, MappingVia>();
  for (const candidate of sorted) {
    if (taken.has(candidate.field) || usedColumns.has(candidate.column)) continue;
    taken.set(candidate.field, candidate.column);
    usedColumns.add(candidate.column);
    via.set(candidate.field, candidate.score >= 100 ? 'exact' : 'synonym');
  }
  return via;
};

// ---------------------------------------------------------------------------
// Pass 2 — content
// ---------------------------------------------------------------------------

const IMAGE_NAME = /\.(jpe?g|png|webp|gif|avif|tiff?|bmp)$/i;

/**
 * Whole-value date shapes only: "1860", "1890s", "c. 1700", "1860/1865",
 * "1912-14". An accession number like `1943.15.1` contains a year but is not
 * one, and mapping it to `year` would put a wrong date on every record.
 */
const DATE_VALUE =
  /^(c|ca|circa|about|abt|approx)?\.?\s*\d{3,4}\s*(s|bc|ad|ce|bce)?\s*([-–—/]\s*(c|ca)?\.?\s*\d{2,4}\s*(s|bc|ad|ce|bce)?)?$/i;

/** `R-1`, `INV 22`, `2019.4` — a catalogue key, not a name for anything. */
const REFERENCE_CODE = /^[\p{Lu}]{0,4}[-_. ]?\d+([-_./]\d+)*$/u;

const basename = (value: string) => value.split(/[\\/]/).pop() || value;

const stripExtension = (value: string) => value.replace(/\.[^.]+$/, '');

/**
 * Recognise the values that name images this archive actually holds.
 *
 * Two forms count. `plate-01.jpg` is the obvious one. `436535`, matching
 * `436535.jpg`, is the one that matters: museum exports key on an object id
 * and whoever assembled the zip named the files after it, so the join is real
 * even though nothing in the column looks like a filename.
 */
export const buildEntryMatcher = (entryNames: string[]) => {
  const full = new Set<string>();
  const byStem = new Map<string, string>();

  for (const name of entryNames) {
    // Trimmed on both sides of the comparison, and in the same order as
    // `normalizeFilenameKey`, because these keys have to match the ones the
    // batch pump looks records up by.
    const base = basename(name.trim()).toLowerCase();
    if (!base) continue;
    full.add(base);
    const stem = stripExtension(base);
    if (stem && !byStem.has(stem)) byStem.set(stem, base);
  }

  /** The archive entry a sidecar value refers to, or null when none does. */
  const resolve = (value: string) => {
    const base = basename(value.trim()).toLowerCase();
    if (!base) return null;
    if (full.has(base)) return base;
    return byStem.get(stripExtension(base)) ?? byStem.get(base) ?? null;
  };

  return { size: full.size, resolve };
};

export type EntryMatcher = ReturnType<typeof buildEntryMatcher>;

/**
 * Inference reads a sample, not the file. A few hundred rows settle what a
 * column is, and a 20,000-row export should not cost a scan per column per
 * candidate role to reach the same answer.
 */
const INFERENCE_ROWS = 200;

const columnValues = (rows: string[][], column: number) =>
  rows
    .slice(0, INFERENCE_ROWS)
    .map((row) => (row[column] || '').trim())
    .filter((value) => value !== '');

const ratio = (values: string[], test: (value: string) => boolean) =>
  values.length === 0
    ? 0
    : values.filter(test).length / values.length;

const meanLength = (values: string[]) =>
  values.length === 0
    ? 0
    : values.reduce((total, value) => total + value.length, 0) / values.length;

/**
 * Infer roles the headers left empty by reading the column's own values.
 * Deliberately conservative: each rule wants a clear majority, and `artist` has
 * no rule at all because nothing in a name distinguishes it from a donor or a
 * place. An unmapped `artist` is reported and asked about instead.
 */
const inferFromContent = (
  rows: string[][],
  headers: string[],
  taken: Map<MappedRole, number>,
  usedColumns: Set<number>,
  entries: EntryMatcher,
  forcedIgnore: Set<number>
) => {
  const via = new Map<MappedRole, MappingVia>();
  const free = () =>
    headers.map((_, index) => index).filter((index) => !usedColumns.has(index));

  const claim = (field: MappedRole, column: number) => {
    taken.set(field, column);
    usedColumns.add(column);
    via.set(field, 'content');
  };

  // filename first: without it no row can be attached to an image at all, so
  // every other inference is moot.
  //
  // When the archive's entry names are known, this looks at *every* column,
  // not just the unclaimed ones. A column whose values resolve to real files
  // is proof; whichever role the header rules gave it was a guess, and proof
  // wins. That is how a museum export whose only join is `Object ID` (against
  // `436535.jpg`) gets read at all — `objectid` reads as an accession number
  // right up until you notice it names every image in the zip.
  const currentFilename = taken.get('filename');
  const provable = (column: number) => {
    const values = columnValues(rows, column);
    return values.length ? ratio(values, (value) => entries.resolve(value) !== null) : 0;
  };

  if (entries.size > 0 && (currentFilename === undefined || provable(currentFilename) < 0.6)) {
    let best: { column: number; score: number } | null = null;
    for (let column = 0; column < headers.length; column += 1) {
      if (forcedIgnore.has(column)) continue;
      const score = provable(column);
      if (score >= 0.6 && (!best || score > best.score)) best = { column, score };
    }
    if (best) {
      // Free whatever role had claimed it, so nothing holds two jobs.
      for (const [role, index] of [...taken]) {
        if (index === best.column) taken.delete(role);
      }
      usedColumns.delete(best.column);
      if (currentFilename !== undefined && currentFilename !== best.column) {
        taken.delete('filename');
        usedColumns.delete(currentFilename);
      }
      claim('filename', best.column);
    }
  }

  if (!taken.has('filename')) {
    let best: { column: number; score: number } | null = null;
    for (const column of free()) {
      const values = columnValues(rows, column);
      if (!values.length) continue;
      const score = ratio(values, (value) => IMAGE_NAME.test(basename(value)));
      if (score >= 0.6 && (!best || score > best.score)) best = { column, score };
    }
    if (best) claim('filename', best.column);
  }

  if (!taken.has('year')) {
    for (const column of free()) {
      const values = columnValues(rows, column);
      if (values.length && ratio(values, (value) => DATE_VALUE.test(value)) >= 0.6) {
        claim('year', column);
        break;
      }
    }
  }

  if (!taken.has('description')) {
    for (const column of free()) {
      const values = columnValues(rows, column);
      if (values.length && meanLength(values) >= 80) {
        claim('description', column);
        break;
      }
    }
  }

  // Title last: by now the columns that are obviously something else are
  // spoken for. Among what remains, take the wordiest — a title reads like
  // language, a leftover reference column reads like `R-1`, and picking the
  // leftmost would take the reference every time.
  if (!taken.has('title')) {
    let best: { column: number; length: number } | null = null;
    for (const column of free()) {
      const values = columnValues(rows, column);
      if (values.length < 1) continue;
      const length = meanLength(values);
      const distinct = new Set(values.map((value) => value.toLowerCase())).size;
      if (
        length >= 3 &&
        length <= 120 &&
        distinct / values.length >= 0.7 &&
        ratio(values, (value) => /\p{L}/u.test(value)) >= 0.6 &&
        ratio(values, (value) => IMAGE_NAME.test(basename(value))) < 0.5 &&
        ratio(values, (value) => REFERENCE_CODE.test(value)) < 0.6 &&
        (!best || length > best.length)
      ) {
        best = { column, length };
      }
    }
    if (best) claim('title', best.column);
  }

  return via;
};

// ---------------------------------------------------------------------------
// The mapping
// ---------------------------------------------------------------------------

const ROLE_SET = new Set<string>(FIELD_ORDER);

/** Roles whose absence is worth interrupting a human over. */
const CORE_ROLES: MappedRole[] = ['filename', 'title', 'artist'];

const SAMPLE_ROWS = 3;
const SAMPLE_VALUE_CHARS = 120;

export type ColumnMappingResult = {
  /** Role -> column index, for the reader that turns rows into records. */
  columns: Map<MappedRole, number>;
  report: MetadataMappingReport;
};

const describe = (
  mapped: Partial<Record<MappedRole, string>>,
  ignored: string[],
  source: 'rules' | 'supplied',
  needsReview: boolean
) => {
  const names = Object.keys(mapped);
  const how =
    source === 'supplied'
      ? 'Applied the column mapping supplied with this request'
      : 'Matched columns automatically';
  const head = names.length
    ? `${how}: ${names.join(', ')}.`
    : `${how}, but nothing matched a catalogue field.`;
  const tail = ignored.length
    ? ` Ignored ${ignored.length} column${ignored.length === 1 ? '' : 's'}: ${ignored.join(', ')}.`
    : ' Every column was used.';
  const ask = needsReview
    ? ' Some columns went unrecognised while a field that matters is still empty — check the mapping before trusting these records.'
    : '';
  return `${head}${tail}${ask}`;
};

/**
 * Decide what each column of a sidecar means.
 *
 * `knownFilenames` are the image entries the archive actually contains; when
 * given, a column whose values name those files is identified with certainty
 * rather than by its header.
 */
export const mapMetadataColumns = (
  headers: string[],
  rows: string[][],
  options: {
    knownFilenames?: string[];
    supplied?: SuppliedColumnMapping;
  } = {}
): ColumnMappingResult => {
  const taken = new Map<MappedRole, number>();
  const usedColumns = new Set<number>();
  const via = new Map<MappedRole, MappingVia>();
  const forcedIgnore = new Set<number>();

  // Pass 3 runs first: an explicit instruction is not a hypothesis to be
  // outvoted by the rules below it.
  const supplied = options.supplied ?? {};
  const suppliedKeys = Object.keys(supplied);
  if (suppliedKeys.length) {
    const byNormalized = new Map<string, number>();
    headers.forEach((header, index) => {
      const key = normalizeColumnName(header);
      if (key && !byNormalized.has(key)) byNormalized.set(key, index);
    });

    for (const [column, role] of Object.entries(supplied)) {
      const index = byNormalized.get(normalizeColumnName(column));
      if (index === undefined || usedColumns.has(index)) continue;
      if (role === 'ignore') {
        forcedIgnore.add(index);
        usedColumns.add(index);
        continue;
      }
      if (!ROLE_SET.has(role) || taken.has(role)) continue;
      taken.set(role, index);
      usedColumns.add(index);
      via.set(role, 'supplied');
    }
  }

  for (const [field, how] of assignByScore(
    headerCandidates(headers),
    taken,
    usedColumns
  )) {
    via.set(field, how);
  }

  // A caller who named the filename column explicitly meant it — do not let
  // content inference overrule an instruction.
  const suppliedFilename = via.get('filename') === 'supplied';
  const entries = buildEntryMatcher(
    suppliedFilename ? [] : (options.knownFilenames ?? [])
  );
  for (const [field, how] of inferFromContent(
    rows,
    headers,
    taken,
    usedColumns,
    entries,
    forcedIgnore
  )) {
    via.set(field, how);
  }

  const roleByColumn = new Map<number, MappedRole>();
  for (const [field, index] of taken) roleByColumn.set(index, field);

  const columns: ColumnDecision[] = headers.map((header, index) => {
    const field = roleByColumn.get(index) ?? null;
    return { column: header, field, via: field ? (via.get(field) ?? null) : null };
  });

  const mapped: Partial<Record<MappedRole, string>> = {};
  for (const field of FIELD_ORDER) {
    const index = taken.get(field);
    if (index !== undefined) mapped[field] = headers[index] ?? '';
  }

  const ignoredIndexes = headers
    .map((_, index) => index)
    .filter((index) => !roleByColumn.has(index));
  const ignored = ignoredIndexes.map((index) => headers[index] ?? '');

  // Columns the caller explicitly dropped are not evidence that anything is
  // unresolved — they were resolved, to nothing.
  const unresolved = ignoredIndexes.filter((index) => !forcedIgnore.has(index));
  const needsReview =
    unresolved.length > 0 && CORE_ROLES.some((role) => !taken.has(role));

  const samples = rows.slice(0, SAMPLE_ROWS).map((row) => {
    const sample: Record<string, string> = {};
    for (const index of unresolved) {
      sample[headers[index] ?? `column ${index + 1}`] = (row[index] || '')
        .trim()
        .slice(0, SAMPLE_VALUE_CHARS);
    }
    return sample;
  });

  const source = suppliedKeys.length ? 'supplied' : 'rules';

  return {
    columns: taken,
    report: {
      columns,
      mapped,
      ignored,
      source,
      rowCount: rows.length,
      needsReview,
      samples: unresolved.length ? samples : [],
      summary: describe(mapped, ignored, source, needsReview),
    },
  };
};

/** The report for an archive that carried no sidecar at all. Not an error. */
export const noSidecarReport = (): MetadataMappingReport => ({
  columns: [],
  mapped: {},
  ignored: [],
  source: 'rules',
  rowCount: 0,
  needsReview: false,
  samples: [],
  summary:
    'No CSV sidecar was found, so each image is titled from its filename. Supply a CSV beside the images to give them real catalogue records.',
});
