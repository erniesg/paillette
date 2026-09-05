/**
 * The room, derived from the show rather than chosen from a menu.
 *
 * Nothing here knows about WebGL. It is arithmetic over an exhibition — the
 * count, the order, the named regions and whatever physical sizes survived
 * `parseDimensions` — and it produces walls and hanging positions in metres.
 * Keeping it separate is what makes the architecture testable at all: a
 * geometry bug inside a render loop is something you squint at, and a geometry
 * bug in a pure function is a failing assertion.
 *
 * Three decisions carry most of the result:
 *
 *  - **`order` is the route.** Works are hung in the sequence the curation
 *    settled on, walked the way a visitor walks a gallery: in on the south
 *    side, turn left, up the west wall, across the far wall, back down the
 *    east. The last work on the east wall is the one nearest the door you came
 *    in by, which is where a hang puts the work you leave on.
 *  - **`regions` are rooms.** When the show names its groups, the walls follow
 *    the names, and the architecture carries the argument instead of
 *    decorating it. With no regions the show is chunked by count.
 *  - **Count decides scale.** A room is exactly as large as the works hung in
 *    it need it to be, floored at something that still reads as a room.
 *
 * The numbers are museum numbers, not invented ones: works want roughly
 * 1.5–2.5 m of wall each and hang to a centre line about 145 cm off the floor.
 * Real constraints produce rooms that feel right without anyone knowing why.
 */

/** Where the centre of a picture sits above the floor. Museum convention. */
export const CENTRE_LINE_M = 1.45;

/** The least wall a work is given, however small the work is. */
export const MIN_SLOT_M = 1.5;

/** Breathing space added either side of a work's own width. */
export const SLOT_MARGIN_M = 0.9;

/** Wall left clear at each end of a run, so nothing is hung into a corner. */
export const CORNER_M = 0.8;

/** A doorway between rooms, centred in the wall it pierces. */
export const DOOR_WIDTH_M = 1.6;

/**
 * The size an unmeasured work is hung at.
 *
 * One constant for every work whose dimensions did not parse, which means the
 * fallback is *visible*: a wall of identically sized pictures is legible as a
 * wall of works nobody recorded the size of. Per-work guesses — scaling by
 * pixel dimensions, say — would produce a tidier wall that quietly asserted
 * facts the catalogue never had.
 */
export const DEFAULT_WORK_AREA_M2 = 0.42;

/** Beyond this a single room stops reading as a room and becomes a corridor. */
export const MAX_WORKS_PER_ROOM = 12;

export const MIN_ROOM_WIDTH_M = 5;
export const MIN_ROOM_DEPTH_M = 5.5;

/**
 * Floor to ceiling.
 *
 * A 2.4 m ceiling reads as an office, and 3.8 — where this started — reads as
 * an atrium once the works are prints: two metres of empty wall above a 65 cm
 * etching is a room that looks like it lost something. 3.2 m is a real print
 * gallery, and anything hung large pushes it up from here anyway.
 */
export const MIN_WALL_HEIGHT_M = 3.2;

/** The room's vertical field of view on a landscape screen, in radians. */
export const BASE_FIELD_OF_VIEW = (62 * Math.PI) / 180;

/**
 * A portrait screen needs a different field, and forgetting that is visible.
 *
 * A camera's field of view is *vertical*, so 62° on a phone held upright is a
 * horizontal field of about 31° — a keyhole. You see acres of wall above and
 * below and almost nothing to either side, which on the first phone screenshot
 * read as a room with nothing in it. So a tall viewport widens the vertical
 * field until the horizontal one is at least usable, and stops before the
 * distortion of a very wide lens takes over.
 */
export const MIN_HORIZONTAL_FOV = (46 * Math.PI) / 180;
export const MAX_VERTICAL_FOV = (80 * Math.PI) / 180;

export const fieldOfView = (aspect: number): number => {
  if (aspect >= 1) return BASE_FIELD_OF_VIEW;
  const wanted = 2 * Math.atan(Math.tan(MIN_HORIZONTAL_FOV / 2) / aspect);
  return Math.min(MAX_VERTICAL_FOV, Math.max(BASE_FIELD_OF_VIEW, wanted));
};

/** Never closer than this, whatever the arithmetic says. */
export const MIN_VIEWING_DISTANCE_M = 0.95;

/** How much of the frame a focused work is meant to take up. */
export const FOCUS_FILL = 0.72;

