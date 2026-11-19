'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { FlaskConical, Loader2, LocateFixed, Play, Save, X } from 'lucide-react';
import { toast } from 'sonner';

import { dryRun, runNow, saveSettings, type SettingsInput } from '@/app/actions/settings';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type { Settings } from '@/db/schema';
import type { RunSummary } from '@/lib/jobs/lead-finder';

const TIMEZONES = [
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Phoenix',
  'America/Los_Angeles',
  'America/Anchorage',
  'Pacific/Honolulu',
  'UTC',
];

type Form = Omit<SettingsInput, 'homeLat' | 'homeLng'> & { homeLat: string; homeLng: string };

export function SettingsForm({ settings: s }: { settings: Settings }) {
  const router = useRouter();
  const [form, setForm] = React.useState<Form>({
    enabled: s.enabled,
    runTime: s.runTime,
    timezone: s.timezone,
    homeLat: s.homeLat?.toString() ?? '',
    homeLng: s.homeLng?.toString() ?? '',
    radiusMiles: s.radiusMiles,
    minRating: s.minRating,
    minReviews: s.minReviews,
    dailyLimit: s.dailyLimit,
    categories: s.categories,
    maxApiCallsPerRun: s.maxApiCallsPerRun,
  });
  const [category, setCategory] = React.useState('');
  const [saving, setSaving] = React.useState(false);
  const [running, setRunning] = React.useState<'run' | 'dry' | null>(null);
  const [preview, setPreview] = React.useState<RunSummary | null>(null);

  const set = <K extends keyof Form>(key: K, value: Form[K]) => setForm((f) => ({ ...f, [key]: value }));
  const timezones = TIMEZONES.includes(form.timezone) ? TIMEZONES : [form.timezone, ...TIMEZONES];

  async function save(e?: React.FormEvent) {
    e?.preventDefault();
    setSaving(true);
    const res = await saveSettings(form);
    setSaving(false);
    if (res.error) {
      toast.error(res.error);
      return false;
    }
    toast.success('Settings saved');
    router.refresh();
    return true;
  }

  function addCategory() {
    const value = category.trim().toLowerCase();
    if (value && !form.categories.includes(value)) set('categories', [...form.categories, value]);
    setCategory('');
  }

  function locate() {
    if (!navigator.geolocation) return toast.error('Geolocation is not available');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        set('homeLat', pos.coords.latitude.toFixed(5));
        set('homeLng', pos.coords.longitude.toFixed(5));
      },
      () => toast.error('Could not read your location')
    );
  }

  async function handleRun() {
    setRunning('run');
    const res = await runNow();
    setRunning(null);
    if (res.error) toast.error(res.error);
    else toast.success('Run started. Watch it on the Runs page.');
  }

  async function handleDryRun() {
    setRunning('dry');
    setPreview(null);
    const res = await dryRun();
    setRunning(null);
    if (res.error) toast.error(res.error);
    else setPreview(res.summary!);
  }

  return (
    <form onSubmit={save} className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Schedule</CardTitle>
          <CardDescription>
            The finder runs once a day at this time. Changes apply within a minute.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between rounded-lg border p-3">
            <div>
              <Label htmlFor="enabled">Daily run</Label>
              <p className="text-sm text-muted-foreground">
                {form.enabled ? 'On' : 'Paused. Nothing runs until you turn it back on.'}
              </p>
            </div>
            <Switch id="enabled" checked={form.enabled} onCheckedChange={(v) => set('enabled', v)} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="runTime">Time</Label>
              <Input
                id="runTime"
                type="time"
                value={form.runTime}
                onChange={(e) => set('runTime', e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Timezone</Label>
              <Select value={form.timezone} onValueChange={(v) => set('timezone', v)}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {timezones.map((tz) => (
                    <SelectItem key={tz} value={tz}>
                      {tz.replace('_', ' ')}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
        <CardFooter className="flex-wrap gap-2 border-t">
          <Button type="button" variant="outline" onClick={handleDryRun} disabled={running !== null}>
            {running === 'dry' ? <Loader2 className="animate-spin" /> : <FlaskConical />}
            Dry run
          </Button>
          <Button type="button" variant="outline" onClick={handleRun} disabled={running !== null}>
            {running === 'run' ? <Loader2 className="animate-spin" /> : <Play />}
            Run now
          </Button>
          <p className="text-xs text-muted-foreground">
            Dry run searches but saves nothing. Both use the saved settings.
          </p>
        </CardFooter>
      </Card>

      {preview && <DryRunResult summary={preview} onClose={() => setPreview(null)} />}

      <Card>
        <CardHeader>
          <CardTitle>Search</CardTitle>
          <CardDescription>Where to look and what counts as a good lead.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
            <Field label="Home latitude" id="homeLat">
              <Input id="homeLat" inputMode="decimal" placeholder="30.3322" value={form.homeLat} onChange={(e) => set('homeLat', e.target.value)} />
            </Field>
            <Field label="Home longitude" id="homeLng">
              <Input id="homeLng" inputMode="decimal" placeholder="-81.6557" value={form.homeLng} onChange={(e) => set('homeLng', e.target.value)} />
            </Field>
            <Button type="button" variant="outline" onClick={locate}>
              <LocateFixed /> Use my location
            </Button>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Radius (miles)" id="radius">
              <Input id="radius" type="number" min={1} max={50} step={1} value={form.radiusMiles as number} onChange={(e) => set('radiusMiles', e.target.value)} />
            </Field>
            <Field label="Min rating" id="minRating">
              <Input id="minRating" type="number" min={1} max={5} step={0.1} value={form.minRating as number} onChange={(e) => set('minRating', e.target.value)} />
            </Field>
            <Field label="Min reviews" id="minReviews">
              <Input id="minReviews" type="number" min={0} step={1} value={form.minReviews as number} onChange={(e) => set('minReviews', e.target.value)} />
            </Field>
            <Field label="Leads per day" id="dailyLimit">
              <Input id="dailyLimit" type="number" min={1} max={25} step={1} value={form.dailyLimit as number} onChange={(e) => set('dailyLimit', e.target.value)} />
            </Field>
            <Field label="Max API calls per run" id="maxCalls" hint="Cost guard">
              <Input id="maxCalls" type="number" min={5} max={500} step={1} value={form.maxApiCallsPerRun as number} onChange={(e) => set('maxApiCallsPerRun', e.target.value)} />
            </Field>
          </div>

          <div className="space-y-2">
            <Label htmlFor="category">Categories</Label>
            <div className="flex flex-wrap gap-1.5">
              {form.categories.map((c) => (
                <Badge key={c} variant="secondary" className="gap-1 pr-1 capitalize">
                  {c}
                  <button
                    type="button"
                    aria-label={`Remove ${c}`}
                    className="rounded-sm p-0.5 hover:bg-foreground/10"
                    onClick={() => set('categories', form.categories.filter((x) => x !== c))}
                  >
                    <X className="size-3" />
                  </button>
                </Badge>
              ))}
            </div>
            <div className="flex gap-2">
              <Input
                id="category"
                value={category}
                placeholder="e.g. auto repair"
                onChange={(e) => setCategory(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ',') {
                    e.preventDefault();
                    addCategory();
                  }
                }}
              />
              <Button type="button" variant="outline" onClick={addCategory}>
                Add
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="sticky bottom-4 z-10 flex justify-end">
        <Button type="submit" disabled={saving} className="shadow-lg">
          {saving ? <Loader2 className="animate-spin" /> : <Save />}
          Save settings
        </Button>
      </div>
    </form>
  );
}

function Field({ label, id, hint, children }: { label: string; id: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>
        {label}
        {hint && <span className="font-normal text-muted-foreground">· {hint}</span>}
      </Label>
      {children}
    </div>
  );
}

function DryRunResult({ summary, onClose }: { summary: RunSummary; onClose: () => void }) {
  return (
    <Card className="border-sky-500/40">
      <CardHeader>
        <CardTitle>Dry run: {summary.leads.length} leads would be saved</CardTitle>
        <CardDescription>
          {summary.apiCalls} API calls · {summary.candidatesSeen} places seen · nothing written
          {summary.errors.length > 0 && ` · ${summary.errors.length} errors`}
        </CardDescription>
      </CardHeader>
      <CardContent className="px-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="pl-6">Business</TableHead>
              <TableHead>Rating</TableHead>
              <TableHead className="pr-6 text-right">Distance</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {summary.leads.map((l) => (
              <TableRow key={l.placeId}>
                <TableCell className="pl-6">
                  <div className="font-medium">{l.name}</div>
                  <div className="text-xs capitalize text-muted-foreground">{l.category}</div>
                </TableCell>
                <TableCell className="tabular-nums">
                  ⭐ {l.rating} <span className="text-muted-foreground">({l.reviewCount})</span>
                </TableCell>
                <TableCell className="pr-6 text-right tabular-nums">{l.distanceMiles} mi</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
      <CardFooter className="border-t">
        <Button type="button" variant="ghost" size="sm" onClick={onClose}>
          Dismiss
        </Button>
      </CardFooter>
    </Card>
  );
}
