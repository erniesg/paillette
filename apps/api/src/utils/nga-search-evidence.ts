import type {
  NgaAttributionIntent,
  NgaSearchPlan,
  PublicSearchRelation,
} from '@paillette/types/public-search';
import type { ArtworkRelationEvidence, ArtworkSearchResult } from '../types';

type NgaArtistRelationship = {
  constituentId: string;
  displayOrder: number;
  roleType: 'artist';
  role: string;
  prefix: string | null;
  suffix: string | null;
  preferredDisplayName: string;
  forwardDisplayName: string;
  alternativeNames: string[];
};

export type NgaAttributionEvidenceMetadata = {
  artist?: unknown;
  primaryArtistId?: unknown;
  ngaArtists?: unknown;
};

type ClassifiedRelationEvidence =
  | Extract<ArtworkRelationEvidence, { verified: true }>
  | { verified: false; source: null };

export const NGA_LATIN_FOLD_GROUPS = [
  ['a', 'ÀÁÂÃÄÅĀĂĄǍǞǠǺȀȂȦàáâãäåāăąǎǟǡǻȁȃȧ'],
  ['ae', 'ÆǢǼæǣǽ'],
  ['c', 'ÇĆĈĊČçćĉċč'],
  ['d', 'ÐĎĐðďđ'],
  ['e', 'ÈÉÊËĒĔĖĘĚȄȆèéêëēĕėęěȅȇ'],
  ['g', 'ĜĞĠĢǦĝğġģǧ'],
  ['h', 'ĤĦĥħ'],
  ['i', 'ÌÍÎÏĨĪĬĮİǏȈȊìíîïĩīĭįıǐȉȋ'],
  ['j', 'Ĵĵ'],
  ['k', 'ĶǨķĸǩ'],
  ['l', 'ĹĻĽĿŁĺļľŀł'],
  ['n', 'ÑŃŅŇŊǸñńņňŋǹ'],
  ['o', 'ÒÓÔÕÖØŌŎŐǑǪǬǾȌȎȪȬȮȰòóôõöøōŏőǒǫǭǿȍȏȫȭȯȱ'],
  ['oe', 'Œœ'],
  ['r', 'ŔŖŘȐȒŕŗřȑȓ'],
  ['s', 'ŚŜŞŠȘśŝşšș'],
  ['ss', 'ß'],
  ['t', 'ŢŤŦȚţťŧț'],
  ['th', 'Þþ'],
  ['u', 'ÙÚÛÜŨŪŬŮŰŲǓǕǗǙǛȔȖùúûüũūŭůűųǔǖǘǚǜȕȗ'],
  ['w', 'ŴẀẂẄŵẁẃẅ'],
  ['y', 'ÝŶŸȲýÿŷȳ'],
  ['z', 'ŹŻŽźżž'],
] as const;

const NGA_LATIN_FOLD_BY_CHARACTER = new Map(
  NGA_LATIN_FOLD_GROUPS.flatMap(([replacement, characters]) =>
    [...characters].map((character) => [character, replacement] as const)
  )
);

