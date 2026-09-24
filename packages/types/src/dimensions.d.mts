/** Centimetres, always. The room converts once, at the edge. */
export interface PhysicalSize {
  heightCm: number;
  widthCm: number;
}

/** A catalogue string read in full: what it measured, and the depth if given. */
export interface MeasuredSize extends PhysicalSize {
  depthCm: number | null;
  qualifier: string;
}

export interface DimensionColumns {
  dimensions_height: number | null;
  dimensions_width: number | null;
  dimensions_depth: number | null;
  dimensions_unit: 'cm' | null;
}

export const MIN_BELIEVABLE_CM: number;
export const MAX_BELIEVABLE_CM: number;

export function measureDimensionText(text: unknown): MeasuredSize | null;
export function parseDimensions(input: unknown): PhysicalSize | null;
export function dimensionColumns(text: unknown): DimensionColumns;
