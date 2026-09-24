/**
 * How big the thing actually is — the room's name for the shared parser.
 *
 * The grammar lives in `@paillette/types/dimensions` because the ingest reads
 * the same catalogue strings into the `artworks` columns, and a room that
 * parsed them differently from the database would hang a work at one size
 * while search reported another. This file stays so the room keeps one local
 * import, and so the room's tests pin the behaviour the room depends on.
 *
 * Two input shapes reach it. The API returns a structured
 * `{ height, width, unit }` on every artwork, filled from those columns; the
 * string path is for a record that carries only the catalogue text. See
 * `docs/night/room-scale-report.md` for how much of the NGA set parses.
 */
export {
  MAX_BELIEVABLE_CM,
  MIN_BELIEVABLE_CM,
  measureDimensionText,
  parseDimensions,
  type MeasuredSize,
  type PhysicalSize,
} from '@paillette/types/dimensions';
