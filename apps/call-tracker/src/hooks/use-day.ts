import { useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "@/lib/api";

export const dayKey = (date: string | null) => ["day", date ?? "today"] as const;
export const daysKey = ["days"] as const;
export const configKey = ["config"] as const;

/** date = null → today (auto-created); a "YYYY-MM-DD" string → that past day. */
export function useDay(date: string | null) {
  return useQuery({
    queryKey: dayKey(date),
    queryFn: () => (date ? api.getDay(date) : api.getToday()),
  });
}

export function useDays() {
  return useQuery({ queryKey: daysKey, queryFn: api.listDays });
}

export function useConfig() {
  return useQuery({ queryKey: configKey, queryFn: api.getConfig });
}

/** Invalidates every day view + the history list after any lead mutation. */
export function useInvalidateDay() {
  const queryClient = useQueryClient();
  return () => {
    queryClient.invalidateQueries({ queryKey: ["day"] });
    queryClient.invalidateQueries({ queryKey: daysKey });
  };
}
