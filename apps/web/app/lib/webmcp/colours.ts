/**
 * The colour vocabulary the human's own palette rail uses.
 *
 * Mirrors `COLOURS` / `COLOUR_SEARCH_TERMS` in
 * `~/routes/galleries.$galleryId.search` so that an agent asking for "rust"
 * and a human clicking the rust swatch run the identical query and land on the
 * identical URL. Kept as a local copy rather than an import because that route
 * module pulls in the whole search page (mermaid, gsap, the atlas view) and
 * this needs to stay a leaf module.
 *
 * Colour search on the public surface is deliberately two-stage, exactly as
 * the page does it: a semantic text query for the colour's language, then a
 * local CIEDE2000 re-rank against each result's extracted palette. The public
 * text route rejects server-side `visualRefinement` on purpose
 * ("Public colour refinement is performed locally").
 */

export interface NamedColour {
  id: string;
  hex: string;
  name: string;
  /** The natural-language query the semantic index is actually good at. */
  searchText: string;
}

export const NAMED_COLOURS: NamedColour[] = [
  { id: 'navy', hex: '#1a2f52', name: 'Navy', searchText: 'dark navy blue' },
  { id: 'cobalt', hex: '#365f9c', name: 'Cobalt', searchText: 'cobalt blue' },
  { id: 'steel', hex: '#6e8ea8', name: 'Steel', searchText: 'cool steel blue grey' },
  { id: 'sage', hex: '#8a9a7a', name: 'Sage', searchText: 'muted sage green' },
  { id: 'olive', hex: '#6a6a3a', name: 'Olive', searchText: 'olive green' },
  { id: 'gold', hex: '#cda636', name: 'Gold', searchText: 'golden ochre yellow' },
  { id: 'amber', hex: '#d2853a', name: 'Amber', searchText: 'warm amber orange' },
  { id: 'rust', hex: '#bf5631', name: 'Rust', searchText: 'rust red orange' },
  { id: 'umber', hex: '#6a5238', name: 'Umber', searchText: 'warm earth-tone browns' },
  { id: 'bone', hex: '#cdbfa2', name: 'Bone', searchText: 'warm bone beige' },
  {
    id: 'charcoal',
    hex: '#221e1a',
    name: 'Charcoal',
    searchText: 'near-black high-contrast monochrome',
  },
];

export const NAMED_COLOUR_IDS = NAMED_COLOURS.map((colour) => colour.id);

const HEX = /^#[0-9a-fA-F]{6}$/;

export interface ResolvedColour {
  /** The `colour` URL parameter the human's page understands. */
  selection: string;
  hex: string;
  label: string;
  searchText: string;
}

/**
 * Accepts either a named swatch (`rust`) or any `#rrggbb`. A raw hex maps to
 * the page's `custom:#rrggbb` selection form so the agent's search and the
 * human's URL stay interchangeable.
 */
export const resolveColour = (value: unknown): ResolvedColour | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  const named = NAMED_COLOURS.find(
    (colour) => colour.id === trimmed.toLowerCase()
  );
  if (named) {
    return {
      selection: named.id,
      hex: named.hex,
      label: named.name,
      searchText: named.searchText,
    };
  }

  const hex = trimmed.startsWith('#') ? trimmed : `#${trimmed}`;
  if (!HEX.test(hex)) return null;
  const lower = hex.toLowerCase();
  return {
    selection: `custom:${lower}`,
    hex: lower,
    label: hex.toUpperCase(),
    searchText: `${lower} colour`,
  };
};
