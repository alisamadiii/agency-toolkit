export type Point = { lat: number; lng: number };

const EARTH_RADIUS_MILES = 3958.8;
const MILES_PER_DEG_LAT = 69.0;

const toRad = (deg: number) => (deg * Math.PI) / 180;

export function haversineMiles(a: Point, b: Point): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_MILES * Math.asin(Math.min(1, Math.sqrt(h)));
}

export const milesToMeters = (miles: number) => miles * 1609.344;

// Square grid of points `spacingMiles` apart, clipped to the circle around
// `home`. Coordinates are rounded so reseeding with the same input is stable.
export function seedGrid(home: Point, radiusMiles: number, spacingMiles = 3): Point[] {
  const steps = Math.floor(radiusMiles / spacingMiles);
  const latStep = spacingMiles / MILES_PER_DEG_LAT;
  const lngStep = spacingMiles / (MILES_PER_DEG_LAT * Math.cos(toRad(home.lat)));
  const points: Point[] = [];

  for (let i = -steps; i <= steps; i++) {
    for (let j = -steps; j <= steps; j++) {
      const point = {
        lat: round(home.lat + i * latStep),
        lng: round(home.lng + j * lngStep),
      };
      if (haversineMiles(home, point) <= radiusMiles) points.push(point);
    }
  }
  return points;
}

const round = (n: number) => Math.round(n * 1e5) / 1e5;
