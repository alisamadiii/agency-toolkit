// Hosts that mean "this business has no real website of its own".
const SOCIAL_HOSTS = [
  'facebook.com',
  'fb.com',
  'fb.me',
  'instagram.com',
  'yelp.com',
  'linktr.ee',
  'linkin.bio',
  'business.site',
  'sites.google.com',
  'g.page',
  'business.google.com',
  'doordash.com',
  'ubereats.com',
  'grubhub.com',
  'postmates.com',
  'seamless.com',
  'square.site',
  'toasttab.com',
  'order.online',
  'tiktok.com',
  'twitter.com',
  'x.com',
  'nextdoor.com',
  'youtube.com',
  'linkedin.com',
  'pinterest.com',
  'thumbtack.com',
  'angi.com',
  'homeadvisor.com',
  'booksy.com',
  'vagaro.com',
  'styleseat.com',
  'schedulicity.com',
  'squareup.com',
  'clover.com',
  'menufy.com',
  'beacons.ai',
];

export function isSocialOnlyUrl(url: string): boolean {
  let host: string;
  try {
    host = new URL(url.includes('://') ? url : `https://${url}`).hostname.toLowerCase();
  } catch {
    return false;
  }
  host = host.replace(/^www\./, '');
  // google.com/maps style links are listings too.
  if (host === 'google.com' || host.endsWith('.google.com')) return true;
  return SOCIAL_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));
}
