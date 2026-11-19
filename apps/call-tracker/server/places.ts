// Google Places API (New) Text Search client, ported from the Portfolio
// monorepo (packages/trpc/src/lib/places.ts). Enterprise field mask —
// websiteUri/phone/rating are Enterprise SKU, free tier 1,000 calls/month.

export interface PlaceResult {
  id: string;
  displayName?: { text?: string };
  formattedAddress?: string;
  nationalPhoneNumber?: string;
  websiteUri?: string;
  rating?: number;
  userRatingCount?: number;
  googleMapsUri?: string;
  types?: string[];
  primaryTypeDisplayName?: { text?: string };
  businessStatus?: string;
  location?: { latitude?: number; longitude?: number };
}

const FIELD_MASK = [
  "places.id",
  "places.displayName",
  "places.formattedAddress",
  "places.nationalPhoneNumber",
  "places.websiteUri",
  "places.rating",
  "places.userRatingCount",
  "places.googleMapsUri",
  "places.types",
  "places.primaryTypeDisplayName",
  "places.businessStatus",
  "places.location",
  "nextPageToken",
].join(",");

// One page of 20 per call. The caller paginates with nextPageToken (Google
// caps a query at 60 results / 3 pages; each page bills as a full request and
// a fresh token needs a ~2s warm-up before use).
export async function searchPlacesPage(
  textQuery: string,
  pageToken?: string
): Promise<{ places: PlaceResult[]; nextPageToken?: string; error?: string }> {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) {
    throw new Error("GOOGLE_PLACES_API_KEY is not set");
  }

  let res: Response;
  try {
    res = await fetch("https://places.googleapis.com/v1/places:searchText", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": FIELD_MASK,
      },
      body: JSON.stringify({
        textQuery,
        pageSize: 20,
        ...(pageToken ? { pageToken } : {}),
      }),
    });
  } catch (error) {
    return {
      places: [],
      error: error instanceof Error ? error.message : "Network error",
    };
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    return {
      places: [],
      error: `Places API ${res.status}: ${body.slice(0, 300)}`,
    };
  }

  const data = (await res.json()) as {
    places?: PlaceResult[];
    nextPageToken?: string;
  };
  return { places: data.places ?? [], nextPageToken: data.nextPageToken };
}

// Hosts that count as "no real website" — social pages and free site builders.
const SOCIAL_HOSTS = [
  "facebook.com",
  "instagram.com",
  "linktr.ee",
  "business.site",
  "godaddysites.com",
  "wixsite.com",
  "square.site",
  "yelp.com",
];

export function isSocialOnly(website: string): boolean {
  try {
    const host = new URL(website).hostname.replace(/^www\./, "");
    return SOCIAL_HOSTS.some((s) => host === s || host.endsWith(`.${s}`));
  } catch {
    return false;
  }
}

// True = site dead. CONSERVATIVE on purpose: dead means only a network-level
// failure (DNS, refused, timeout — after one retry) or a hard 404/410 on the
// root URL. Any other HTTP response proves a server answers for the domain —
// WAF bot blocks (403), Cloudflare challenges (403/503), auth walls (401),
// and rate limits (429) all come from LIVE sites.
export async function isWebsiteDead(website: string): Promise<boolean> {
  const attempt = async () => {
    const res = await fetch(website, {
      redirect: "follow",
      signal: AbortSignal.timeout(8000),
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36",
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
    });
    // Status is all we need — drop the body without downloading it.
    void res.body?.cancel().catch(() => {});
    return res.status === 404 || res.status === 410;
  };

  // Misconfigured-but-live TLS (incomplete chains, hostname mismatches):
  // browsers tolerate these, strict clients throw. A server that presented a
  // certificate is answering — not dead.
  const isTlsError = (err: unknown): boolean => {
    let current = err as { code?: string; cause?: unknown } | null;
    for (let depth = 0; current && depth < 5; depth++) {
      const code = String(current.code ?? "");
      if (code.includes("CERT") || code.includes("SSL") || code.includes("TLS"))
        return true;
      current = current.cause as typeof current;
    }
    return false;
  };

  try {
    return await attempt();
  } catch (err) {
    if (isTlsError(err)) return false;
    // Transient DNS/conn hiccups happen under parallel scan load — one retry
    // before a "dead" verdict.
    try {
      return await attempt();
    } catch (retryErr) {
      return !isTlsError(retryErr);
    }
  }
}

/** Promise.all with bounded concurrency — order-preserving. */
export async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from(
    { length: Math.min(limit, items.length) },
    async () => {
      while (next < items.length) {
        const i = next++;
        results[i] = await fn(items[i]!);
      }
    }
  );
  await Promise.all(workers);
  return results;
}
