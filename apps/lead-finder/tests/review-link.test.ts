import { describe, expect, it } from 'vitest';

import { reviewLinkFor } from '@/lib/review-link';

describe('reviewLinkFor', () => {
  it('builds the writereview link from a place ID', () => {
    expect(reviewLinkFor('ChIJR3DcogrK5YgRYK38wOz4Y14')).toBe(
      'https://search.google.com/local/writereview?placeid=ChIJR3DcogrK5YgRYK38wOz4Y14',
    );
  });

  it('encodes unexpected characters', () => {
    expect(reviewLinkFor('a b')).toBe('https://search.google.com/local/writereview?placeid=a%20b');
  });
});
