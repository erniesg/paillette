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

/** Floor to ceiling. Galleries are tall; a 2.4 m ceiling reads as an office. */
export const MIN_WALL_HEIGHT_M = 3.8;

/** How far a visitor is set back from the wall when a work is focused. */
export const VIEWING_DISTANCE_FACTOR = 1.6;
export const MIN_VIEWING_DISTANCE_M = 1.6;

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
 */
const layOut = (widths: number[]): { runM: number; offsets: number[] } => {
  const slots = widths.map(slotFor);
  const runM = slots.reduce((total, slot) => total + slot, 0);
  const offsets: number[] = [];
  let cursor = -runM / 2;
  for (const slot of slots) {
    offsets.push(cursor + slot / 2);
    cursor += slot;
  }
  return { runM, offsets };
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

  const rooms: RoomShape[] = [];
  const placements: Placement[] = [];
  let tallest = 0;
  let southZ = 0;

  groups.forEach((group, roomIndex) => {
    const terminal = roomIndex === groups.length - 1;
    const { west, north, east } = allocateWalls(group.works.length, terminal);

    // The route: up the left wall, across the far wall, back down the right.
    const westWorks = group.works.slice(0, west);
    const northWorks = group.works.slice(west, west + north);
    const eastWorks = group.works.slice(west + north, west + north + east);

    const sizes = group.works.map((entry) => sizeOf(entry.work));
    for (const size of sizes) tallest = Math.max(tallest, size.heightM);

    const westRun = layOut(westWorks.map((entry) => sizeOf(entry.work).widthM));
    const eastRun = layOut(eastWorks.map((entry) => sizeOf(entry.work).widthM));

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
    const northLeftRun = layOut(northLeft.map((entry) => sizeOf(entry.work).widthM));
    const northRightRun = layOut(northRight.map((entry) => sizeOf(entry.work).widthM));

    const northNeed = doorNorth
      ? Math.max(northLeftRun.runM, northRightRun.runM) * 2 + DOOR_WIDTH_M
      : northLeftRun.runM;

    const widthM = Math.max(MIN_ROOM_WIDTH_M, northNeed + CORNER_M * 2);
    const depthM = Math.max(
      MIN_ROOM_DEPTH_M,
      westRun.runM + CORNER_M * 2,
      eastRun.runM + CORNER_M * 2
    );

    const centreX = 0;
    const northZ = southZ - depthM;

    rooms.push({
      index: roomIndex,
      name: group.name,
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
    westWorks.forEach((entry, position) => {
      const slotM = slotFor(sizeOf(entry.work).widthM);
      push(
        entry,
        'west',
        centreX - widthM / 2,
        centreZ - westRun.offsets[position],
        Math.PI / 2,
        slotM
      );
    });

    const hangNorth = (
      run: { runM: number; offsets: number[] },
      entries: typeof northWorks,
      flankCentre: number
    ) => {
      entries.forEach((entry, position) => {
        const slotM = slotFor(sizeOf(entry.work).widthM);
        push(entry, 'north', flankCentre + run.offsets[position], northZ, 0, slotM);
      });
    };

    if (doorNorth) {
      const flank = (widthM - DOOR_WIDTH_M) / 4 + DOOR_WIDTH_M / 4;
      hangNorth(northLeftRun, northLeft, centreX - flank);
      hangNorth(northRightRun, northRight, centreX + flank);
    } else {
      hangNorth(northLeftRun, northLeft, centreX);
    }

    // East wall: hung north to south, walked on the way back out.
    eastWorks.forEach((entry, position) => {
      const slotM = slotFor(sizeOf(entry.work).widthM);
      push(
        entry,
        'east',
        centreX + widthM / 2,
        centreZ + eastRun.offsets[position],
        -Math.PI / 2,
        slotM
      );
    });

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

/** How far back you have to stand for a work to fill the view. */
export const viewingDistance = (widthM: number, heightM: number): number =>
  Math.max(
    MIN_VIEWING_DISTANCE_M,
    Math.max(widthM, heightM) * VIEWING_DISTANCE_FACTOR
  );
