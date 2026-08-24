export const NGA_ARTIST_METADATA_KEY = 'ngaArtists';

const normalizeText = (value) =>
  String(value ?? '')
    .normalize('NFC')
    .replace(/\s+/g, ' ')
    .trim();

const compareText = (left, right) => (left < right ? -1 : left > right ? 1 : 0);

const normalizeId = (value, field) => {
  const id = normalizeText(value);
  if (!/^\d+$/.test(id)) throw new Error(`malformed ${field}`);
  return id;
};

const normalizeDisplayOrder = (value) => {
  const text = normalizeText(value);
  if (!/^-?\d+$/.test(text)) throw new Error('malformed displayorder');

  const displayOrder = Number(text);
  if (!Number.isSafeInteger(displayOrder)) {
    throw new Error('malformed displayorder');
  }
  return displayOrder;
};

const requireText = (value, field) => {
  const text = normalizeText(value);
  if (!text) throw new Error(`malformed ${field}`);
  return text;
};

const optionalText = (value) => normalizeText(value) || null;

const compareRelationship = (left, right) =>
  left.displayOrder - right.displayOrder ||
  compareText(left.constituentId, right.constituentId) ||
  compareText(left.role, right.role) ||
  compareText(left.prefix || '', right.prefix || '') ||
  compareText(left.suffix || '', right.suffix || '');

const relationKey = (relationship) =>
  JSON.stringify([
    relationship.objectId,
    relationship.constituentId,
    relationship.displayOrder,
    relationship.role,
    relationship.prefix,
    relationship.suffix,
  ]);

const asRows = (rows) => (Array.isArray(rows) ? rows : []);

export function buildNgaArtistMetadata({
  relationships,
  constituents,
  alternativeNames,
  requiredObjectIds,
}) {
  const requiredIds = [...(requiredObjectIds || [])]
    .map((objectId) => normalizeId(objectId, 'objectid'))
    .sort(compareText);
  const requiredIdSet = new Set(requiredIds);

  const artistRelationships = asRows(relationships)
    .map((row) => {
      const roleType = requireText(row?.roletype, 'roletype').toLowerCase();
      return {
        objectId: normalizeId(row?.objectid, 'objectid'),
        constituentId: normalizeId(row?.constituentid, 'constituentid'),
        displayOrder: normalizeDisplayOrder(row?.displayorder),
        roleType,
        role: requireText(row?.role, 'role'),
        prefix: optionalText(row?.prefix),
        suffix: optionalText(row?.suffix),
      };
    })
    .filter(
      (relationship) =>
        requiredIdSet.has(relationship.objectId) &&
        relationship.roleType === 'artist'
    );

  const constituentsById = new Map(
    asRows(constituents)
      .map((row) => ({
        constituentId: normalizeId(row?.constituentid, 'constituentid'),
        preferredDisplayName: requireText(
          row?.preferreddisplayname,
          'preferred display name'
        ),
        forwardDisplayName: requireText(
          row?.forwarddisplayname,
          'forward display name'
        ),
      }))
      .sort(
        (left, right) =>
          compareText(left.constituentId, right.constituentId) ||
          compareText(left.preferredDisplayName, right.preferredDisplayName) ||
          compareText(left.forwardDisplayName, right.forwardDisplayName)
      )
      .map((constituent) => [constituent.constituentId, constituent])
  );

  const alternativeNamesByConstituentId = new Map();
  for (const row of asRows(alternativeNames)) {
    const constituentId = normalizeId(row?.constituentid, 'constituentid');
    const name = optionalText(row?.forwarddisplayname);
    if (!name) continue;
    const names =
      alternativeNamesByConstituentId.get(constituentId) || new Set();
    names.add(name);
    alternativeNamesByConstituentId.set(constituentId, names);
  }

  const relationshipsByObjectId = new Map();
  for (const relationship of artistRelationships) {
    const rows = relationshipsByObjectId.get(relationship.objectId) || [];
    rows.push(relationship);
    relationshipsByObjectId.set(relationship.objectId, rows);
  }

  const metadata = new Map();
  for (const objectId of requiredIds) {
    const deduplicated = new Map();
    for (const relationship of relationshipsByObjectId.get(objectId) || []) {
      deduplicated.set(relationKey(relationship), relationship);
    }
    const rows = [...deduplicated.values()].sort(compareRelationship);

    if (!rows.length)
      throw new Error(`missing artist relationship for ${objectId}`);
    if (rows.length > 1 && rows[0].displayOrder === rows[1].displayOrder) {
      throw new Error(`minimum displayorder tie for ${objectId}`);
    }

    const normalizedRelationships = rows.map((relationship) => {
      const constituent = constituentsById.get(relationship.constituentId);
      if (!constituent) {
        throw new Error(`unresolved constituent ${relationship.constituentId}`);
      }

      return {
        constituentId: relationship.constituentId,
        displayOrder: relationship.displayOrder,
        roleType: 'artist',
        role: relationship.role,
        prefix: relationship.prefix,
        suffix: relationship.suffix,
        preferredDisplayName: constituent.preferredDisplayName,
        forwardDisplayName: constituent.forwardDisplayName,
        alternativeNames: [
          ...(alternativeNamesByConstituentId.get(relationship.constituentId) ||
            []),
        ].sort(compareText),
      };
    });

    metadata.set(objectId, {
      primaryArtistId: normalizedRelationships[0].constituentId,
      relationships: normalizedRelationships,
    });
  }

  return metadata;
}

export function mergeNgaArtistCustomMetadata(
  existing,
  artistMetadata,
  sourceCommit
) {
  return {
    ...(existing || {}),
    [NGA_ARTIST_METADATA_KEY]: {
      sourceCommit,
      relationships: artistMetadata.relationships,
    },
  };
}
