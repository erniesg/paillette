/**
 * The room, drawn.
 *
 * Imperative and framework-free on purpose. The scene is built once from a
 * plan and then mutated by a visitor walking around it; there is no tree of
 * components whose props change, so a React reconciler for the 3D graph would
 * be paying for a diff nobody needs. It also keeps the thing that matters most
 * — every `dispose()` — in plain sight rather than behind a cache.
 *
 * Architecture is physically lit with shared `MeshStandardMaterial` surfaces:
 * plaster catches its normal map, oak catches a soft ceiling pool, and rail
 * depth makes frames read as objects. Artworks deliberately remain
 * `MeshBasicMaterial`, so the supplied image pixels retain their original
 * colour. There are no shadow maps or per-work lights on the mobile path.
 *
 * The geometry, the walkable set and the texture accounting are all in
 * `~/lib/room/*` and tested there. What is left here is the parts that need a
 * GPU: loading, disposing, and the camera.
 */

import type * as THREE from 'three';
import type { Placement, RoomPlan } from '~/lib/room/plan';
import { DOOR_WIDTH_M, fieldOfView, viewingDistance } from '~/lib/room/plan';
import {
  BASE_WIDTH,
  MAX_NEAR_TEXTURES,
  MAX_PLATES,
  PICTURE_BUDGET_BYTES,
  PLATE_BUDGET_BYTES,
  TextureBudget,
  nearWidthFor,
  nearestIds,
  textureBytes,
} from '~/lib/room/texture-budget';
import {
  EYE_HEIGHT_M,
  roomAt,
  stepTowards,
  walkTowards,
} from '~/lib/room/walkable';
import type { FrameStyle } from '~/lib/room/frame';
import { layoutPlate, PLATE_WIDTH_PX } from '~/lib/room/plate-layout';
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
  /** Fixed shared building materials; counted separately from artwork LOD. */
  architecturalTextureBytes: number;
  nearCount: number;
  /** What the renderer itself says it is holding. The cross-check. */
  rendererTextures: number;
  /** The renderer's previous frame: architectural and artwork batching check. */
  rendererDrawCalls: number;
  pixelRatio: number;
  /**
   * Which room the visitor is standing in, and how many there are.
   *
   * Published so a screenshot named `thirty-third-room` can be *asserted* to
   * be the third room rather than described as one. A named shot containing
   * something other than its name is a documented failure on this project.
   */
  roomIndex: number;
  roomCount: number;
  roomName: string | null;
  /** How far past the threshold. A doorway is not a photograph of a room. */
  metresIntoRoom: number;
}

export interface RoomSceneOptions {
  canvas: HTMLCanvasElement;
  plan: RoomPlan;
  works: SceneWork[];
  /** Painted on the entrance wall, the way a gallery sets its wall text. */
  title: string | null;
  statement: string | null;
  /** The finish around every work. This mutates in place after scene setup. */
  frame?: FrameStyle;
  reducedMotion: boolean;
  onFocus: (artworkId: string | null) => void;
  /**
   * The browser took the context away — not us.
   *
   * A GPU reset, a laptop switching graphics, an OS reclaiming memory: the
   * canvas goes black and stays black, and nothing in the scene can recover it
   * without rebuilding everything. The honest answer is the same one a device
   * that never had WebGL gets, so this hands the page back to the flat view
   * rather than leaving a visitor looking at a dead rectangle.
   */
  onContextLost?: () => void;
  onStats?: (stats: SceneStats) => void;
}

/**
 * The building takes its colour from the page it is part of.
 *
 * The exhibition page follows the app's theme, so a room painted in hardcoded
 * charcoal is a dark gallery inside a cream document — and, worse, the DOM the
 * scene shares the screen with is in the *other* theme's ink, which is how the
 * title came out pale grey on white the first time this ran. Reading
 * `--lt-ground` and shading it means dark mode is a charcoal gallery and light
 * mode is a white cube, which are the two rooms a museum actually builds.
 *
 * The shades are multipliers rather than mixes: the far wall a little lighter
 * than the sides so a corner reads without a light in the scene, the floor
 * darker than either, the ceiling darkest. In a light room the same ordering
 * with gentler steps, because a white cube's walls are nearly the same value
 * and the tonal separation has to come from the small end of the range.
 */
interface Palette {
  wall: number;
  farWall: number;
  floor: number;
  ceiling: number;
  /** The narrow value changes that make planes meet as architecture. */
  shadow: number;
  cove: number;
  ink: string;
  inkSoft: string;
  inkFaint: string;
  plate: string;
}

const readVar = (styles: CSSStyleDeclaration, name: string, fallback: string) =>
  styles.getPropertyValue(name).trim() || fallback;

