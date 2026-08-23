// scripts/seed-rates.mjs — manual CLI entrypoint for the canonical dataset in lib/seed-data.js.
// usage: npm run seed-rates
import { config as loadEnv } from 'dotenv';
loadEnv({ path: '.env.local' });
import { diffAndDraft } from '../lib/rates.js';
import { getSeedRows, SEED_SUBMITTED_BY } from '../lib/seed-data.js';

const rows = getSeedRows();
const result = await diffAndDraft(rows, { submitted_by: SEED_SUBMITTED_BY });
console.log(`created: ${result.created}, unchanged: ${result.unchanged}, rejected: ${result.rejected.length}, superseded drafts removed: ${result.supersededDraftsRemoved}`);
if (result.rejected.length) {
  console.log('REJECTED (not drafted — review manually):');
  for (const r of result.rejected) console.log(` - ${r.candidate.category} ${JSON.stringify(r.candidate.payload)}: ${r.reason}`);
}
const unverified = rows.filter(r => /UNVERIFIED|aggregator-only/.test(r.source_ref)).length;
const notSyncable = rows.filter(r => r.source_ref.includes('not yet syncable')).length;
console.log(`${unverified} of ${rows.length} candidate rows are flagged UNVERIFIED/aggregator-only — check before approving.`);
console.log(`${notSyncable} gst_rate candidate rows are category-level reference data, not yet syncable to Shanti Ops (no default-rate concept there).`);