export interface RoomWorkInput {
  artworkId: string;
  /** Metres, and only when the catalogue actually said so. */
  size: { widthM: number; heightM: number } | null;
}

export interface RoomRegionInput {
  label: string;
  artworkIds: string[];
}

export type WallSide = 'west' | 'north' | 'east';

export interface Placement {
  artworkId: string;
  /** Position in the exhibition's order, which is also the walking order. */
  index: number;
  roomIndex: number;
  side: WallSide;
  /** World position of the centre of the picture. */
  x: number;
  y: number;
  z: number;
  /** Rotation about Y that turns the picture to face into the room. */
  rotationY: number;
  widthM: number;
  heightM: number;
  /** False when the size is the declared fallback rather than a record. */
  measured: boolean;
  /**
   * The wall this work owns. A picture whose true aspect arrives late — from
   * the texture, after the plan is built — is widened into this and no
   * further, so a surprise panorama cannot overlap its neighbour.
   */
  slotM: number;
}

export interface RoomShape {
  index: number;
  /** The region's name, when a region made this room. */
  name: string | null;
  widthM: number;
  depthM: number;
  centreX: number;
  /** The wall you come in by. Larger z than `northZ`; the visitor faces -z. */
  southZ: number;
  /** The far wall. */
  northZ: number;
  doorSouth: boolean;
  doorNorth: boolean;
}

export interface RoomPlan {
  rooms: RoomShape[];
  placements: Placement[];
  wallHeightM: number;
  /** Where the visitor is standing when the room opens. */
  entry: { x: number; z: number };
  /** How many placements are hung at a size the catalogue actually recorded. */
  measuredCount: number;
}

const DEFAULT_SIDE_M = Math.sqrt(DEFAULT_WORK_AREA_M2);

const slotFor = (widthM: number) => Math.max(MIN_SLOT_M, widthM + SLOT_MARGIN_M);

/**
 * A wall's worth of works: how much wall they need, and where each centre
 * lands along it once the whole run is centred on the wall.
 *
 * The offset is carried back attached to its work rather than in a parallel
 * array indexed alongside it. Two arrays that have to stay the same length is
 * an invariant nobody can see; this way there is nothing to keep in step.
 */
interface Placed<T> {
  entry: T;
  offset: number;
  slotM: number;
}

const layOut = <T>(
  entries: T[],
  widthOf: (entry: T) => number
): { runM: number; placed: Placed<T>[] } => {
  const slots = entries.map((entry) => slotFor(widthOf(entry)));
  const runM = slots.reduce((total, slot) => total + slot, 0);
  const placed: Placed<T>[] = [];
  let cursor = -runM / 2;
  entries.forEach((entry, index) => {
    const slotM = slots[index] ?? MIN_SLOT_M;
    placed.push({ entry, offset: cursor + slotM / 2, slotM });
    cursor += slotM;
  });
  return { runM, placed };
};

/**
 * Which wall each work goes on.
 *
 * Three or fewer in the room you end in means one wall — the one you are
 * facing when you walk in. Anything more is spread across three, north
 * favoured, because the far wall is the one the room is pointing at.
 */
export const allocateWalls = (
  count: number,
  terminal: boolean
): { west: number; north: number; east: number } => {
  if (count <= 0) return { west: 0, north: 0, east: 0 };
  if (terminal && count <= 3) return { west: 0, north: count, east: 0 };

  const base = Math.floor(count / 3);
  let remainder = count % 3;
  let north = base;
  let west = base;
  const east = base;
  if (remainder > 0) {
    north += 1;
    remainder -= 1;
  }
  if (remainder > 0) {
    west += 1;
  }
  return { west, north, east };
};

/** Contiguous chunks, as even as they go, order preserved. */
export const chunkWorks = <T>(works: T[], maxPerChunk: number): T[][] => {
  if (!works.length) return [];
  const chunks = Math.max(1, Math.ceil(works.length / maxPerChunk));
  const out: T[][] = [];
  let cursor = 0;
  for (let index = 0; index < chunks; index += 1) {
    const size = Math.ceil((works.length - cursor) / (chunks - index));
    out.push(works.slice(cursor, cursor + size));
    cursor += size;
  }
  return out;
};

interface Group {
  name: string | null;
  works: { work: RoomWorkInput; index: number }[];
}

