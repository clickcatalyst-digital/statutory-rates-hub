// scripts/selfcheck.mjs — the one runnable check for the whole hub workflow:
// draft -> approve -> tenant pulls -> cursor advances -> re-pull returns nothing new.
import { strict as assert } from 'node:assert';
import { unlinkSync, existsSync } from 'node:fs';

process.env.DB_PATH = './statutory-rates-hub-selfcheck.db';
if (existsSync(process.env.DB_PATH)) unlinkSync(process.env.DB_PATH);

const { createDraft, approve, listSince } = await import('../lib/rates.js');

const id = await createDraft({
  category: 'gst_rate',
  payload: { hsn_code: '8481', description: 'Valves', rate_pct: 18 },
  effective_from: '2026-09-22',
  source_ref: 'Notification 12/2026-CT(R)',
  submitted_by: 'selfcheck'
});
assert.ok(id > 0, 'draft id should be positive');

let pulled = await listSince(0);
assert.equal(pulled.find(r => r.id === id), undefined, 'draft (unapproved) must not appear in listSince');

const ok = await approve(id, 'selfcheck-admin');
assert.equal(ok, true, 'approve should succeed on a fresh draft');

pulled = await listSince(0);
const row = pulled.find(r => r.id === id);
assert.ok(row, 'approved row must appear in listSince');
assert.deepEqual(row.payload, { hsn_code: '8481', description: 'Valves', rate_pct: 18 });

const nextCursor = pulled[pulled.length - 1].id;
const secondPull = await listSince(nextCursor);
assert.equal(secondPull.find(r => r.id === id), undefined, 'row must not be pulled twice past its cursor');

const reApprove = await approve(id, 'selfcheck-admin');
assert.equal(reApprove, false, 'approving an already-approved row should be a no-op');

unlinkSync(process.env.DB_PATH);
console.log('selfcheck OK: draft -> approve -> pull -> no duplicate pull');
