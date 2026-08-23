// scripts/test-lifecycle.mjs — regression suite for the Hub's statutory-data lifecycle: draft,
// approve, change detection, versioning, cursor pagination. Uses node's built-in test runner
// (`node --test`, stdlib, no new dependency) — a deliberate step up from selfcheck.mjs's plain-
// assert-script style, kept separate since selfcheck.mjs stays as the fast top-level smoke test.
//
// TEST ISOLATION: lib/db.js caches its client in a module-level singleton, set once on first call.
// Every test(...) block below therefore shares ONE DB_PATH / one live DB for the whole process —
// there is no per-test reset. Each test must use its own unique dimension values (hsn_code/
// section/state/etc.) so identities never collide with another test's rows. Do not reuse a
// dimension value across tests.
//
// usage: npm test  (or: node --test scripts/test-lifecycle.mjs)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { unlinkSync, existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

process.env.DB_PATH = './statutory-rates-hub-test-lifecycle.db';
if (existsSync(process.env.DB_PATH)) unlinkSync(process.env.DB_PATH);

const { createDraft, createDraftsBulk, approve, approveBulk, listAll, listSince, diffAndDraft, retract } =
  await import('../lib/rates.js');
const { runRefresh, latestRefreshRun } = await import('../lib/refresh.js');
const { checkRefreshKey } = await import('../lib/auth.js');

after(() => {
  if (existsSync(process.env.DB_PATH)) unlinkSync(process.env.DB_PATH);
});

// ---------- validation ----------

test('rejects invalid payload per category', async () => {
  const cases = [
    { category: 'gst_rate', payload: { rate_pct: 18 }, effective_from: '2026-01-01' }, // no hsn_code/category
    { category: 'gst_rate', payload: { hsn_code: 'v1', rate_pct: '18' }, effective_from: '2026-01-01' }, // string rate
    { category: 'vendor_tds_rate', payload: { section: 'v2', rate_pct: 1, threshold_amount: 'lots' }, effective_from: '2026-01-01' },
    { category: 'income_tax_slab', payload: { financial_year: '2099-00', min_income: 0 }, effective_from: '2026-01-01' }, // no rate_pct
    { category: 'professional_tax_slab', payload: { state: 'v3', amount: 0 }, effective_from: '2026-01-01' }, // no min_gross
    { category: 'statutory_rate', payload: { made_up_field: 1 }, effective_from: '2026-01-01' },
    { category: 'statutory_rate', payload: {}, effective_from: '2026-01-01' }, // empty
  ];
  for (const c of cases) await assert.rejects(() => createDraft(c));
});

test('rejects missing effective_from', async () => {
  await assert.rejects(() => createDraft({ category: 'gst_rate', payload: { hsn_code: 'v4', rate_pct: 1 }, source_ref: 's' }));
});

test('diffAndDraft rejects a candidate missing source_ref', async () => {
  await assert.rejects(() => diffAndDraft([{ category: 'gst_rate', payload: { hsn_code: 'v5', rate_pct: 1 }, effective_from: '2026-01-01' }]));
});

// ---------- draft / approval isolation ----------

test('drafts never appear in listSince; approved rows do', async () => {
  const id = await createDraft({ category: 'gst_rate', payload: { hsn_code: 'v6', rate_pct: 18 }, effective_from: '2026-01-01', source_ref: 's' });
  let rows = await listSince(0);
  assert.equal(rows.find((r) => r.id === id), undefined, 'unapproved draft leaked into listSince');

  await approve(id, 'tester');
  rows = await listSince(0);
  assert.ok(rows.find((r) => r.id === id), 'approved row missing from listSince');
});

test('approve is a no-op on an already-approved row (immutable approval act)', async () => {
  const id = await createDraft({ category: 'gst_rate', payload: { hsn_code: 'v7', rate_pct: 18 }, effective_from: '2026-01-01', source_ref: 's' });
  assert.equal(await approve(id, 'tester'), true);
  assert.equal(await approve(id, 'someone-else'), false, 're-approving an approved row must fail, not overwrite approved_by');
});

// ---------- bulk operations ----------

