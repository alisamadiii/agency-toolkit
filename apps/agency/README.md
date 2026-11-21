# Agency (native iOS)

A personal iOS app that collects the small tools I use to run the agency. The first screen lists the tools; each one is a plain SwiftUI screen using system components only.

## Tools

### Review Cards

Turns a business into a Google review link and programs NFC cards with it.

1. **Leads**: the list is lead-finder's `leads` table (Neon, project Lead Tracker), nearest to home first (miles worked out live from each lead's `lat`/`lng` and `settings.home_lat/home_lng`, not the stored `distance_miles`, which goes stale when home moves), ties by `review_count * rating`. **+** adds a business as a new lead: search by name (Google Places API) or paste a place ID, pick its category and status, and it is inserted into `leads` like a lead the daily search found. There are no phone-only businesses.
2. **Review link**: `https://search.google.com/local/writereview?placeid=<PLACE_ID>`. Opening it shows the "write a review" box on top of the business's Google profile. Copy, share, or open it from the business screen.
3. **Write to Card**: hold a blank (or old) NFC card to the top of the iPhone. The link is written as an NDEF URI record, read back, and the card is saved under the business with its chip UID. Tap again for the next card. Cards are never locked, so a wrong link can always be rewritten.
4. **Verify Card**: reads any card and tells you whether it points to this business, to another saved business, to some other link, or is empty.

### Lead Tracker (Neon)

The Leads screen loads every non-hidden lead from lead-finder's Neon database (project **Lead Tracker**) on open and on pull-to-refresh, with each lead's status and category. Businesses saved on the phone before this change are inserted into Lead Tracker on the next sync (status Contacted if a card was written for them, otherwise New).

- **Adding**: the new row gets the place's name, address, phone, location, Maps link, rating, review count, `review_link`, and `distance_miles` from lead-finder's home point (`settings.home_lat/lng`, same haversine formula). `details` stays empty; run `pnpm lead:refresh <place_id>` before designing it. Adding a place that is already a hidden lead brings it back with the chosen status.

- **Status**: change it on the lead page, or by long-pressing a row. It saves straight to `leads.status`, using the same statuses as lead-finder. Choosing Design Ready also sets `design_ready`. Any status other than New stops Claude from picking that lead for a design.
- **Review link**: taken from `leads.review_link`, so an owner's `g.page/r/.../review` link put there wins over the generated one.
- **Card writes**: after a successful write, the app sets `nfc_cards_written_at` (and `review_link` if it was empty). Card records (chip UIDs) stay on the phone.

The app talks to Neon's HTTP SQL endpoint (`https://api.<region host>/sql`), the same one `@neondatabase/serverless` uses, so it needs no driver. Connect as the restricted role `agency_ios`, not the owner. That role can read lead basics and lead-finder's home point and categories, insert new leads (basic columns only), and update only `status`, `design_ready`, `review_link`, `nfc_cards_written_at` and `updated_at`. It cannot delete anything; hide a lead with the Hidden status instead. Get its connection string from the Neon console (Lead Tracker → Connect → role `agency_ios`) and paste it in Settings → Lead Tracker → Test connection. It is stored in the Keychain.

Debug builds on the simulator can skip the paste:

```sh
SIMCTL_CHILD_LEAD_TRACKER_URL='postgresql://agency_ios:…' SIMCTL_CHILD_AGENCY_OPEN=reviewCards \
  xcrun simctl launch booted com.alisamadi.agency
```

Cards that work: NTAG213 / 215 / 216 (and other ISO 14443 or ISO 15693 NDEF tags). The link is about 70 bytes, so even NTAG213 (144 bytes) fits.

### Smart Route

