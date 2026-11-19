'use client';

import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from 'recharts';

import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart';

const config = {
  leads: { label: 'New leads', color: 'oklch(0.65 0.15 160)' },
} satisfies ChartConfig;

export function LeadsChart({ data }: { data: { day: string; leads: number }[] }) {
  return (
    <ChartContainer config={config} className="h-56 w-full">
      <BarChart data={data} margin={{ left: -20, right: 4, top: 8 }}>
        <CartesianGrid vertical={false} />
        <XAxis
          dataKey="day"
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          minTickGap={16}
          tickFormatter={(d: string) =>
            new Date(`${d}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
          }
        />
        <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={40} />
        <ChartTooltip cursor={false} content={<ChartTooltipContent />} />
        <Bar dataKey="leads" fill="var(--color-leads)" radius={4} isAnimationActive={false} />
      </BarChart>
    </ChartContainer>
  );
}
