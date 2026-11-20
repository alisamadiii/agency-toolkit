import { and, asc, eq, inArray, lt, sql } from 'drizzle-orm';

import { db } from '@/db';
import {
  leads,
  runs,
  searchCells,
  settings as settingsTable,
  type PlaceDetails,
  type RunError,
  type Settings,
} from '@/db/schema';
import { filterCandidates, leadScore, type Candidate } from '@/lib/filter';
import { seedGrid } from '@/lib/geo';
import { BudgetExceededError, PlacesClient } from '@/lib/google';
import { DASHBOARD_URL, sendAlert } from '@/lib/notifications/dispatch';

import { cellsHash, getSettings } from './settings';

const CELL_SPACING_MILES = 3;
const CELL_BIAS_RADIUS_MILES = 2.5;
const MAX_PAGES = 3;
const DETAILS_TTL_DAYS = 30;

export type FoundLead = {
  placeId: string;
  name: string;
  category: string;
  rating: number;
  reviewCount: number;
  distanceMiles: number;
  phone: string | null;
  googleMapsUrl: string | null;
  socialUrl: string | null;
  address: string | null;
};

export type RunSummary = {
  runId: string | null;
  dryRun: boolean;
  apiCalls: number;
  candidatesSeen: number;
  leads: FoundLead[];
  errors: RunError[];
};

type Cell = { id: string | null; lat: number; lng: number; category: string };

let inProcessRun = false;

// Is a run already going? Covers this process and a stale-safe DB check.
export async function isRunInProgress() {
  if (inProcessRun) return true;
  const [row] = await db
    .select({ id: runs.id })
    .from(runs)
    .where(
      and(eq(runs.status, 'running'), sql`${runs.startedAt} > now() - interval '30 minutes'`)
    )
    .limit(1);
  return Boolean(row);
}

