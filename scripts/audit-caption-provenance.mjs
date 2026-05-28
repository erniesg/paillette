#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import Papa from 'papaparse';

const args = new Map();
for (let index = 2; index < process.argv.length; index += 1) {
  const arg = process.argv[index];
  if (!arg.startsWith('--')) continue;
  const key = arg.slice(2);
  const next = process.argv[index + 1];
  if (!next || next.startsWith('--')) {
    args.set(key, 'true');
  } else {
    args.set(key, next);
    index += 1;
  }
}

const root = resolve(new URL('..', import.meta.url).pathname);
const outDir = resolve(args.get('out-dir') || 'tmp/caption-provenance-audit');
const corpusPath = resolve(
  args.get('corpus') || 'eval/corpus_grounding.jsonl'
);
const captionsPath = resolve(args.get('captions') || 'eval/captions.jsonl');
const rootsCaptionOverridesPath = resolve(
  args.get('roots-caption-overrides') ||
    'eval/ngs-roots-caption-overrides.json'
);
const rootsDescriptionOverridesPath = resolve(
  args.get('roots-description-overrides') ||
    'eval/ngs-roots-description-overrides.json'
);
const rootsCsvPath = resolve(
  args.get('roots-csv') || 'data/df_10K_nhb_all.csv'
);
const appDbPath = resolve(
  args.get('app-db') || '/tmp/paillette-v2-bakeoff.sqlite'
);

const cleanText = (value) => {
  if (typeof value !== 'string') return null;
  const text = value.replace(/\s+/g, ' ').trim();
  return text || null;
};

const firstText = (...values) => {
  for (const value of values) {
    const text = cleanText(value);
    if (text) return text;
  }
  return null;
};

const parseJson = (value) => {
  if (!value) return null;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
};

const normalizeText = (value) =>
  String(value || '')
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const textHash = (value) =>
  createHash('sha256').update(normalizeText(value)).digest('hex').slice(0, 16);

const unique = (values) =>
  [...new Set(values.filter((value) => typeof value === 'string' && value))];

const readJsonl = (path) =>
  readFileSync(path, 'utf8')
    .split(/\n+/)
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line));

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));

