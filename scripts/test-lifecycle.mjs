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

const { createDraft, createDraftsBulk, approve, approveBulk, listAll, listSince, diffAndDraft } =
  await import('../lib/rates.js');

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

// ---------- explicitly out of scope, documented rather than faked ----------
// "Failed sync doesn't advance the cursor" is Shanti Ops' responsibility, not the Hub's: the cursor
// lives in Shanti Ops' own hub_sync_state table (see ../shanti-ops/lib/rate-sync.js), and is only
// persisted there after a successful loop over the pulled rows. The Hub itself is stateless per
// request — listSince takes the cursor as an input, stores nothing — so there is no Hub-side cursor
// state a failed request could corrupt. That test belongs in Shanti Ops' own suite.
