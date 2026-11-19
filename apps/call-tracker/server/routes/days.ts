import { Hono } from "hono";

import type { DayResponse, DaySummary } from "../../shared/types.ts";
import { db, getOrCreateToday, todayKey, write } from "../db.ts";

export const daysRoute = new Hono();

daysRoute.get("/today", async (c) => {
  const day = await getOrCreateToday();
  const leads = db.data.leads.filter((l) => l.date === day.date);
  const res: DayResponse = { day, leads };
  return c.json(res);
});

daysRoute.get("/:date", (c) => {
  const day = db.data.days.find((d) => d.date === c.req.param("date"));
  if (!day) return c.json({ error: "Day not found" }, 404);
  const leads = db.data.leads.filter((l) => l.date === day.date);
  const res: DayResponse = { day, leads };
  return c.json(res);
});

// All scan days, newest first — the history "folders".
export const daysListRoute = new Hono();

daysListRoute.get("/", (c) => {
  const today = todayKey();
  const summaries: DaySummary[] = db.data.days
    .map((day) => {
      const leads = db.data.leads.filter((l) => l.date === day.date);
      return {
        date: day.date,
        city: day.city,
        state: day.state,
        industries: day.industries,
        scannedAt: day.scannedAt,
        leadCount: leads.length,
        calledCount: leads.filter((l) => l.status !== "new").length,
        interestedCount: leads.filter(
          (l) => l.status === "interested" || l.status === "won"
        ).length,
      };
    })
    // Hide empty non-today days (opened but never scanned).
    .filter((s) => s.leadCount > 0 || s.date === today)
    .sort((a, b) => b.date.localeCompare(a.date));
  return c.json(summaries);
});

daysRoute.put("/today/industries", async (c) => {
  const { industries } = (await c.req.json().catch(() => ({}))) as {
    industries?: unknown;
  };
  if (
    !Array.isArray(industries) ||
    industries.some((i) => typeof i !== "string" || !i.trim()) ||
    industries.length > 10
  ) {
    return c.json({ error: "industries must be up to 10 non-empty strings" }, 400);
  }
  const day = await getOrCreateToday();
  await write(() => {
    day.industries = (industries as string[]).map((i) => i.trim());
  });
  return c.json({ ok: true });
});

export const configRoute = new Hono();

configRoute.get("/", (c) => c.json(db.data.config));

configRoute.put("/", async (c) => {
  const { city, state } = (await c.req.json().catch(() => ({}))) as {
    city?: string;
    state?: string;
  };
  if (typeof city !== "string" || typeof state !== "string" || !city.trim()) {
    return c.json({ error: "city and state are required" }, 400);
  }
  const day = await getOrCreateToday();
  await write((data) => {
    data.config = { city: city.trim(), state: state.trim() };
    // Today's day snapshots the config; keep it in sync until scanned.
    if (!day.scannedAt) {
      day.city = data.config.city;
      day.state = data.config.state;
    }
  });
  return c.json(db.data.config);
});