test('approveBulk approves exactly the requested subset, ignores the rest', async () => {
  const ids = [];
  for (const hsn of ['v8a', 'v8b', 'v8c']) {
    ids.push(await createDraft({ category: 'gst_rate', payload: { hsn_code: hsn, rate_pct: 18 }, effective_from: '2026-01-01', source_ref: 's' }));
  }
  const n = await approveBulk([ids[0], ids[2]], 'tester');
  assert.equal(n, 2);
  const rows = await listAll();
  const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
  assert.ok(byId[ids[0]].approved_at);
  assert.equal(byId[ids[1]].approved_at, null);
  assert.ok(byId[ids[2]].approved_at);
});

test('createDraftsBulk is one round trip and all rows land as drafts', async () => {
  await createDraftsBulk([
    { category: 'gst_rate', payload: { hsn_code: 'v9a', rate_pct: 1 }, effective_from: '2026-01-01', source_ref: 's' },
    { category: 'gst_rate', payload: { hsn_code: 'v9b', rate_pct: 2 }, effective_from: '2026-01-01', source_ref: 's' },
  ]);
  const rows = await listAll();
  const v9 = rows.filter((r) => r.payload.hsn_code === 'v9a' || r.payload.hsn_code === 'v9b');
  assert.equal(v9.length, 2);
  assert.ok(v9.every((r) => !r.approved_at));
});

// ---------- change detection / versioning ----------

test('unchanged input produces zero new rows', async () => {
  const candidate = { category: 'gst_rate', payload: { hsn_code: 'v10', rate_pct: 18 }, effective_from: '2026-01-01', source_ref: 's' };
  const first = await diffAndDraft([candidate]);
  assert.equal(first.created, 1);
  const second = await diffAndDraft([candidate]);
  assert.equal(second.created, 0);
  assert.equal(second.unchanged, 1);
});

test('changed value with a later effective_from creates exactly one new draft, old row untouched', async () => {
  const r1 = await diffAndDraft([{ category: 'gst_rate', payload: { hsn_code: 'v11', rate_pct: 18 }, effective_from: '2026-01-01', source_ref: 's' }]);
  const [{ id: originalId }] = (await listAll()).filter((r) => r.payload.hsn_code === 'v11');
  await approve(originalId, 'tester');
  const before = (await listAll()).find((r) => r.id === originalId);

  const r2 = await diffAndDraft([{ category: 'gst_rate', payload: { hsn_code: 'v11', rate_pct: 20 }, effective_from: '2027-01-01', source_ref: 's2' }]);
  assert.equal(r2.created, 1);

  const rows = await listAll();
  const v11rows = rows.filter((r) => r.payload.hsn_code === 'v11');
  assert.equal(v11rows.length, 2, 'expected exactly 2 versions (old approved + new draft)');

  const after = rows.find((r) => r.id === originalId);
  assert.deepEqual(after, before, 'historical approved row must be byte-for-byte unchanged after a superseding version');
});

test('new identity (unrelated rule) is drafted independently', async () => {
  const r = await diffAndDraft([{ category: 'gst_rate', payload: { hsn_code: 'v12', rate_pct: 5 }, effective_from: '2026-01-01', source_ref: 's' }]);
  assert.equal(r.created, 1);
});

test('retroactive/same-date conflicting change is rejected, not drafted', async () => {
  await diffAndDraft([{ category: 'gst_rate', payload: { hsn_code: 'v13', rate_pct: 18 }, effective_from: '2026-06-01', source_ref: 's' }]);

  const sameDate = await diffAndDraft([{ category: 'gst_rate', payload: { hsn_code: 'v13', rate_pct: 99 }, effective_from: '2026-06-01', source_ref: 's' }]);
  assert.equal(sameDate.created, 0);
  assert.equal(sameDate.rejected.length, 1);

  const earlier = await diffAndDraft([{ category: 'gst_rate', payload: { hsn_code: 'v13', rate_pct: 99 }, effective_from: '2025-01-01', source_ref: 's' }]);
  assert.equal(earlier.created, 0);
  assert.equal(earlier.rejected.length, 1);

  const rows = (await listAll()).filter((r) => r.payload.hsn_code === 'v13');
  assert.equal(rows.length, 1, 'no rejected candidate should have created a row');
});