export async function runLeadFinder(opts: {
  trigger: 'scheduled' | 'manual';
  dryRun?: boolean;
  log?: (msg: string) => void;
}): Promise<RunSummary> {
  const dryRun = opts.dryRun ?? false;
  const log = opts.log ?? ((m: string) => console.log(`[lead-finder] ${m}`));
  const errors: RunError[] = [];
  const pushError = (message: string) => {
    errors.push({ at: new Date().toISOString(), message });
    log(`error: ${message}`);
  };

  if (!dryRun && inProcessRun) throw new Error('A run is already in progress');
  if (!dryRun) inProcessRun = true;

  let runId: string | null = null;
  const places = new PlacesClient();
  let candidatesSeen = 0;

  try {
    const s = await getSettings();
    if (s.homeLat == null || s.homeLng == null) {
      throw new Error('Home location is not set. Add it on the Settings page.');
    }
    if (s.categories.length === 0) throw new Error('No categories configured.');

    if (!dryRun) {
      const [run] = await db.insert(runs).values({ trigger: opts.trigger }).returning();
      runId = run.id;
    }

    const home = { lat: s.homeLat, lng: s.homeLng };
    const client = new PlacesClient(s.maxApiCallsPerRun);
    // Keep enough budget for one Place Details call per lead.
    const searchBudget = Math.max(1, s.maxApiCallsPerRun - s.dailyLimit);

    const cells = await loadCells(s, dryRun);
    log(`${cells.length} cells, budget ${s.maxApiCallsPerRun} calls`);

    const found = new Map<string, Candidate & { category: string }>();

    for (const cell of cells) {
      if (found.size >= s.dailyLimit || client.calls >= searchBudget) break;

      let pageToken: string | undefined;
      let cellResults = 0;
      try {
        for (let page = 0; page < MAX_PAGES && client.calls < searchBudget; page++) {
          const res = await client.searchText(
            cell.category,
            cell,
            CELL_BIAS_RADIUS_MILES,
            pageToken
          );
          const batch = res.places ?? [];
          candidatesSeen += batch.length;

          const kept = filterCandidates(batch, {
            home,
            radiusMiles: s.radiusMiles,
            minRating: s.minRating,
            minReviews: s.minReviews,
          }).filter((c) => !found.has(c.place.id));

          const existing = await existingPlaceIds(kept.map((c) => c.place.id));
          for (const c of kept) {
            if (existing.has(c.place.id)) continue;
            found.set(c.place.id, { ...c, category: cell.category });
            cellResults++;
          }

          pageToken = res.nextPageToken;
          if (!pageToken || found.size >= s.dailyLimit) break;
        }
      } catch (error) {
        if (error instanceof BudgetExceededError) break;
        pushError(`search "${cell.category}" @ ${cell.lat},${cell.lng}: ${message(error)}`);
      }

      if (!dryRun && cell.id) {
        await db
          .update(searchCells)
          .set({ lastSearchedAt: new Date(), resultsFound: cellResults })
          .where(eq(searchCells.id, cell.id));
      }
    }

    // Best first, so the Details budget goes to the strongest leads.
    const top = [...found.values()]
      .sort(
        (a, b) =>
          leadScore(b.place.rating ?? 0, b.place.userRatingCount ?? 0) -
          leadScore(a.place.rating ?? 0, a.place.userRatingCount ?? 0)
      )
      .slice(0, s.dailyLimit);

    const saved: FoundLead[] = [];
    for (const c of top) {
      const lead = toFoundLead(c);
      if (dryRun) {
        saved.push(lead);
        continue;
      }

      let details: PlaceDetails | null = null;
      try {
        details = await client.placeDetails(c.place.id);
      } catch (error) {
        pushError(`details ${c.place.id}: ${message(error)}`);
      }

      const inserted = await db
        .insert(leads)
        .values({
          placeId: c.place.id,
          name: lead.name,
          category: c.category,
          primaryType: c.place.primaryType ?? null,
          address: lead.address,
          phone: lead.phone,
          lat: c.place.location!.latitude,
          lng: c.place.location!.longitude,
          distanceMiles: round1(c.distanceMiles),
          googleMapsUrl: lead.googleMapsUrl,
          rating: lead.rating,
          reviewCount: lead.reviewCount,
          socialUrl: c.socialUrl,
          details,
          detailsFetchedAt: details ? new Date() : null,
        })
        .onConflictDoNothing({ target: leads.placeId })
        .returning({ placeId: leads.placeId });
      if (inserted.length) saved.push(lead);
    }

    if (!dryRun) await purgeOldDetails();

    places.calls = client.calls;
    log(`${saved.length} new leads, ${client.calls} API calls`);

    if (!dryRun) {
      await db
        .update(runs)
        .set({
          status: 'ok',
          finishedAt: new Date(),
          apiCalls: client.calls,
          candidatesSeen,
          newLeadsSaved: saved.length,
          errors,
        })
        .where(eq(runs.id, runId!));
      await notifySummary(saved, client.calls).catch((e) =>
        log(`notify failed: ${message(e)}`)
      );
    }

    return { runId, dryRun, apiCalls: client.calls, candidatesSeen, leads: saved, errors };
  } catch (error) {
    pushError(message(error));
    if (runId) {
      await db
        .update(runs)
        .set({
          status: 'failed',
          finishedAt: new Date(),
          apiCalls: places.calls,
          candidatesSeen,
          errors,
        })
        .where(eq(runs.id, runId));
    }
    if (!dryRun) {
      await sendAlert({
        title: '❌ Lead Finder run failed',
        lines: [message(error)],
        embed: { color: 0xef4444, url: DASHBOARD_URL, fields: [{ name: 'Error', value: message(error) }] },
      }).catch(() => {});
    }
    throw error;
  } finally {
    if (!dryRun) inProcessRun = false;
  }
}