Plan a day of lead visits, like SoloRoute:
- **New Route:** pick up to 25 leads. Choose to start from your current location or home, and to end back home or at the last stop.
- **Ordering:** the Google **Routes API** (`computeRoutes` with `optimizeWaypointOrder`) picks the order. It uses real driving times with live traffic, not straight-line distance.
- **Navigate:** hands the current stop to Google Maps in navigation mode. If Google Maps isn't installed, Apple Maps opens instead. The app has no turn-by-turn of its own.
- **Visited:** asks whether to change the lead's status in Lead Tracker.
- **Failed:** pick a reason to skip the stop, or **Retry later** to move it to the end.
- **Undo:** in All Stops.
- **Add stop and Re-optimize:** re-order the remaining stops, starting from where you are.
- **Arrival times:** each one is now + drive time + "Time at each stop" (Settings, default 10 min).

Routes live in Lead Tracker's `routes` and `route_stops` tables (schema in lead-finder, migration 0003). Only the phone uses them. You need **Routes API** enabled on the same Google key as Places. Settings → Smart Route → **Test Routes API** checks it.

Simulator: `SIMCTL_CHILD_AGENCY_OPEN=smartRoute` (add `SIMCTL_CHILD_AGENCY_ROUTE=<route uuid>` to open a route), with `xcrun simctl location booted set <lat>,<lng>`.

### Client website preview

On a route's current stop (the **Website** button under "arriving") and on a lead's page (**Preview Website**), the app opens the website designed for that client, full screen. The site comes first; **Presentation** (`presentation.html`) and **Video** (`preview.mp4`) show up when the folder has them, plus a Pages menu.

- Source: R2 bucket `client-websites`, read through the Cloudflare REST API with one **Cloudflare API token** (Settings → Client Websites; permission Account · Workers R2 Storage · Read). The account ID is found automatically.
- Matching: folder `<slug>--<placeId>`; the part after the first `--` must equal `leads.place_id` exactly (case-sensitive). Folders without `--` are ignored.
- Serving: a `WKURLSchemeHandler` (`agencysite://site/…`) maps every path, relative or root-absolute, into the folder (`/about` → `about.html` or `about/index.html`), hides the deck's `#bar`, never serves `_meta.json`. Outside links (tel:, maps) open outside the viewer.
- Cache: lifetime, in Application Support/ClientSites. Opening a route pre-downloads the sites of its stops (not the video, which is saved on first play), so they work offline at the door. Nothing is re-fetched until **Refresh now** in Settings, which re-lists folders and re-downloads only files whose ETag changed. **Clear Cache** wipes it.

Simulator: `SIMCTL_CHILD_CLOUDFLARE_TOKEN=…` seeds the token, `SIMCTL_CHILD_AGENCY_SITE=<placeId>` opens that site on launch.

## Build

Needs Xcode 26+, `brew install xcodegen`, and an iPhone (the simulator has no NFC; the app still runs there for everything else).

```sh
make build   # simulator build, checks the code compiles
make run     # install + launch on the iPhone 17 simulator
make open    # open the Xcode project, then Run on your iPhone
```

Signing is automatic with the team in `project.yml` (`DEVELOPMENT_TEAM`). Core NFC needs the "Near Field Communication Tag Reading" capability, which the entitlements file already declares; Xcode registers it on the team the first time you run on a device.

## Google Places API key

Settings (gear icon) → paste the key → **Test key**. Create it in [Google Cloud credentials](https://console.cloud.google.com/google/maps-apis/credentials) with **Places API (New)** and **Routes API** enabled. The key is stored in the Keychain, never in the repo.

## Layout

```
Agency/
  App/          AgencyApp (entry), ToolsView (hub list), Router (root path)
  Models/       Business, NFCCard (SwiftData), LeadStatus
  Services/     ReviewLink, PlacesService, NFCService, NeonClient, LeadTracker, Keychain,
                RoutePlanner (routes tables), RoutesService (Google Routes + polyline), LocationService, MapsLauncher,
                R2Client (Cloudflare REST), SiteCache (offline sites), SiteSchemeHandler (WKWebView serving)
  ViewModels/   CardProgrammer (write/verify + card records), LeadSync (Neon ↔ SwiftData), RouteSession (open route)
  Views/        Settings, ReviewCards (list, add, detail), SmartRoute (list, new, map), ClientSite (viewer, buttons)
  Resources/    Info.plist, entitlements, asset catalog
tools/make-icon.swift   renders the app icon (make icon)
```
