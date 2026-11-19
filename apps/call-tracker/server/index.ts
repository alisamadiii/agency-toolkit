import fs from "node:fs";
import { serve } from "@hono/node-server";
import { Hono } from "hono";

import { DATA_DIR, RECORDINGS_DIR } from "./db.ts";
import { configRoute, daysListRoute, daysRoute } from "./routes/days.ts";
import { leadsRoute } from "./routes/leads.ts";
import { recordingsRoute } from "./routes/recordings.ts";
import { scanRoute } from "./routes/scan.ts";

// Load .env (GOOGLE_PLACES_API_KEY) without a dotenv dependency.
try {
  for (const line of fs.readFileSync(".env", "utf8").split("\n")) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m && !process.env[m[1]!]) process.env[m[1]!] = m[2]!;
  }
} catch {
  // no .env — searchPlaces will throw a clear error when used
}

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(RECORDINGS_DIR, { recursive: true });

const app = new Hono().basePath("/api");

app.get("/health", (c) => c.json({ ok: true }));
app.route("/config", configRoute);
app.route("/day", daysRoute);
app.route("/days", daysListRoute);
app.route("/scan", scanRoute);
app.route("/leads", leadsRoute);
app.route("/", recordingsRoute); // /api/leads/:id/recording + /api/recordings/*

const port = 8787;
serve({ fetch: app.fetch, port }, () => {
  console.log(`api on http://localhost:${port}`);
});
