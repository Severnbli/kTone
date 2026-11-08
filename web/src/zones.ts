export type Zone = 'green' | 'yellow' | 'red';

export interface ZoneThresholds {
  /** Max |cents| for the green zone (inclusive). */
  green: number;
  /** Max |cents| for the yellow zone (inclusive). */
  yellow: number;
}

export function classifyCents(cents: number, t: ZoneThresholds): Zone {
  const a = Math.abs(cents);
  if (a <= t.green) return 'green';
  if (a <= t.yellow) return 'yellow';
  return 'red';
}

/** The gauge shows ±GAUGE_RANGE cents. */
export const GAUGE_RANGE = 50;

/** Needle position in percent of the gauge width for a deviation in cents. */
export function needlePercent(cents: number): number {
  const c = Math.max(-GAUGE_RANGE, Math.min(GAUGE_RANGE, cents));
  return 50 + (c / GAUGE_RANGE) * 50;
}

export const ZONE_COLORS: Record<Zone, string> = {
  green: '#22a559',
  yellow: '#e0a800',
  red: '#e5484d',
};
