import { useState } from "react";
import { ChevronDown } from "lucide-react";

import { LeadRow } from "@/components/lead-row";
import { Card } from "@/components/ui/card";
import { cn } from "cn";
import type { Lead } from "@shared/types";

export function LeadList({
  leads,
  activeLeadId,
  onOpenCamera,
}: {
  leads: Lead[];
  activeLeadId: string | null;
  onOpenCamera: (lead: Lead) => void;
}) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  if (leads.length === 0) {
    return (
      <div className="rounded-xl border border-dashed py-16 text-center text-sm text-muted-foreground">
        No leads yet today. Pick your industries and hit Scan.
      </div>
    );
  }

  const groups = new Map<string, Lead[]>();
  for (const lead of leads) {
    const list = groups.get(lead.industry) ?? [];
    list.push(lead);
    groups.set(lead.industry, list);
  }

  return (
    <div className="space-y-4">
      {[...groups.entries()].map(([industry, group]) => {
        const sorted = [...group].sort((a, b) => b.score - a.score);
        const called = group.filter((l) => l.status !== "new").length;
        const isCollapsed = collapsed[industry];
        return (
          <Card key={industry} className="gap-0 overflow-hidden py-0">
            <button
              className="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-muted/50"
              onClick={() =>
                setCollapsed((c) => ({ ...c, [industry]: !c[industry] }))
              }
            >
              <span className="font-semibold capitalize">{industry}</span>
              <span className="flex items-center gap-2 text-xs text-muted-foreground">
                {called}/{group.length} called
                <ChevronDown
                  className={cn(
                    "size-4 transition-transform",
                    isCollapsed && "-rotate-90"
                  )}
                />
              </span>
            </button>
            {!isCollapsed && (
              <div className="border-t">
                {sorted.map((lead) => (
                  <LeadRow
                    key={lead.id}
                    lead={lead}
                    isActive={lead.id === activeLeadId}
                    onOpenCamera={onOpenCamera}
                  />
                ))}
              </div>
            )}
          </Card>
        );
      })}
    </div>
  );
}
