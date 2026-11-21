import { sql, type SQL } from 'drizzle-orm';

import { leads } from '@/db/schema';

import type { Point } from './geo';

/**
 * Live straight-line miles from `home` to each lead, in SQL (same formula as `haversineMiles`),
 * rounded to 0.1. Use this instead of the stored `distance_miles`, which is measured from the
 * home that was set when the lead was found and goes stale when home moves.
 * Falls back to the stored value when no home is set.
 */
export function milesFromHome(home: Point | null): SQL<number> {
  if (!home) return sql<number>`${leads.distanceMiles}`.mapWith(Number);
  return sql<number>`round((2 * 3958.8 * asin(least(1, sqrt(
    power(sin(radians(${leads.lat} - ${home.lat}::float8) / 2), 2)
    + cos(radians(${home.lat}::float8)) * cos(radians(${leads.lat}))
      * power(sin(radians(${leads.lng} - ${home.lng}::float8) / 2), 2)
  ))))::numeric, 1)::float8`.mapWith(Number);
}

export function homePoint(settings: { homeLat: number | null; homeLng: number | null }): Point | null {
  return settings.homeLat != null && settings.homeLng != null
    ? { lat: settings.homeLat, lng: settings.homeLng }
    : null;
}
