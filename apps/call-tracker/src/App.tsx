import { useState } from "react";
import { Loader2 } from "lucide-react";

import { CameraColumn } from "@/components/camera-column";
import { DayHeader } from "@/components/day-header";
import { DayHistory } from "@/components/day-history";
import { IndustryPicker } from "@/components/industry-picker";
import { LeadList } from "@/components/lead-list";
import { Card, CardContent } from "@/components/ui/card";
import { useDay } from "@/hooks/use-day";

export default function App() {
  // null = today; "YYYY-MM-DD" = a past day from the history row.
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const { data, isLoading, error } = useDay(selectedDate);
  const [cameraLeadId, setCameraLeadId] = useState<string | null>(null);

  if (isLoading) {
    return (
      <div className="flex h-dvh items-center justify-center">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (error || !data) {
    return (
      <div className="flex h-dvh items-center justify-center text-sm text-destructive">
        {error?.message ?? "Failed to load — is the API running?"}
      </div>
    );
  }

  const { day, leads } = data;
  const isToday = selectedDate === null;
  const cameraLead = leads.find((l) => l.id === cameraLeadId) ?? null;

  const dashboard = (
    <div className="mx-auto max-w-5xl space-y-6 px-4 py-8">
      <DayHistory selectedDate={selectedDate} onSelect={setSelectedDate} />

      <DayHeader day={day} leads={leads} isToday={isToday} />

      {isToday && (
        <Card>
          <CardContent>
            <IndustryPicker selected={day.industries} disabled={false} />
          </CardContent>
        </Card>
      )}

      <LeadList
        leads={leads}
        activeLeadId={cameraLeadId}
        onOpenCamera={(lead) => setCameraLeadId(lead.id)}
      />

      {isToday && leads.length === 0 && day.industries.length === 0 && (
        <p className="text-center text-sm text-muted-foreground">
          Pick up to 10 industries above, then scan to pull leads.
        </p>
      )}
    </div>
  );

  // Recording splits the screen: dashboard stays live on the left, camera
  // fills a fixed column on the right.
  if (cameraLead) {
    return (
      <div className="grid grid-cols-2 h-dvh">
        <div className="min-w-0 flex-1 overflow-y-auto">{dashboard}</div>
        <div className="p-4">
          <CameraColumn
            lead={cameraLead}
            onClose={() => setCameraLeadId(null)}
          />
        </div>
      </div>
    );
  }

  return dashboard;
}
