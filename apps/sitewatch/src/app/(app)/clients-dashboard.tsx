'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  AlertTriangle,
  CircleCheck,
  CircleX,
  Globe,
  Loader2,
  Play,
  Plus,
} from 'lucide-react';
import { toast } from 'sonner';

import { addClient, runNow } from '@/app/actions/clients';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardAction,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
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

export type ClientCard = {
  id: string;
  name: string;
  baseUrl: string;
  enabled: boolean;
  uptimeStatus: 'unknown' | 'up' | 'down';
  pageCount: number;
  openErrors: number;
  openWarnings: number;
  lastRun: {
    id: string;
    status: string;
    startedAt: string;
    pagesChecked: number;
  } | null;
};

export function ClientsDashboard({ cards }: { cards: ClientCard[] }) {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="font-heading text-3xl font-bold tracking-tight">
            Websites
          </h1>
          <p className="text-muted-foreground">
            Every client site, checked around the clock.
          </p>
        </div>
        <AddWebsiteDialog />
      </div>

      {cards.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
            <Globe className="size-10 text-muted-foreground" />
            <p className="font-medium">No websites yet</p>
            <p className="max-w-sm text-sm text-muted-foreground">
              Add a domain and monitoring starts automatically — uptime every 5
              minutes, a full page-by-page check every day.
            </p>
            <AddWebsiteDialog />
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {cards.map((card) => (
            <WebsiteCard key={card.id} card={card} />
          ))}
        </div>
      )}
    </div>
  );
}

function WebsiteCard({ card }: { card: ClientCard }) {
  const router = useRouter();
  const [running, setRunning] = React.useState(false);

  async function handleRunNow(e: React.MouseEvent) {
    e.preventDefault();
    setRunning(true);
    const result = await runNow(card.id);
    setRunning(false);
    if (result.error) toast.error(result.error);
    else {
      toast.success('Check started — results appear as the run finishes');
      router.refresh();
    }
  }

  return (
    <Link href={`/clients/${card.id}`} className="group">
      <Card className="h-full transition-shadow group-hover:shadow-md">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 font-heading">
            <StatusDot card={card} />
            {card.name}
          </CardTitle>
          <CardAction>
            <Button
              variant="ghost"
              size="icon"
              onClick={handleRunNow}
              disabled={running}
              title="Run a full check now"
            >
              {running ? <Loader2 className="animate-spin" /> : <Play />}
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent className="space-y-2">
          <p className="truncate text-sm text-muted-foreground">
            {card.baseUrl.replace(/^https?:\/\//, '')}
          </p>
          <div className="flex flex-wrap gap-1.5">
            {card.uptimeStatus === 'down' && (
              <Badge variant="destructive" className="gap-1">
                <CircleX className="size-3" /> down
              </Badge>
            )}
            {card.openErrors > 0 && (
              <Badge variant="destructive" className="gap-1">
                <CircleX className="size-3" /> {card.openErrors} error
                {card.openErrors === 1 ? '' : 's'}
              </Badge>
            )}
            {card.openWarnings > 0 && (
              <Badge variant="secondary" className="gap-1">
                <AlertTriangle className="size-3" /> {card.openWarnings} warning
                {card.openWarnings === 1 ? '' : 's'}
              </Badge>
            )}
            {card.uptimeStatus !== 'down' &&
              card.openErrors === 0 &&
              card.openWarnings === 0 && (
                <Badge className="gap-1 bg-emerald-600 text-white hover:bg-emerald-600">
                  <CircleCheck className="size-3" /> healthy
                </Badge>
              )}
          </div>
        </CardContent>
        <CardFooter className="text-xs text-muted-foreground">
          {card.lastRun ? (
            <span>
              {card.lastRun.status === 'running'
                ? 'Check running now…'
                : `Last check ${timeAgo(card.lastRun.startedAt)}`}
            </span>
          ) : (
            <span>First check queued…</span>
          )}
          <span className="ml-auto">{card.pageCount} pages</span>
        </CardFooter>
      </Card>
    </Link>
  );
}

function StatusDot({ card }: { card: ClientCard }) {
  const color =
    card.uptimeStatus === 'down' || card.openErrors > 0
      ? 'bg-destructive'
      : card.openWarnings > 0
        ? 'bg-amber-500'
        : card.uptimeStatus === 'up'
          ? 'bg-emerald-500'
          : 'bg-muted-foreground';
  return <span className={`size-2.5 shrink-0 rounded-full ${color}`} />;
}

function AddWebsiteDialog() {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [url, setUrl] = React.useState('');
  const [saving, setSaving] = React.useState(false);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    const result = await addClient(url);
    setSaving(false);
    if (result.error) {
      toast.error(result.error);
      return;
    }
    toast.success('Website added — first check is running');
    setUrl('');
    setOpen(false);
    router.refresh();
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus /> Add website
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-heading">Add a website</DialogTitle>
          <DialogDescription>
            Just the domain. Monitoring starts immediately — no other setup.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleAdd} className="space-y-4">
          <Input
            autoFocus
            placeholder="clientsite.com"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
          <DialogFooter>
            <Button type="submit" disabled={saving || !url.trim()}>
              {saving && <Loader2 className="animate-spin" />}
              Start monitoring
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function timeAgo(iso: string): string {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}
