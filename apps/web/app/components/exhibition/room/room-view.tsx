/**
 * The room, as a page.
 *
 * Thin on purpose. It owns the element the scene draws into, hands the scene a
 * plan, and renders the one piece of the room that should not be a texture:
 * the wall label of whatever the visitor is standing in front of, in real
 * type, in the same two inks the flat page uses.
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
import { usePrefersReducedMotion } from '~/components/board/use-prefers-reduced-motion';
import type { ExhibitionPage } from '~/lib/exhibition-page.server';
import { parseDimensions } from '~/lib/room/dimensions';
import { planRoom, type RoomWorkInput } from '~/lib/room/plan';
import type { ExhibitionTemplate } from '~/lib/room/template';
import type { RoomSceneHandle, SceneStats, SceneWork } from './room-scene';
import { FocusedLabel, catalogueLine } from './room-focus';
import { TemplateSwitch } from './template-switch';

export const RoomView = ({
  page,
  template,
  available,
  onUnavailable,
}: {
  page: ExhibitionPage;
  template: ExhibitionTemplate;
  available: boolean;
  /** Told once, when the device stops being able to draw a room at all. */
  onUnavailable?: () => void;
}) => {
  const stageRef = useRef<HTMLDivElement | null>(null);
  const [focused, setFocused] = useState<string | null>(null);
  /**
   * The browser took the context away mid-visit.
   *
   * A GPU reset or an OS reclaiming memory leaves the canvas black forever, and
   * nothing the scene can do brings it back. The honest answer is the one a
   * device that never had WebGL already gets: the flat page, with no apology on
   * screen and the word ROOM gone, because it is now a control that would not
   * work. Handing back to `ExhibitionView` rather than rendering an error is
   * what makes that true for free.
   */
  const [lost, setLost] = useState(false);
  const reducedMotion = usePrefersReducedMotion();

  /**
   * The plan, from the show.
   *
   * `dimensions` reaches this payload but arrives empty from the NGA ingest —
   * the structured field is present on every record with every value null — so
   * in practice every work here takes the declared fallback size. The parse
   * runs anyway, because the day a collection carries real dimensions the room
   * should start using them without anybody remembering to come back here.
   * See `docs/night/room-report.md` for the count.
   *
   * Memoised because the effect below depends on it and rebuilding the plan
   * would rebuild the whole scene. `useLoaderData` turns out to hand back a
   * stable object per navigation — measured, by counting scene creations
   * across three mounts of the room: three — so the array identities are a
   * sound key and no content hash is needed.
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

  const sceneWorks = useMemo<SceneWork[]>(
    () =>
      page.works.map((work) => ({
        artworkId: work.artworkId,
        title: work.title,
        artist: work.artist,
        date: work.date,
        label: work.label,
        imageUrl: work.imageUrl,
      })),
    [page.works]
  );

  const onFocus = useCallback((artworkId: string | null) => {
    setFocused(artworkId);
  }, []);

  const { title, statement } = page;

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage || !available || lost) return;

    /*
     * The canvas is made here rather than rendered by React, and that is a
     * bug fix rather than a style.
     *
     * Tearing a scene down ends with `forceContextLoss()`, which is not
     * optional — without it a visitor toggling between the page and the room
     * a dozen times runs into the browser's cap on live WebGL contexts and
     * every later room is blank. But a lost context is lost *for that canvas
     * element, permanently*: a second `WebGLRenderer` built on the same
     * element gets the dead context back and renders nothing, silently, with
     * one "Context Lost" line in the console as the only clue. React reuses
     * the element across effect runs, so a single re-run was enough to kill
     * the room for the rest of the page's life. Owning the element means
     * every scene gets a live context and disposal takes the whole thing.
     */
    const canvas = document.createElement('canvas');
    canvas.className = 'exhibition-room-canvas';
    canvas.tabIndex = 0;
    // A canvas with no accessible name is announced as "canvas". Everything a
    // screen reader actually needs is in the list further down the document.
    canvas.setAttribute('aria-label', `${title}, walkable`);
    stage.appendChild(canvas);

    let handle: RoomSceneHandle | null = null;
    let disposed = false;

    void import('./room-scene')
      .then(({ createRoomScene }) => {
        // Checked before the scene exists, not after: creating one only to
        // dispose it is what put a dead context on a live canvas.
        if (disposed) return null;
        return createRoomScene({
          canvas,
          plan,
          title,
          statement,
          works: sceneWorks,
          reducedMotion,
          onFocus,
          onContextLost: () => {
            setLost(true);
            onUnavailable?.();
          },
          onStats: (stats: SceneStats) => {
            /*
             * Instrumentation, not a control surface. The room is measured by
             * walking it; this is only how a number gets out of a render loop
             * and into the report, and nothing in the product reads it.
             */
            (window as Window & { __paillette_room?: SceneStats }).__paillette_room =
              stats;
          },
        });
      })
      .then((created) => {
        if (!created) return;
        if (disposed) {
          created.dispose();
          return;
        }
        handle = created;
      });

    return () => {
      disposed = true;
      handle?.dispose();
      canvas.remove();
    };
  }, [
    available,
    lost,
    plan,
    sceneWorks,
    title,
    statement,
    reducedMotion,
    onFocus,
    onUnavailable,
  ]);

  const work = focused
    ? page.works.find((candidate) => candidate.artworkId === focused)
    : null;

  return (
    <main className="exhibition-room" data-focused={work ? 'true' : undefined}>
      <div className="exhibition-room-stage" ref={stageRef} />

      <header className="exhibition-room-masthead">
        <h1 className="exhibition-room-title">{page.title}</h1>
        <TemplateSwitch template={template} available={available ? 'yes' : 'no'} />
      </header>

      {work && <FocusedLabel key={work.artworkId} work={work} />}

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
