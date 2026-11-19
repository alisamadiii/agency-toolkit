import fs from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { Hono } from "hono";

import { db, write } from "../db.ts";
import { extForMime, newRecordingPath, safeRecordingPath } from "../recordings-fs.ts";

export const recordingsRoute = new Hono();

// Raw video body (webm/mp4) streamed straight to disk — no buffering, long
// clips can be 100MB+.
recordingsRoute.post("/leads/:id/recording", async (c) => {
  const lead = db.data.leads.find((l) => l.id === c.req.param("id"));
  if (!lead) return c.json({ error: "Lead not found" }, 404);

  const body = c.req.raw.body;
  if (!body) return c.json({ error: "Empty body" }, 400);

  const mime = c.req.header("content-type") ?? "video/webm";
  const { abs, rel } = newRecordingPath(lead.date, lead.name, mime);

  try {
    await pipeline(Readable.fromWeb(body as never), fs.createWriteStream(abs));
  } catch (err) {
    fs.rmSync(abs, { force: true });
    return c.json(
      { error: err instanceof Error ? err.message : "Upload failed" },
      500
    );
  }

  await write(() => {
    lead.recordingPaths.push(rel);
  });
  return c.json({ path: rel });
});

// Static serving with Range support — <video> seeking needs 206 responses.
recordingsRoute.get("/recordings/*", (c) => {
  const rel = decodeURIComponent(c.req.path.replace(/^\/api\/recordings\//, ""));
  const abs = safeRecordingPath(rel);
  if (!abs || !fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
    return c.json({ error: "Not found" }, 404);
  }

  const size = fs.statSync(abs).size;
  const mime = `video/${extForMime(rel)}`;
  const range = c.req.header("range");

  if (range) {
    const match = /bytes=(\d*)-(\d*)/.exec(range);
    const start = match?.[1] ? Number(match[1]) : 0;
    const end = match?.[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
    if (start > end || start >= size) {
      return c.body(null, 416, { "Content-Range": `bytes */${size}` });
    }
    const stream = Readable.toWeb(
      fs.createReadStream(abs, { start, end })
    ) as ReadableStream;
    return c.body(stream, 206, {
      "Content-Type": mime,
      "Content-Length": String(end - start + 1),
      "Content-Range": `bytes ${start}-${end}/${size}`,
      "Accept-Ranges": "bytes",
    });
  }

  const stream = Readable.toWeb(fs.createReadStream(abs)) as ReadableStream;
  return c.body(stream, 200, {
    "Content-Type": mime,
    "Content-Length": String(size),
    "Accept-Ranges": "bytes",
  });
});
