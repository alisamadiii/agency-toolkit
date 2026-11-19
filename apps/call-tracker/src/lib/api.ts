import type {
  CallStatus,
  Config,
  DayResponse,
  DaySummary,
  Lead,
  ScanResult,
} from "@shared/types";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    headers: init?.body ? { "Content-Type": "application/json" } : undefined,
    ...init,
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
  return data;
}

export const api = {
  getConfig: () => request<Config>("/config"),
  updateConfig: (config: Config) =>
    request<Config>("/config", { method: "PUT", body: JSON.stringify(config) }),

  getToday: () => request<DayResponse>("/day/today"),
  getDay: (date: string) => request<DayResponse>(`/day/${date}`),
  listDays: () => request<DaySummary[]>("/days"),
  setIndustries: (industries: string[]) =>
    request<{ ok: true }>("/day/today/industries", {
      method: "PUT",
      body: JSON.stringify({ industries }),
    }),

  scan: (industry: string) =>
    request<ScanResult>("/scan", {
      method: "POST",
      body: JSON.stringify({ industry }),
    }),

  updateStatus: (id: string, status: CallStatus) =>
    request<Lead>(`/leads/${id}/status`, {
      method: "PATCH",
      body: JSON.stringify({ status }),
    }),
  updateNotes: (id: string, notes: string) =>
    request<Lead>(`/leads/${id}/notes`, {
      method: "PATCH",
      body: JSON.stringify({ notes }),
    }),

  uploadRecording: async (id: string, blob: Blob): Promise<{ path: string }> => {
    const res = await fetch(`/api/leads/${id}/recording`, {
      method: "POST",
      headers: { "Content-Type": blob.type || "video/webm" },
      body: blob,
    });
    const data = (await res.json().catch(() => ({}))) as {
      path?: string;
      error?: string;
    };
    if (!res.ok || !data.path) throw new Error(data.error ?? "Upload failed");
    return { path: data.path };
  },

  recordingUrl: (path: string) =>
    `/api/recordings/${path.split("/").map(encodeURIComponent).join("/")}`,
};