/**
 * Regions become rooms, in the order the regions were named; everything they
 * did not claim becomes one more room at the end.
 *
 * A work named by two regions belongs to the first that claimed it — the
 * alternative is hanging the same picture twice, which is a lie about the
 * show. A region larger than a room splits into several rooms under the same
 * name, which is what an institution does too.
 */
export const groupWorks = (
  works: RoomWorkInput[],
  regions: RoomRegionInput[] | undefined
): Group[] => {
  const indexed = works.map((work, index) => ({ work, index }));

  if (!regions?.length) {
    return chunkWorks(indexed, MAX_WORKS_PER_ROOM).map((chunk) => ({
      name: null,
      works: chunk,
    }));
  }

  const byId = new Map(indexed.map((entry) => [entry.work.artworkId, entry]));
  const claimed = new Set<string>();
  const groups: Group[] = [];

  for (const region of regions) {
    const members: { work: RoomWorkInput; index: number }[] = [];
    for (const artworkId of region.artworkIds) {
      const entry = byId.get(artworkId);
      if (!entry || claimed.has(artworkId)) continue;
      claimed.add(artworkId);
      members.push(entry);
    }
    if (!members.length) continue;
    // Within a region the show's own order still decides the walk.
    members.sort((a, b) => a.index - b.index);
    for (const chunk of chunkWorks(members, MAX_WORKS_PER_ROOM)) {
      groups.push({ name: region.label, works: chunk });
    }
  }

  const rest = indexed.filter((entry) => !claimed.has(entry.work.artworkId));
  for (const chunk of chunkWorks(rest, MAX_WORKS_PER_ROOM)) {
    groups.push({ name: null, works: chunk });
  }

  return groups;
};

const sizeOf = (work: RoomWorkInput) =>
  work.size ?? { widthM: DEFAULT_SIDE_M, heightM: DEFAULT_SIDE_M };

