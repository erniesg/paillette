/**
 * The collections Paillette exposes to anonymous callers.
 *
 * This mirrors `ALLOWED_PUBLIC_SEARCH_ROUTE_IDS` in
 * `~/lib/public-search.server` exactly. Today that is one collection: the
 * National Gallery of Art (Washington) open-access records. Being explicit
 * about it — rather than letting the agent guess an org id and collect 403s —
 * is the whole point of `list_collections`.
 */

export interface PublicCollectionDescriptor {
  /** The id every tool takes as its `collection` argument. */
  id: string;
  name: string;
  description: string;
  /** Where the human's browser sits when searching this collection. */
  searchPath: string;
  institution: string;
  institutionUrl: string;
  rights: string;
  /** Search modalities this collection actually supports today. */
  capabilities: ('text' | 'image' | 'color' | 'browse')[];
}

export const PUBLIC_COLLECTIONS: PublicCollectionDescriptor[] = [
  {
    id: 'nga',
    name: 'National Gallery of Art, Washington — open access',
    description:
      'Open-access artworks released by the National Gallery of Art, Washington. Every record carries source-labelled catalogue metadata, an extracted colour palette, and a generated visual description that the semantic index searches over.',
    searchPath: '/collections/nga/search',
    institution: 'National Gallery of Art, Washington',
    institutionUrl: 'https://www.nga.gov/open-access-images.html',
    rights:
      'Public-domain / open-access source records. Cite the National Gallery of Art, Washington, using each record’s sourceUrl.',
    capabilities: ['text', 'image', 'color', 'browse'],
  },
];

const BY_ID = new Map(
  PUBLIC_COLLECTIONS.map((collection) => [collection.id, collection])
);

export const PUBLIC_COLLECTION_IDS = PUBLIC_COLLECTIONS.map(
  (collection) => collection.id
);

export const DEFAULT_PUBLIC_COLLECTION_ID = PUBLIC_COLLECTION_IDS[0] as string;

export const getPublicCollection = (
  id: unknown
): PublicCollectionDescriptor | null => {
  if (typeof id !== 'string') return null;
  return BY_ID.get(id.trim().toLowerCase()) ?? null;
};

/**
 * Resolves the `collection` argument, defaulting rather than failing so a
 * single-collection deployment does not force the agent to name it.
 */
export const resolveCollectionId = (id: unknown): string =>
  getPublicCollection(id)?.id ?? DEFAULT_PUBLIC_COLLECTION_ID;
