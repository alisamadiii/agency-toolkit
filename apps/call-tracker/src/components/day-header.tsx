import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, Pencil, Radar } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { configKey, daysKey, useConfig } from "@/hooks/use-day";
import { api } from "@/lib/api";
import { CITIES, STATES } from "@/lib/locations";
import type { Day, Lead } from "@shared/types";

const CUSTOM_CITY = "__custom__";

interface ScanProgress {
  current: string;
  done: number;
  total: number;
  added: number;
}

export function DayHeader({
  day,
  leads,
  isToday,
}: {
  day: Day;
  leads: Lead[];
  isToday: boolean;
}) {
  const queryClient = useQueryClient();
  const { data: config } = useConfig();
  const [editingCity, setEditingCity] = useState(false);
  const [city, setCity] = useState("");
  const [customCity, setCustomCity] = useState("");
  const [state, setState] = useState("FL");
  const [progress, setProgress] = useState<ScanProgress | null>(null);
  const [failed, setFailed] = useState<string[]>([]);

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: ["day"] });
    queryClient.invalidateQueries({ queryKey: daysKey });
  };

  const configMutation = useMutation({
    mutationFn: api.updateConfig,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: configKey });
      invalidateAll();
      setEditingCity(false);
    },
    onError: (e) => toast.error(e.message),
  });

  const runScan = async (industries: string[]) => {
    setFailed([]);
    const errors: string[] = [];
    let added = 0;
    let dupes = 0;
    let established = 0;
    let calls = 0;
    for (let i = 0; i < industries.length; i++) {
      const industry = industries[i]!;
      setProgress({ current: industry, done: i, total: industries.length, added });
      try {
        const result = await api.scan(industry);
        added += result.added;
        dupes += result.skippedDupes;
        established += result.skippedUnqualified;
        calls += result.apiCalls;
        if (result.error) errors.push(industry);
      } catch {
        errors.push(industry);
      }
      await queryClient.invalidateQueries({ queryKey: ["day"] });
    }
    await queryClient.invalidateQueries({ queryKey: daysKey });
    setProgress(null);
    setFailed(errors);
    if (errors.length) {
      toast.error(
        `${errors.length} industr${errors.length === 1 ? "y" : "ies"} failed — retry below`
      );
    } else if (added === 0 && (dupes > 0 || established > 0)) {
      toast.warning(
        `0 new leads — ${established} established, ${dupes} already imported. Change city or industries.`
      );
    } else {
      toast.success(
        `Scan done: ${added} new leads (${established} established skipped, ${dupes} dupes, ${calls} API calls)`
      );
    }
  };

  const startEditing = () => {
    const current = config ?? { city: day.city, state: day.state };
    setState(current.state || "FL");
    const listed = (CITIES[current.state] ?? []).includes(current.city);
    setCity(listed ? current.city : CUSTOM_CITY);
    setCustomCity(listed ? "" : current.city);
    setEditingCity(true);
  };

  const saveConfig = () => {
    const finalCity = city === CUSTOM_CITY ? customCity.trim() : city;
    if (!finalCity) {
      toast.error("Pick or type a city");
      return;
    }
    configMutation.mutate({ city: finalCity, state });
  };

  const called = leads.filter((l) => l.status !== "new").length;
  const interested = leads.filter(
    (l) => l.status === "interested" || l.status === "won"
  ).length;
  const scanning = progress !== null;
  const dateLabel = new Date(`${day.date}T12:00:00`).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight">
            {dateLabel}
            {!isToday && (
              <span className="ml-2 text-sm font-normal text-muted-foreground">
                (past day)
              </span>
            )}
          </h1>
          <div className="mt-0.5 flex items-center gap-1.5 text-sm text-muted-foreground">
            {editingCity ? (
              <div className="flex items-center gap-1.5">
                <Select
                  value={state}
                  onValueChange={(s) => {
                    setState(s);
                    setCity(CITIES[s]?.[0] ?? CUSTOM_CITY);
                  }}
                >
                  <SelectTrigger size="sm" className="h-7 w-20">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {STATES.map((s) => (
                      <SelectItem key={s} value={s}>
                        {s}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={city} onValueChange={setCity}>
                  <SelectTrigger size="sm" className="h-7 w-44">
                    <SelectValue placeholder="City" />
                  </SelectTrigger>
                  <SelectContent>
                    {(CITIES[state] ?? []).map((c) => (
                      <SelectItem key={c} value={c}>
                        {c}
                      </SelectItem>
                    ))}
                    <SelectItem value={CUSTOM_CITY}>Custom…</SelectItem>
                  </SelectContent>
                </Select>
                {city === CUSTOM_CITY && (
                  <Input
                    value={customCity}
                    onChange={(e) => setCustomCity(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && saveConfig()}
                    placeholder="City name"
                    className="h-7 w-36 text-sm"
                    autoFocus
                  />
                )}
                <Button size="sm" className="h-7" onClick={saveConfig}>
                  Save
                </Button>
              </div>
            ) : (
              <>
                <span>
                  {day.city}, {day.state}
                </span>
                {isToday && !scanning && (
                  <button
                    className="text-muted-foreground/60 hover:text-foreground"
                    onClick={startEditing}
                    title="Change city"
                  >
                    <Pencil className="size-3.5" />
                  </button>
                )}
              </>
            )}
          </div>
        </div>

        <div className="flex items-center gap-4">
          {leads.length > 0 && (
            <div className="flex gap-4 text-sm">
              <span>
                <span className="font-semibold tabular-nums">{leads.length}</span>{" "}
                <span className="text-muted-foreground">leads</span>
              </span>
              <span>
                <span className="font-semibold tabular-nums">{called}</span>{" "}
                <span className="text-muted-foreground">called</span>
              </span>
              <span>
                <span className="font-semibold tabular-nums">{interested}</span>{" "}
                <span className="text-muted-foreground">interested</span>
              </span>
            </div>
          )}
          {isToday && (
            <Button
              size="lg"
              disabled={scanning || day.industries.length === 0}
              onClick={() => runScan(day.industries)}
            >
              {scanning ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Radar className="size-4" />
              )}
              {scanning
                ? `Scanning ${progress.current}… ${progress.done + 1}/${progress.total}`
                : leads.length > 0
                  ? "Scan again"
                  : `Scan ${day.industries.length * 20} leads`}
            </Button>
          )}
        </div>
      </div>

      {scanning && (
        <Progress value={(progress.done / progress.total) * 100} className="h-1.5" />
      )}

      {failed.length > 0 && !scanning && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-destructive">Failed:</span>
          {failed.map((industry) => (
            <Button
              key={industry}
              variant="outline"
              size="sm"
              className="h-7 rounded-full capitalize"
              onClick={() => runScan([industry])}
            >
              Retry {industry}
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}
