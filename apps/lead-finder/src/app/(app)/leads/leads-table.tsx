'use client';

import * as React from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Check, Eye, EyeOff, Search } from 'lucide-react';
import { toast } from 'sonner';

import { updateLead } from '@/app/actions/leads';

import { LeadStatusBadge, statusLabel } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { LEAD_STATUSES, type Lead, type LeadStatus } from '@/db/schema';
import { ago } from '@/lib/format';

type Row = Omit<Lead, 'details'>;
const ALL = '__all';

export function LeadsTable({
  rows,
  categories,
  filters,
}: {
  rows: Row[];
  categories: string[];
  filters: { status: string; category: string; q: string };
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [q, setQ] = React.useState(filters.q);

  const setParam = React.useCallback(
    (key: string, value: string) => {
      const params = new URLSearchParams(searchParams);
      if (value) params.set(key, value);
      else params.delete(key);
      router.replace(`${pathname}?${params}`, { scroll: false });
    },
    [pathname, router, searchParams]
  );

  async function setStatus(placeId: string, status: LeadStatus, undo?: LeadStatus) {
    const res = await updateLead(placeId, { status });
    if (res.error) return toast.error(res.error);
    if (undo) {
      toast.success('Lead hidden', {
        action: { label: 'Undo', onClick: () => void setStatus(placeId, undo) },
      });
    } else {
      toast.success(status === 'hidden' ? 'Lead hidden' : 'Lead restored');
    }
  }

  React.useEffect(() => {
    if (q === filters.q) return;
    const id = setTimeout(() => setParam('q', q), 300);
    return () => clearTimeout(id);
  }, [q, filters.q, setParam]);

  return (
    <Card className="gap-0 py-0">
      <div className="flex flex-wrap items-center gap-2 border-b p-3">
        <div className="relative min-w-48 flex-1">
          <Search className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search name or address"
            className="pl-8"
          />
        </div>
        <Select value={filters.status || ALL} onValueChange={(v) => setParam('status', v === ALL ? '' : v)}>
          <SelectTrigger className="w-40">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All but hidden</SelectItem>
            {LEAD_STATUSES.map((s) => (
              <SelectItem key={s} value={s} className="capitalize">
                {statusLabel(s)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={filters.category || ALL} onValueChange={(v) => setParam('category', v === ALL ? '' : v)}>
          <SelectTrigger className="w-44">
            <SelectValue placeholder="Category" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All categories</SelectItem>
            {categories.map((c) => (
              <SelectItem key={c} value={c} className="capitalize">
                {c}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="pl-4">Business</TableHead>
            <TableHead>Rating</TableHead>
            <TableHead className="hidden md:table-cell">Distance</TableHead>
            <TableHead className="hidden lg:table-cell">Phone</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="hidden text-right sm:table-cell">Found</TableHead>
            <TableHead className="w-12 pr-4" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 && (
            <TableRow>
              <TableCell colSpan={7} className="h-32 text-center text-muted-foreground">
                No leads match. Run the finder from Settings or loosen the filters.
              </TableCell>
            </TableRow>
          )}
          {rows.map((l) => (
            <TableRow
              key={l.placeId}
              className="group cursor-pointer"
              onClick={() => setParam('lead', l.placeId)}
            >
              <TableCell className="max-w-72 pl-4">
                <div className="flex items-center gap-1.5 truncate font-medium">
                  {l.name}
                  {l.designReady && <Check className="size-3.5 shrink-0 text-violet-500" />}
                </div>
                <div className="truncate text-xs text-muted-foreground">
                  <span className="capitalize">{l.category}</span>
                  {l.socialUrl && ' · social only'}
                </div>
              </TableCell>
              <TableCell className="tabular-nums">
                ⭐ {l.rating.toFixed(1)}{' '}
                <span className="text-muted-foreground">({l.reviewCount})</span>
              </TableCell>
              <TableCell className="hidden tabular-nums md:table-cell">{l.distanceMiles} mi</TableCell>
              <TableCell className="hidden tabular-nums lg:table-cell">{l.phone ?? '—'}</TableCell>
              <TableCell>
                <LeadStatusBadge status={l.status} />
              </TableCell>
              <TableCell
                className="hidden text-right text-muted-foreground sm:table-cell"
                suppressHydrationWarning
              >
                {ago(l.firstSeenAt)}
              </TableCell>
              <TableCell className="pr-4 text-right">
                {l.status === 'hidden' ? (
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    title="Unhide (back to new)"
                    onClick={(e) => {
                      e.stopPropagation();
                      void setStatus(l.placeId, 'new');
                    }}
                  >
                    <Eye />
                  </Button>
                ) : (
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    title="Hide this lead"
                    className="text-muted-foreground md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100"
                    onClick={(e) => {
                      e.stopPropagation();
                      void setStatus(l.placeId, 'hidden', l.status);
                    }}
                  >
                    <EyeOff />
                  </Button>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  );
}