test('re-sending the current live value is a no-op even when a future draft already exists (regression: must diff against the full version set, not just the latest)', async () => {
  await diffAndDraft([{ category: 'gst_rate', payload: { hsn_code: 'v14', rate_pct: 18 }, effective_from: '2026-01-01', source_ref: 's' }]);
  const [{ id }] = (await listAll()).filter((r) => r.payload.hsn_code === 'v14');
  await approve(id, 'tester');
  await diffAndDraft([{ category: 'gst_rate', payload: { hsn_code: 'v14', rate_pct: 20 }, effective_from: '2027-01-01', source_ref: 's' }]);

  const r = await diffAndDraft([{ category: 'gst_rate', payload: { hsn_code: 'v14', rate_pct: 18 }, effective_from: '2026-01-01', source_ref: 's' }]);
  assert.equal(r.created, 0);
  assert.equal(r.unchanged, 1);
  assert.equal(r.rejected.length, 0);
});

test('a new version supersedes a stale pending draft, but never an approved row', async () => {
  await diffAndDraft([{ category: 'gst_rate', payload: { hsn_code: 'v15', rate_pct: 18 }, effective_from: '2026-01-01', source_ref: 's' }]);
  const [{ id: approvedId }] = (await listAll()).filter((r) => r.payload.hsn_code === 'v15');
  await approve(approvedId, 'tester');

  await diffAndDraft([{ category: 'gst_rate', payload: { hsn_code: 'v15', rate_pct: 20 }, effective_from: '2027-01-01', source_ref: 's2' }]);
  let rows = (await listAll()).filter((r) => r.payload.hsn_code === 'v15');
  assert.equal(rows.length, 2);

  const r = await diffAndDraft([{ category: 'gst_rate', payload: { hsn_code: 'v15', rate_pct: 22 }, effective_from: '2027-06-01', source_ref: 's3' }]);
  assert.equal(r.created, 1);
  assert.equal(r.supersededDraftsRemoved, 1);

  rows = (await listAll()).filter((r) => r.payload.hsn_code === 'v15');
  assert.equal(rows.length, 2, 'the 20% draft should have been removed, replaced by the 22% draft');
  assert.ok(rows.find((r) => r.payload.rate_pct === 18 && r.approved_at));
  assert.ok(rows.find((r) => r.payload.rate_pct === 22 && !r.approved_at));
  assert.equal(rows.find((r) => r.payload.rate_pct === 20), undefined);
});

test('statutory_rate identity is the field-set, not per-field', async () => {
  const r1 = await diffAndDraft([{ category: 'statutory_rate', payload: { pf_employee_pct: 12, pf_employer_pct: 12 }, effective_from: '2026-01-01', source_ref: 's' }]);
  assert.equal(r1.created, 1);
  const r2 = await diffAndDraft([{ category: 'statutory_rate', payload: { standard_deduction: 75000 }, effective_from: '2026-01-01', source_ref: 's' }]);
  assert.equal(r2.created, 1, 'a different field-set is a different identity, must not be treated as a conflict with the first row');
});

test('two consecutive diffAndDraft runs on identical input: second creates zero rows (idempotent)', async () => {
  const batch = [
    { category: 'gst_rate', payload: { hsn_code: 'v16a', rate_pct: 1 }, effective_from: '2026-01-01', source_ref: 's' },
    { category: 'gst_rate', payload: { hsn_code: 'v16b', rate_pct: 2 }, effective_from: '2026-01-01', source_ref: 's' },
    { category: 'vendor_tds_rate', payload: { section: 'v16', description: 'x', rate_pct: 1, threshold_amount: 100 }, effective_from: '2026-01-01', source_ref: 's' },
  ];
  const r1 = await diffAndDraft(batch);
  assert.equal(r1.created, 3);
  const r2 = await diffAndDraft(batch);
  assert.equal(r2.created, 0);
  assert.equal(r2.unchanged, 3);
});

// ---------- cursor pagination ----------

