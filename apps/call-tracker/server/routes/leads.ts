import { Hono } from "hono";

import { CALL_STATUSES, type CallStatus } from "../../shared/types.ts";
import { db, write } from "../db.ts";

export const leadsRoute = new Hono();

function findLead(id: string) {
  return db.data.leads.find((l) => l.id === id);
}

leadsRoute.patch("/:id/status", async (c) => {
  const lead = findLead(c.req.param("id"));
  if (!lead) return c.json({ error: "Lead not found" }, 404);

  const { status } = (await c.req.json().catch(() => ({}))) as {
    status?: CallStatus;
  };
  if (!status || !CALL_STATUSES.includes(status)) {
    return c.json({ error: "Invalid status" }, 400);
  }

  await write(() => {
    lead.status = status;
    if (status !== "new" && !lead.calledAt) {
      lead.calledAt = new Date().toISOString();
    }
  });
  return c.json(lead);
});

leadsRoute.patch("/:id/notes", async (c) => {
  const lead = findLead(c.req.param("id"));
  if (!lead) return c.json({ error: "Lead not found" }, 404);

  const { notes } = (await c.req.json().catch(() => ({}))) as {
    notes?: string;
  };
  if (typeof notes !== "string") {
    return c.json({ error: "notes must be a string" }, 400);
  }

  await write(() => {
    lead.notes = notes;
  });
  return c.json(lead);
});
