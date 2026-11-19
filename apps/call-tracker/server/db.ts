import path from "node:path";
import { fileURLToPath } from "node:url";
import { JSONFilePreset } from "lowdb/node";

import type { DbSchema, Day } from "../shared/types.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const DATA_DIR = path.join(ROOT, "data");
export const RECORDINGS_DIR = path.join(ROOT, "recordings");

const DEFAULTS: DbSchema = {
  config: { city: "Jacksonville", state: "FL" },
  days: [],
  leads: [],
};

export const db = await JSONFilePreset<DbSchema>(
  path.join(DATA_DIR, "db.json"),
  DEFAULTS
);

// Dedupe index across all days.
export const seenPlaceIds = new Set(db.data.leads.map((l) => l.placeId));

// Status patches can race the scan loop's inserts — serialize every write.
let writeChain: Promise<void> = Promise.resolve();
export function write(mutate: (data: DbSchema) => void): Promise<void> {
  writeChain = writeChain.then(async () => {
    mutate(db.data);
    await db.write();
  });
  return writeChain;
}

/** Local date, never UTC — an evening session must not roll into tomorrow. */
export function todayKey(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export async function getOrCreateToday(): Promise<Day> {
  const date = todayKey();
  let day = db.data.days.find((d) => d.date === date);
  if (!day) {
    day = {
      date,
      city: db.data.config.city,
      state: db.data.config.state,
      industries: [],
      scannedAt: null,
      scanErrors: {},
    };
    await write((data) => data.days.push(day!));
  }
  return day;
}
