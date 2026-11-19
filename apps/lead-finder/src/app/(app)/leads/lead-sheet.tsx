'use client';

import * as React from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { ExternalLink, Loader2, MapPin, Phone, RefreshCw, Star } from 'lucide-react';
import { toast } from 'sonner';

import { refreshDetails, updateLead } from '@/app/actions/leads';
import { statusLabel } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { LEAD_STATUSES, type Lead, type LeadStatus } from '@/db/schema';
import { ago } from '@/lib/format';

export function LeadSheet({ lead }: { lead: Lead | null }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function close() {
    const params = new URLSearchParams(searchParams);
    params.delete('lead');
    router.replace(`${pathname}?${params}`, { scroll: false });
  }

  return (
    <Sheet open={Boolean(lead)} onOpenChange={(open) => !open && close()}>
      <SheetContent className="w-full gap-0 p-0 sm:max-w-xl">
        {lead && <LeadDetail key={lead.placeId} lead={lead} />}
      </SheetContent>
    </Sheet>
  );
}

function LeadDetail({ lead }: { lead: Lead }) {
  const [pending, startTransition] = React.useTransition();
  const [refreshing, setRefreshing] = React.useState(false);
  const [notes, setNotes] = React.useState(lead.notes ?? '');
  const d = lead.details;

  function patch(p: Parameters<typeof updateLead>[1], msg: string) {
    startTransition(async () => {
      const res = await updateLead(lead.placeId, p);
      if (res.error) toast.error(res.error);
      else toast.success(msg);
    });
  }

  async function refresh() {
    setRefreshing(true);
    const res = await refreshDetails(lead.placeId);
    setRefreshing(false);
    if (res.error) toast.error(res.error);
    else toast.success('Details refreshed');
  }

  return (
    <>
      <SheetHeader className="border-b p-6">
        <SheetTitle className="font-heading text-xl">{lead.name}</SheetTitle>
        <SheetDescription suppressHydrationWarning>
          <span className="capitalize">{d?.primaryTypeDisplayName?.text ?? lead.category}</span> · {lead.distanceMiles} mi away · found {ago(lead.firstSeenAt)}
        </SheetDescription>
        <div className="flex flex-wrap gap-2 pt-2">
          {lead.googleMapsUrl && (
            <Button asChild size="sm" variant="outline">
              <a href={lead.googleMapsUrl} target="_blank" rel="noreferrer">
                <MapPin /> Google Maps
              </a>
            </Button>
          )}
          {lead.phone && (
            <Button asChild size="sm" variant="outline">
              <a href={`tel:${lead.phone}`}>
                <Phone /> {lead.phone}
              </a>
            </Button>
          )}
          {lead.socialUrl && (
            <Button asChild size="sm" variant="outline">
              <a href={lead.socialUrl} target="_blank" rel="noreferrer">
                <ExternalLink /> Social page
              </a>
            </Button>
          )}
        </div>
      </SheetHeader>

      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-6 p-6">
          <section className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>Status</Label>
              <Select
                value={lead.status}
                disabled={pending}
                onValueChange={(v) => patch({ status: v as LeadStatus }, `Status → ${statusLabel(v)}`)}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {LEAD_STATUSES.map((s) => (
                    <SelectItem key={s} value={s} className="capitalize">
                      {statusLabel(s)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="design-ready">Design ready</Label>
              <div className="flex h-9 items-center">
                <Switch
                  id="design-ready"
                  checked={lead.designReady}
                  disabled={pending}
                  onCheckedChange={(v) =>
                    patch({ designReady: v }, v ? 'Marked design ready' : 'Design ready cleared')
                  }
                />
              </div>
            </div>
            <div className="col-span-2 space-y-1.5">
              <Label htmlFor="notes">Notes</Label>
              <Textarea
                id="notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                onBlur={() => notes !== (lead.notes ?? '') && patch({ notes: notes || null }, 'Notes saved')}
                placeholder="Owner name, best time to call, design ideas…"
                rows={3}
              />
            </div>
          </section>

          <Separator />

          <section className="space-y-2 text-sm">
            <div className="flex items-center gap-2 text-base font-semibold">
              <Star className="size-4 fill-amber-400 text-amber-400" />
              {lead.rating.toFixed(1)}
              <span className="font-normal text-muted-foreground">· {lead.reviewCount} reviews</span>
            </div>
            {lead.address && <p className="text-muted-foreground">{lead.address}</p>}
            {d?.editorialSummary?.text && <p>{d.editorialSummary.text}</p>}
          </section>

          {!d ? (
            <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
              <p className="mb-3">Details were cleared after 30 days (Google terms). Fetch them again to design.</p>
              <Button size="sm" onClick={refresh} disabled={refreshing}>
                {refreshing ? <Loader2 className="animate-spin" /> : <RefreshCw />}
                Fetch details
              </Button>
            </div>
          ) : (
            <>
              {d.photos && d.photos.length > 0 && (
                <section className="space-y-2">
                  <h3 className="text-sm font-semibold">Photos</h3>
                  <div className="grid grid-cols-3 gap-2">
                    {d.photos.slice(0, 9).map((p) => (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        key={p.name}
                        src={`/api/photo/${p.name}?w=400`}
                        alt=""
                        loading="lazy"
                        className="aspect-square w-full rounded-md bg-muted object-cover"
                      />
                    ))}
                  </div>
                </section>
              )}

              {d.regularOpeningHours?.weekdayDescriptions && (
                <section className="space-y-2">
                  <h3 className="text-sm font-semibold">Hours</h3>
                  <ul className="space-y-0.5 text-sm text-muted-foreground">
                    {d.regularOpeningHours.weekdayDescriptions.map((h) => (
                      <li key={h}>{h}</li>
                    ))}
                  </ul>
                </section>
              )}

              {d.reviews && d.reviews.length > 0 && (
                <section className="space-y-3">
                  <h3 className="text-sm font-semibold">Reviews</h3>
                  {d.reviews.map((r, i) => (
                    <figure key={i} className="rounded-lg border p-3 text-sm">
                      <figcaption className="mb-1 flex items-center justify-between gap-2">
                        <span className="font-medium">{r.authorAttribution?.displayName ?? 'Google user'}</span>
                        <span className="text-xs text-muted-foreground">
                          {'★'.repeat(r.rating ?? 0)} · {r.relativePublishTimeDescription}
                        </span>
                      </figcaption>
                      <blockquote className="text-muted-foreground">{r.text?.text}</blockquote>
                    </figure>
                  ))}
                </section>
              )}

              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span suppressHydrationWarning>Details fetched {ago(lead.detailsFetchedAt)}</span>
                <Button size="sm" variant="ghost" onClick={refresh} disabled={refreshing}>
                  {refreshing ? <Loader2 className="animate-spin" /> : <RefreshCw />}
                  Refresh
                </Button>
              </div>
            </>
          )}

          <p className="font-mono text-xs break-all text-muted-foreground">{lead.placeId}</p>
        </div>
      </ScrollArea>
    </>
  );
}