export const foldNgaEvidenceText = (value: unknown) =>
  [...String(value ?? '').normalize('NFC')]
    .map((character) => NGA_LATIN_FOLD_BY_CHARACTER.get(character) || character)
    .join('')
    .toLocaleLowerCase('en-US')
    .replace(/[^a-z0-9]+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();

const fold = foldNgaEvidenceText;

const tokens = (value: unknown) =>
  foldNgaEvidenceText(value).split(' ').filter(Boolean);

const containsPhrase = (value: unknown, phrase: string) =>
  Boolean(phrase && ` ${fold(value)} `.includes(` ${phrase} `));

const containsAllTargetTokens = (value: unknown, targetText: string) => {
  const requested = [...new Set(tokens(targetText))];
  if (!requested.length) return false;
  const available = new Set(tokens(value));
  return requested.every((token) => available.has(token));
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === 'object' && !Array.isArray(value));

const isNonemptyString = (value: unknown): value is string =>
  typeof value === 'string' && Boolean(value.trim());

const isOptionalText = (value: unknown): value is string | null =>
  value === null || isNonemptyString(value);

const parseArtistRelationship = (
  value: unknown
): NgaArtistRelationship | null => {
  if (!isRecord(value)) return null;
  if (
    typeof value.constituentId !== 'string' ||
    !/^\d+$/u.test(value.constituentId) ||
    typeof value.displayOrder !== 'number' ||
    !Number.isSafeInteger(value.displayOrder) ||
    value.roleType !== 'artist' ||
    !isNonemptyString(value.role) ||
    !isOptionalText(value.prefix) ||
    !isOptionalText(value.suffix) ||
    !isNonemptyString(value.preferredDisplayName) ||
    !isNonemptyString(value.forwardDisplayName) ||
    !Array.isArray(value.alternativeNames) ||
    !value.alternativeNames.every(isNonemptyString)
  ) {
    return null;
  }

  return value as NgaArtistRelationship;
};

const structuredArtistRelationships = (
  metadata: NgaAttributionEvidenceMetadata
): { present: boolean; relationships: NgaArtistRelationship[] } => {
  if (metadata.ngaArtists === undefined) {
    return { present: false, relationships: [] };
  }
  if (!isRecord(metadata.ngaArtists)) {
    return { present: true, relationships: [] };
  }
  const relationships = metadata.ngaArtists.relationships;
  return {
    present: true,
    relationships: Array.isArray(relationships)
      ? relationships.flatMap((relationship) => {
          const parsed = parseArtistRelationship(relationship);
          return parsed ? [parsed] : [];
        })
      : [],
  };
};

const QUALIFIED_ROLE_MARKERS = [
  'after',
  'attributed to',
  'attributed',
  'workshop of',
  'studio of',
  'circle of',
  'school of',
  'follower of',
] as const;

const ROLE_MARKERS: Record<
  Exclude<NgaAttributionIntent['relationship'], 'direct'>,
  readonly string[]
> = {
  after: ['after'],
  attributed_to: ['attributed to', 'attributed'],
  workshop_of: ['workshop of'],
  studio_of: ['studio of'],
  circle_of: ['circle of'],
  school_of: ['school of'],
  follower_of: ['follower of'],
};

const matchesRole = (
  value: unknown,
  relationship: NgaAttributionIntent['relationship'],
  implicitDirect: boolean
) => {
  const normalized = fold(value);
  if (relationship === 'direct') {
    return (
      implicitDirect ||
      (containsPhrase(normalized, 'artist') &&
        !QUALIFIED_ROLE_MARKERS.some((marker) =>
          containsPhrase(normalized, marker)
        ))
    );
  }
  return ROLE_MARKERS[relationship].some((marker) =>
    containsPhrase(normalized, marker)
  );
};

const relationshipNames = (relationship: NgaArtistRelationship) => [
  relationship.preferredDisplayName,
  relationship.forwardDisplayName,
  ...(Array.isArray(relationship.alternativeNames)
    ? relationship.alternativeNames
    : []),
];

const relationshipMatches = (
  relationship: NgaArtistRelationship,
  intent: NgaAttributionIntent
) => {
  if (fold(relationship.roleType) !== 'artist') return false;
  const roleText = [relationship.role, relationship.prefix, relationship.suffix]
    .map(fold)
    .filter(Boolean)
    .join(' ');
  return (
    matchesRole(roleText, intent.relationship, false) &&
    relationshipNames(relationship).some((name) =>
      containsAllTargetTokens(name, intent.targetText)
    )
  );
};

const relationshipNameMatches = (
  relationship: NgaArtistRelationship,
  targetText: string
) =>
  relationshipNames(relationship).some((name) =>
    containsAllTargetTokens(name, targetText)
  );

const flatArtistSegments = (value: string) => {
  const parts = value.normalize('NFC').split(/(\s+(?:and|with)\s+|[,;&|]+)/giu);
  const segments = parts.flatMap((part, index) => {
    if (index % 2 !== 0) return [];
    const text = fold(part);
    if (!text) return [];
    return [
      {
        text,
        precedingDelimiter: index > 0 ? parts[index - 1] || '' : '',
      },
    ];
  });

  return segments.map((segment, index) => ({
    text: segment.text,
    hasLaterComma: segments
      .slice(index + 1)
      .some((candidate) => candidate.precedingDelimiter.includes(',')),
  }));
};

const matchesQualifiedFlatSegment = (
  segment: string,
  intent: NgaAttributionIntent
) => {
  if (intent.relationship === 'direct') return false;

  return ROLE_MARKERS[intent.relationship].some((marker) => {
    const boundedSegment = ` ${segment} `;
    const boundedMarker = ` ${marker} `;
    let markerIndex = boundedSegment.indexOf(boundedMarker);

    while (markerIndex >= 0) {
      const before = boundedSegment.slice(0, markerIndex).trim();
      const after = boundedSegment
        .slice(markerIndex + boundedMarker.length)
        .trim();
      if (
        (after && containsAllTargetTokens(after, intent.targetText)) ||
        (!after && before && containsAllTargetTokens(before, intent.targetText))
      ) {
        return true;
      }
      markerIndex = boundedSegment.indexOf(
        boundedMarker,
        markerIndex + boundedMarker.length
      );
    }

    return false;
  });
};

const matchesLegacyFlatArtist = (
  artist: unknown,
  intent: NgaAttributionIntent
) => {
  if (typeof artist !== 'string' || !artist.trim()) return false;
  const segments = flatArtistSegments(artist);

  if (intent.relationship === 'direct') {
    const primarySegment = segments[0];
    return Boolean(
      primarySegment &&
        !QUALIFIED_ROLE_MARKERS.some((marker) =>
          containsPhrase(primarySegment.text, marker)
        ) &&
        containsAllTargetTokens(primarySegment.text, intent.targetText)
    );
  }

  return segments.some(
    (segment) =>
      !segment.hasLaterComma &&
      matchesQualifiedFlatSegment(segment.text, intent)
  );
};

export const matchesNgaAttributionEvidence = (
  metadata: NgaAttributionEvidenceMetadata,
  intent: NgaAttributionIntent
): boolean => {
  const structured = structuredArtistRelationships(metadata);
  const relationships = structured.relationships;
  if (intent.relationship === 'direct') {
    const primaryArtistId =
      typeof metadata.primaryArtistId === 'string' &&
      /^\d+$/u.test(metadata.primaryArtistId)
        ? metadata.primaryArtistId
        : null;
    const primaryRelationship = primaryArtistId
      ? relationships.find(
          (relationship) => relationship.constituentId === primaryArtistId
        )
      : undefined;
    if (primaryRelationship) {
      return relationshipNameMatches(primaryRelationship, intent.targetText);
    }
    return structured.present
      ? false
      : matchesLegacyFlatArtist(metadata.artist, intent);
  }

  return structured.present
    ? relationships.some((relationship) =>
        relationshipMatches(relationship, intent)
      )
    : matchesLegacyFlatArtist(metadata.artist, intent);
};

const CLASSIFICATION_PHRASES: Record<string, readonly string[]> = {
  painting: ['painting', 'paintings'],
  drawing: ['drawing', 'drawings'],
  print: ['print', 'prints'],
  sculpture: ['sculpture', 'sculptures'],
  photograph: ['photograph', 'photographs', 'photo', 'photos', 'photography'],
  'decorative art': ['decorative art', 'decorative arts'],
};

const containsClassification = (value: unknown, classification: string) => {
  const normalized = fold(classification);
  return (CLASSIFICATION_PHRASES[normalized] || [normalized]).some((phrase) =>
    containsPhrase(value, phrase)
  );
};

const institutionTextFields = (result: ArtworkSearchResult) => [
  result.title,
  result.metadata?.description,
];

const searchSourceChannels = (result: ArtworkSearchResult) => {
  const rawSources =
    result.metadata?.searchSources || result.metadata?.search_sources;
  if (!Array.isArray(rawSources)) return new Set<string>();
  return new Set(
    rawSources.flatMap((source) =>
      isRecord(source) && typeof source.channel === 'string'
        ? [source.channel]
        : []
    )
  );
};

const DERIVATION_CONNECTORS = [
  'based on',
  'used as basis for',
  'used as the basis for',
  'derived from',
  'copied from',
  'adapted from',
  'after',
] as const;

export const classifyNgaRelationEvidence = (
  result: ArtworkSearchResult,
  relation: PublicSearchRelation
): ClassifiedRelationEvidence => {
  const institutionFields = institutionTextFields(result);
  if (relation.kind === 'derived_from') {
    const verified = institutionFields.some(
      (value) =>
        containsClassification(value, relation.sourceClassification) &&
        DERIVATION_CONNECTORS.some((connector) =>
          containsPhrase(value, connector)
        )
    );
    return verified
      ? { verified: true, source: 'institution_metadata' }
      : { verified: false, source: null };
  }

  if (
    institutionFields.some((value) =>
      containsClassification(value, relation.subjectClassification)
    )
  ) {
    return { verified: true, source: 'institution_metadata' };
  }

  const channels = searchSourceChannels(result);
  const hasImage =
    channels.has('image_embedding') || channels.has('jina_image');
  const hasCaption =
    channels.has('institution_caption_embedding') ||
    channels.has('generated_caption_embedding') ||
    channels.has('caption_embedding') ||
    channels.has('caption');
  return hasImage && hasCaption
    ? { verified: true, source: 'image_caption_agreement' }
    : { verified: false, source: null };
};

export const filterNgaRelationEvidence = (
  results: ArtworkSearchResult[],
  plan: NgaSearchPlan
): ArtworkSearchResult[] => {
  if (plan.mode !== 'relational' || !plan.relation) return results;

  const verified = results.flatMap((result) => {
    const evidence = classifyNgaRelationEvidence(result, plan.relation!);
    if (!evidence.verified) return [];
    return [
      {
        ...result,
        metadata: {
          ...(result.metadata || {}),
          relationEvidence: evidence,
        },
      },
    ];
  });

  return [
    ...verified.filter(
      (result) =>
        result.metadata?.relationEvidence?.source === 'institution_metadata'
    ),
    ...verified.filter(
      (result) =>
        result.metadata?.relationEvidence?.source === 'image_caption_agreement'
    ),
  ];
};