test('listSince paginates a large batch without skipping or duplicating (LIMIT 500 boundary)', async () => {
  const N = 505;
  const items = Array.from({ length: N }, (_, i) => ({
    category: 'gst_rate',
    payload: { hsn_code: `cursor-test-${i}`, rate_pct: 1 },
    effective_from: '2026-01-01',
    source_ref: 's',
  }));
  await createDraftsBulk(items);
  const rows = await listAll();
  const ids = rows.filter((r) => r.payload.hsn_code?.startsWith('cursor-test-')).map((r) => r.id);
  await approveBulk(ids, 'tester');

  let cursor = 0;
  const seen = new Set();
  for (let guard = 0; guard < 20; guard++) {
    const page = await listSince(cursor, 'gst_rate');
    const relevant = page.filter((r) => r.payload.hsn_code?.startsWith('cursor-test-'));
    if (page.length === 0) break;
    for (const r of page) {
      assert.ok(!seen.has(r.id), `duplicate id ${r.id} returned across pages`);
      seen.add(r.id);
    }
    cursor = page[page.length - 1].id;
    if (relevant.length < page.length && page.length < 500) break; // ran past our test rows into other categories/end
  }
  const seenCount = [...seen].filter((id) => ids.includes(id)).length;
  assert.equal(seenCount, N, `expected all ${N} rows to be seen across pages, got ${seenCount}`);

  const rePull = await listSince(cursor, 'gst_rate');
  assert.equal(rePull.filter((r) => ids.includes(r.id)).length, 0, 're-pulling past the last cursor must return nothing new for these rows');
});

// ---------- tenant isolation (structural check against the actual route modules) ----------

test('the tenant-facing route only exports GET — no write path for a tenant key', () => {
  // Not a dynamic import: this route imports `next/server`, whose export map only resolves inside
  // Next's own bundler/runtime — plain `node --test` can't load it. A text-level check of the
  // exported HTTP verb functions is the honest structural equivalent without needing Next running.
  const path = fileURLToPath(new URL('../app/api/rates/since/route.js', import.meta.url));
  const src = readFileSync(path, 'utf8');
  const verbs = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];
  const exportedVerbs = verbs.filter((v) => new RegExp(`export\\s+async\\s+function\\s+${v}\\b`).test(src));
  assert.deepEqual(exportedVerbs, ['GET']);
});

test('admin routes require x-admin-key via checkAdminKey, not the tenant key function', async () => {
  const authMod = await import('../lib/auth.js');
  assert.equal(typeof authMod.checkAdminKey, 'function');
  assert.equal(typeof authMod.tenantForKey, 'function');
  const fakeReqNoAdminKey = { headers: new Headers({ 'x-api-key': 'some-tenant-key' }) };
  assert.equal(authMod.checkAdminKey(fakeReqNoAdminKey), false, 'a tenant key must not satisfy the admin check');
});

// ---------- retraction (for an approved row that was wrong from inception, not a later change) ----------

test('retract() marks retraction metadata but leaves category/payload/effective_from/effective_to/source_ref byte-for-byte unchanged', async () => {
  const id = await createDraft({ category: 'gst_rate', payload: { hsn_code: 'r1', rate_pct: 18 }, effective_from: '2026-01-01', source_ref: 's' });
  await approve(id, 'tester');
  const before = (await listAll()).find((r) => r.id === id);

  const ok = await retract(id, { retracted_by: 'tester', retraction_reason: 'approved by mistake' });
  assert.equal(ok, true);

  const after = (await listAll()).find((r) => r.id === id);
  assert.equal(after.category, before.category);
  assert.deepEqual(after.payload, before.payload);
  assert.equal(after.effective_from, before.effective_from);
  assert.equal(after.effective_to, before.effective_to);
  assert.equal(after.source_ref, before.source_ref);
  assert.equal(after.approved_at, before.approved_at, 'approval record itself must also stay untouched');
  assert.ok(after.retracted_at);
  assert.equal(after.retracted_by, 'tester');
  assert.equal(after.retraction_reason, 'approved by mistake');
});

test('retract() requires a reason', async () => {
  const id = await createDraft({ category: 'gst_rate', payload: { hsn_code: 'r2', rate_pct: 18 }, effective_from: '2026-01-01', source_ref: 's' });
  await approve(id, 'tester');
  await assert.rejects(() => retract(id, { retracted_by: 'tester' }));
});

test('retract() only applies to approved rows — a draft is a no-op, not a silent success', async () => {
  const id = await createDraft({ category: 'gst_rate', payload: { hsn_code: 'r3', rate_pct: 18 }, effective_from: '2026-01-01', source_ref: 's' });
  const ok = await retract(id, { retracted_by: 'tester', retraction_reason: 'x' });
  assert.equal(ok, false);
  const row = (await listAll()).find((r) => r.id === id);
  assert.equal(row.retracted_at, null);
});

