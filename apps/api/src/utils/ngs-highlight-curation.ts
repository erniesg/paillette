import type { PublicSearchSpotlightArtwork } from '@paillette/types/public-search';

// Native catalogue review selected actual returned works, not interchangeable
// festival imagery. These are related thematic artworks, not claims that each
// work documents that exact observance. Keep full explicit-search depth apart.
export const NGS_CURATED_HIGHLIGHT_IDS: Readonly<
  Record<string, readonly string[]>
> = {
  'new-years-day': ['2017-00858', '1993-00015', '2007-52395', '2017-00856'],
  'chinese-new-year': ['P-0529', '2008-06922', '2001-03344', 'P-1106'],
  'mid-autumn-festival': ['1994-04153', '2003-03122', '2003-03147', 'P-0805'],
  'labour-day': ['P-0016', 'P-1178', '2013-00175', 'P-0015'],
  'national-day': ['2003-03280', 'P-0268', '2021-00059', '2014-00521'],
  'lantern-festival': ['2003-03099'],
  'qing-ming-festival': ['2012-00268'],
  'dragon-boat-festival': ['1994-00096', '2001-02705', '1991-00328', 'OF-0022'],
  'hari-raya-puasa': ['2016-00151', '1994-04157'],
  'hari-raya-haji': ['2016-00151'],
  'vesak-day': ['1993-01008', '2003-03283', '2018-00425', '1994-04130'],
  'good-friday': ['2001-02703', '1997-02957', '2021-00503'],
  deepavali: ['P-0229', 'P-0230', 'P-0231', '2016-00373'],
};

export const QIXI_HIGHLIGHT_QUERY =
  'a romantic couple, lovers embracing under a starry night sky';

export function selectNgsPreparedHighlights(
  id: string,
  artworks: readonly PublicSearchSpotlightArtwork[]
) {
  const curated = NGS_CURATED_HIGHLIGHT_IDS[id];
  if (curated) {
    const byId = new Map(artworks.map((artwork) => [artwork.id, artwork]));
    const selected = curated
      .map((artworkId) => byId.get(artworkId))
      .filter((artwork): artwork is PublicSearchSpotlightArtwork =>
        Boolean(artwork)
      );
    if (!selected.length)
      throw new Error(`No reviewed NGS highlight available: ${id}`);
    return selected;
  }
  if (id === 'christmas-day') {
    const selected = artworks
      .filter((artwork) =>
        /\b(christmas|nativity|epiphany|winter|december|cold day|holy family)\b/i.test(
          artwork.title
        )
      )
      .slice(0, 4);
    if (!selected.length)
      throw new Error('No Christmas-related NGS highlight available');
    return selected;
  }
  return artworks.slice(0, 4);
}
