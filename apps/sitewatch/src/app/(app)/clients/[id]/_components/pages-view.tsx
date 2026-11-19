import { CircleCheck } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

export type PageView = {
  url: string;
  problems: { errors: number; warnings: number } | null;
};

export function PagesView({ pages }: { pages: PageView[] }) {
  return (
    <Card>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Page</TableHead>
              <TableHead className="w-40 text-right">Last check</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {pages.map((page) => (
              <TableRow key={page.url}>
                <TableCell className="max-w-md truncate font-mono text-xs">
                  {pathOf(page.url)}
                </TableCell>
                <TableCell className="text-right">
                  {!page.problems ? (
                    <span className="text-xs text-muted-foreground">—</span>
                  ) : page.problems.errors > 0 ? (
                    <Badge variant="destructive">{page.problems.errors} errors</Badge>
                  ) : page.problems.warnings > 0 ? (
                    <Badge variant="secondary">{page.problems.warnings} warnings</Badge>
                  ) : (
                    <CircleCheck className="ml-auto size-4 text-emerald-500" />
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function pathOf(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}
