import { describe, expect, it } from 'vitest';

import { filterCandidates, type SearchPlace } from '@/lib/filter';

const home = { lat: 30.3322, lng: -81.6557 };
const opts = { home, radiusMiles: 15, minRating: 4.5, minReviews: 20 };

function place(overrides: Partial<SearchPlace> = {}): SearchPlace {
  return {
    id: 'p1',
    displayName: { text: 'Joe’s Pest Control' },
    location: { latitude: 30.34, longitude: -81.66 },
    rating: 4.8,
    userRatingCount: 120,
    businessStatus: 'OPERATIONAL',
    ...overrides,
  };
}

describe('filterCandidates', () => {
  it('keeps a good place with no website', () => {
    const [c] = filterCandidates([place()], opts);
    expect(c.place.id).toBe('p1');
    expect(c.socialUrl).toBeNull();
    expect(c.distanceMiles).toBeLessThan(1);
  });

  it('keeps a place whose website is only social and stores it', () => {
    const url = 'https://facebook.com/joes';
    const [c] = filterCandidates([place({ websiteUri: url })], opts);
    expect(c.socialUrl).toBe(url);
  });

  it('drops a place with a real website', () => {
    expect(filterCandidates([place({ websiteUri: 'https://joes.com' })], opts)).toHaveLength(0);
  });

  it('drops non-operational places', () => {
    expect(filterCandidates([place({ businessStatus: 'CLOSED_TEMPORARILY' })], opts)).toHaveLength(0);
    expect(filterCandidates([place({ businessStatus: undefined })], opts)).toHaveLength(0);
  });

  it('enforces rating and review thresholds inclusively', () => {
    expect(filterCandidates([place({ rating: 4.4 })], opts)).toHaveLength(0);
    expect(filterCandidates([place({ userRatingCount: 19 })], opts)).toHaveLength(0);
    expect(filterCandidates([place({ rating: 4.5, userRatingCount: 20 })], opts)).toHaveLength(1);
    expect(filterCandidates([place({ rating: undefined })], opts)).toHaveLength(0);
  });

  it('drops places outside the radius', () => {
    // ~0.3° north ≈ 20 mi
    expect(
      filterCandidates([place({ location: { latitude: 30.63, longitude: -81.66 } })], opts)
    ).toHaveLength(0);
  });

  it('drops places without a location', () => {
    expect(filterCandidates([place({ location: undefined })], opts)).toHaveLength(0);
  });
});
