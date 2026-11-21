// Google's public "write a review" link: opens the review box on top of the
// business profile. Works from a place ID alone, no owner access needed.
export function reviewLinkFor(placeId: string): string {
  return `https://search.google.com/local/writereview?placeid=${encodeURIComponent(placeId)}`;
}
