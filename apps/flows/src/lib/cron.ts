import { CronExpressionParser } from 'cron-parser';

export function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

// Next fire times strictly after `from`. Throws on a bad expression or timezone.
export function nextRuns(cron: string, timezone: string, count = 1, from = new Date()): Date[] {
  if (!isValidTimezone(timezone)) throw new Error(`Unknown timezone "${timezone}"`);
  const interval = CronExpressionParser.parse(cron, { tz: timezone, currentDate: from, strict: false });
  return interval.take(count).map((d) => d.toDate());
}

export function nextRun(cron: string, timezone: string, from = new Date()): Date {
  return nextRuns(cron, timezone, 1, from)[0];
}

// Validation message for the API, or null when the expression is fine.
export function cronError(cron: string, timezone: string): string | null {
  try {
    const [first, second] = nextRuns(cron, timezone, 2);
    // Sub-minute schedules would flood the queue; the scheduler ticks every 15s anyway.
    if (second && second.getTime() - first.getTime() < 60_000) return 'Schedules must be at least 1 minute apart';
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : 'Invalid cron expression';
  }
}
