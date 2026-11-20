import {
  pgTable,
  text,
  timestamp,
  boolean,
  uuid,
  integer,
  jsonb,
  real,
  doublePrecision,
  index,
  unique,
} from 'drizzle-orm/pg-core';

// ---------- Leads ----------

export const LEAD_STATUSES = [
  'new',
  'designing',
  'design_ready',
  'contacted',
  'won',
  'lost',
  'skipped',
  // Hidden from the default list and never picked for a design.
  'hidden',
] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];

export const leads = pgTable(
  'leads',
  {
    // Google Place ID doubles as the duplicate check.
    placeId: text('place_id').primaryKey(),
    name: text('name').notNull(),
    category: text('category').notNull(),
    primaryType: text('primary_type'),
    address: text('address'),
    phone: text('phone'),
    lat: doublePrecision('lat').notNull(),
    lng: doublePrecision('lng').notNull(),
    distanceMiles: doublePrecision('distance_miles').notNull(),
    googleMapsUrl: text('google_maps_url'),
    rating: real('rating').notNull(),
    reviewCount: integer('review_count').notNull(),
    // Set when their only "website" is a Facebook/Instagram/Yelp-style page.
    socialUrl: text('social_url'),
    details: jsonb('details').$type<PlaceDetails | null>(),
    detailsFetchedAt: timestamp('details_fetched_at', { withTimezone: true }),
    // Set when a design session claims the lead, so two sessions never pick the same one.
    claimedAt: timestamp('claimed_at', { withTimezone: true }),
    designReady: boolean('design_ready').notNull().default(false),
    status: text('status', { enum: LEAD_STATUSES }).notNull().default('new'),
    notes: text('notes'),
    firstSeenAt: timestamp('first_seen_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index('leads_design_ready_idx').on(t.designReady),
    index('leads_status_idx').on(t.status),
    index('leads_category_idx').on(t.category),
  ]
);

// One row per (grid point × category). Each run searches the stalest cells first.
export const searchCells = pgTable(
  'search_cells',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    lat: doublePrecision('lat').notNull(),
    lng: doublePrecision('lng').notNull(),
    category: text('category').notNull(),
    lastSearchedAt: timestamp('last_searched_at', { withTimezone: true }),
    resultsFound: integer('results_found').notNull().default(0),
  },
  (t) => [
    unique('search_cells_point_category').on(t.lat, t.lng, t.category),
    index('search_cells_last_searched_idx').on(t.lastSearchedAt),
  ]
);

export type RunError = { at: string; message: string };

export const runs = pgTable(
  'runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    trigger: text('trigger', { enum: ['scheduled', 'manual'] })
      .notNull()
      .default('scheduled'),
    status: text('status', { enum: ['running', 'ok', 'failed'] })
      .notNull()
      .default('running'),
    startedAt: timestamp('started_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    apiCalls: integer('api_calls').notNull().default(0),
    candidatesSeen: integer('candidates_seen').notNull().default(0),
    newLeadsSaved: integer('new_leads_saved').notNull().default(0),
    errors: jsonb('errors').$type<RunError[]>().notNull().default([]),
  },
  (t) => [index('runs_started_at_idx').on(t.startedAt)]
);

// Singleton config row (id = 'global'). Drives the scheduler and the search.
export const settings = pgTable('settings', {
  id: text('id').primaryKey().default('global'),
  enabled: boolean('enabled').notNull().default(true),
  runTime: text('run_time').notNull().default('08:00'), // HH:mm, local to timezone
  timezone: text('timezone').notNull().default('America/New_York'),
  homeLat: doublePrecision('home_lat'),
  homeLng: doublePrecision('home_lng'),
  radiusMiles: real('radius_miles').notNull().default(15),
  minRating: real('min_rating').notNull().default(4.5),
  minReviews: integer('min_reviews').notNull().default(20),
  dailyLimit: integer('daily_limit').notNull().default(10),
  categories: jsonb('categories')
    .$type<string[]>()
    .notNull()
    .default(['pest control', 'handyman', 'restaurant', 'barbershop']),
  maxApiCallsPerRun: integer('max_api_calls_per_run').notNull().default(60),
  // Hash of home/radius/categories the grid was seeded with.
  cellsHash: text('cells_hash'),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const notificationChannels = pgTable(
  'notification_channels',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    type: text('type', { enum: ['discord'] }).notNull().unique(),
    enabled: boolean('enabled').notNull().default(false),
    config: jsonb('config').notNull().default({}),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  }
);

// Subset of the Place Details response the dashboard reads.
export type PlaceDetails = {
  id?: string;
  displayName?: { text: string };
  formattedAddress?: string;
  nationalPhoneNumber?: string;
  googleMapsUri?: string;
  websiteUri?: string;
  rating?: number;
  userRatingCount?: number;
  primaryTypeDisplayName?: { text: string };
  types?: string[];
  priceLevel?: string;
  editorialSummary?: { text: string };
  regularOpeningHours?: { weekdayDescriptions?: string[] };
  reviews?: {
    rating?: number;
    text?: { text: string };
    relativePublishTimeDescription?: string;
    authorAttribution?: { displayName?: string; photoUri?: string };
  }[];
  photos?: { name: string; widthPx?: number; heightPx?: number }[];
  [key: string]: unknown;
};

export type Lead = typeof leads.$inferSelect;
export type Run = typeof runs.$inferSelect;
export type Settings = typeof settings.$inferSelect;
export type NotificationChannel = typeof notificationChannels.$inferSelect;
