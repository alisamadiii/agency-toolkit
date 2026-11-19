import { describe, expect, it } from 'vitest';

import { nextRunAt, zonedParts } from '@/lib/time';

describe('zonedParts', () => {
  it('converts UTC to New York wall time (EST)', () => {
    expect(zonedParts(new Date('2026-01-15T13:00:00Z'), 'America/New_York')).toEqual({
      day: '2026-01-15',
      time: '08:00',
    });
  });

  it('handles daylight saving (EDT)', () => {
    expect(zonedParts(new Date('2026-07-15T12:00:00Z'), 'America/New_York').time).toBe('08:00');
  });
});

describe('nextRunAt', () => {
  it('returns today when the time is still ahead', () => {
    const from = new Date('2026-01-15T12:00:00Z'); // 07:00 EST
    expect(nextRunAt('08:00', 'America/New_York', from).toISOString()).toBe('2026-01-15T13:00:00.000Z');
  });

  it('rolls to tomorrow when the time has passed', () => {
    const from = new Date('2026-01-15T14:00:00Z'); // 09:00 EST
    expect(nextRunAt('08:00', 'America/New_York', from).toISOString()).toBe('2026-01-16T13:00:00.000Z');
  });
});
