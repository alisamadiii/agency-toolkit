import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";
import { useInvalidateDay } from "@/hooks/use-day";
import { api } from "@/lib/api";
import { cn } from "cn";
import { CALL_STATUSES, type CallStatus, type Lead } from "@shared/types";

const STATUS_LABELS: Record<CallStatus, string> = {
  new: "New",
  no_answer: "No answer",
  callback: "Callback",
  interested: "Interested",
  not_interested: "Not interested",
  won: "Won",
};

const STATUS_CLASSES: Record<CallStatus, string> = {
  new: "bg-muted text-muted-foreground",
  no_answer: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  callback: "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300",
  interested:
    "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
  not_interested: "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300",
  won: "bg-emerald-600 text-white dark:bg-emerald-500 dark:text-emerald-950",
};

export function StatusPill({ lead }: { lead: Lead }) {
  const invalidate = useInvalidateDay();
  const mutation = useMutation({
    mutationFn: (status: CallStatus) => api.updateStatus(lead.id, status),
    onSuccess: invalidate,
    onError: (e) => toast.error(e.message),
  });

  return (
    <Select
      value={lead.status}
      onValueChange={(v) => mutation.mutate(v as CallStatus)}
    >
      <SelectTrigger
        size="sm"
        className={cn(
          "h-7 w-auto gap-1 rounded-full border-none px-3 text-xs font-medium shadow-none",
          STATUS_CLASSES[lead.status]
        )}
      >
        {STATUS_LABELS[lead.status]}
      </SelectTrigger>
      <SelectContent>
        {CALL_STATUSES.map((s) => (
          <SelectItem key={s} value={s}>
            {STATUS_LABELS[s]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
