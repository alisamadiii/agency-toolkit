import { CalendarDays } from "lucide-react";

import { useDays } from "@/hooks/use-day";
import { todayLocal } from "@/lib/dates";
import { cn } from "cn";

export function DayHistory({
  selectedDate,
  onSelect,
}: {
  selectedDate: string | null;
  onSelect: (date: string | null) => void;
}) {
  const { data: days } = useDays();
  const today = todayLocal();
  if (!days || days.length === 0) return null;

  const past = days.filter((d) => d.date !== today);
  if (past.length === 0) return null;

  return (
    <div className="flex gap-2 overflow-x-auto pb-1">
      <button
        className={cn(
          "flex shrink-0 items-center gap-2 rounded-xl border px-3 py-2 text-left text-sm transition-colors hover:bg-muted/50",
          selectedDate === null && "border-primary bg-primary/5"
        )}
        onClick={() => onSelect(null)}
      >
        <CalendarDays className="size-4 text-muted-foreground" />
        <span className="font-medium">Today</span>
      </button>
      {past.map((day) => (
        <button
          key={day.date}
          className={cn(
            "shrink-0 rounded-xl border px-3 py-2 text-left text-sm transition-colors hover:bg-muted/50",
            selectedDate === day.date && "border-primary bg-primary/5"
          )}
          onClick={() => onSelect(day.date)}
        >
          <div className="font-medium">
            {new Date(`${day.date}T12:00:00`).toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
            })}
            <span className="ml-1.5 font-normal text-muted-foreground">
              {day.city}
            </span>
          </div>
          <div className="text-xs text-muted-foreground">
            {day.leadCount} leads · {day.calledCount} called ·{" "}
            {day.interestedCount} interested
          </div>
        </button>
      ))}
    </div>
  );
}
