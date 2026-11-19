import type { PlaceDetails } from '@/db/schema';
import { env } from '@/env';

import type { SearchPlace } from './filter';
import { milesToMeters, type Point } from './geo';

const BASE = 'https://places.googleapis.com/v1';

const SEARCH_FIELD_MASK = [
  'places.id',
  'places.displayName',
  'places.formattedAddress',
  'places.location',
  'places.primaryType',
  'places.websiteUri',
  'places.rating',
  'places.userRatingCount',
  'places.businessStatus',
  'places.googleMapsUri',
  'places.nationalPhoneNumber',
  'nextPageToken',
].join(',');

const DETAILS_FIELD_MASK = [
  'id',
  'displayName',
  'formattedAddress',
  'nationalPhoneNumber',
  'internationalPhoneNumber',
  'googleMapsUri',
  'websiteUri',
  'location',
  'rating',
  'userRatingCount',
  'primaryType',
  'primaryTypeDisplayName',
  'types',
  'priceLevel',
  'editorialSummary',
  'regularOpeningHours',
  'reviews',
  'photos',
  'businessStatus',
].join(',');

export class BudgetExceededError extends Error {
  constructor() {
    super('API call budget reached');
  }
}

// Counts every HTTP request (retries included) against the per-run budget.
export class PlacesClient {
  calls = 0;

  constructor(private readonly maxCalls = Infinity) {}

  get remaining() {
    return this.maxCalls - this.calls;
  }

  async searchText(query: string, center: Point, radiusMiles: number, pageToken?: string) {
    return this.request<{ places?: SearchPlace[]; nextPageToken?: string }>(
      `${BASE}/places:searchText`,
      {
        method: 'POST',
        fieldMask: SEARCH_FIELD_MASK,
        body: {
          textQuery: query,
          pageSize: 20,
          pageToken,
          locationBias: {
            circle: {
              center: { latitude: center.lat, longitude: center.lng },
              radius: milesToMeters(radiusMiles),
            },
          },
        },
      }
    );
  }

  async placeDetails(placeId: string) {
    return this.request<PlaceDetails>(
      `${BASE}/places/${encodeURIComponent(placeId)}`,
      { method: 'GET', fieldMask: DETAILS_FIELD_MASK }
    );
  }

  private async request<T>(
    url: string,
    opts: { method: 'GET' | 'POST'; fieldMask: string; body?: unknown },
    attempt = 0
  ): Promise<T> {
    if (this.calls >= this.maxCalls) throw new BudgetExceededError();
    this.calls++;

    const res = await fetch(url, {
      method: opts.method,
      headers: {
        'Content-Type': 'application/json',
        // Key travels only in this header; never logged or put in a URL.
        'X-Goog-Api-Key': env().GOOGLE_MAPS_API_KEY,
        'X-Goog-FieldMask': opts.fieldMask,
      },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      signal: AbortSignal.timeout(20_000),
    });

    if (res.ok) return (await res.json()) as T;

    const retryable = res.status === 429 || res.status >= 500;
    if (retryable && attempt < 3) {
      await sleep(1000 * 2 ** attempt + Math.random() * 250);
      return this.request<T>(url, opts, attempt + 1);
    }

    const text = await res.text().catch(() => '');
    throw new Error(`Places API ${res.status}: ${text.slice(0, 300)}`);
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