const toRgb = (value: string): [number, number, number] => {
  const hex = value.match(/^#([0-9a-f]{6})$/i);
  if (hex?.[1]) {
    const n = parseInt(hex[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const rgb = value.match(/(\d+)\D+(\d+)\D+(\d+)/);
  if (rgb) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
  return [26, 26, 29];
};

const shade = ([r, g, b]: [number, number, number], factor: number) => {
  const clamp = (channel: number) =>
    Math.max(0, Math.min(255, Math.round(channel * factor)));
  return (clamp(r) << 16) | (clamp(g) << 8) | clamp(b);
};

const readPalette = (): Palette => {
  const styles = getComputedStyle(document.documentElement);
  const ground = toRgb(readVar(styles, '--lt-ground', '#1a1a1d'));
  const light = (ground[0] + ground[1] + ground[2]) / 3 > 127;
  return {
    wall: shade(ground, light ? 1.03 : 1.22),
    farWall: shade(ground, light ? 1.1 : 1.72),
    floor: shade(ground, light ? 0.9 : 0.82),
    ceiling: shade(ground, light ? 0.97 : 0.62),
    // These stay very close to their surrounding planes. They describe a
    // skirting shadow and a ceiling cove; they are never decorative colour.
    shadow: shade(ground, light ? 0.9 : 0.78),
    cove: shade(ground, light ? 0.98 : 0.92),
    ink: readVar(styles, '--ink-human', '#e6e3dc'),
    inkSoft: readVar(styles, '--ink-human-soft', 'rgba(230, 227, 220, 0.7)'),
    inkFaint: readVar(styles, '--ink-human-faint', 'rgba(230, 227, 220, 0.58)'),
    plate: readVar(styles, '--lt-slide-well', '#1e1e22'),
  };
};

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

const PLATE_WIDTH_M = 0.42;
const FRAME_RAIL_DEPTH_M = 0.045;
const ENTRANCE_YAW = 0;
const HELD_WALK_M_PER_SECOND = 2.4;
const HELD_TURN_RADIANS_PER_SECOND = 1.7;

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
  /** Artwork stays unlit so the supplied image pixels keep their source colour. */
  material: THREE.MeshBasicMaterial;
  /** Slots in the two shared dimensional frame-rail batches. */
  frameIndex: number;
  plate: THREE.Mesh | null;
  base: THREE.Texture | null;
  near: THREE.Texture | null;
  /** The size the work is hung at once its true aspect is known. */
  widthM: number;
  heightM: number;
}

export interface RoomSceneHandle {
  focus: (artworkId: string | null) => void;
  /** Changes only the backing batch, leaving the visitor's camera intact. */
  setFrame: (style: FrameStyle) => void;
  /** Repaints a visible wall label without reconstructing the room. */
  setLabel: (artworkId: string, label: string | null) => void;
  /** Held controls: left/right turn and forward/backward walk each frame. */
  setMovement: (
    direction: 'forward' | 'backward' | 'left' | 'right',
    active: boolean
  ) => void;
  /** Returns to the unfocused entrance view without rebuilding the gallery. */
  resetView: () => void;
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
    AmbientLight,
    BoxGeometry,
    CanvasTexture,
    Color,
    Fog,
    HemisphereLight,
    InstancedMesh,
    LinearFilter,
    LinearMipmapLinearFilter,
    Mesh,
    MeshBasicMaterial,
    MeshStandardMaterial,
    NoColorSpace,
    Object3D,
    PerspectiveCamera,
    PlaneGeometry,
    Raycaster,
    RepeatWrapping,
    SRGBColorSpace,
    Scene,
    SpotLight,
    TextureLoader,
    Vector2,
    Vector3,
    WebGLRenderer,
  } = THREE_NS;

  const { canvas, plan, works, reducedMotion, onFocus, onStats } = options;
  const byId = new Map(works.map((work) => [work.artworkId, work]));
  const palette = readPalette();

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
  scene.background = new Color(palette.wall);
  // A distant atmospheric fade complements the physically lit architecture.
  scene.fog = new Fog(palette.ceiling, 11, 38);

  const camera = new PerspectiveCamera(62, 1, 0.08, 90);
  camera.position.set(plan.entry.x, EYE_HEIGHT_M, plan.entry.z);

  // -------------------------------------------------------------------------
  // The building
  // -------------------------------------------------------------------------

  const disposables: { dispose: () => void }[] = [];
  /** Read by texture completions as well as the renderer teardown. */
  let disposed = false;
  const track = <T extends { dispose: () => void }>(item: T): T => {
    disposables.push(item);
    return item;
  };

  const materials = new TextureLoader();
  materials.setCrossOrigin('anonymous');
  const loadArchitectureMap = async (
    path: string,
    repeatX: number,
    repeatY: number
  ) => {
    const texture = await new Promise<THREE.Texture | null>((resolve) =>
      materials.load(path, resolve, undefined, () => resolve(null))
    );
    if (!texture || disposed) {
      texture?.dispose();
      return null;
    }
    texture.wrapS = RepeatWrapping;
    texture.wrapT = RepeatWrapping;
    texture.repeat.set(repeatX, repeatY);
    texture.colorSpace = path.includes('normal')
      ? NoColorSpace
      : SRGBColorSpace;
    texture.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
    texture.needsUpdate = true;
    disposables.push(texture);
    return texture;
  };
  const floorWidth = plan.rooms[0]?.widthM ?? 5;
  const floorDepth = plan.rooms[0]?.depthM ?? 6;
  const [oakColor, oakNormal, plasterColor, plasterNormal] = await Promise.all([
    loadArchitectureMap(
      '/room/materials/oak-color.png',
      floorWidth / 0.72,
      floorDepth / 1.2
    ),
    loadArchitectureMap(
      '/room/materials/oak-normal.png',
      floorWidth / 0.72,
      floorDepth / 1.2
    ),
    loadArchitectureMap('/room/materials/plaster-color.png', 18, 12),
    loadArchitectureMap('/room/materials/plaster-normal.png', 18, 12),
  ]);
  const architecturalTextureBytes = 4 * 512 * 512 * 4 * (4 / 3);
  const floorMaterial = track(
    new MeshStandardMaterial({
      color: 0xffffff,
      map: oakColor,
      normalMap: oakNormal,
      roughness: 0.58,
      metalness: 0,
    })
  );
  const plasterMaterial = track(
    new MeshStandardMaterial({
      color: palette.wall,
      roughnessMap: plasterColor,
      normalMap: plasterNormal,
      normalScale: new Vector2(0.025, 0.025),
      roughness: 0.92,
    })
  );
  const farWallMaterial = track(
    new MeshStandardMaterial({
      color: palette.farWall,
      roughnessMap: plasterColor,
      normalMap: plasterNormal,
      normalScale: new Vector2(0.025, 0.025),
      roughness: 0.9,
    })
  );
  const ceilingMaterial = track(
    new MeshStandardMaterial({ color: palette.ceiling, roughness: 0.94 })
  );
  const trimMaterial = track(
    new MeshStandardMaterial({ color: palette.cove, roughness: 0.72 })
  );
  const shadowMaterial = track(
    new MeshStandardMaterial({ color: palette.shadow, roughness: 0.84 })
  );
  const surfaceGeometry = track(new PlaneGeometry(1, 1));
  const trackGeometry = track(new BoxGeometry(1, 1, 1));
  const fixtureMaterial = track(
    new MeshStandardMaterial({
      color: 0x24211e,
      roughness: 0.45,
      metalness: 0.25,
    })
  );
  const surface = (
    width: number,
    height: number,
    material: THREE.Material,
    position: [number, number, number],
    rotation: [number, number, number]
  ) => {
    const mesh = new Mesh(surfaceGeometry, material);
    mesh.scale.set(width, height, 1);
    mesh.position.set(...position);
    mesh.rotation.set(...rotation);
    scene.add(mesh);
    return mesh;
  };

  scene.add(new AmbientLight(0xffffff, 1.15));
  scene.add(new HemisphereLight(0xfffaf0, 0x877566, 1.25));

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
      context.fillStyle = palette.ink;
      context.font = '54px "EB Garamond", Georgia, serif';
      for (const line of wrap(context, title, width - 96, 2)) {
        context.fillText(line, 48, y);
        y += 62;
      }
      y += 26;
    }
    if (statement) {
      context.fillStyle = palette.inkSoft;
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

    surface(
      room.widthM,
      depth,
      floorMaterial,
      [room.centreX, 0, centreZ],
      [-Math.PI / 2, 0, 0]
    );
    surface(
      room.widthM,
      depth,
      ceilingMaterial,
      [room.centreX, wallHeight, centreZ],
      [Math.PI / 2, 0, 0]
    );
    surface(
      depth,
      wallHeight,
      plasterMaterial,
      [room.centreX - halfWidth, wallHeight / 2, centreZ],
      [0, Math.PI / 2, 0]
    );
    surface(
      depth,
      wallHeight,
      plasterMaterial,
      [room.centreX + halfWidth, wallHeight / 2, centreZ],
      [0, -Math.PI / 2, 0]
    );

    /*
     * The strips do the quiet architectural work a lighting model would
     * normally do. A low shadow gap grounds plaster to floor; the cove near
     * the ceiling gives the room an edge without putting a spotlight on art.
     * They are planes instead of boxes so they keep the original scene's
     * small geometry and draw-call budget.
     */
    const sideAccent = (x: number, rotationY: number) => {
      surface(
        depth,
        0.025,
        shadowMaterial,
        [x, 0.013, centreZ],
        [0, rotationY, 0]
      );
      surface(
        depth,
        0.03,
        trimMaterial,
        [x, wallHeight - 0.015, centreZ],
        [0, rotationY, 0]
      );
    };
    sideAccent(room.centreX - halfWidth + 0.006, Math.PI / 2);
    sideAccent(room.centreX + halfWidth - 0.006, -Math.PI / 2);

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
        surface(
          room.widthM,
          wallHeight,
          farWallMaterial,
          [room.centreX, wallHeight / 2, z],
          rotation
        );
        surface(
          room.widthM,
          0.025,
          shadowMaterial,
          [room.centreX, 0.013, z + faceIn * 0.006],
          rotation
        );
        surface(
          room.widthM,
          0.03,
          trimMaterial,
          [room.centreX, wallHeight - 0.015, z + faceIn * 0.006],
          rotation
        );
        return;
      }
      const jamb = (room.widthM - DOOR_WIDTH_M) / 2;
      const offset = DOOR_WIDTH_M / 2 + jamb / 2;
      surface(
        jamb,
        wallHeight,
        farWallMaterial,
        [room.centreX - offset, wallHeight / 2, z],
        rotation
      );
      surface(
        jamb,
        wallHeight,
        farWallMaterial,
        [room.centreX + offset, wallHeight / 2, z],
        rotation
      );
      surface(
        DOOR_WIDTH_M,
        wallHeight - doorHeight,
        farWallMaterial,
        [room.centreX, doorHeight + (wallHeight - doorHeight) / 2, z],
        rotation
      );
      // A threshold and top cove give the opening a constructed edge while
      // leaving its middle entirely open to the next room.
      surface(
        room.widthM,
        0.03,
        trimMaterial,
        [room.centreX, wallHeight - 0.015, z + faceIn * 0.006],
        rotation
      );
      surface(
        DOOR_WIDTH_M,
        0.025,
        shadowMaterial,
        [room.centreX, 0.013, z + faceIn * 0.006],
        rotation
      );
      /*
       * The doorway is a hole, and it took a screenshot to notice it was not.
       *
       * There was a thin box here, meant to give the opening a reveal so it
       * read as a thickness rather than a cut in a sheet of paper. A box in a
       * doorway is a door: it filled the hole, and the enfilade rendered as a
       * far wall with a black rectangle in the middle of it. The jambs and the
       * lintel already describe the opening; what makes it read as a passage
       * is seeing the next room through it.
       */
    };

    crossWall(room.northZ, 1, room.doorNorth);
    if (!room.doorSouth) crossWall(room.southZ, -1, false);

    // A short track with two restrained pools gives plaster and frame rails
    // their relief. Shadow maps stay off: thirty artworks must remain mobile.
    for (const xOffset of [-room.widthM * 0.22, room.widthM * 0.22]) {
      const rail = new Mesh(trackGeometry, fixtureMaterial);
      rail.position.set(room.centreX + xOffset, wallHeight - 0.08, centreZ);
      rail.scale.set(0.045, 0.045, Math.min(2.2, depth * 0.42));
      scene.add(rail);
      const fixture = new Mesh(trackGeometry, fixtureMaterial);
      fixture.position.set(
        room.centreX + xOffset,
        wallHeight - 0.14,
        centreZ - 0.32
      );
      fixture.scale.set(0.16, 0.07, 0.11);
      scene.add(fixture);
      const light = new SpotLight(0xfff2dd, 6.5, 8, Math.PI / 5, 0.45, 1.5);
      light.position.set(room.centreX + xOffset, wallHeight - 0.18, centreZ);
      light.target.position.set(
        room.centreX + xOffset * 0.55,
        0.55,
        centreZ - 0.5
      );
      scene.add(light, light.target);
    }
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
      const material = track(
        new MeshBasicMaterial({ map: text, transparent: true })
      );
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

  /*
   * Two budgets, because they hold different things for different reasons.
   *
   * The pictures compete for six high-resolution slots; the label plates
   * compete for eight of their own. The fixed architectural maps reserve
   * their 512 KiB before either pool is admitted. Sharing one pool meant the plates —
   * admitted last on each pass — evicted every picture's near texture every
   * cycle, so the room settled into blurry pictures beside crisp labels and
   * the reported byte count was the plates alone. The two allowances are
   * subtracted from one stated ceiling, so `TEXTURE_BUDGET_BYTES` is still the
   * only number anybody has to hold in their head.
   */
  const budget = new TextureBudget(
    PICTURE_BUDGET_BYTES - architecturalTextureBytes,
    MAX_NEAR_TEXTURES
  );
  const plates = new TextureBudget(PLATE_BUDGET_BYTES, MAX_PLATES);
  const loader = new TextureLoader();
  loader.setCrossOrigin('anonymous');
  const hung: Hung[] = [];
  const pickable: THREE.Object3D[] = [];

  /*
   * Reveals are one opaque instanced surface, not one transparent mesh per
   * work. Every slot starts at zero scale; texture arrival replaces only its
   * matrix. The room therefore pays one draw call whether it holds one work
   * or thirty, and the reveal never enters the picking set.
   */
  const frameGeometry = track(new BoxGeometry(1, 1, 1));
  const backingMaterial = track(
    new MeshStandardMaterial({
      color: palette.cove,
      roughness: 0.54,
      metalness: 0.04,
    })
  );
  const backings = track(
    new InstancedMesh(
      frameGeometry,
      backingMaterial,
      plan.placements.length * 2
    )
  );
  const sideBackings = track(
    new InstancedMesh(
      frameGeometry,
      backingMaterial,
      plan.placements.length * 2
    )
  );
  // Instance bounds change as images arrive; one small always-visible batch
  // avoids recomputing them and is cheaper than risking a culled reveal.
  backings.frustumCulled = false;
  sideBackings.frustumCulled = false;
  const backingTransform = new Object3D();
  backingTransform.scale.set(0, 0, 0);
  backingTransform.updateMatrix();
  for (let index = 0; index < plan.placements.length; index += 1) {
    backings.setMatrixAt(index * 2, backingTransform.matrix);
    backings.setMatrixAt(index * 2 + 1, backingTransform.matrix);
    sideBackings.setMatrixAt(index * 2, backingTransform.matrix);
    sideBackings.setMatrixAt(index * 2 + 1, backingTransform.matrix);
  }
  backings.instanceMatrix.needsUpdate = true;
  sideBackings.instanceMatrix.needsUpdate = true;
  scene.add(backings);
  scene.add(sideBackings);

  /*
   * The same instanced backing batch has two jobs: its narrow default reveal
   * keeps an unframed work off plaster, while its wider variants become the
   * visible stock of a frame. Keeping this behind the artwork preserves the
   * source image exactly and means a frame can never intercept a work click.
   */
  const frameAppearance = (style: FrameStyle) => {
    switch (style) {
      case 'black':
        return { colour: 0x191816, railM: 0.04 };
      case 'white':
        return { colour: 0xf2f0eb, railM: 0.038 };
      case 'oak':
        return { colour: 0x765536, railM: 0.052 };
      case 'gilt':
        return { colour: 0xb18a39, railM: 0.07 };
      case 'none':
        return { colour: palette.cove, railM: 0 };
    }
  };
  let frameStyle: FrameStyle = options.frame ?? 'none';
  backingMaterial.color.setHex(frameAppearance(frameStyle).colour);

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
      frameIndex: hung.length,
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
  /**
   * A work with no picture is a blank plate, not a hole in the wall.
   *
   * The flat page draws `.exhibition-image-missing` — a slightly lighter
   * rectangle with a hairline — for a work whose image will not resolve, and
   * the room has to say the same thing or the two views disagree about what
   * the show contains. Without this the mesh stayed at opacity 0 forever and
   * the wall had a label plate hanging beside nothing, which reads as a bug
   * rather than as an absence.
   */
  const showMissing = (entry: Hung) => {
    if (entry.base) return;
    // `plate` is a CSS colour string, not a hex number: `set` takes both.
    entry.material.color.set(palette.plate);
    entry.material.opacity = 1;
    entry.material.transparent = false;
    entry.material.needsUpdate = true;
    revealBacking(entry);
    positionPlate(entry);
  };

  const revealBacking = (entry: Hung) => {
    const appearance = frameAppearance(frameStyle);
    backingTransform.position.set(
      entry.placement.x,
      entry.placement.y,
      entry.placement.z
    );
    backingTransform.rotation.set(0, entry.placement.rotationY, 0);
    // Four physical rails would cost four meshes per work. Two instanced box
    // pairs retain that depth and relief in just two draw calls for the show.
    backingTransform.translateZ(0.025 + FRAME_RAIL_DEPTH_M / 2);
    backingTransform.position.y += entry.heightM / 2 + appearance.railM / 2;
    backingTransform.scale.set(
      entry.widthM + appearance.railM * 2,
      appearance.railM,
      FRAME_RAIL_DEPTH_M
    );
    backingTransform.updateMatrix();
    backings.setMatrixAt(entry.frameIndex * 2, backingTransform.matrix);
    backingTransform.position.y -= entry.heightM + appearance.railM;
    backingTransform.updateMatrix();
    backings.setMatrixAt(entry.frameIndex * 2 + 1, backingTransform.matrix);
    backingTransform.position.set(
      entry.placement.x,
      entry.placement.y,
      entry.placement.z
    );
    backingTransform.rotation.set(0, entry.placement.rotationY, 0);
    backingTransform.translateZ(0.025 + FRAME_RAIL_DEPTH_M / 2);
    backingTransform.translateX(-(entry.widthM / 2 + appearance.railM / 2));
    backingTransform.scale.set(
      appearance.railM,
      entry.heightM + appearance.railM * 2,
      FRAME_RAIL_DEPTH_M
    );
    backingTransform.updateMatrix();
    sideBackings.setMatrixAt(entry.frameIndex * 2, backingTransform.matrix);
    backingTransform.position.set(
      entry.placement.x,
      entry.placement.y,
      entry.placement.z
    );
    backingTransform.rotation.set(0, entry.placement.rotationY, 0);
    backingTransform.translateZ(0.025 + FRAME_RAIL_DEPTH_M / 2);
    backingTransform.translateX(entry.widthM / 2 + appearance.railM / 2);
    backingTransform.updateMatrix();
    sideBackings.setMatrixAt(entry.frameIndex * 2 + 1, backingTransform.matrix);
    backings.instanceMatrix.needsUpdate = true;
    sideBackings.instanceMatrix.needsUpdate = true;
  };

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
    revealBacking(entry);
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
    surfaceCanvas.width = PLATE_WIDTH_PX;
    surfaceCanvas.height = 64;
    const context = surfaceCanvas.getContext('2d');
    if (!context) return null;
    const layout = layoutPlate(work, (text, font) => {
      context.font = font;
      return context.measureText(text).width;
    });
    surfaceCanvas.width = layout.widthPx;
    surfaceCanvas.height = layout.heightPx;
    const draw = surfaceCanvas.getContext('2d');
    if (!draw) return null;

    draw.fillStyle = palette.plate;
    draw.fillRect(0, 0, layout.widthPx, layout.heightPx);
    for (const line of layout.lines) {
      draw.font = line.font;
      draw.fillStyle =
        line.colorRole === 'title'
          ? palette.ink
          : line.colorRole === 'metadata'
            ? palette.inkFaint
            : palette.inkSoft;
      draw.fillText(line.text, line.x, line.y);
    }

    const texture = new CanvasTexture(surfaceCanvas);
    texture.colorSpace = SRGBColorSpace;
    return texture;
  };

  const plateHeight = (entry: Hung) =>
    (entry.plate?.userData.heightM as number | undefined) ??
    PLATE_WIDTH_M * 0.4;

  const positionPlate = (entry: Hung) => {
    if (!entry.plate) return;
    const { placement } = entry;
    entry.plate.position.set(placement.x, placement.y, placement.z);
    entry.plate.rotation.y = placement.rotationY;
    entry.plate.translateZ(0.021);
    // This begins outside the physical outer rail, including the wide gilt.
    const outerEdge = entry.widthM / 2 + frameAppearance(frameStyle).railM;
    entry.plate.translateX(outerEdge + 0.06 + PLATE_WIDTH_M / 2);
    entry.plate.translateY(-entry.heightM / 2 + plateHeight(entry) / 2);
  };

  const addPlate = (entry: Hung) => {
    if (entry.plate) return;
    const texture = drawPlate(entry.work);
    if (!texture) return;
    const image = texture.image as { width: number; height: number };
    const bytes = textureBytes(image.width, image.height);
    for (const id of plates.admit(entry.work.artworkId, 'near', bytes)) {
      removePlate(id);
    }
    const heightM = PLATE_WIDTH_M * (image.height / image.width);
    const geometry = new PlaneGeometry(PLATE_WIDTH_M, heightM);
    const material = new MeshBasicMaterial({ map: texture, fog: true });
    entry.plate = new Mesh(geometry, material);
    entry.plate.userData.heightM = heightM;
    positionPlate(entry);
    scene.add(entry.plate);
  };

  const removePlate = (artworkId: string) => {
    const entry = hung.find(
      (candidate) => candidate.work.artworkId === artworkId
    );
    if (!entry?.plate) return;
    scene.remove(entry.plate);
    entry.plate.geometry.dispose();
    const material = entry.plate.material as THREE.MeshBasicMaterial;
    material.map?.dispose();
    material.dispose();
    entry.plate = null;
    plates.release(artworkId);
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
    const image = texture.image as
      | { width?: number; height?: number }
      | undefined;
    return textureBytes(image?.width ?? 0, image?.height ?? 0);
  };

  const loadBase = async (entry: Hung) => {
    const key = `base:${entry.work.artworkId}`;
    if (entry.base || loading.has(key)) return;
    loading.add(key);
    const texture = await load(entry, BASE_WIDTH);
    loading.delete(key);
    if (!texture) {
      showMissing(entry);
      return;
    }
    /*
     * A texture that arrives after the visitor has gone is a leak.
     *
     * `dispose()` walks the works it knows about, and a load still in flight
     * is not one of them — so on a slow connection, leaving the room mid-load
     * used to hand thirty decoded textures to a scene that no longer exists
     * and never disposes them. This is the only place that can be checked,
     * because it is the only place that knows the load finished.
     */
    if (disposed) {
      texture.dispose();
      return;
    }
    entry.base = texture;
    budget.admit(entry.work.artworkId, 'base', bytesOf(texture));
    const image = texture.image as { width: number; height: number };
    if (!entry.near) entry.material.map = texture;
    entry.material.needsUpdate = true;
    resize(entry, image.width / image.height);
  };

  const loadNear = async (entry: Hung) => {
    const key = `near:${entry.work.artworkId}`;
    // Nothing is upgraded before its small texture has told us its shape, so
    // the width asked for is always the one bounded by the longer side.
    if (entry.near || !entry.base || loading.has(key)) return;
    const image = entry.base.image as { width: number; height: number };
    loading.add(key);
    const texture = await load(entry, nearWidthFor(image.width / image.height));
    loading.delete(key);
    if (!texture) return;
    if (disposed) {
      texture.dispose();
      return;
    }

    for (const id of budget.admit(
      entry.work.artworkId,
      'near',
      bytesOf(texture)
    )) {
      downgrade(id);
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
    const entry = hung.find(
      (candidate) => candidate.work.artworkId === artworkId
    );
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
        plates.touch(id);
        addPlate(entry);
      } else if (entry.plate) {
        removePlate(id);
      }
    }
  };

  // Every work gets its small texture up front. Seventeen MiB for a thirty-work
  // show, and it is what makes a wall a wall rather than a set of holes.
  for (const entry of hung) {
    if (entry.work.imageUrl) void loadBase(entry);
    else showMissing(entry);
  }

  // -------------------------------------------------------------------------
  // Walking
  // -------------------------------------------------------------------------

  let yaw = ENTRANCE_YAW;
  let pitch = 0;
  let standing = { x: plan.entry.x, z: plan.entry.z };
  /** Where the visitor was looking before a work took the camera. */
  let standingYaw = ENTRANCE_YAW;
  const held = new Set<'forward' | 'backward' | 'left' | 'right'>();

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

  /**
   * Walk towards where the visitor pointed, as far as the building allows.
   *
   * This used to refuse anything outside the walkable set, which sounded
   * careful and was close to unusable: standing at the door of a 5.5 m room,
   * every floor pixel except the bottom five per cent of the screen projects
   * *past* the far wall's standoff, so clicking the floor did nothing at all
   * and said nothing about why. Walking as far along the line as fits is both
   * what every game does and what a person means by pointing at the far end of
   * a room — go that way.
   */
  const walkTo = (x: number, z: number) => {
    const destination = walkTowards(plan, standing, { x, z });
    if (destination.x === standing.x && destination.z === standing.z) return;
    standing = destination;
    standingYaw = yaw;
    if (focused) setFocus(null, false);
    glideTo(destination.x, destination.z, EYE_HEIGHT_M, yaw, pitch, GLIDE_MS);
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
    standingYaw = yaw;
    /*
     * The step cancels whatever the camera was in the middle of.
     *
     * Without this the step writes a position and the frame loop, still
     * interpolating an earlier glide, writes over it — so a key pressed within
     * half a second of clicking the floor, or of backing out of a work, does
     * nothing at all. It looks exactly like a dropped keypress, and it is why
     * the demo path could click a picture and then walk nowhere.
     */
    move = null;
    // A step is a step, not a glide: short enough that easing it would only
    // add latency between the key and the movement.
    camera.position.set(next.x, EYE_HEIGHT_M, next.z);
    pitch = 0;
    applyLook();
  };

  /** Turning always snaps. A swung turn is the part that makes people ill. */
  const turn = (direction: 1 | -1) => {
    // Same reason as `step`: a turn during an unfinished glide is overwritten
    // by it a frame later, and reads as a key the room ignored.
    move = null;
    yaw += TURN_RADIANS * direction;
    if (!focused) standingYaw = yaw;
    applyLook();
  };

  const heldMove = (elapsedSeconds: number) => {
    if (!held.size) return;
    move = null;
    if (focused) setFocus(null, false);
    const turnDirection =
      (held.has('left') ? 1 : 0) - (held.has('right') ? 1 : 0);
    if (turnDirection)
      yaw += turnDirection * HELD_TURN_RADIANS_PER_SECOND * elapsedSeconds;
    const walkDirection =
      (held.has('forward') ? 1 : 0) - (held.has('backward') ? 1 : 0);
    if (walkDirection) {
      const next = stepTowards(
        plan,
        { x: camera.position.x, z: camera.position.z },
        walkDirection > 0 ? yaw : yaw + Math.PI,
        HELD_WALK_M_PER_SECOND * elapsedSeconds
      );
      standing = next;
      camera.position.set(next.x, EYE_HEIGHT_M, next.z);
      standingYaw = yaw;
    }
    pitch = 0;
    applyLook();
  };

  function setFocus(artworkId: string | null, animate: boolean) {
    if (artworkId === focused) return;
    focused = artworkId;
    onFocus(artworkId);

    /*
     * Backing out of a work leaves you standing in front of it.
     *
     * The first version treated focusing as an excursion and returned the
     * visitor to wherever they had been — so clicking a picture at the far end
     * of a room and then closing the label teleported them back to the door,
     * undoing travel they had asked for. In a gallery you walk over to a
     * picture and you are then *there*; leaning back does not put you across
     * the room again. So focusing sets where the visitor is standing, and
     * exiting returns to that rather than to the past.
     *
     * Which also fixed the more confusing half: the room the scene reported
     * standing in changed while a work was focused and changed back when it
     * was closed, so anything reading the position saw the visitor in two
     * places within a second.
     */
    if (!artworkId) {
      glideTo(
        standing.x,
        standing.z,
        EYE_HEIGHT_M,
        standingYaw,
        0,
        animate ? FOCUS_MS : 0
      );
      return;
    }

    const entry = hung.find(
      (candidate) => candidate.work.artworkId === artworkId
    );
    if (!entry) return;
    const distance = viewingDistance(
      entry.widthM,
      entry.heightM,
      (camera.fov * Math.PI) / 180,
      camera.aspect
    );
    const normal = new Vector3(
      Math.sin(entry.placement.rotationY),
      0,
      Math.cos(entry.placement.rotationY)
    );
    const x = entry.placement.x + normal.x * distance;
    const z = entry.placement.z + normal.z * distance;
    /*
     * Facing the wall means looking back down the picture's own normal.
     *
     * This was `atan2(-normal.x, -normal.z)` and it turned the visitor around:
     * a camera's forward vector at yaw *y* is `(-sin y, 0, -cos y)`, so the
     * yaw that points it along `-normal` is `atan2(normal.x, normal.z)`, not
     * the negation of it. Clicking a picture walked you to exactly the right
     * spot in front of it and then had you admire the opposite wall — which
     * looked, in a screenshot, almost like a nice shot of the wall text.
     */
    const targetYaw = Math.atan2(normal.x, normal.z);
    const eye = Math.min(EYE_HEIGHT_M, entry.placement.y);
    const targetPitch = Math.atan2(entry.placement.y - eye, distance);
    /*
     * The camera may end up a little inside the wall standoff — a small work
     * is looked at from closer than the room otherwise lets you stand — so
     * where the visitor is left *standing* is the last legal point on the way
     * there, and the lean-in is the difference between the two.
     */
    standing = walkTowards(plan, standing, { x, z });
    standingYaw = targetYaw;
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
    // Looking around deliberately is the heading you keep; looking around
    // because a work took the camera is not.
    if (!focused) standingYaw = yaw;
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

  /*
   * A context we did not throw away.
   *
   * `forceContextLoss()` in `dispose` fires this too, which is why it checks
   * `disposed` first — the teardown path has already told React what it needs
   * to know, and reporting a loss there would bounce a visitor who simply
   * clicked PAGE back to the page they had just asked for.
   */
  const onContextLost = (event: Event) => {
    event.preventDefault();
    if (disposed) return;
    options.onContextLost?.();
  };
  canvas.addEventListener('webglcontextlost', onContextLost);

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
    // A phone held upright needs a wider vertical field or it sees a keyhole.
    camera.fov = (fieldOfView(camera.aspect) * 180) / Math.PI;
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
  const settleAt = performance.now() + 4000;
  let running = true;
  let lastTick = performance.now();

  const tick = (now: number) => {
    if (!running) return;
    frame = requestAnimationFrame(tick);
    const elapsedSeconds = Math.min(0.05, Math.max(0, (now - lastTick) / 1000));
    lastTick = now;

    heldMove(elapsedSeconds);

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
      // Published here rather than once a second with the frame rate, because
      // the position in it goes stale between ticks and anything reading it to
      // decide where the visitor is standing walks straight past the answer.
      onStats?.(snapshot());
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
      if (
        !degraded &&
        now >= settleAt &&
        fps > 0 &&
        fps < DEGRADE_BELOW_FPS &&
        pixelRatio > 1.5
      ) {
        degraded = true;
        pixelRatio = Math.max(1.5, pixelRatio - 0.5);
        renderer.setPixelRatio(pixelRatio);
        resize2d();
      }
    }
  };

  const snapshot = (): SceneStats => {
    const roomIndex = roomAt(plan, camera.position.z);
    return {
      fps: Math.round(fps),
      textureBytes: budget.bytes + plates.bytes + architecturalTextureBytes,
      architecturalTextureBytes,
      nearCount: budget.nearCount,
      rendererTextures: renderer.info.memory.textures,
      rendererDrawCalls: renderer.info.render.calls,
      pixelRatio,
      roomIndex,
      roomCount: plan.rooms.length,
      roomName: plan.rooms[roomIndex]?.name ?? null,
      metresIntoRoom: (plan.rooms[roomIndex]?.southZ ?? 0) - camera.position.z,
    };
  };

  frame = requestAnimationFrame(tick);

  return {
    focus: (artworkId) => setFocus(artworkId, true),
    setFrame: (style) => {
      if (style === frameStyle) return;
      frameStyle = style;
      backingMaterial.color.setHex(frameAppearance(style).colour);
      for (const entry of hung) revealBacking(entry);
      backingMaterial.needsUpdate = true;
    },
    setLabel: (artworkId, label) => {
      const entry = hung.find(
        (candidate) => candidate.work.artworkId === artworkId
      );
      if (!entry || entry.work.label === label) return;
      entry.work.label = label;
      if (entry.plate) {
        removePlate(artworkId);
        addPlate(entry);
      }
    },
    setMovement: (direction, active) => {
      if (active) held.add(direction);
      else held.delete(direction);
    },
    resetView: () => {
      held.clear();
      focused = null;
      onFocus(null);
      standing = { x: plan.entry.x, z: plan.entry.z };
      standingYaw = ENTRANCE_YAW;
      glideTo(plan.entry.x, plan.entry.z, EYE_HEIGHT_M, ENTRANCE_YAW, 0, 0);
    },
    stats: snapshot,
    dispose: () => {
      disposed = true;
      running = false;
      held.clear();
      cancelAnimationFrame(frame);
      observer?.disconnect();
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointercancel', onPointerUp);
      canvas.removeEventListener('keydown', onKeyDown);
      canvas.removeEventListener('webglcontextlost', onContextLost);
      for (const entry of hung) {
        entry.base?.dispose();
        entry.near?.dispose();
        removePlate(entry.work.artworkId);
      }
      for (const item of disposables) item.dispose();
      budget.clear();
      plates.clear();
      // Without this the context survives the unmount, and a visitor toggling
      // between the page and the room a dozen times hits the browser's cap.
      renderer.dispose();
      renderer.forceContextLoss();
    },
  };
};
