import { formatDistanceToNowStrict } from 'date-fns';

export const ago = (d: Date | string | null | undefined) =>
  d ? formatDistanceToNowStrict(new Date(d), { addSuffix: true }) : '—';

export function duration(start: Date, end: Date | null) {
  if (!end) return '—';
  const s = Math.round((end.getTime() - start.getTime()) / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

export const dateTime = (d: Date | string, timeZone?: string) =>
  new Date(d).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone,
  });
