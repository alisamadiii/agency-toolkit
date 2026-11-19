// Ported verbatim from the Portfolio monorepo (packages/trpc/src/routers/leads.ts).
export function scoreLead(input: {
  noWebsite: boolean;
  socialOnly: boolean;
  websiteDead: boolean;
  phone: boolean;
  rating: number | null;
  reviewCount: number;
}): number {
  let score = 0;
  if (input.noWebsite) score += 40;
  else if (input.socialOnly) score += 30;
  else if (input.websiteDead) score += 30;
  if (input.phone) score += 20;
  if (input.rating !== null) {
    if (input.rating >= 4) score += 15;
    else if (input.rating >= 3) score += 10;
  }
  if (input.reviewCount >= 20) score += 15;
  else if (input.reviewCount >= 5) score += 10;
  return score;
}
