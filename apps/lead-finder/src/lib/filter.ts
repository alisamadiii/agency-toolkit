import { haversineMiles, type Point } from './geo';
import { isSocialOnlyUrl } from './social';

export type SearchPlace = {
  id: string;
  displayName?: { text: string };
  formattedAddress?: string;
  location?: { latitude: number; longitude: number };
  primaryType?: string;
  websiteUri?: string;
  rating?: number;
  userRatingCount?: number;
  businessStatus?: string;
  googleMapsUri?: string;
  nationalPhoneNumber?: string;
};

export type FilterOptions = {
  home: Point;
  radiusMiles: number;
  minRating: number;
  minReviews: number;
};

export type Candidate = {
  place: SearchPlace;
  socialUrl: string | null;
  distanceMiles: number;
};

// Keeps operational, well-reviewed places within range that have no website
// (or only a social/listing page). Dedup against the DB happens separately.
export function filterCandidates(places: SearchPlace[], opts: FilterOptions): Candidate[] {
  const out: Candidate[] = [];
  for (const place of places) {
    if (place.businessStatus !== 'OPERATIONAL') continue;
    if ((place.rating ?? 0) < opts.minRating) continue;
    if ((place.userRatingCount ?? 0) < opts.minReviews) continue;
    if (!place.location) continue;

    let socialUrl: string | null = null;
    if (place.websiteUri) {
      if (!isSocialOnlyUrl(place.websiteUri)) continue;
      socialUrl = place.websiteUri;
    }

    const distanceMiles = haversineMiles(opts.home, {
      lat: place.location.latitude,
      lng: place.location.longitude,
    });
    if (distanceMiles > opts.radiusMiles) continue;

    out.push({ place, socialUrl, distanceMiles });
  }
  return out;
}

export const leadScore = (rating: number, reviewCount: number) => rating * reviewCount;