const sourceUrlHost = (value) => {
  try {
    return new URL(value).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
};

const classifyUrl = (value) => {
  const host = sourceUrlHost(value);
  if (!host) return 'unknown';
  if (host.includes('nationalgallery.sg')) return 'ngs_public_page';
  if (host.includes('roots.gov.sg')) return 'roots_public_page';
  return host;
};

const candidates = [];

const addCandidate = ({
  id,
  sourceKind,
  sourceLabel,
  isGenerated,
  text,
  sourceUrls = [],
  sourceFile,
  evidence = {},
  feedsCaptionEmbedding = false,
  usedForCaptionEmbedding = false,
  usedForDisplayDescription = false,
}) => {
  const cleaned = cleanText(text);
  if (!id || !cleaned) return;

  const urls = unique(sourceUrls.map(cleanText));
  const urlKinds = unique(urls.map(classifyUrl));
  candidates.push({
    id: String(id),
    source_kind: sourceKind,
    source_label: sourceLabel,
    is_generated: Boolean(isGenerated),
    feeds_caption_embedding: Boolean(feedsCaptionEmbedding),
    used_for_caption_embedding: Boolean(usedForCaptionEmbedding),
    used_for_display_description: Boolean(usedForDisplayDescription),
    text: cleaned,
    text_hash: textHash(cleaned),
    text_length: cleaned.length,
    text_preview: cleaned.slice(0, 240),
    source_urls: urls,
    source_url_kinds: urlKinds,
    has_source_url: urls.length > 0,
    has_ngs_source_url: urls.some((url) => /nationalgallery\.sg/i.test(url)),
    has_roots_source_url: urls.some((url) => /roots\.gov\.sg/i.test(url)),
    has_accession: Boolean(evidence.accession),
    has_roots_page_id: Boolean(evidence.rootsPageId),
    source_file: sourceFile,
    evidence,
  });
};

const addGeneratedCaptions = () => {
  for (const row of readJsonl(captionsPath)) {
    addCandidate({
      id: row.id,
      sourceKind: 'generated_caption_jsonl',
      sourceLabel: 'Paillette generated caption',
      isGenerated: true,
      text: row.caption,
      sourceUrls: Array.isArray(row.sources) ? row.sources : [],
      sourceFile: 'eval/captions.jsonl',
      feedsCaptionEmbedding: true,
      evidence: {
        model: row.model || null,
        promptVersion: row.prompt_version || null,
        generatedAt: row.generated_at || null,
      },
    });
  }
};

const addCorpusGroundingCaptions = () => {
  for (const row of readJsonl(corpusPath)) {
    const ngs = parseJson(row.raw_ngs) || {};
    const roots = parseJson(row.raw_roots) || {};
    const accession = firstText(
      ngs.objObjectNumberTxt,
      ngs.accessionNo,
      ngs.accession_number,
      row.id
    );

    addCandidate({
      id: row.id,
      sourceKind: 'ngs_artplus_payload_description',
      sourceLabel: 'NGS Art+ imported payload',
      isGenerated: false,
      text: firstText(ngs.objDescriptionClb, ngs.ocspWebText),
      sourceUrls: [row.ngs_detail_url],
      sourceFile: 'eval/corpus_grounding.jsonl',
      evidence: {
        accession,
        title: firstText(ngs.objObjectTitleTxt),
        artist: firstText(
          ...(Array.isArray(ngs.artistAvailableNames)
            ? ngs.artistAvailableNames
            : [])
        ),
        artPlusId: firstText(ngs.artPlusId),
        note:
          'Imported structured payload text. This audit does not treat it as visible on the public NGS page unless separately verified.',
      },
    });

    addCandidate({
      id: row.id,
      sourceKind: 'roots_grounding_payload_text',
      sourceLabel: 'Roots grounding payload',
      isGenerated: false,
      text: firstText(
        roots.caption,
        roots.description,
        roots.summary,
        roots.synopsis,
        roots.content,
        roots.text
      ),
      sourceUrls: [row.roots_listing_url],
      sourceFile: 'eval/corpus_grounding.jsonl',
      evidence: {
        accession,
        rootsPageId: firstText(roots.pageid, roots.pageId),
        title: firstText(roots.title),
        creator: firstText(roots.creator, roots.artist, roots.maker),
      },
    });
  }
};

const addRootsOverrideCaptions = () => {
  const captionPayload = readJson(rootsCaptionOverridesPath);
  const captionRecords = Array.isArray(
    captionPayload.verified_roots_caption_records
  )
    ? captionPayload.verified_roots_caption_records
    : [];

  for (const row of captionRecords) {
    addCandidate({
      id: row.id,
      sourceKind: 'roots_verified_caption_override',
      sourceLabel: 'Verified Roots catalogue text',
      isGenerated: false,
      text: row.caption,
      sourceUrls: [row.rootsUrl],
      sourceFile: 'eval/ngs-roots-caption-overrides.json',
      evidence: {
        rootsTitle: row.rootsTitle || null,
        auditGeneratedAt: captionPayload.generated_at || null,
        auditBasis: captionPayload.basis || null,
      },
    });
  }

  const descriptionPayload = readJson(rootsDescriptionOverridesPath);
  const descriptionRecords = Array.isArray(
    descriptionPayload.verified_roots_description_records
  )
    ? descriptionPayload.verified_roots_description_records
    : [];

  for (const row of descriptionRecords) {
    addCandidate({
      id: row.id,
      sourceKind: 'roots_verified_description_url_only',
      sourceLabel: 'Verified Roots URL without captured caption text',
      isGenerated: false,
      text: row.caption,
      sourceUrls: [row.rootsUrl],
      sourceFile: 'eval/ngs-roots-description-overrides.json',
      evidence: {
        note:
          'This override file verifies a Roots URL, but most rows do not store caption text here.',
      },
    });
  }
};

const addRootsCsvCaptions = () => {
  const parsed = Papa.parse(readFileSync(rootsCsvPath, 'utf8'), {
    header: true,
    skipEmptyLines: true,
  });

  for (const row of parsed.data) {
    const id = firstText(
      row.documents_0_metadata_accession_no,
      row.documents_0_metadata_accession_no_csv,
      row.documents_0_metadata_accession_no_0
    );
    const sourceUrls = [
      row.documents_0_path,
      row.documents_0_metadata_image_url,
    ];
    const evidence = {
      accession: id,
      rootsPageId: firstText(row.documents_0_metadata_pageId),
      title: firstText(
        row.documents_0_title,
        row.documents_0_metadata_title_text
      ),
      creator: firstText(
        row.documents_0_metadata_creator,
        row.documents_0_metadata_creator_0
      ),
      collectionOf: firstText(
        row.documents_0_metadata_collection_of,
        row.documents_0_metadata_collection_of_0
      ),
    };

    const content = firstText(row.documents_0_content);
    const labelText = firstText(row.documents_0_metadata_sgcool_label_text);
    addCandidate({
      id,
      sourceKind: 'roots_csv_content',
      sourceLabel: 'Roots CSV content',
      isGenerated: false,
      text: content,
      sourceUrls,
      sourceFile: 'data/df_10K_nhb_all.csv',
      evidence,
    });

    if (labelText && normalizeText(labelText) !== normalizeText(content)) {
      addCandidate({
        id,
        sourceKind: 'roots_csv_label_text',
        sourceLabel: 'Roots CSV sgcool label text',
        isGenerated: false,
        text: labelText,
        sourceUrls,
        sourceFile: 'data/df_10K_nhb_all.csv',
        evidence,
      });
    }
  }
};

const sqliteJson = (dbPath, sql) => {
  if (!existsSync(dbPath)) return [];
  const statOutput = execFileSync('stat', ['-f', '%z', dbPath], {
    encoding: 'utf8',
  }).trim();
  if (Number(statOutput) <= 0) return [];

  const output = execFileSync('sqlite3', ['-json', dbPath, sql], {
    encoding: 'utf8',
    maxBuffer: 512 * 1024 * 1024,
  }).trim();
  return output ? JSON.parse(output) : [];
};

const addAppDbCaptions = () => {
  const rows = sqliteJson(
    appDbPath,
    `
    SELECT id, description, field_sources, custom_metadata
    FROM artworks
    WHERE deleted_at IS NULL
    ORDER BY id
    `
  );

  for (const row of rows) {
    const fieldSources = parseJson(row.field_sources) || {};
    const metadata = parseJson(row.custom_metadata) || {};
    const provenance = parseJson(metadata.source_provenance) || {};
    const sourceRecords = parseJson(metadata.source_records) || {};
    const generatedCaption = parseJson(metadata.generated_caption) || {};
    const descriptionProvenance = parseJson(provenance.description) || {};

    addCandidate({
      id: row.id,
      sourceKind: 'app_db_public_description',
      sourceLabel: `App DB display description (${fieldSources.description || 'unlabelled'})`,
      isGenerated: false,
      text: row.description,
      sourceUrls: [
        descriptionProvenance.ref,
        metadata.ngs_detail_url,
        metadata.roots_listing_url,
        sourceRecords.ngs_detail_url,
        sourceRecords.roots_listing_url,
      ],
      sourceFile: appDbPath,
      usedForDisplayDescription: true,
      evidence: {
        fieldSource: fieldSources.description || null,
      },
    });

    addCandidate({
      id: row.id,
      sourceKind: 'app_db_generated_caption',
      sourceLabel: 'App DB generated caption',
      isGenerated: true,
      text: generatedCaption.text,
      sourceUrls: Array.isArray(generatedCaption.sources)
        ? generatedCaption.sources
        : [],
      sourceFile: appDbPath,
      usedForCaptionEmbedding: true,
      evidence: {
        model: generatedCaption.model || null,
        promptVersion: generatedCaption.prompt_version || null,
        generatedAt: generatedCaption.generated_at || null,
      },
    });
  }
};

const candidateSortKey = (candidate) =>
  [
    candidate.id,
    candidate.source_kind,
    candidate.text_hash,
    candidate.text_preview,
  ].join('\t');

const buildRollups = () => {
  const byId = new Map();
  for (const candidate of candidates) {
    if (!byId.has(candidate.id)) {
      byId.set(candidate.id, {
        id: candidate.id,
        candidate_count: 0,
        generated_count: 0,
        source_count: 0,
        display_description_count: 0,
        caption_embedding_count: 0,
        distinct_text_hashes: new Set(),
        source_kinds: new Set(),
        source_urls: new Set(),
        candidates: [],
      });
    }

    const rollup = byId.get(candidate.id);
    rollup.candidate_count += 1;
    if (candidate.is_generated) rollup.generated_count += 1;
    if (!candidate.is_generated) rollup.source_count += 1;
    if (candidate.used_for_display_description) {
      rollup.display_description_count += 1;
    }
    if (candidate.used_for_caption_embedding) {
      rollup.caption_embedding_count += 1;
    }
    rollup.distinct_text_hashes.add(candidate.text_hash);
    rollup.source_kinds.add(candidate.source_kind);
    for (const url of candidate.source_urls) rollup.source_urls.add(url);
    rollup.candidates.push({
      source_kind: candidate.source_kind,
      source_label: candidate.source_label,
      is_generated: candidate.is_generated,
      text_hash: candidate.text_hash,
      text_length: candidate.text_length,
      text_preview: candidate.text_preview,
      source_urls: candidate.source_urls,
      used_for_display_description: candidate.used_for_display_description,
      used_for_caption_embedding: candidate.used_for_caption_embedding,
      feeds_caption_embedding: candidate.feeds_caption_embedding,
      evidence: candidate.evidence,
    });
  }

  return [...byId.values()]
    .map((rollup) => ({
      ...rollup,
      distinct_text_hashes: [...rollup.distinct_text_hashes].sort(),
      distinct_text_count: rollup.distinct_text_hashes.size,
      source_kinds: [...rollup.source_kinds].sort(),
      source_urls: [...rollup.source_urls].sort(),
      candidates: rollup.candidates.sort((left, right) =>
        candidateSortKey({ id: rollup.id, ...left }).localeCompare(
          candidateSortKey({ id: rollup.id, ...right })
        )
      ),
    }))
    .sort((left, right) => left.id.localeCompare(right.id));
};

const buildSummary = (rollups) => {
  const byKind = {};
  const byKindNoSourceUrl = {};
  const byKindGenerated = {};
  const generatedByModel = {};

  for (const candidate of candidates) {
    byKind[candidate.source_kind] = (byKind[candidate.source_kind] || 0) + 1;
    if (!candidate.has_source_url) {
      byKindNoSourceUrl[candidate.source_kind] =
        (byKindNoSourceUrl[candidate.source_kind] || 0) + 1;
    }
    if (candidate.is_generated) {
      byKindGenerated[candidate.source_kind] =
        (byKindGenerated[candidate.source_kind] || 0) + 1;
    }
    const model = candidate.evidence?.model;
    if (model) generatedByModel[model] = (generatedByModel[model] || 0) + 1;
  }

  const generatedJsonl = candidates.filter(
    (candidate) => candidate.source_kind === 'generated_caption_jsonl'
  );
  const appGenerated = candidates.filter(
    (candidate) => candidate.source_kind === 'app_db_generated_caption'
  );
  const appDescriptions = candidates.filter(
    (candidate) => candidate.source_kind === 'app_db_public_description'
  );

  return {
    generated_at: new Date().toISOString(),
    inputs: {
      corpusPath,
      captionsPath,
      rootsCaptionOverridesPath,
      rootsDescriptionOverridesPath,
      rootsCsvPath,
      appDbPath: existsSync(appDbPath) ? appDbPath : null,
    },
    totals: {
      candidates: candidates.length,
      artworks_with_any_caption_candidate: rollups.length,
      distinct_text_hashes: new Set(
        candidates.map((candidate) => candidate.text_hash)
      ).size,
      generated_caption_jsonl: generatedJsonl.length,
      generated_caption_jsonl_without_source_urls: generatedJsonl.filter(
        (candidate) => !candidate.has_source_url
      ).length,
      generated_caption_jsonl_with_ngs_url: generatedJsonl.filter(
        (candidate) => candidate.has_ngs_source_url
      ).length,
      generated_caption_jsonl_with_roots_url: generatedJsonl.filter(
        (candidate) => candidate.has_roots_source_url
      ).length,
      app_db_generated_captions_used_for_caption_embeddings:
        appGenerated.length,
      app_db_public_descriptions_used_for_display: appDescriptions.length,
    },
    by_kind: byKind,
    by_kind_without_source_url: byKindNoSourceUrl,
    generated_by_kind: byKindGenerated,
    generated_by_model: generatedByModel,
    notes: [
      'generated_caption_jsonl rows come from eval/captions.jsonl and feed custom_metadata.generated_caption during ETL.',
      'caption embedding export/build scripts use custom_metadata.generated_caption.text, not artwork.description and not Roots/NGS catalogue text.',
      'ngs_artplus_payload_description rows are imported structured payload descriptions; this audit does not claim they are visible on the current public NGS page.',
      'roots_verified_caption_override rows are source text captured from verified Roots URLs.',
    ],
  };
};

mkdirSync(outDir, { recursive: true });

addGeneratedCaptions();
addCorpusGroundingCaptions();
addRootsOverrideCaptions();
addRootsCsvCaptions();
addAppDbCaptions();

candidates.sort((left, right) =>
  candidateSortKey(left).localeCompare(candidateSortKey(right))
);

const rollups = buildRollups();
const summary = buildSummary(rollups);

const candidatesJsonlPath = resolve(outDir, 'caption-candidates.jsonl');
const rollupsJsonPath = resolve(outDir, 'caption-rollups.json');
const summaryJsonPath = resolve(outDir, 'summary.json');
const candidatesCsvPath = resolve(outDir, 'caption-candidates.csv');

writeFileSync(
  candidatesJsonlPath,
  `${candidates.map((candidate) => JSON.stringify(candidate)).join('\n')}\n`
);
writeFileSync(rollupsJsonPath, `${JSON.stringify(rollups, null, 2)}\n`);
writeFileSync(summaryJsonPath, `${JSON.stringify(summary, null, 2)}\n`);
writeFileSync(
  candidatesCsvPath,
  Papa.unparse(
    candidates.map((candidate) => ({
      id: candidate.id,
      source_kind: candidate.source_kind,
      source_label: candidate.source_label,
      is_generated: candidate.is_generated,
      feeds_caption_embedding: candidate.feeds_caption_embedding,
      used_for_caption_embedding: candidate.used_for_caption_embedding,
      used_for_display_description: candidate.used_for_display_description,
      text_hash: candidate.text_hash,
      text_length: candidate.text_length,
      has_source_url: candidate.has_source_url,
      has_ngs_source_url: candidate.has_ngs_source_url,
      has_roots_source_url: candidate.has_roots_source_url,
      source_urls: candidate.source_urls.join(' | '),
      model: candidate.evidence?.model || '',
      prompt_version: candidate.evidence?.promptVersion || '',
      field_source: candidate.evidence?.fieldSource || '',
      accession: candidate.evidence?.accession || '',
      roots_page_id: candidate.evidence?.rootsPageId || '',
      title: candidate.evidence?.title || candidate.evidence?.rootsTitle || '',
      text_preview: candidate.text_preview,
    }))
  )
);

console.log(
  JSON.stringify(
    {
      outDir,
      candidatesJsonlPath,
      candidatesCsvPath,
      rollupsJsonPath,
      summaryJsonPath,
      summary: summary.totals,
      by_kind: summary.by_kind,
      by_kind_without_source_url: summary.by_kind_without_source_url,
    },
    null,
    2
  )
);
