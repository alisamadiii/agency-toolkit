// Formats findings/incidents as markdown meant to be pasted into an AI
// assistant ("fix these"). Used by the dashboard copy buttons.

export type FindingLike = {
  checkType: string;
  severity: string;
  message: string;
  pageUrl: string;
  details?: Record<string, unknown> | null;
};

// Internal bookkeeping keys that don't help a human or an AI fix anything.
const NOISE_KEYS = new Set(['screenshot', 'runId', 'fingerKey', 'box']);

export function formatFindingForAI(f: FindingLike): string {
  const lines = [`[${f.severity}/${f.checkType}] ${f.message}`, `Page: ${f.pageUrl}`];

  const details = f.details ?? {};
  const selector = details.selector;
  if (typeof selector === 'string' && selector) lines.push(`Selector: ${selector}`);

  const rest = Object.fromEntries(
    Object.entries(details).filter(
      ([key, value]) => !NOISE_KEYS.has(key) && key !== 'selector' && value != null
    )
  );
  if (Object.keys(rest).length > 0) {
    lines.push(`Details: ${JSON.stringify(rest)}`);
  }
  return lines.join('\n');
}

export function formatFindingsForAI(
  siteName: string,
  baseUrl: string,
  items: FindingLike[],
  label: string
): string {
  const header = `Automated monitoring found ${items.length} ${label} on ${siteName} (${baseUrl}).\nFix the following issues:\n`;
  const body = items
    .map((f, i) => {
      const block = formatFindingForAI(f)
        .split('\n')
        .map((line, idx) => (idx === 0 ? `${i + 1}. ${line}` : `   ${line}`))
        .join('\n');
      return block;
    })
    .join('\n\n');
  return `${header}\n${body}\n`;
}
