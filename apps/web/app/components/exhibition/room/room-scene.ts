/**
 * The room, drawn.
 *
 * Imperative and framework-free on purpose. The scene is built once from a
 * plan and then mutated by a visitor walking around it; there is no tree of
 * components whose props change, so a React reconciler for the 3D graph would
 * be paying for a diff nobody needs. It also keeps the thing that matters most
 * — every `dispose()` — in plain sight rather than behind a cache.
 *
 * **Nothing here is lit.** Every material is `MeshBasicMaterial`, which is the
 * design decision as much as the performance one. A lighting model renders a
 * painting as a painting *under a light*, and every one of those makes a Titian
 * muddier than a Titian; unlit means each work is exactly its own colours, and
 * the house rule that the works are the only saturated thing on screen holds in
 * three dimensions the same way it holds on the page. The walls read as walls
 * from tone alone: the far wall a shade lighter than the sides, the floor
 * darker than either, and fog the colour of the wall carrying depth. That is
 * also why this runs at all on a phone — thirty unlit quads and no shadow maps.
 *
 * The geometry, the walkable set and the texture accounting are all in
 * `~/lib/room/*` and tested there. What is left here is the parts that need a
 * GPU: loading, disposing, and the camera.
 */

import type * as THREE from 'three';
import type { Placement, RoomPlan } from '~/lib/room/plan';
import { DOOR_WIDTH_M, viewingDistance } from '~/lib/room/plan';
import {
  BASE_WIDTH,
  MAX_NEAR_TEXTURES,
  NEAR_WIDTH,
  TextureBudget,
  nearestIds,
  textureBytes,
} from '~/lib/room/texture-budget';
import { EYE_HEIGHT_M, isWalkable, stepTowards } from '~/lib/room/walkable';
import { atWidth } from '~/lib/share/iiif';

export interface SceneWork {
  artworkId: string;
  title: string;
  artist: string | null;
  date: string | null;
  label: string | null;
  imageUrl: string | null;
}

export interface SceneStats {
  fps: number;
  textureBytes: number;
  nearCount: number;
  /** What the renderer itself says it is holding. The cross-check. */
  rendererTextures: number;
  pixelRatio: number;
}

export interface RoomSceneOptions {
  canvas: HTMLCanvasElement;
  plan: RoomPlan;
  works: SceneWork[];
  /** Painted on the entrance wall, the way a gallery sets its wall text. */
  title: string | null;
  statement: string | null;
  reducedMotion: boolean;
  onFocus: (artworkId: string | null) => void;
  onStats?: (stats: SceneStats) => void;
}

/** Charcoal, the same ground the page uses. Not black; black dissolves darks. */
const WALL = 0x232327;
const FAR_WALL = 0x2b2b30;
const FLOOR = 0x151517;
const CEILING = 0x101012;

/** How far a keyboard step moves, and how far a snap turn turns. */
const STEP_M = 0.85;
const TURN_RADIANS = Math.PI / 8;

/** Movement is short and eased; under reduced motion it is not eased at all. */
const GLIDE_MS = 480;
const FOCUS_MS = 620;

/** Works within this many metres are candidates for a better texture. */
const NEAR_RADIUS_M = 7;

/** How often the level of detail is reconsidered. Not every frame. */
const LOD_INTERVAL_MS = 220;

/** Below this the renderer gives up some resolution rather than some frames. */
const DEGRADE_BELOW_FPS = 40;

const PLATE_TEXTURE_WIDTH = 384;
const PLATE_TEXTURE_HEIGHT = 192;
const PLATE_WIDTH_M = 0.32;
const PLATE_HEIGHT_M = 0.16;
const MAX_PLATES = 8;

const easeInOutCubic = (t: number) =>
  t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;

const shortestAngle = (from: number, to: number) => {
  let delta = (to - from) % (Math.PI * 2);
  if (delta > Math.PI) delta -= Math.PI * 2;
  if (delta < -Math.PI) delta += Math.PI * 2;
  return delta;
};