async function loadCells(s: Settings, dryRun: boolean): Promise<Cell[]> {
  const hash = cellsHash(s);
  const points = () =>
    seedGrid({ lat: s.homeLat!, lng: s.homeLng! }, s.radiusMiles, CELL_SPACING_MILES);

  const [{ count }] = await db.select({ count: sql<number>`count(*)::int` }).from(searchCells);
  const stale = count === 0 || s.cellsHash !== hash;

  if (stale && dryRun) {
    return points().flatMap((p) => s.categories.map((category) => ({ id: null, ...p, category })));
  }

  if (stale) {
    const rows = points().flatMap((p) => s.categories.map((category) => ({ ...p, category })));
    await db.transaction(async (tx) => {
      await tx.delete(searchCells);
      for (let i = 0; i < rows.length; i += 500) {
        await tx.insert(searchCells).values(rows.slice(i, i + 500));
      }
      await tx
        .update(settingsTable)
        .set({ cellsHash: hash })
        .where(eq(settingsTable.id, 'global'));
    });
  }

  return db
    .select({
      id: searchCells.id,
      lat: searchCells.lat,
      lng: searchCells.lng,
      category: searchCells.category,
    })
    .from(searchCells)
    .orderBy(sql`${searchCells.lastSearchedAt} asc nulls first`, asc(searchCells.id));
}

async function existingPlaceIds(ids: string[]) {
  if (ids.length === 0) return new Set<string>();
  const rows = await db
    .select({ placeId: leads.placeId })
    .from(leads)
    .where(inArray(leads.placeId, ids));
  return new Set(rows.map((r) => r.placeId));
}

// Google's terms only allow keeping Place IDs long-term; details are refetched
// on demand when a lead is picked up for design.
async function purgeOldDetails() {
  await db
    .update(leads)
    .set({ details: null, updatedAt: new Date() })
    .where(
      and(
        inArray(leads.status, ['new', 'skipped', 'hidden']),
        lt(leads.detailsFetchedAt, sql`now() - make_interval(days => ${DETAILS_TTL_DAYS})`),
        sql`${leads.details} is not null`
      )
    );
}

async function notifySummary(found: FoundLead[], apiCalls: number) {
  if (found.length === 0) {
    await sendAlert({
      title: 'Lead Finder: no new leads today',
      lines: [`Searched with ${apiCalls} API calls. Nothing new matched.`],
      embed: { color: 0x737373, url: `${DASHBOARD_URL}/runs`, footer: `${apiCalls} API calls` },
    });
    return;
  }
  await sendAlert({
    title: `🎯 ${found.length} new lead${found.length === 1 ? '' : 's'} today`,
    lines: found.map((l) => `${l.name} · ⭐ ${l.rating} (${l.reviewCount})`),
    embed: {
      color: 0x22c55e,
      url: `${DASHBOARD_URL}/leads`,
      fields: found.slice(0, 25).map((l, i) => ({
        name: `${i + 1}. ${l.name}`,
        value: [
          `${l.category} · ⭐ ${l.rating} (${l.reviewCount}) · ${l.distanceMiles} mi`,
          l.phone ?? 'No phone',
          l.googleMapsUrl ? `[Google Maps](${l.googleMapsUrl})` : null,
        ]
          .filter(Boolean)
          .join('\n'),
      })),
      footer: `${apiCalls} API calls`,
      timestamp: new Date().toISOString(),
    },
  });
}

function toFoundLead(c: Candidate & { category: string }): FoundLead {
  return {
    placeId: c.place.id,
    name: c.place.displayName?.text ?? 'Unknown',
    category: c.category,
    rating: c.place.rating ?? 0,
    reviewCount: c.place.userRatingCount ?? 0,
    distanceMiles: round1(c.distanceMiles),
    phone: c.place.nationalPhoneNumber ?? null,
    googleMapsUrl: c.place.googleMapsUri ?? null,
    socialUrl: c.socialUrl,
    address: c.place.formattedAddress ?? null,
  };
}

// Refetches Place Details for one lead (used before designing).
export async function refreshLeadDetails(placeId: string) {
  const details = await new PlacesClient(4).placeDetails(placeId);
  await db
    .update(leads)
    .set({ details, detailsFetchedAt: new Date(), updatedAt: new Date() })
    .where(eq(leads.placeId, placeId));
  return details;
}

const round1 = (n: number) => Math.round(n * 10) / 10;
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