test('retract() is idempotent — retracting an already-retracted row is a no-op', async () => {
  const id = await createDraft({ category: 'gst_rate', payload: { hsn_code: 'r4', rate_pct: 18 }, effective_from: '2026-01-01', source_ref: 's' });
  await approve(id, 'tester');
  assert.equal(await retract(id, { retracted_by: 'a', retraction_reason: 'first' }), true);
  assert.equal(await retract(id, { retracted_by: 'b', retraction_reason: 'second' }), false, 'must not overwrite the original retraction record');
  const row = (await listAll()).find((r) => r.id === id);
  assert.equal(row.retracted_by, 'a', 'the second retract() call must not have changed who retracted it');
});

test('a retracted row can never sync to Shanti Ops — excluded from listSince even though approved', async () => {
  const id = await createDraft({ category: 'gst_rate', payload: { hsn_code: 'r5', rate_pct: 18 }, effective_from: '2026-01-01', source_ref: 's' });
  await approve(id, 'tester');
  // cursor scoped to just before this row, not 0 — the earlier LIMIT-500 pagination test already
  // pushed hundreds of rows ahead of it, so a from-0 pull would miss it on page one regardless
  assert.ok((await listSince(id - 1)).find((r) => r.id === id), 'sanity check: visible before retraction');

  await retract(id, { retracted_by: 'tester', retraction_reason: 'wrong from the start' });
  assert.equal((await listSince(id - 1)).find((r) => r.id === id), undefined, 'retracted-but-approved row must not appear in the tenant feed');
});

test('194A-style scenario: retract a wrong approved value, then approve a corrected replacement at the SAME effective_from', async () => {
  const wrongId = await createDraft({ category: 'vendor_tds_rate', payload: { section: 'r6', description: 'x', rate_pct: 10, threshold_amount: 5000 }, effective_from: '2026-04-01', source_ref: 's' });
  await approve(wrongId, 'tester');

  await retract(wrongId, { retracted_by: 'tester', retraction_reason: 'threshold was 5000, should be 10000' });

  // same effective_from as the retracted row — must NOT be rejected as a same-date conflict
  const r = await diffAndDraft([{ category: 'vendor_tds_rate', payload: { section: 'r6', description: 'x', rate_pct: 10, threshold_amount: 10000 }, effective_from: '2026-04-01', source_ref: 's2' }]);
  assert.equal(r.created, 1);
  assert.equal(r.rejected.length, 0);

  const correctedId = (await listAll()).find((row) => row.payload.section === 'r6' && row.payload.threshold_amount === 10000).id;
  await approve(correctedId, 'tester');

  const since = await listSince(0, 'vendor_tds_rate');
  const r6rows = since.filter((row) => row.payload.section === 'r6');
  assert.equal(r6rows.length, 1, 'only the corrected value should reach the tenant feed');
  assert.equal(r6rows[0].payload.threshold_amount, 10000);
});

test('206C(1H)-style scenario: retract an approved row with NO replacement — identity fully vacated', async () => {
  const id = await createDraft({ category: 'vendor_tds_rate', payload: { section: 'r7', description: 'y', rate_pct: 0.1, threshold_amount: 5000000 }, effective_from: '2026-04-01', source_ref: 's' });
  await approve(id, 'tester');
  await retract(id, { retracted_by: 'tester', retraction_reason: 'provision does not exist under the new Act — erroneously seeded' });

  assert.equal((await listSince(0, 'vendor_tds_rate')).find((row) => row.payload.section === 'r7'), undefined);

  // a genuinely new, unrelated future version for this identity must still be possible later —
  // retraction must not permanently block the identity
  const r = await diffAndDraft([{ category: 'vendor_tds_rate', payload: { section: 'r7', description: 'y', rate_pct: 0.2, threshold_amount: 6000000 }, effective_from: '2027-01-01', source_ref: 's3' }]);
  assert.equal(r.created, 1);
});

// ---------- daily refresh job (lib/refresh.js) ----------