interface Hung {
  placement: Placement;
  work: SceneWork;
  mesh: THREE.Mesh;
  material: THREE.MeshBasicMaterial;
  plate: THREE.Mesh | null;
  base: THREE.Texture | null;
  near: THREE.Texture | null;
  /** The size the work is hung at once its true aspect is known. */
  widthM: number;
  heightM: number;
}

export interface RoomSceneHandle {
  focus: (artworkId: string | null) => void;
  dispose: () => void;
  /** Read once, after a visit, for the report. Never drives the product. */
  stats: () => SceneStats;
}

export const createRoomScene = async (
  options: RoomSceneOptions
): Promise<RoomSceneHandle> => {
  /*
   * Three is imported here and nowhere above it, so the bundler puts it in a
   * chunk that only a visitor who asked for the room ever downloads. The flat
   * page — the default, and what a cold shared link opens — never fetches a
   * byte of it. That is the whole justification for the library being an
   * acceptable dependency at all.
   */
  const THREE_NS = await import('three');
  const {
    BoxGeometry,
    CanvasTexture,
    Color,
    DoubleSide,
    Fog,
    LinearFilter,
    LinearMipmapLinearFilter,
    Mesh,
    MeshBasicMaterial,
    PerspectiveCamera,
    PlaneGeometry,
    Raycaster,
    SRGBColorSpace,
    Scene,
    TextureLoader,
    Vector2,
    Vector3,
    WebGLRenderer,
  } = THREE_NS;

  const { canvas, plan, works, reducedMotion, onFocus, onStats } = options;
  const byId = new Map(works.map((work) => [work.artworkId, work]));

  const renderer = new WebGLRenderer({
    canvas,
    antialias: true,
    powerPreference: 'high-performance',
  });
  let pixelRatio = Math.min(
    typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1,
    2
  );
  renderer.setPixelRatio(pixelRatio);
  renderer.outputColorSpace = SRGBColorSpace;

  const scene = new Scene();
  scene.background = new Color(WALL);
  // Fog the colour of the wall, so the far end of an enfilade recedes rather
  // than ending. It is also the cheapest possible distance cue with no lights.
  scene.fog = new Fog(WALL, 8, 46);

  const camera = new PerspectiveCamera(62, 1, 0.08, 90);
  camera.position.set(plan.entry.x, EYE_HEIGHT_M, plan.entry.z);

  // -------------------------------------------------------------------------
  // The building
  // -------------------------------------------------------------------------

  const disposables: { dispose: () => void }[] = [];
  const track = <T extends { dispose: () => void }>(item: T): T => {
    disposables.push(item);
    return item;
  };

  const surface = (
    width: number,
    height: number,
    colour: number,
    position: [number, number, number],
    rotation: [number, number, number]
  ) => {
    const geometry = track(new PlaneGeometry(width, height));
    const material = track(new MeshBasicMaterial({ color: colour, fog: true }));
    const mesh = new Mesh(geometry, material);
    mesh.position.set(...position);
    mesh.rotation.set(...rotation);
    scene.add(mesh);
    return mesh;
  };

  /**
   * A block of text on a wall, drawn to a transparent canvas.
   *
   * Wrapped by measuring, not by counting characters, because the serif is
   * proportional and a character count wraps a line of capitals two words
   * early. Anything that overruns the plate is dropped rather than shrunk —
   * an exhibition statement is disciplined to 60–100 words upstream, and a
   * statement that somehow is not should be visibly cut rather than silently
   * set in six-point type.
   */
  function wallText(
    title: string | null,
    statement: string | null
  ): THREE.Texture | null {
    const width = 1024;
    const height = 512;
    const element = document.createElement('canvas');
    element.width = width;
    element.height = height;
    const context = element.getContext('2d');
    if (!context) return null;

    let y = 64;
    if (title) {
      context.fillStyle = 'rgba(230, 227, 220, 0.92)';
      context.font = '54px "EB Garamond", Georgia, serif';
      for (const line of wrap(context, title, width - 96, 2)) {
        context.fillText(line, 48, y);
        y += 62;
      }
      y += 26;
    }
    if (statement) {
      context.fillStyle = 'rgba(230, 227, 220, 0.66)';
      context.font = '30px "EB Garamond", Georgia, serif';
      for (const line of wrap(context, statement, width - 96, 9)) {
        context.fillText(line, 48, y);
        y += 42;
        if (y > height - 24) break;
      }
    }

    const texture = new CanvasTexture(element);
    texture.colorSpace = SRGBColorSpace;
    texture.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
    // Worth the pixels: it is read from a metre away, and it is one texture
    // for the whole show rather than one per work.
    return texture;
  }

  function wrap(
    context: CanvasRenderingContext2D,
    text: string,
    maxWidth: number,
    maxLines: number
  ): string[] {
    const lines: string[] = [];
    let line = '';
    for (const word of text.split(/\s+/)) {
      const next = line ? `${line} ${word}` : word;
      if (context.measureText(next).width > maxWidth && line) {
        lines.push(line);
        line = word;
        if (lines.length >= maxLines) return lines;
      } else {
        line = next;
      }
    }
    if (line && lines.length < maxLines) lines.push(line);
    return lines;
  }

  const wallHeight = plan.wallHeightM;
  const doorHeight = Math.min(2.6, wallHeight - 0.6);

  for (const room of plan.rooms) {
    const depth = room.depthM;
    const centreZ = (room.southZ + room.northZ) / 2;
    const halfWidth = room.widthM / 2;

    surface(room.widthM, depth, FLOOR, [room.centreX, 0, centreZ], [-Math.PI / 2, 0, 0]);
    surface(
      room.widthM,
      depth,
      CEILING,
      [room.centreX, wallHeight, centreZ],
      [Math.PI / 2, 0, 0]
    );
    surface(
      depth,
      wallHeight,
      WALL,
      [room.centreX - halfWidth, wallHeight / 2, centreZ],
      [0, Math.PI / 2, 0]
    );
    surface(
      depth,
      wallHeight,
      WALL,
      [room.centreX + halfWidth, wallHeight / 2, centreZ],
      [0, -Math.PI / 2, 0]
    );

    /*
     * A cross wall is either solid or has a doorway punched through it, and a
     * doorway is three rectangles rather than a hole: the two jambs and the
     * lintel over them. Cheaper than CSG and it gives the reveal a visitor
     * walks through an actual thickness.
     */
    const crossWall = (z: number, faceIn: number, hasDoor: boolean) => {
      const rotation: [number, number, number] =
        faceIn > 0 ? [0, 0, 0] : [0, Math.PI, 0];
      if (!hasDoor) {
        surface(room.widthM, wallHeight, FAR_WALL, [room.centreX, wallHeight / 2, z], rotation);
        return;
      }
      const jamb = (room.widthM - DOOR_WIDTH_M) / 2;
      const offset = DOOR_WIDTH_M / 2 + jamb / 2;
      surface(jamb, wallHeight, FAR_WALL, [room.centreX - offset, wallHeight / 2, z], rotation);
      surface(jamb, wallHeight, FAR_WALL, [room.centreX + offset, wallHeight / 2, z], rotation);
      surface(
        DOOR_WIDTH_M,
        wallHeight - doorHeight,
        FAR_WALL,
        [room.centreX, doorHeight + (wallHeight - doorHeight) / 2, z],
        rotation
      );
      // The reveal: a thin box in the plane of the wall, so a doorway seen
      // from an angle has an edge instead of being a cut in a sheet of paper.
      const revealGeometry = track(new BoxGeometry(DOOR_WIDTH_M, doorHeight, 0.34));
      const revealMaterial = track(new MeshBasicMaterial({ color: FLOOR, side: DoubleSide }));
      const reveal = new Mesh(revealGeometry, revealMaterial);
      reveal.position.set(room.centreX, doorHeight / 2, z);
      scene.add(reveal);
    };

    crossWall(room.northZ, 1, room.doorNorth);
    if (!room.doorSouth) crossWall(room.southZ, -1, false);
  }

  /*
   * The title and the statement go on the entrance wall, which is behind you.
   *
   * That is where a gallery puts them and it is the reason they are not a
   * banner pinned to the corner of the screen: wall text is a thing you turn
   * round and read once, not chrome that follows you through six rooms. The
   * title is also repeated in the page's own overlay, so nobody who never
   * turns round is left without the name of the show.
   */
  const firstRoom = plan.rooms[0];
  if (firstRoom && (options.title || options.statement)) {
    const width = Math.min(3.4, firstRoom.widthM - 1.6);
    const text = wallText(options.title, options.statement);
    if (text) {
      const geometry = track(new PlaneGeometry(width, width * 0.5));
      const material = track(new MeshBasicMaterial({ map: text, transparent: true }));
      const mesh = new Mesh(geometry, material);
      mesh.position.set(firstRoom.centreX, 1.62, firstRoom.southZ - 0.02);
      mesh.rotation.y = Math.PI;
      scene.add(mesh);
      disposables.push(text);
    }
  }

  // -------------------------------------------------------------------------
  // The hang
  // -------------------------------------------------------------------------

  const budget = new TextureBudget();
  const loader = new TextureLoader();
  loader.setCrossOrigin('anonymous');
  const hung: Hung[] = [];
  const pickable: THREE.Object3D[] = [];

  const prepare = (texture: THREE.Texture) => {
    texture.colorSpace = SRGBColorSpace;
    texture.minFilter = LinearMipmapLinearFilter;
    texture.magFilter = LinearFilter;
    texture.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
    texture.needsUpdate = true;
    return texture;
  };

  for (const placement of plan.placements) {
    const work = byId.get(placement.artworkId);
    if (!work) continue;

    const geometry = track(new PlaneGeometry(1, 1));
    const material = track(
      new MeshBasicMaterial({
        color: 0xffffff,
        fog: true,
        // Held back until a texture arrives, so a wall never flashes a row of
        // white rectangles at the size of a guess.
        transparent: true,
        opacity: 0,
      })
    );
    const mesh = new Mesh(geometry, material);
    mesh.position.set(placement.x, placement.y, placement.z);
    mesh.rotation.y = placement.rotationY;
    // A hair off the wall, or the two planes fight for the same depth.
    mesh.translateZ(0.02);
    mesh.scale.set(placement.widthM, placement.heightM, 1);
    mesh.userData.artworkId = placement.artworkId;
    scene.add(mesh);
    pickable.push(mesh);

    hung.push({
      placement,
      work,
      mesh,
      material,
      plate: null,
      base: null,
      near: null,
      widthM: placement.widthM,
      heightM: placement.heightM,
    });
  }

  /**
   * The size a work is finally hung at.
   *
   * A measured work is hung at what the catalogue said and the image's own
   * proportions are not consulted — if the record and the photograph disagree,
   * the record is the object. An unmeasured one is hung at the declared
   * fallback area in the picture's true aspect, which is the most that can be
   * said honestly: we know its shape, not its size.
   */
  const resize = (entry: Hung, aspect: number) => {
    if (entry.placement.measured) {
      entry.widthM = entry.placement.widthM;
      entry.heightM = entry.placement.heightM;
    } else {
      const area = entry.placement.widthM * entry.placement.heightM;
      let width = Math.sqrt(area * aspect);
      let height = area / width;
      // Never past the wall it was allotted, whatever shape turns up.
      const maxWidth = entry.placement.slotM - 0.3;
      if (width > maxWidth) {
        height *= maxWidth / width;
        width = maxWidth;
      }
      const maxHeight = wallHeight - 1.1;
      if (height > maxHeight) {
        width *= maxHeight / height;
        height = maxHeight;
      }
      entry.widthM = width;
      entry.heightM = height;
    }
    entry.mesh.scale.set(entry.widthM, entry.heightM, 1);
    entry.material.opacity = 1;
    entry.material.transparent = false;
    entry.material.needsUpdate = true;
    positionPlate(entry);
  };

  // -------------------------------------------------------------------------
  // Wall labels, printed
  // -------------------------------------------------------------------------

  /**
   * The label as a museum prints it: a small plate beside the work, unreadable
   * from across the room and legible when you are standing in front of it.
   *
   * They are made on approach and thrown away on departure, for the same
   * reason the pictures are — a canvas texture is 393 kB of video memory and
   * thirty of them is a real cost for text nobody is close enough to read.
   */
  const drawPlate = (work: SceneWork): THREE.Texture | null => {
    const surfaceCanvas = document.createElement('canvas');
    surfaceCanvas.width = PLATE_TEXTURE_WIDTH;
    surfaceCanvas.height = PLATE_TEXTURE_HEIGHT;
    const context = surfaceCanvas.getContext('2d');
    if (!context) return null;

    context.fillStyle = '#1c1c1f';
    context.fillRect(0, 0, PLATE_TEXTURE_WIDTH, PLATE_TEXTURE_HEIGHT);

    const catalogue = [work.title, work.artist, work.date].filter(Boolean).join('   ');
    context.fillStyle = 'rgba(230, 227, 220, 0.62)';
    context.font = '600 15px "IBM Plex Mono", ui-monospace, monospace';
    context.fillText(catalogue.toUpperCase().slice(0, 40), 20, 34);

    if (work.label) {
      context.fillStyle = 'rgba(230, 227, 220, 0.86)';
      context.font = '19px "EB Garamond", Georgia, serif';
      let y = 74;
      for (const line of wrap(context, work.label, PLATE_TEXTURE_WIDTH - 40, 4)) {
        context.fillText(line, 20, y);
        y += 26;
      }
    }

    const texture = new CanvasTexture(surfaceCanvas);
    texture.colorSpace = SRGBColorSpace;
    return texture;
  };

  const positionPlate = (entry: Hung) => {
    if (!entry.plate) return;
    const { placement } = entry;
    entry.plate.position.set(placement.x, placement.y, placement.z);
    entry.plate.rotation.y = placement.rotationY;
    entry.plate.translateZ(0.021);
    // Bottom right of the work, at the height a printed label is set.
    entry.plate.translateX(entry.widthM / 2 + PLATE_WIDTH_M / 2 + 0.09);
    entry.plate.translateY(-entry.heightM / 2 + PLATE_HEIGHT_M / 2);
  };

  const addPlate = (entry: Hung) => {
    if (entry.plate) return;
    const texture = drawPlate(entry.work);
    if (!texture) return;
    const bytes = textureBytes(PLATE_TEXTURE_WIDTH, PLATE_TEXTURE_HEIGHT);
    for (const id of budget.admit(`plate:${entry.work.artworkId}`, 'near', bytes)) {
      if (id.startsWith('plate:')) removePlate(id.slice(6));
    }
    const geometry = new PlaneGeometry(PLATE_WIDTH_M, PLATE_HEIGHT_M);
    const material = new MeshBasicMaterial({ map: texture, fog: true });
    entry.plate = new Mesh(geometry, material);
    positionPlate(entry);
    scene.add(entry.plate);
  };

  const removePlate = (artworkId: string) => {
    const entry = hung.find((candidate) => candidate.work.artworkId === artworkId);
    if (!entry?.plate) return;
    scene.remove(entry.plate);
    entry.plate.geometry.dispose();
    const material = entry.plate.material as THREE.MeshBasicMaterial;
    material.map?.dispose();
    material.dispose();
    entry.plate = null;
    budget.release(`plate:${artworkId}`);
  };

  // -------------------------------------------------------------------------
  // Level of detail
  // -------------------------------------------------------------------------

  const loading = new Set<string>();

  const load = (entry: Hung, width: number): Promise<THREE.Texture | null> => {
    const url = atWidth(entry.work.imageUrl, width);
    if (!url) return Promise.resolve(null);
    return new Promise((resolve) => {
      loader.load(
        url,
        (texture) => resolve(prepare(texture)),
        undefined,
        () => resolve(null)
      );
    });
  };

  const bytesOf = (texture: THREE.Texture) => {
    const image = texture.image as { width?: number; height?: number } | undefined;
    return textureBytes(image?.width ?? 0, image?.height ?? 0);
  };

  const loadBase = async (entry: Hung) => {
    const key = `base:${entry.work.artworkId}`;
    if (entry.base || loading.has(key)) return;
    loading.add(key);
    const texture = await load(entry, BASE_WIDTH);
    loading.delete(key);
    if (!texture) return;
    entry.base = texture;
    budget.admit(entry.work.artworkId, 'base', bytesOf(texture));
    const image = texture.image as { width: number; height: number };
    if (!entry.near) entry.material.map = texture;
    entry.material.needsUpdate = true;
    resize(entry, image.width / image.height);
  };

  const loadNear = async (entry: Hung) => {
    const key = `near:${entry.work.artworkId}`;
    if (entry.near || loading.has(key)) return;
    loading.add(key);
    const texture = await load(entry, NEAR_WIDTH);
    loading.delete(key);
    if (!texture) return;

    for (const id of budget.admit(entry.work.artworkId, 'near', bytesOf(texture))) {
      if (id.startsWith('plate:')) removePlate(id.slice(6));
      else downgrade(id);
    }
    entry.near = texture;
    entry.material.map = texture;
    entry.material.needsUpdate = true;
  };

  /**
   * Walking away gives the memory back.
   *
   * The base texture is still there, so the work does not go blank — it goes
   * back to being a picture on a wall across the room, which is what it is.
   */
  const downgrade = (artworkId: string) => {
    const entry = hung.find((candidate) => candidate.work.artworkId === artworkId);
    if (!entry?.near) return;
    entry.near.dispose();
    entry.near = null;
    entry.material.map = entry.base;
    entry.material.needsUpdate = true;
    if (entry.base) budget.admit(artworkId, 'base', bytesOf(entry.base));
    else budget.release(artworkId);
  };

  let focused: string | null = null;

  const reconsider = () => {
    const from = { x: camera.position.x, z: camera.position.z };
    const positions = hung.map((entry) => ({
      id: entry.work.artworkId,
      x: entry.placement.x,
      z: entry.placement.z,
    }));

    const wanted = new Set(
      nearestIds(positions, from, MAX_NEAR_TEXTURES, focused).filter((id) => {
        const entry = hung.find((candidate) => candidate.work.artworkId === id);
        if (!entry) return false;
        if (id === focused) return true;
        return (
          Math.hypot(entry.placement.x - from.x, entry.placement.z - from.z) <=
          NEAR_RADIUS_M
        );
      })
    );

    for (const entry of hung) {
      const id = entry.work.artworkId;
      if (wanted.has(id)) {
        budget.touch(id);
        void loadNear(entry);
      } else if (entry.near) {
        downgrade(id);
      }
    }

    const plateWanted = new Set(
      nearestIds(positions, from, MAX_PLATES, focused).filter((id) => {
        const entry = hung.find((candidate) => candidate.work.artworkId === id);
        return (
          entry &&
          Math.hypot(entry.placement.x - from.x, entry.placement.z - from.z) <=
            NEAR_RADIUS_M
        );
      })
    );
    for (const entry of hung) {
      const id = entry.work.artworkId;
      if (plateWanted.has(id)) {
        budget.touch(`plate:${id}`);
        addPlate(entry);
      } else if (entry.plate) {
        removePlate(id);
      }
    }
  };

  // Every work gets its small texture up front. Sixteen MiB for a thirty-work
  // show, and it is what makes a wall a wall rather than a set of holes.
  for (const entry of hung) void loadBase(entry);

  // -------------------------------------------------------------------------
  // Walking
  // -------------------------------------------------------------------------

  let yaw = 0;
  let pitch = 0;
  let standing = { x: plan.entry.x, z: plan.entry.z };

  interface Move {
    fromX: number;
    fromZ: number;
    fromY: number;
    toX: number;
    toZ: number;
    toY: number;
    fromYaw: number;
    yawDelta: number;
    fromPitch: number;
    toPitch: number;
    start: number;
    duration: number;
  }
  let move: Move | null = null;

  const glideTo = (
    x: number,
    z: number,
    y: number,
    targetYaw: number,
    targetPitch: number,
    duration: number
  ) => {
    if (reducedMotion || duration <= 0) {
      camera.position.set(x, y, z);
      yaw = targetYaw;
      pitch = targetPitch;
      move = null;
      applyLook();
      return;
    }
    move = {
      fromX: camera.position.x,
      fromZ: camera.position.z,
      fromY: camera.position.y,
      toX: x,
      toZ: z,
      toY: y,
      fromYaw: yaw,
      yawDelta: shortestAngle(yaw, targetYaw),
      fromPitch: pitch,
      toPitch: targetPitch,
      start: performance.now(),
      duration,
    };
  };

  function applyLook() {
    camera.rotation.order = 'YXZ';
    camera.rotation.y = yaw;
    camera.rotation.x = pitch;
    camera.rotation.z = 0;
  }
  applyLook();

  const walkTo = (x: number, z: number) => {
    if (!isWalkable(plan, x, z)) return;
    standing = { x, z };
    if (focused) setFocus(null, false);
    glideTo(x, z, EYE_HEIGHT_M, yaw, pitch, GLIDE_MS);
  };

  const step = (direction: 1 | -1) => {
    if (focused) {
      setFocus(null, true);
      return;
    }
    const next = stepTowards(
      plan,
      { x: camera.position.x, z: camera.position.z },
      direction > 0 ? yaw : yaw + Math.PI,
      STEP_M
    );
    standing = next;
    // A step is a step, not a glide: short enough that easing it would only
    // add latency between the key and the movement.
    camera.position.set(next.x, EYE_HEIGHT_M, next.z);
  };

  /** Turning always snaps. A swung turn is the part that makes people ill. */
  const turn = (direction: 1 | -1) => {
    yaw += TURN_RADIANS * direction;
    applyLook();
  };

  function setFocus(artworkId: string | null, animate: boolean) {
    if (artworkId === focused) return;
    focused = artworkId;
    onFocus(artworkId);

    if (!artworkId) {
      glideTo(standing.x, standing.z, EYE_HEIGHT_M, yaw, 0, animate ? FOCUS_MS : 0);
      return;
    }

    const entry = hung.find((candidate) => candidate.work.artworkId === artworkId);
    if (!entry) return;
    const distance = viewingDistance(entry.widthM, entry.heightM);
    const normal = new Vector3(
      Math.sin(entry.placement.rotationY),
      0,
      Math.cos(entry.placement.rotationY)
    );
    const x = entry.placement.x + normal.x * distance;
    const z = entry.placement.z + normal.z * distance;
    // Facing the wall is facing back down the normal.
    const targetYaw = Math.atan2(-normal.x, -normal.z);
    const eye = Math.min(EYE_HEIGHT_M, entry.placement.y);
    const targetPitch = Math.atan2(entry.placement.y - eye, distance);
    glideTo(x, z, eye, targetYaw, targetPitch, animate ? FOCUS_MS : 0);
    void loadNear(entry);
  }

  // -------------------------------------------------------------------------
  // Input
  // -------------------------------------------------------------------------

  const raycaster = new Raycaster();
  const pointer = new Vector2();
  let dragging = false;
  let dragged = false;
  let lastPointer = { x: 0, y: 0 };
  let activePointer: number | null = null;

  const onPointerDown = (event: PointerEvent) => {
    if (activePointer !== null) return;
    activePointer = event.pointerId;
    dragging = true;
    dragged = false;
    lastPointer = { x: event.clientX, y: event.clientY };
    canvas.setPointerCapture(event.pointerId);
    canvas.focus();
  };

  const onPointerMove = (event: PointerEvent) => {
    if (!dragging || event.pointerId !== activePointer) return;
    const dx = event.clientX - lastPointer.x;
    const dy = event.clientY - lastPointer.y;
    if (Math.abs(dx) + Math.abs(dy) > 4) dragged = true;
    lastPointer = { x: event.clientX, y: event.clientY };
    if (!dragged) return;
    yaw -= dx * 0.0035;
    pitch = Math.max(-0.75, Math.min(0.75, pitch - dy * 0.0032));
    move = null;
    applyLook();
  };

  const onPointerUp = (event: PointerEvent) => {
    if (event.pointerId !== activePointer) return;
    activePointer = null;
    dragging = false;
    if (canvas.hasPointerCapture(event.pointerId)) {
      canvas.releasePointerCapture(event.pointerId);
    }
    if (dragged) return;

    const rect = canvas.getBoundingClientRect();
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);

    const [picture] = raycaster.intersectObjects(pickable, false);
    if (picture) {
      setFocus(picture.object.userData.artworkId as string, true);
      return;
    }
    if (focused) {
      setFocus(null, true);
      return;
    }
    // Nothing hit means the floor: project the ray onto y = 0 and walk there.
    const direction = raycaster.ray.direction;
    if (direction.y >= -0.0001) return;
    const t = -raycaster.ray.origin.y / direction.y;
    walkTo(
      raycaster.ray.origin.x + direction.x * t,
      raycaster.ray.origin.z + direction.z * t
    );
  };

  const onKeyDown = (event: KeyboardEvent) => {
    switch (event.key) {
      case 'ArrowUp':
      case 'w':
      case 'W':
        step(1);
        break;
      case 'ArrowDown':
      case 's':
      case 'S':
        step(-1);
        break;
      case 'ArrowLeft':
      case 'a':
      case 'A':
        turn(1);
        break;
      case 'ArrowRight':
      case 'd':
      case 'D':
        turn(-1);
        break;
      case 'Escape':
        if (!focused) return;
        setFocus(null, true);
        break;
      default:
        return;
    }
    event.preventDefault();
  };

  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerUp);
  canvas.addEventListener('keydown', onKeyDown);

  // -------------------------------------------------------------------------
  // The loop
  // -------------------------------------------------------------------------

  const resize2d = () => {
    const width = canvas.clientWidth || 1;
    const height = canvas.clientHeight || 1;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  };
  resize2d();
  const observer =
    typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(resize2d);
  observer?.observe(canvas);

  let frame = 0;
  let frames = 0;
  let fpsWindow = performance.now();
  let fps = 0;
  let lastLod = 0;
  let degraded = false;
  let running = true;

  const tick = (now: number) => {
    if (!running) return;
    frame = requestAnimationFrame(tick);

    if (move) {
      const t = Math.min(1, (now - move.start) / move.duration);
      const eased = easeInOutCubic(t);
      camera.position.set(
        move.fromX + (move.toX - move.fromX) * eased,
        move.fromY + (move.toY - move.fromY) * eased,
        move.fromZ + (move.toZ - move.fromZ) * eased
      );
      yaw = move.fromYaw + move.yawDelta * eased;
      pitch = move.fromPitch + (move.toPitch - move.fromPitch) * eased;
      applyLook();
      if (t >= 1) move = null;
    }

    if (now - lastLod > LOD_INTERVAL_MS) {
      lastLod = now;
      reconsider();
    }

    renderer.render(scene, camera);

    frames += 1;
    if (now - fpsWindow >= 1000) {
      fps = (frames * 1000) / (now - fpsWindow);
      frames = 0;
      fpsWindow = now;
      /*
       * The one degradation the visitor can feel, and the honest trade: a
       * struggling device gives up resolution rather than frames, once, and
       * never climbs back — oscillating between two pixel ratios looks far
       * worse than sitting at the lower one.
       */
      if (!degraded && fps > 0 && fps < DEGRADE_BELOW_FPS && pixelRatio > 1) {
        degraded = true;
        pixelRatio = 1;
        renderer.setPixelRatio(1);
        resize2d();
      }
      onStats?.(snapshot());
    }
  };

  const snapshot = (): SceneStats => ({
    fps: Math.round(fps),
    textureBytes: budget.bytes,
    nearCount: budget.nearCount,
    rendererTextures: renderer.info.memory.textures,
    pixelRatio,
  });

  frame = requestAnimationFrame(tick);

  return {
    focus: (artworkId) => setFocus(artworkId, true),
    stats: snapshot,
    dispose: () => {
      running = false;
      cancelAnimationFrame(frame);
      observer?.disconnect();
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointercancel', onPointerUp);
      canvas.removeEventListener('keydown', onKeyDown);
      for (const entry of hung) {
        entry.base?.dispose();
        entry.near?.dispose();
        removePlate(entry.work.artworkId);
      }
      for (const item of disposables) item.dispose();
      budget.clear();
      // Without this the context survives the unmount, and a visitor toggling
      // between the page and the room a dozen times hits the browser's cap.
      renderer.dispose();
      renderer.forceContextLoss();
    },
  };
};