export const planRoom = (
  works: RoomWorkInput[],
  regions?: RoomRegionInput[]
): RoomPlan => {
  const groups = groupWorks(works, regions);

  type Run = { runM: number; placed: Placed<Group['works'][number]>[] };

  interface Draft {
    terminal: boolean;
    westRun: Run;
    eastRun: Run;
    northLeftRun: Run;
    northRightRun: Run;
    doorNorth: boolean;
    widthNeed: number;
    depthM: number;
  }

  let tallest = 0;

  const drafts: Draft[] = groups.map((group, roomIndex) => {
    const terminal = roomIndex === groups.length - 1;
    const { west, north, east } = allocateWalls(group.works.length, terminal);

    // The route: up the left wall, across the far wall, back down the right.
    const westWorks = group.works.slice(0, west);
    const northWorks = group.works.slice(west, west + north);
    const eastWorks = group.works.slice(west + north, west + north + east);

    for (const entry of group.works) {
      tallest = Math.max(tallest, sizeOf(entry.work).heightM);
    }

    /*
     * The far wall of a room you walk through has a hole in it, and works
     * cannot be hung across a doorway. So a through-room's north run is split
     * in two and each half is centred on its own flank; a terminal room hangs
     * one uninterrupted run.
     */
    const doorNorth = !terminal;
    const northLeft = doorNorth
      ? northWorks.slice(0, Math.ceil(northWorks.length / 2))
      : northWorks;
    const northRight = doorNorth
      ? northWorks.slice(Math.ceil(northWorks.length / 2))
      : [];

    const wallWidth = (entry: Group['works'][number]) => sizeOf(entry.work).widthM;
    const westRun = layOut(westWorks, wallWidth);
    const eastRun = layOut(eastWorks, wallWidth);
    const northLeftRun = layOut(northLeft, wallWidth);
    const northRightRun = layOut(northRight, wallWidth);

    const northNeed = doorNorth
      ? Math.max(northLeftRun.runM, northRightRun.runM) * 2 + DOOR_WIDTH_M
      : northLeftRun.runM;

    return {
      terminal,
      westRun,
      eastRun,
      northLeftRun,
      northRightRun,
      doorNorth,
      widthNeed: northNeed + CORNER_M * 2,
      depthM: Math.max(
        MIN_ROOM_DEPTH_M,
        westRun.runM + CORNER_M * 2,
        eastRun.runM + CORNER_M * 2
      ),
    };
  });

  /*
   * One width for the whole enfilade, taken from the room that needs the most.
   *
   * Rooms of differing widths would leave a step in the side walls at every
   * threshold — a seam where one room is narrower than the one behind it and
   * you can see out through the gap. Depth still varies room by room, which is
   * where the variation reads anyway: you feel a long room as long.
   */
  const widthM = drafts.reduce(
    (widest, draft) => Math.max(widest, draft.widthNeed),
    MIN_ROOM_WIDTH_M
  );

  const rooms: RoomShape[] = [];
  const placements: Placement[] = [];
  let southZ = 0;

  drafts.forEach((draft, roomIndex) => {
    const { westRun, eastRun, northLeftRun, northRightRun, doorNorth, depthM } =
      draft;

    const centreX = 0;
    const northZ = southZ - depthM;

    rooms.push({
      index: roomIndex,
      name: groups[roomIndex]?.name ?? null,
      widthM,
      depthM,
      centreX,
      southZ,
      northZ,
      doorSouth: roomIndex > 0,
      doorNorth,
    });

    const centreZ = (southZ + northZ) / 2;
    const push = (
      entry: { work: RoomWorkInput; index: number },
      side: WallSide,
      x: number,
      z: number,
      rotationY: number,
      slotM: number
    ) => {
      const size = sizeOf(entry.work);
      placements.push({
        artworkId: entry.work.artworkId,
        index: entry.index,
        roomIndex,
        side,
        x,
        y: hangHeight(size.heightM),
        z,
        rotationY,
        widthM: size.widthM,
        heightM: size.heightM,
        measured: entry.work.size !== null,
        slotM,
      });
    };

    // West wall: hung south to north, because that is the way you walk it.
    for (const { entry, offset, slotM } of westRun.placed) {
      push(entry, 'west', centreX - widthM / 2, centreZ - offset, Math.PI / 2, slotM);
    }

    const hangNorth = (run: Run, flankCentre: number) => {
      for (const { entry, offset, slotM } of run.placed) {
        push(entry, 'north', flankCentre + offset, northZ, 0, slotM);
      }
    };

    if (doorNorth) {
      const flank = (widthM - DOOR_WIDTH_M) / 4 + DOOR_WIDTH_M / 4;
      hangNorth(northLeftRun, centreX - flank);
      hangNorth(northRightRun, centreX + flank);
    } else {
      hangNorth(northLeftRun, centreX);
    }

    // East wall: hung north to south, walked on the way back out.
    for (const { entry, offset, slotM } of eastRun.placed) {
      push(entry, 'east', centreX + widthM / 2, centreZ + offset, -Math.PI / 2, slotM);
    }

    southZ = northZ;
  });

  const wallHeightM = Math.max(MIN_WALL_HEIGHT_M, tallest + CENTRE_LINE_M + 1);
  const first = rooms[0];

  return {
    rooms,
    placements,
    wallHeightM,
    entry: {
      x: first ? first.centreX : 0,
      // Just inside the door, facing the length of the show.
      z: first ? first.southZ - 1.4 : -1.4,
    },
    measuredCount: placements.filter((placement) => placement.measured).length,
  };
};

/**
 * Where the centre of a work sits.
 *
 * 145 cm is the centre line, but a work taller than 2.6 m would have its
 * bottom edge below the floor at that height, so anything large is raised
 * until it clears — which is what a gallery does with a history painting too.
 */
export function hangHeight(heightM: number): number {
  return Math.max(CENTRE_LINE_M, heightM / 2 + 0.15);
}

/**
 * How far back to stand for a work to fill the view — on *this* screen.
 *
 * Derived from the camera rather than from a rule of thumb, because the beat
 * is "it fills the view" and a fixed multiple of the work's size fills a
 * different fraction of a phone than of a laptop. Whichever of the two
 * dimensions binds decides, so a panorama is framed by its width and an
 * altarpiece by its height.
 *
 * This is the one place the room deliberately does *not* preserve real scale.
 * A print and a history painting arrive at the same size on screen when they
 * are being looked at, because what the focused view is for is the label and
 * the surface; the size is what the room itself already said, on the way in.
 */
export const viewingDistance = (
  widthM: number,
  heightM: number,
  verticalFov: number,
  aspect: number
): number => {
  const halfTan = Math.tan(verticalFov / 2);
  return Math.max(
    MIN_VIEWING_DISTANCE_M,
    heightM / (2 * halfTan * FOCUS_FILL),
    widthM / (2 * halfTan * aspect * FOCUS_FILL)
  );
};