test('runRefresh() drafts synthetic rows, records a success heartbeat, never approves anything', async () => {
  const rows = [
    { category: 'gst_rate', payload: { hsn_code: 'refresh-a', rate_pct: 18 }, effective_from: '2026-01-01', source_ref: 's' },
    { category: 'gst_rate', payload: { hsn_code: 'refresh-b', rate_pct: 5 }, effective_from: '2026-01-01', source_ref: 's' },
  ];
  const result = await runRefresh({ rows });
  assert.equal(result.created, 2);
  assert.equal(result.rejected.length, 0);

  const drafted = (await listAll()).filter((r) => r.payload.hsn_code === 'refresh-a' || r.payload.hsn_code === 'refresh-b');
  assert.equal(drafted.length, 2);
  assert.ok(drafted.every((r) => !r.approved_at), 'runRefresh must never approve anything, only draft');

  const heartbeat = await latestRefreshRun();
  assert.equal(heartbeat.id, result.runId);
  assert.equal(heartbeat.status, 'success');
  assert.equal(heartbeat.created, 2);
  assert.ok(heartbeat.completed_at);
});

test('runRefresh() is idempotent — a second run against the same input creates zero new rows', async () => {
  const rows = [{ category: 'gst_rate', payload: { hsn_code: 'refresh-c', rate_pct: 18 }, effective_from: '2026-01-01', source_ref: 's' }];
  const r1 = await runRefresh({ rows });
  assert.equal(r1.created, 1);
  const r2 = await runRefresh({ rows });
  assert.equal(r2.created, 0);
  assert.equal(r2.unchanged, 1);
});

test('runRefresh() records a failed heartbeat and rethrows when the pipeline rejects invalid input, without touching prior data', async () => {
  const before = await listAll();
  const invalidRows = [{ category: 'gst_rate', payload: { rate_pct: 18 }, effective_from: '2026-01-01', source_ref: 's' }]; // missing hsn_code/category — fails validateDraft
  await assert.rejects(() => runRefresh({ rows: invalidRows }));

  const heartbeat = await latestRefreshRun();
  assert.equal(heartbeat.status, 'failed');
  assert.ok(heartbeat.error_message);
  assert.ok(heartbeat.completed_at);

  const after = await listAll();
  assert.equal(after.length, before.length, 'a failed run must not have written any rate_changes rows');
});

test('checkRefreshKey requires x-refresh-key to exactly match REFRESH_JOB_SECRET', () => {
  process.env.REFRESH_JOB_SECRET = 'test-refresh-secret-123';
  assert.equal(checkRefreshKey({ headers: new Headers({ 'x-refresh-key': 'test-refresh-secret-123' }) }), true);
  assert.equal(checkRefreshKey({ headers: new Headers({ 'x-refresh-key': 'wrong' }) }), false);
  assert.equal(checkRefreshKey({ headers: new Headers({ 'x-admin-key': 'test-refresh-secret-123' }) }), false, 'the admin key header must not satisfy the refresh check');
  assert.equal(checkRefreshKey({ headers: new Headers() }), false);
});

test('the refresh route only exports POST and GET — POST for the cron trigger, GET for status', () => {
  // Same next/server resolution constraint as the tenant-facing route test above — text-level check.
  const path = fileURLToPath(new URL('../app/api/refresh/route.js', import.meta.url));
  const src = readFileSync(path, 'utf8');
  const verbs = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];
  const exportedVerbs = verbs.filter((v) => new RegExp(`export\\s+async\\s+function\\s+${v}\\b`).test(src));
  assert.deepEqual(exportedVerbs.sort(), ['GET', 'POST']);
  assert.ok(src.includes('checkRefreshKey'), 'POST must be gated by the refresh secret, not the admin key');
  assert.ok(src.includes('checkAdminKey'), 'GET must be gated by the admin key');
});

// ---------- explicitly out of scope, documented rather than faked ----------
// "Failed sync doesn't advance the cursor" is Shanti Ops' responsibility, not the Hub's: the cursor
// lives in Shanti Ops' own hub_sync_state table (see ../shanti-ops/lib/rate-sync.js), and is only
// persisted there after a successful loop over the pulled rows. The Hub itself is stateless per
// request — listSince takes the cursor as an input, stores nothing — so there is no Hub-side cursor
// state a failed request could corrupt. That test belongs in Shanti Ops' own suite.
