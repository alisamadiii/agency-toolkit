// Wall-clock date and HH:mm of `date` in an IANA timezone.
export function zonedParts(date: Date, timeZone: string) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(date)
      .map((p) => [p.type, p.value])
  );
  return {
    day: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour}:${parts.minute}`,
  };
}

// Next moment the daily `runTime` (HH:mm in `timeZone`) occurs after `from`.
// Walks forward minute by minute over at most ~2 days, which keeps DST correct
// without a timezone library.
export function nextRunAt(runTime: string, timeZone: string, from = new Date()): Date {
  const start = new Date(Math.ceil(from.getTime() / 60_000) * 60_000);
  for (let i = 0; i < 2 * 24 * 60 + 120; i++) {
    const candidate = new Date(start.getTime() + i * 60_000);
    if (zonedParts(candidate, timeZone).time === runTime) return candidate;
  }
  return start;
}

export function isValidTimeZone(tz: string) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}
