import { describe, expect, it } from 'vitest';

import { haversineMiles, seedGrid } from '@/lib/geo';

const JAX = { lat: 30.3322, lng: -81.6557 };

describe('haversineMiles', () => {
  it('is zero for the same point', () => {
    expect(haversineMiles(JAX, JAX)).toBe(0);
  });

  it('matches a known distance (Jacksonville → Orlando ≈ 125 mi)', () => {
    const orlando = { lat: 28.5384, lng: -81.3789 };
    expect(haversineMiles(JAX, orlando)).toBeGreaterThan(122);
    expect(haversineMiles(JAX, orlando)).toBeLessThan(128);
  });

  it('is symmetric', () => {
    const b = { lat: 30.5, lng: -81.4 };
    expect(haversineMiles(JAX, b)).toBeCloseTo(haversineMiles(b, JAX), 10);
  });
});

describe('seedGrid', () => {
  it('keeps every point inside the radius', () => {
    const points = seedGrid(JAX, 15, 3);
    for (const p of points) expect(haversineMiles(JAX, p)).toBeLessThanOrEqual(15);
  });

  it('includes the home point and spaces neighbours ~3 mi apart', () => {
    const points = seedGrid(JAX, 15, 3);
    expect(points).toContainEqual({ lat: JAX.lat, lng: JAX.lng });
    const east = points.find((p) => p.lat === JAX.lat && p.lng > JAX.lng)!;
    const nearestEast = points
      .filter((p) => p.lat === JAX.lat && p.lng > JAX.lng)
      .sort((a, b) => a.lng - b.lng)[0];
    expect(east).toBeDefined();
    expect(haversineMiles(JAX, nearestEast)).toBeCloseTo(3, 1);
  });

  it('produces roughly πr²/spacing² points', () => {
    const points = seedGrid(JAX, 15, 3);
    const expected = (Math.PI * 15 ** 2) / 3 ** 2; // ≈ 78.5
    expect(points.length).toBeGreaterThan(expected * 0.8);
    expect(points.length).toBeLessThan(expected * 1.2);
  });

  it('is deterministic', () => {
    expect(seedGrid(JAX, 10, 3)).toEqual(seedGrid(JAX, 10, 3));
  });

  it('returns just the center when radius < spacing', () => {
    expect(seedGrid(JAX, 2, 3)).toEqual([{ lat: JAX.lat, lng: JAX.lng }]);
  });
});
