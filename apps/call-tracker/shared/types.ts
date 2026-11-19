export const CALL_STATUSES = [
  "new",
  "no_answer",
  "callback",
  "interested",
  "not_interested",
  "won",
] as const;

export type CallStatus = (typeof CALL_STATUSES)[number];

export interface Config {
  city: string;
  state: string;
}

export interface Day {
  date: string; // local "YYYY-MM-DD"
  city: string;
  state: string;
  industries: string[]; // ≤10 picked that day
  scannedAt: string | null;
  scanErrors: Record<string, string>; // industry → error message
}

export interface Lead {
  id: string;
  placeId: string; // unique across ALL days — dedupe key
  date: string; // day it was scanned
  industry: string;
  name: string;
  phone: string | null;
  address: string | null;
  website: string | null;
  socialOnly: boolean;
  websiteDead: boolean;
  rating: number | null;
  reviewCount: number;
  mapsUrl: string | null;
  category: string | null;
  score: number;
  status: CallStatus;
  notes: string;
  recordingPaths: string[]; // relative to recordings/
  calledAt: string | null; // first status change off "new"
  createdAt: string;
}

export interface DbSchema {
  config: Config;
  days: Day[];
  leads: Lead[];
}

export interface ScanResult {
  industry: string;
  added: number;
  skippedDupes: number;
  skippedUnqualified: number;
  apiCalls: number;
  error?: string;
}

export interface DaySummary {
  date: string;
  city: string;
  state: string;
  industries: string[];
  scannedAt: string | null;
  leadCount: number;
  calledCount: number;
  interestedCount: number;
}

export interface DayResponse {
  day: Day;
  leads: Lead[];
}
