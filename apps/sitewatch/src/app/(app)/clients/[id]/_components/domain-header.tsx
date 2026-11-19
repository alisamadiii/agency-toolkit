'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { ExternalLink, Loader2, Play, Settings2, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

import { deleteClient, runNow, updateClient } from '@/app/actions/clients';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';

export type DomainHeaderClient = {
  id: string;
  name: string;
  baseUrl: string;
  enabled: boolean;
  sitemapUrl: string | null;
  criticalPaths: string[] | null;
  cdnHosts: string[] | null;
};

export function DomainHeader({
  client,
  checkRunning,
}: {
  client: DomainHeaderClient;
  checkRunning: boolean;
}) {
  const router = useRouter();
  const [starting, setStarting] = React.useState(false); // Run-now action in flight
  const [optimistic, setOptimistic] = React.useState(false); // bridge until server sees the run
  const checking = checkRunning || optimistic;
  const prevRunning = React.useRef(checkRunning);

  // Toast when a running crawl finishes (server flips running -> done).
  React.useEffect(() => {
    if (checkRunning) setOptimistic(false); // server now tracks it; drop the bridge
    if (prevRunning.current && !checkRunning) {
      toast.success('Check complete');
      setOptimistic(false);
    }
    prevRunning.current = checkRunning;
  }, [checkRunning]);

  // Poll for completion while a check is running.
  React.useEffect(() => {
    if (!checking) return;
    const t = setInterval(() => router.refresh(), 4000);
    return () => clearInterval(t);
  }, [checking, router]);

  // Safety net: if the server never reports a running crawl (e.g. it finished
  // or was skipped before the first poll), stop pretending after 25s.
  React.useEffect(() => {
    if (!optimistic) return;
    const t = setTimeout(() => setOptimistic(false), 25_000);
    return () => clearTimeout(t);
  }, [optimistic]);

  async function handleRunNow() {
    setStarting(true);
    const result = await runNow(client.id);
    setStarting(false);
    if (result.error) toast.error(result.error);
    else {
      toast.success('Check started');
      setOptimistic(true);
      router.refresh();
    }
  }

  return (
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div>
        <div className="flex items-center gap-2">
          <h1 className="font-heading text-3xl font-bold tracking-tight">{client.name}</h1>
          {checking && (
            <Badge variant="secondary" className="gap-1.5">
              <Loader2 className="size-3 animate-spin" />
              Checking…
            </Badge>
          )}
        </div>
        <a
          href={client.baseUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:underline"
        >
          {client.baseUrl.replace(/^https?:\/\//, '')}
          <ExternalLink className="size-3" />
        </a>
      </div>
      <div className="flex gap-2">
        <Button onClick={handleRunNow} disabled={starting || checking}>
          {starting || checking ? <Loader2 className="animate-spin" /> : <Play />}
          {checking ? 'Checking…' : 'Run check now'}
        </Button>
        <AdvancedDialog client={client} />
        <DeleteButton id={client.id} name={client.name} />
      </div>
    </div>
  );
}

function AdvancedDialog({ client }: { client: DomainHeaderClient }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [form, setForm] = React.useState({
    name: client.name,
    enabled: client.enabled,
    sitemapUrl: client.sitemapUrl ?? '',
    criticalPaths: (client.criticalPaths ?? []).join('\n'),
    cdnHosts: (client.cdnHosts ?? []).join('\n'),
  });

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    const result = await updateClient(client.id, {
      name: form.name,
      enabled: form.enabled,
      sitemapUrl: form.sitemapUrl.trim() || null,
      criticalPaths: splitLines(form.criticalPaths),
      cdnHosts: splitLines(form.cdnHosts),
    });
    setSaving(false);
    if (result.error) toast.error(result.error);
    else {
      toast.success('Saved');
      setOpen(false);
      router.refresh();
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <Settings2 /> Advanced
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-heading">Advanced settings</DialogTitle>
          <DialogDescription>
            All optional — monitoring works with just the domain. These unlock
            the deeper checks.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSave} className="space-y-4">
          <div className="space-y-1.5">
            <Label>Name</Label>
            <Input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </div>
          <div className="flex items-center justify-between">
            <Label>Monitoring enabled</Label>
            <Switch
              checked={form.enabled}
              onCheckedChange={(enabled) => setForm({ ...form, enabled })}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Sitemap URL override</Label>
            <Input
              placeholder="auto-discovered when empty"
              value={form.sitemapUrl}
              onChange={(e) => setForm({ ...form, sitemapUrl: e.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Critical paths (one per line)</Label>
            <Textarea
              rows={3}
              placeholder={'/\n/contact\n/pricing'}
              value={form.criticalPaths}
              onChange={(e) => setForm({ ...form, criticalPaths: e.target.value })}
            />
            <p className="text-xs text-muted-foreground">
              Screenshotted on every run and watched for stale content.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label>Approved CDN hosts (one per line)</Label>
            <Textarea
              rows={2}
              placeholder={'cdn.example.com\nimages.example.com'}
              value={form.cdnHosts}
              onChange={(e) => setForm({ ...form, cdnHosts: e.target.value })}
            />
            <p className="text-xs text-muted-foreground">
              When set, any image served from another host is flagged.
            </p>
          </div>
          <DialogFooter>
            <Button type="submit" disabled={saving}>
              {saving && <Loader2 className="animate-spin" />}
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function DeleteButton({ id, name }: { id: string; name: string }) {
  const router = useRouter();

  async function handleDelete() {
    const result = await deleteClient(id);
    if (result.error) toast.error(result.error);
    else {
      toast.success(`${name} removed`);
      router.push('/');
      router.refresh();
    }
  }

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="outline" size="icon">
          <Trash2 />
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Stop monitoring {name}?</AlertDialogTitle>
          <AlertDialogDescription>
            Deletes the website along with its history, findings and uptime
            data. This cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={handleDelete}>Delete</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function splitLines(value: string): string[] | null {
  const lines = value
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  return lines.length > 0 ? lines : null;
}
