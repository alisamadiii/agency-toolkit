// One run right now: `pnpm worker` or `pnpm worker --dry-run`.
import 'dotenv/config';

import { env } from '@/env';
import { runLeadFinder } from '@/lib/jobs/lead-finder';

const dryRun = process.argv.includes('--dry-run');

async function main() {
  env();
  const summary = await runLeadFinder({ trigger: 'manual', dryRun });
  console.log(
    `\n${dryRun ? '[dry run] ' : ''}${summary.leads.length} leads · ${summary.apiCalls} API calls · ${summary.candidatesSeen} places seen`
  );
  console.table(
    summary.leads.map((l) => ({
      name: l.name,
      category: l.category,
      rating: `${l.rating} (${l.reviewCount})`,
      miles: l.distanceMiles,
      phone: l.phone ?? '',
      social: l.socialUrl ?? '',
    }))
  );
  if (summary.errors.length) console.log('errors:', summary.errors);
  process.exit(0);
}

main().catch((error) => {
  console.error('❌', error instanceof Error ? error.message : error);
  process.exit(1);
});
