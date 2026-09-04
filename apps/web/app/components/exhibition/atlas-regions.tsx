/**
 * The atlas, with its groupings named.
 *
 * The plain atlas scatters works by a hash of their id, which is a pleasant
 * arrangement and means nothing. A name floating over that would be worse than
 * no name — it would claim a relationship the positions do not have. So naming
 * a region *changes the layout*: the works in it are drawn together, under
 * their name, and everything unassigned sits below in its own band.
 *
 * That is the whole condition the brief put on this feature, and it is why the
 * arrangement moves rather than gaining a caption.
 *
 * The human owns the names as much as the agent does: click one to rename it,
 * and dissolving it leaves its works on the atlas, unassigned, rather than
 * removing them.
 */

import { useEffect, useRef, useState } from 'react';
import type { ArtworkSearchResult } from '~/types';
import { dissolveRegion, renameRegion } from '~/lib/webmcp/exhibition';
import type { AtlasRegion } from '~/lib/webmcp/store';
import { useExhibition } from './exhibition-head';

/** Stable per-id jitter, so a redeal does not reshuffle what stayed. */
const hash = (value: string) => {
  let out = 0;
  for (let index = 0; index < value.length; index += 1) {
    out = (out * 31 + value.charCodeAt(index)) >>> 0;
  }
  return out;
};

const RegionName = ({ region }: { region: AtlasRegion }) => {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(region.label);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!editing) setDraft(region.label);
  }, [region.label, editing]);

  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  return (
    <div className="paillette-region-head" data-provenance={region.by}>
      {editing ? (
        <input
          ref={inputRef}
          type="text"
          value={draft}
          aria-label={`Rename “${region.label}”`}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={() => {
            setEditing(false);
            if (draft.trim() && draft.trim() !== region.label) {
              renameRegion(region.id, draft);
            }
          }}
          onKeyDown={(event) => {
            event.stopPropagation();
            if (event.key === 'Enter') event.currentTarget.blur();
            if (event.key === 'Escape') {
              setDraft(region.label);
              setEditing(false);
            }
          }}
          className="paillette-region-name paillette-editable border-0 bg-transparent p-0 outline-none"
        />
      ) : (
        <button
          type="button"
          onClick={() => setEditing(true)}
          aria-label={`Rename “${region.label}”`}
          className="paillette-region-name border-0 bg-transparent p-0 text-left"
        >
          {region.label}
        </button>
      )}

      <button
        type="button"
        onClick={() => dissolveRegion(region.id)}
        aria-label={`Dissolve “${region.label}”`}
        className="paillette-region-dissolve leading-none"
      >
        ×
      </button>

      {region.note && <p className="paillette-region-note">{region.note}</p>}
    </div>
  );
};

const Cluster = ({
  works,
  onSelectArtwork,
  renderWork,
}: {
  works: ArtworkSearchResult[];
  onSelectArtwork: (artwork: ArtworkSearchResult) => void;
  renderWork: (work: ArtworkSearchResult, size: number) => React.ReactNode;
}) => (
  <div className="paillette-region-cluster">
    {works.map((work) => {
      const seed = hash(work.id);
      // Size and vertical drift vary, so a band reads as a group of things
      // rather than as a row of cells. The variation is small on purpose: a
      // scatter you cannot scan is not a map.
      const size = 88 + (seed % 56);
      const drift = (seed >> 6) % 34;
      return (
        <button
          key={work.id}
          type="button"
          onClick={() => onSelectArtwork(work)}
          style={{ marginTop: drift, width: size }}
          className="paillette-region-work border-0 bg-transparent p-0"
        >
          {renderWork(work, size)}
        </button>
      );
    })}
  </div>
);

export const RegionedAtlas = ({
  results,
  onSelectArtwork,
  renderWork,
}: {
  results: ArtworkSearchResult[];
  onSelectArtwork: (artwork: ArtworkSearchResult) => void;
  renderWork: (work: ArtworkSearchResult, size: number) => React.ReactNode;
}) => {
  const exhibition = useExhibition();
  if (!exhibition.regions.length) return null;

  const byId = new Map(results.map((result) => [result.id, result]));
  const claimed = new Set<string>();
  const bands = exhibition.regions
    .map((region) => {
      const works = region.artworkIds
        .map((id) => byId.get(id))
        .filter((work): work is ArtworkSearchResult => Boolean(work));
      works.forEach((work) => claimed.add(work.id));
      return { region, works };
    })
    // A named region with none of its works on screen is a label over
    // nothing, which is the one thing this must not draw.
    .filter((band) => band.works.length > 0);

  const rest = results.filter((result) => !claimed.has(result.id));
  if (!bands.length) return null;

  return (
    <div className="paillette-atlas-regions">
      {bands.map(({ region, works }) => (
        <section key={region.id} className="paillette-region">
          <RegionName region={region} />
          <Cluster
            works={works}
            onSelectArtwork={onSelectArtwork}
            renderWork={renderWork}
          />
        </section>
      ))}

      {rest.length > 0 && (
        // Unassigned works keep their place on the atlas with no name over
        // them. Something that has not found its group yet is a fact about the
        // arrangement, and the honest way to draw it is the absence of a label.
        <section className="paillette-region" data-unassigned="true">
          <Cluster
            works={rest}
            onSelectArtwork={onSelectArtwork}
            renderWork={renderWork}
          />
        </section>
      )}
    </div>
  );
};
