'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';

import { useApp } from '@/components/app-context';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export function NewWorkflowForm({ workspaceId, hasHttpbin }: { workspaceId: string; hasHttpbin: boolean }) {
  const router = useRouter();
  const { actions, paths } = useApp();
  const { createWorkflowAction } = actions;
  const [name, setName] = useState('');
  const [pending, start] = useTransition();

  const create = (template: 'blank' | 'example') =>
    start(async () => {
      const res = await createWorkflowAction(workspaceId, name || (template === 'example' ? 'Example workflow' : ''), template);
      if (!res.ok) return void toast.error(res.error);
      router.push(paths.workflow(workspaceId, res.data!.id));
    });

  return (
    <Card>
      <CardContent className="grid gap-4 pt-6">
        <div className="grid gap-1.5">
          <Label htmlFor="wf-name">Name</Label>
          <Input id="wf-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Daily report" autoFocus />
        </div>
        <div className="flex flex-wrap gap-2">
          <Button disabled={pending} onClick={() => create('blank')}>
            Create blank workflow
          </Button>
          <Button variant="outline" disabled={pending} onClick={() => create('example')}>
            Start from example
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          The example fetches httpbin.org, branches with IF on the status code, and shapes the result with Code.
          {!hasHttpbin && ' Add httpbin.org to this workspace’s allowed hosts to run it.'}
        </p>
      </CardContent>
    </Card>
  );
}
