'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { CircleCheck, CircleX, Clock, Pencil, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

import { updateClient } from '@/app/actions/clients';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { JsonEditor } from '@/components/json-editor';
import type { EndpointCheck } from '@/db/schema';

type Status = 'up' | 'down' | 'pending';
type EndpointWithStatus = EndpointCheck & { status: Status; downReason: string | null };

type EndpointRow = {
  id: string;
  name: string;
  url: string;
  method: 'GET' | 'POST' | 'PUT';
  body: string;
  expectStatus: string;
  expectKeys: string;
};

export function EndpointsView({
  clientId,
  endpoints,
}: {
  clientId: string;
  endpoints: EndpointWithStatus[];
}) {
  const router = useRouter();
  const [editing, setEditing] = React.useState<EndpointRow | null>(null);
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [saving, setSaving] = React.useState(false);

  // Persist the full list (server recomputes status on refresh).
  async function persist(checks: EndpointCheck[]) {
    setSaving(true);
    const result = await updateClient(clientId, {
      endpointChecks: checks.length ? checks : null,
    });
    setSaving(false);
    if (result.error) {
      toast.error(result.error);
      return false;
    }
    router.refresh();
    return true;
  }

  function currentChecks(): EndpointCheck[] {
    return endpoints.map(({ status, downReason, ...e }) => {
      void status;
      void downReason;
      return e;
    });
  }

  function openAdd() {
    setEditing(emptyRow());
    setDialogOpen(true);
  }

  function openEdit(e: EndpointWithStatus) {
    setEditing({
      id: e.id,
      name: e.name,
      url: e.url,
      method: e.method,
      body: e.body ?? '',
      expectStatus: e.expectStatus != null ? String(e.expectStatus) : '',
      expectKeys: (e.expectKeys ?? []).join('\n'),
    });
    setDialogOpen(true);
  }

  async function handleRemove(id: string) {
    await persist(currentChecks().filter((e) => e.id !== id));
    toast.success('Endpoint removed');
  }

  async function handleSubmit(row: EndpointRow) {
    if (!row.name.trim() || !row.url.trim()) {
      toast.error('Name and URL are required');
      return;
    }
    const status = row.expectStatus.trim();
    if (status && Number.isNaN(Number(status))) {
      toast.error('Expected status must be a number');
      return;
    }
    const sendsBody = row.method === 'POST' || row.method === 'PUT';
    if (sendsBody && row.body.trim() && !isValidJson(row.body)) {
      toast.error('Request body is not valid JSON');
      return;
    }
    const check: EndpointCheck = {
      id: row.id,
      name: row.name.trim(),
      url: row.url.trim(),
      method: row.method,
      body: row.body.trim() || null,
      expectStatus: status ? Number(status) : null,
      expectKeys: splitLines(row.expectKeys),
    };

    const existing = currentChecks();
    const next = existing.some((e) => e.id === row.id)
      ? existing.map((e) => (e.id === row.id ? check : e))
      : [...existing, check];

    if (await persist(next)) {
      setDialogOpen(false);
      toast.success('Saved');
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-heading text-xl font-semibold">Endpoints</h2>
          <p className="text-sm text-muted-foreground">
            HTTP checks hit on every crawl. A bad status or missing key opens a problem.
          </p>
        </div>
        <Button onClick={openAdd}>
          <Plus /> Add endpoint
        </Button>
      </div>

      {endpoints.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
            <p className="text-sm text-muted-foreground">
              No endpoints yet. Add one to monitor an API or health route.
            </p>
            <Button variant="outline" onClick={openAdd}>
              <Plus /> Add endpoint
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {endpoints.map((e) => (
            <Card key={e.id}>
              <CardContent className="flex items-start justify-between gap-4">
                <div className="min-w-0 space-y-1">
                  <div className="flex items-center gap-2">
                    <StatusBadge status={e.status} />
                    <span className="font-medium">{e.name}</span>
                  </div>
                  <p className="truncate text-xs text-muted-foreground">
                    <Badge variant="outline" className="mr-1.5 font-mono text-[10px]">
                      {e.method}
                    </Badge>
                    {e.url}
                  </p>
                  {e.status === 'down' && e.downReason && (
                    <p className="text-xs text-destructive">{e.downReason}</p>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    title="Edit"
                    onClick={() => openEdit(e)}
                  >
                    <Pencil />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    title="Remove"
                    onClick={() => handleRemove(e.id)}
                  >
                    <Trash2 />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <EndpointDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        row={editing}
        saving={saving}
        onSubmit={handleSubmit}
      />
    </div>
  );
}

function StatusBadge({ status }: { status: Status }) {
  if (status === 'up')
    return (
      <Badge className="gap-1 bg-emerald-600 text-white hover:bg-emerald-600">
        <CircleCheck className="size-3" /> Up
      </Badge>
    );
  if (status === 'down')
    return (
      <Badge variant="destructive" className="gap-1">
        <CircleX className="size-3" /> Down
      </Badge>
    );
  return (
    <Badge variant="secondary" className="gap-1">
      <Clock className="size-3" /> Pending
    </Badge>
  );
}

function EndpointDialog({
  open,
  onOpenChange,
  row,
  saving,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  row: EndpointRow | null;
  saving: boolean;
  onSubmit: (row: EndpointRow) => void;
}) {
  const [form, setForm] = React.useState<EndpointRow>(row ?? emptyRow());

  // Resync when a different endpoint (or Add) is opened.
  React.useEffect(() => {
    if (row) setForm(row);
  }, [row]);

  const isEdit = row != null && row.name !== '';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-heading">
            {isEdit ? 'Edit endpoint' : 'Add endpoint'}
          </DialogTitle>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onSubmit(form);
          }}
          className="space-y-4"
        >
          <div className="space-y-1.5">
            <Label>Name</Label>
            <Input
              placeholder="Quote API"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </div>
          <div className="flex gap-2">
            <div className="space-y-1.5">
              <Label>Method</Label>
              <Select
                value={form.method}
                onValueChange={(method) =>
                  setForm({ ...form, method: method as EndpointRow['method'] })
                }
              >
                <SelectTrigger className="w-24">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="GET">GET</SelectItem>
                  <SelectItem value="POST">POST</SelectItem>
                  <SelectItem value="PUT">PUT</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex-1 space-y-1.5">
              <Label>Expected status</Label>
              <Input
                placeholder="200 (optional)"
                value={form.expectStatus}
                onChange={(e) => setForm({ ...form, expectStatus: e.target.value })}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>URL or path</Label>
            <Input
              placeholder="/api/health or https://…"
              value={form.url}
              onChange={(e) => setForm({ ...form, url: e.target.value })}
            />
          </div>
          {(form.method === 'POST' || form.method === 'PUT') && (
            <div className="space-y-1.5">
              <Label>Request body (JSON)</Label>
              <JsonEditor
                value={form.body}
                onChange={(body) => setForm({ ...form, body })}
                placeholder={'{\n  "service": "web"\n}'}
                minHeight="88px"
              />
              {form.body.trim() !== '' && !isValidJson(form.body) && (
                <p className="text-xs text-destructive">Invalid JSON</p>
              )}
            </div>
          )}
          <div className="space-y-1.5">
            <Label>Expected response keys (one per line)</Label>
            <Textarea
              rows={2}
              placeholder={'price\ncurrency'}
              value={form.expectKeys}
              onChange={(e) => setForm({ ...form, expectKeys: e.target.value })}
            />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={saving}>
              {saving && <span className="animate-pulse">…</span>}
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function emptyRow(): EndpointRow {
  return {
    id: crypto.randomUUID(),
    name: '',
    url: '',
    method: 'GET',
    body: '',
    expectStatus: '',
    expectKeys: '',
  };
}

function splitLines(value: string): string[] | null {
  const lines = value
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  return lines.length > 0 ? lines : null;
}

function isValidJson(text: string): boolean {
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
}
