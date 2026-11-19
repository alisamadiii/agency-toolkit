'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import {
  AlertTriangle,
  BellOff,
  ChevronDown,
  CircleCheck,
  CircleX,
  Copy,
  Crosshair,
  ExternalLink,
  RotateCcw,
  Sparkles,
} from 'lucide-react';
import { toast } from 'sonner';

import { ignoreIncident, unignoreIncident } from '@/app/actions/clients';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { formatFindingForAI, formatFindingsForAI } from '@/lib/format-finding';

import { timeAgo } from '../../../clients-dashboard';

export type IncidentView = {
  id: string;
  checkType: string;
  pageUrl: string;
  severity: 'error' | 'warning';
  message: string;
  details: Record<string, unknown> | null;
  firstSeenAt: string;
  ignoredAt: string | null;
};

type SiteRef = { name: string; baseUrl: string };

async function copyToClipboard(text: string, what: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(`${what} copied — paste it into Claude`);
  } catch {
    toast.error('Clipboard unavailable');
  }
}

export function ProblemsView({
  site,
  incidents,
  ignoredIncidents,
}: {
  site: SiteRef;
  incidents: IncidentView[];
  ignoredIncidents: IncidentView[];
}) {
  const errors = incidents.filter((i) => i.severity === 'error');
  const warnings = incidents.filter((i) => i.severity === 'warning');

  return (
    <div className="space-y-4">
      {incidents.length === 0 ? (
        <Card>
          <CardContent className="flex items-center gap-3 py-10">
            <CircleCheck className="size-6 text-emerald-500" />
            <p className="text-sm">No open problems — everything looks healthy.</p>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="flex justify-end">
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                copyToClipboard(
                  formatFindingsForAI(site.name, site.baseUrl, incidents, 'problems'),
                  'All problems'
                )
              }
            >
              <Sparkles /> Copy all for AI
            </Button>
          </div>
          {errors.length > 0 && (
            <IncidentList title="Errors" items={errors} tone="error" site={site} />
          )}
          {warnings.length > 0 && (
            <IncidentList title="Warnings" items={warnings} tone="warning" site={site} />
          )}
        </>
      )}

      {ignoredIncidents.length > 0 && <IgnoredSection items={ignoredIncidents} />}
    </div>
  );
}

function IncidentList({
  title,
  items,
  tone,
  site,
}: {
  title: string;
  items: IncidentView[];
  tone: 'error' | 'warning';
  site: SiteRef;
}) {
  const router = useRouter();

  async function handleIgnore(id: string) {
    const result = await ignoreIncident(id);
    if (result.error) toast.error(result.error);
    else {
      toast.success('Ignored — it won’t alert again');
      router.refresh();
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-4">
          <CardTitle className="flex items-center gap-2 font-heading text-lg">
            {tone === 'error' ? (
              <CircleX className="size-5 text-destructive" />
            ) : (
              <AlertTriangle className="size-5 text-amber-500" />
            )}
            {title} ({items.length})
          </CardTitle>
          <Button
            variant="ghost"
            size="sm"
            onClick={() =>
              copyToClipboard(
                formatFindingsForAI(site.name, site.baseUrl, items, title.toLowerCase()),
                title
              )
            }
          >
            <Sparkles /> Copy for AI
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {items.map((incident) => (
          <div key={incident.id} className="flex items-start justify-between gap-3 text-sm">
            <div className="min-w-0">
              <p className="font-medium">{incident.message}</p>
              <p className="truncate text-xs text-muted-foreground">
                <Badge variant="outline" className="mr-1.5 font-mono text-[10px]">
                  {incident.checkType}
                </Badge>
                {pathOf(incident.pageUrl) || incident.pageUrl}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <span className="mr-1 text-xs text-muted-foreground">
                since {timeAgo(incident.firstSeenAt)}
              </span>
              <LocateButton incident={incident} />
              <Button
                variant="ghost"
                size="icon-sm"
                title="Copy for AI"
                onClick={() => copyToClipboard(formatFindingForAI(incident), 'Problem')}
              >
                <Copy />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                title="Ignore — stop alerting on this"
                onClick={() => handleIgnore(incident.id)}
              >
                <BellOff />
              </Button>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

// Muted problems: hidden from the active lists, collapsed by default, each with
// a Restore button that un-mutes it (and lets it alert again).
function IgnoredSection({ items }: { items: IncidentView[] }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);

  async function handleRestore(id: string) {
    const result = await unignoreIncident(id);
    if (result.error) toast.error(result.error);
    else {
      toast.success('Restored');
      router.refresh();
    }
  }

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <Card>
        <CardHeader>
          <CollapsibleTrigger asChild>
            <button
              type="button"
              className="flex w-full items-center justify-between gap-4 text-left"
            >
              <CardTitle className="flex items-center gap-2 font-heading text-lg text-muted-foreground">
                <BellOff className="size-5" />
                Ignored ({items.length})
              </CardTitle>
              <ChevronDown
                className={`size-4 text-muted-foreground transition-transform ${
                  open ? 'rotate-180' : ''
                }`}
              />
            </button>
          </CollapsibleTrigger>
        </CardHeader>
        <CollapsibleContent>
          <CardContent className="space-y-3">
            {items.map((incident) => (
              <div
                key={incident.id}
                className="flex items-start justify-between gap-3 text-sm"
              >
                <div className="min-w-0">
                  <p className="font-medium text-muted-foreground">{incident.message}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    <Badge variant="outline" className="mr-1.5 font-mono text-[10px]">
                      {incident.checkType}
                    </Badge>
                    {pathOf(incident.pageUrl) || incident.pageUrl}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="shrink-0"
                  onClick={() => handleRestore(incident.id)}
                >
                  <RotateCcw /> Restore
                </Button>
              </div>
            ))}
          </CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}

// Shows where the problem element lives: its screenshot (captured during the
// crawl), the CSS selector, and a link to the live page.
function LocateButton({ incident }: { incident: IncidentView }) {
  const details = incident.details ?? {};
  const selector = typeof details.selector === 'string' ? details.selector : null;
  const screenshot =
    typeof details.screenshot === 'string' && typeof details.runId === 'string'
      ? `/api/screenshots/${details.runId}/${details.screenshot}`
      : null;
  if (!selector && !screenshot) return null;

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon-sm" title="Locate element">
          <Crosshair />
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-heading">Where it is</DialogTitle>
          <DialogDescription className="break-words">{incident.message}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          {screenshot && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={screenshot}
              alt="The affected element"
              className="max-h-64 w-full rounded-lg border object-contain bg-muted/30"
            />
          )}
          {selector && (
            <button
              type="button"
              className="w-full rounded-lg border bg-muted/50 px-3 py-2 text-left font-mono text-xs break-all hover:bg-muted"
              title="Click to copy selector"
              onClick={() => copyToClipboard(selector, 'Selector')}
            >
              {selector}
            </button>
          )}
          <p className="text-xs text-muted-foreground">
            Open the page, then find the element with this selector in DevTools
            (Cmd+F in the Elements panel).
          </p>
          <Button asChild variant="outline" className="w-full">
            <a href={incident.pageUrl} target="_blank" rel="noreferrer">
              Open page <ExternalLink />
            </a>
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function pathOf(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}
