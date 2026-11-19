import { useEffect, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Globe, MapPin, NotebookPen, Phone, Star, Video } from "lucide-react";
import { toast } from "sonner";

import { StatusPill } from "@/components/status-pill";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api";
import { cn } from "cn";
import type { Lead } from "@shared/types";

export function LeadRow({
  lead,
  isActive,
  onOpenCamera,
}: {
  lead: Lead;
  isActive: boolean;
  onOpenCamera: (lead: Lead) => void;
}) {
  const [notesOpen, setNotesOpen] = useState(false);
  const [notes, setNotes] = useState(lead.notes);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const notesMutation = useMutation({
    mutationFn: (value: string) => api.updateNotes(lead.id, value),
    onError: (e) => toast.error(e.message),
  });

  // Debounced save; flush pending timer on unmount.
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  const onNotesChange = (value: string) => {
    setNotes(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => notesMutation.mutate(value), 600);
  };

  return (
    <div
      className={cn(
        "relative border-b px-4 py-3 transition-colors last:border-b-0",
        lead.status === "won" && "bg-emerald-50/60 dark:bg-emerald-950/20",
        lead.status === "not_interested" && "opacity-55",
        // Highlight the business currently open / recording in the camera panel.
        isActive &&
          "bg-primary/10 opacity-100 before:absolute before:inset-y-0 before:left-0 before:w-1 before:bg-primary"
      )}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate font-medium">{lead.name}</span>
            <Badge
              variant="secondary"
              className="rounded-full px-2 py-0 text-[11px] tabular-nums"
            >
              {lead.score}
            </Badge>
            {!lead.website && (
              <Badge className="rounded-full bg-primary/10 px-2 py-0 text-[11px] text-primary">
                No site
              </Badge>
            )}
            {lead.socialOnly && (
              <Badge className="rounded-full bg-sky-100 px-2 py-0 text-[11px] text-sky-700 dark:bg-sky-950 dark:text-sky-300">
                Social only
              </Badge>
            )}
            {lead.websiteDead && (
              <Badge className="rounded-full bg-red-100 px-2 py-0 text-[11px] text-red-700 dark:bg-red-950 dark:text-red-300">
                Dead site
              </Badge>
            )}
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
            {lead.rating !== null && (
              <span className="inline-flex items-center gap-1">
                <Star className="size-3 fill-amber-400 text-amber-400" />
                {lead.rating} ({lead.reviewCount})
              </span>
            )}
            {lead.address && <span className="truncate">{lead.address}</span>}
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          {lead.phone && (
            <Button asChild variant="outline" size="sm" className="h-8 rounded-full">
              <a href={`tel:${lead.phone}`}>
                <Phone className="size-3.5" />
                {lead.phone}
              </a>
            </Button>
          )}
          {lead.website && (
            <Button asChild variant="ghost" size="icon" className="size-8">
              <a href={lead.website} target="_blank" rel="noreferrer" title="Website">
                <Globe className="size-4" />
              </a>
            </Button>
          )}
          {lead.mapsUrl && (
            <Button asChild variant="ghost" size="icon" className="size-8">
              <a href={lead.mapsUrl} target="_blank" rel="noreferrer" title="Google Maps">
                <MapPin className="size-4" />
              </a>
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            className={cn("size-8", (notesOpen || lead.notes) && "text-primary")}
            onClick={() => setNotesOpen((o) => !o)}
            title="Notes"
          >
            <NotebookPen className="size-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className={cn(
              "size-8",
              lead.recordingPaths.length > 0 && "text-primary"
            )}
            onClick={() => onOpenCamera(lead)}
            title={
              lead.recordingPaths.length > 0
                ? `Record / ${lead.recordingPaths.length} recording(s)`
                : "Record call"
            }
          >
            <Video className="size-4" />
            {lead.recordingPaths.length > 0 && (
              <span className="text-[11px] tabular-nums">
                {lead.recordingPaths.length}
              </span>
            )}
          </Button>
          <StatusPill lead={lead} />
        </div>
      </div>

      {notesOpen && (
        <Textarea
          value={notes}
          onChange={(e) => onNotesChange(e.target.value)}
          placeholder="Call notes…"
          className="mt-2 min-h-16 text-sm"
        />
      )}
    </div>
  );
}
