import { describe, expect, it } from 'vitest';

import { isSocialOnlyUrl } from '@/lib/social';

describe('isSocialOnlyUrl', () => {
  it.each([
    'https://www.facebook.com/joespestcontrol',
    'http://m.facebook.com/pages/123',
    'https://instagram.com/barber_bros',
    'https://www.yelp.com/biz/some-place',
    'https://linktr.ee/handyman',
    'https://joes-handyman.business.site/',
    'https://sites.google.com/view/thebarbershop',
    'https://www.doordash.com/store/123',
    'https://order.toasttab.com/online/place',
    'https://tacos.square.site',
    'facebook.com/no-scheme',
  ])('treats %s as social/listing', (url) => {
    expect(isSocialOnlyUrl(url)).toBe(true);
  });

  it.each([
    'https://joespestcontrol.com',
    'https://www.bestbarberjax.net/',
    'https://notfacebook.com',
    'https://facebook.com.evil.example',
  ])('treats %s as a real website', (url) => {
    expect(isSocialOnlyUrl(url)).toBe(false);
  });

  it('returns false for garbage', () => {
    expect(isSocialOnlyUrl('::::')).toBe(false);
  });
});
