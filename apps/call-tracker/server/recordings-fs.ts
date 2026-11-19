import fs from "node:fs";
import path from "node:path";

import { RECORDINGS_DIR } from "./db.ts";

export function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "lead"
  );
}

export function extForMime(mime: string): string {
  if (mime.includes("mp4")) return "mp4";
  return "webm";
}

/** Resolve a relative recording path, refusing anything outside RECORDINGS_DIR. */
export function safeRecordingPath(relPath: string): string | null {
  const abs = path.resolve(RECORDINGS_DIR, relPath);
  if (abs !== RECORDINGS_DIR && !abs.startsWith(RECORDINGS_DIR + path.sep)) {
    return null;
  }
  return abs;
}

export function newRecordingPath(
  date: string,
  leadName: string,
  mime: string
): { abs: string; rel: string } {
  const dir = path.join(RECORDINGS_DIR, date);
  fs.mkdirSync(dir, { recursive: true });
  const time = new Date().toTimeString().slice(0, 8).replace(/:/g, "");
  const rel = path.join(date, `${slugify(leadName)}-${time}.${extForMime(mime)}`);
  return { abs: path.join(RECORDINGS_DIR, rel), rel };
}
