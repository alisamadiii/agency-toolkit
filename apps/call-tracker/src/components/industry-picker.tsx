import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Plus, X } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { useInvalidateDay } from "@/hooks/use-day";
import { api } from "@/lib/api";
import { NICHES } from "@/lib/niches";

const MAX_INDUSTRIES = 10;

export function IndustryPicker({
  selected,
  disabled,
}: {
  selected: string[];
  disabled: boolean;
}) {
  const [custom, setCustom] = useState("");
  const invalidate = useInvalidateDay();

  const mutation = useMutation({
    mutationFn: api.setIndustries,
    onSuccess: invalidate,
    onError: (e) => toast.error(e.message),
  });

  const toggle = (niche: string) => {
    const next = selected.includes(niche)
      ? selected.filter((n) => n !== niche)
      : [...selected, niche];
    if (next.length > MAX_INDUSTRIES) {
      toast.error(`Max ${MAX_INDUSTRIES} industries per day`);
      return;
    }
    mutation.mutate(next);
  };

  const addCustom = () => {
    const niche = custom.trim().toLowerCase();
    if (!niche) return;
    if (selected.includes(niche)) {
      setCustom("");
      return;
    }
    toggle(niche);
    setCustom("");
  };

  const customSelected = selected.filter((s) => !NICHES.includes(s));

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">
          Industries{" "}
          <span className="font-normal text-muted-foreground">
            {selected.length}/{MAX_INDUSTRIES}
          </span>
        </h3>
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3 lg:grid-cols-4">
        {NICHES.map((niche) => (
          <label
            key={niche}
            className="flex cursor-pointer items-center gap-2 text-sm capitalize"
          >
            <Checkbox
              checked={selected.includes(niche)}
              onCheckedChange={() => toggle(niche)}
              disabled={disabled}
            />
            {niche}
          </label>
        ))}
      </div>
      {customSelected.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {customSelected.map((niche) => (
            <Badge key={niche} variant="secondary" className="gap-1 rounded-full capitalize">
              {niche}
              {!disabled && (
                <button onClick={() => toggle(niche)} title="Remove">
                  <X className="size-3" />
                </button>
              )}
            </Badge>
          ))}
        </div>
      )}
      {!disabled && (
        <div className="flex max-w-xs gap-2">
          <Input
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addCustom()}
            placeholder="Add custom industry…"
            className="h-8 text-sm"
          />
          <Button variant="outline" size="icon" className="size-8" onClick={addCustom}>
            <Plus className="size-4" />
          </Button>
        </div>
      )}
    </div>
  );
}
