export type NgaDateRange = Readonly<{
  startYear: number;
  endYear: number;
}>;

export function deriveNgaDisplayDateRange(
  value: unknown
): NgaDateRange | null;
