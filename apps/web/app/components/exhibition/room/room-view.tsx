/**
 * The room, as a page.
 *
 * Thin on purpose. It owns a canvas, hands the scene a plan, and renders the
 * one piece of the room that should not be a texture: the wall label of
 * whatever the visitor is standing in front of, in real type, in the same two
 * inks the flat page uses.
 *
 * **The label in the focused view is the published one.** `page.works[].label`
 * is the `current` value of the exhibition field — what the human wrote, or
 * what they accepted — and a `proposed` rewording never reaches this payload
 * at all. So the room cannot render an agent's unaccepted suggestion as though
 * it had been taken, which is the provenance rule holding by construction
 * rather than by a check somebody has to remember.
 *
 * There is no instruction anywhere on screen. Click the floor and you move,
 * click a picture and you stand in front of it, drag to look, arrow keys to
 * walk and turn. Nothing here says so.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { SpeakButton } from '~/components/artwork/speak-button';
import { usePrefersReducedMotion } from '~/components/board/use-prefers-reduced-motion';
import type { ExhibitionPage } from '~/lib/exhibition-page.server';
import { parseDimensions } from '~/lib/room/dimensions';
import { planRoom, type RoomWorkInput } from '~/lib/room/plan';
import type { ExhibitionTemplate } from '~/lib/room/template';
import type { RoomSceneHandle, SceneStats } from './room-scene';
import { TemplateSwitch } from './template-switch';

/**
 * The catalogue's own words, in the order a wall label sets them.
 *
 * Shared by the focused panel and the read-aloud, so the two cannot drift into
 * saying different things about the same picture.
 */
const catalogueLine = (work: ExhibitionPage['works'][number]) =>
  [work.title, work.artist, work.date, work.medium].filter(Boolean).join(', ');

export const RoomView = ({
  page,
  template,
  available,
}: {
  page: ExhibitionPage;
  template: ExhibitionTemplate;
  available: boolean;
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const sceneRef = useRef<RoomSceneHandle | null>(null);
  const [focused, setFocused] = useState<string | null>(null);
  const reducedMotion = usePrefersReducedMotion();

  /**
   * The plan, from the show.
   *
   * `dimensions` is not on the exhibition payload — the public catalogue
   * returns it on the artwork record and this page does not carry it through —
   * so in practice every work here takes the declared fallback size. The parse
   * runs anyway, against whatever the payload does have, because the day the
   * loader starts carrying dimensions the room should start using them without
   * anybody remembering to come back here. See `docs/night/room-report.md`.
   */
  const plan = useMemo(() => {
    const works: RoomWorkInput[] = page.works.map((work) => {
      const size = parseDimensions(work.dimensions);
      return {
        artworkId: work.artworkId,
        size: size
          ? { widthM: size.widthCm / 100, heightM: size.heightCm / 100 }
          : null,
      };
    });
    return planRoom(works, page.regions);
  }, [page.works, page.regions]);

  const onFocus = useCallback((artworkId: string | null) => {
    setFocused(artworkId);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !available) return;

    let handle: RoomSceneHandle | null = null;
    let cancelled = false;

    void import('./room-scene').then(({ createRoomScene }) =>
      createRoomScene({
        canvas,
        plan,
        title: page.title,
        statement: page.statement,
        works: page.works.map((work) => ({
          artworkId: work.artworkId,
          title: work.title,
          artist: work.artist,
          date: work.date,
          label: work.label,
          imageUrl: work.imageUrl,
        })),
        reducedMotion,
        onFocus,
        onStats: (stats: SceneStats) => {
          /*
           * Instrumentation, not a control surface. The room is measured by
           * walking it; this is only how the number gets out of the frame loop
           * and into the report, and nothing in the product reads it.
           */
          (window as Window & { __paillette_room?: SceneStats }).__paillette_room =
            stats;
        },
      }).then((created) => {
        if (cancelled) {
          created.dispose();
          return;
        }
        handle = created;
        sceneRef.current = created;
      })
    );

    return () => {
      cancelled = true;
      handle?.dispose();
      sceneRef.current = null;
    };
  }, [available, plan, page.works, page.title, page.statement, reducedMotion, onFocus]);

  const work = focused
    ? page.works.find((candidate) => candidate.artworkId === focused)
    : null;

  return (
    <main className="exhibition-room" data-focused={work ? 'true' : undefined}>
      <canvas
        ref={canvasRef}
        className="exhibition-room-canvas"
        tabIndex={0}
        /*
         * The only string on screen that describes the interface, and it is
         * not on screen: a canvas with no accessible name is announced as
         * "canvas", which is worse than useless. Everything a screen reader
         * actually needs is in the list below.
         */
        aria-label={`${page.title}, walkable`}
      />

      <header className="exhibition-room-masthead">
        <h1 className="exhibition-room-title">{page.title}</h1>
        <TemplateSwitch template={template} available={available} />
      </header>

      {work && (
        <aside className="exhibition-room-focus" key={work.artworkId}>
          <p className="exhibition-line">
            <span className="exhibition-work-title">{work.title}</span>
            {work.artist && <span>{work.artist}</span>}
            {work.date && <span>{work.date}</span>}
            {work.medium && <span>{work.medium}</span>}
          </p>

          {work.label && (
            <p
              className="exhibition-label"
              data-provenance={work.labelByAgent ? 'agent' : 'human'}
            >
              {work.label}
            </p>
          )}

          <p className="exhibition-accession lt-catalogue">
            {work.accession && <span>{work.accession}</span>}
            {work.sourceUrl && (
              <a href={work.sourceUrl} rel="noreferrer noopener">
                Catalogue record
              </a>
            )}
          </p>

          {/* The page's own read-aloud, not a second one built for the room. */}
          <SpeakButton
            className="exhibition-room-speak"
            text={[catalogueLine(work), work.label].filter(Boolean).join('. ')}
          />
        </aside>
      )}

      {/*
        The show as a document, for anyone whose way in is not a camera.
        Off screen, in the exhibition's own order, and it is also what is left
        if the scene never finishes loading.
      */}
      <ol className="sr-only">
        {page.works.map((entry) => (
          <li key={entry.artworkId}>
            <p>{catalogueLine(entry)}</p>
            {entry.label && <p>{entry.label}</p>}
          </li>
        ))}
      </ol>
    </main>
  );
};
