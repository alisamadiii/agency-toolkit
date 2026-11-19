import { Hono } from "hono";
import { nanoid } from "nanoid";

import type { Lead, ScanResult } from "../../shared/types.ts";
import { getOrCreateToday, seenPlaceIds, todayKey, write } from "../db.ts";
import {
  isSocialOnly,
  isWebsiteDead,
  mapLimit,
  searchPlacesPage,
  type PlaceResult,
} from "../places.ts";
import { scoreLead } from "../score.ts";

const LEADS_PER_INDUSTRY = 20;
const MAX_PAGES = 3; // Google's hard cap per query (60 results)
const QUALIFY_MIN_REVIEWS = 50;

// A website check carried alongside its place so we never recompute it.
interface Checked {
  place: PlaceResult;
  website: string | null;
  socialOnly: boolean;
  websiteDead: boolean;
}

// A business is worth calling UNLESS it already has a real, working website
// with an established review count — those don't need what Ali sells.
function qualifies(c: Checked): boolean {
  const reviews = c.place.userRatingCount ?? 0;
  return (
    !c.website ||
    c.socialOnly ||
    c.websiteDead ||
    reviews < QUALIFY_MIN_REVIEWS
  );
}

export const scanRoute = new Hono();

// One industry per request — the client loops over the day's industries so a
// single failure never kills the run and progress is per-industry.
scanRoute.post("/", async (c) => {
  const { industry } = (await c.req.json().catch(() => ({}))) as {
    industry?: string;
  };
  if (!industry || typeof industry !== "string" || !industry.trim()) {
    return c.json({ error: "industry is required" }, 400);
  }
  const niche = industry.trim();

  const day = await getOrCreateToday();
  if (!day.city.trim()) {
    return c.json({ error: "Set a city in config first" }, 400);
  }

  const query = `${niche} in ${day.city}, ${day.state}`;

  // Check-as-we-page: the 20 cap counts QUALIFYING leads, not raw results, so
  // we keep paging past established businesses and already-imported rows.
  const qualified: Checked[] = [];
  const pickedIds = new Set<string>();
  let skippedDupes = 0;
  let skippedUnqualified = 0;
  let apiCalls = 0;
  let scanError: string | undefined;
  let pageToken: string | undefined;

  for (let page = 0; page < MAX_PAGES; page++) {
    if (page > 0) {
      // Fresh tokens need a moment to become valid.
      await new Promise((r) => setTimeout(r, 2000));
    }
    const { places, nextPageToken, error } = await searchPlacesPage(
      query,
      pageToken
    );
    apiCalls++;
    if (error) {
      scanError = error;
      break;
    }

    // Fresh, operational candidates from this page.
    const candidates = places.filter((p) => {
      if (p.businessStatus && p.businessStatus !== "OPERATIONAL") return false;
      if (seenPlaceIds.has(p.id) || pickedIds.has(p.id)) {
        skippedDupes++;
        return false;
      }
      pickedIds.add(p.id);
      return true;
    });

    // Concurrency 8 — higher looks like bot traffic and reads live sites as dead.
    const checks = await mapLimit(candidates, 8, async (place) => {
      const website = place.websiteUri ?? null;
      const socialOnly = website ? isSocialOnly(website) : false;
      const websiteDead =
        website && !socialOnly ? await isWebsiteDead(website) : false;
      return { place, website, socialOnly, websiteDead } satisfies Checked;
    });

    for (const checked of checks) {
      if (qualified.length >= LEADS_PER_INDUSTRY) break;
      if (qualifies(checked)) qualified.push(checked);
      else skippedUnqualified++;
    }

    pageToken = nextPageToken;
    if (qualified.length >= LEADS_PER_INDUSTRY || !pageToken) break;
  }

  if (scanError && qualified.length === 0) {
    await write(() => {
      day.scanErrors[niche] = scanError;
    });
    const result: ScanResult = {
      industry: niche,
      added: 0,
      skippedDupes,
      skippedUnqualified,
      apiCalls,
      error: scanError,
    };
    return c.json(result);
  }

  const now = new Date().toISOString();
  const newLeads: Lead[] = qualified.map(
    ({ place, website, socialOnly, websiteDead }) => ({
      id: nanoid(10),
      placeId: place.id,
      date: todayKey(),
      industry: niche,
      name: place.displayName?.text ?? "Unknown",
      phone: place.nationalPhoneNumber ?? null,
      address: place.formattedAddress ?? null,
      website,
      socialOnly,
      websiteDead,
      rating: place.rating ?? null,
      reviewCount: place.userRatingCount ?? 0,
      mapsUrl: place.googleMapsUri ?? null,
      category: place.primaryTypeDisplayName?.text ?? place.types?.[0] ?? null,
      score: scoreLead({
        noWebsite: !website,
        socialOnly,
        websiteDead,
        phone: !!place.nationalPhoneNumber,
        rating: place.rating ?? null,
        reviewCount: place.userRatingCount ?? 0,
      }),
      status: "new",
      notes: "",
      recordingPaths: [],
      calledAt: null,
      createdAt: now,
    })
  );

  for (const lead of newLeads) seenPlaceIds.add(lead.placeId);
  await write((data) => {
    data.leads.push(...newLeads);
    day.scannedAt = now;
    if (scanError) day.scanErrors[niche] = scanError;
    else delete day.scanErrors[niche];
  });

  const result: ScanResult = {
    industry: niche,
    added: newLeads.length,
    skippedDupes,
    skippedUnqualified,
    apiCalls,
    error: scanError,
  };
  return c.json(result);
});
