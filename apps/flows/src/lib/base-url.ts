// This server's public origin (e.g. https://flows.alisamadii.com), from BETTER_AUTH_URL.
// Used for trigger URLs, run links in alerts and the Google OAuth redirect.
export function appUrl(): string | undefined {
  return process.env.BETTER_AUTH_URL?.trim().replace(/\/+$/, '') || undefined;
}
