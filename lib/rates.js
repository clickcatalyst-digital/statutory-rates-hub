// lib/rates.js — the whole workflow: draft, approve, list, pull-since. Deliberately flat;
// approval is just approved_at going from null to a timestamp, not a status state machine.
import { execute, batch } from './db.js';
import { deepStrictEqual } from 'node:assert';

export const CATEGORIES = ['gst_rate', 'vendor_tds_rate', 'statutory_rate', 'income_tax_slab', 'professional_tax_slab'];

// Canonical payload shape per category — field names and types match what the tenant consumer
// (Shanti Ops lib/data.js insert*/lib/payroll.js patchStatutoryRates) actually requires, so a row
// that passes validation here is guaranteed syncable, not just well-formed JSON. Numeric fields
// must be numbers (or null where the consumer allows it) — no compound free-text thresholds like
// "30000 single / 100000 aggregate"; where a rule genuinely has two thresholds, pick the one the
// consumer's single numeric column represents and note the rest in `description`.
const num = (v) => typeof v === 'number';
const numOrNull = (v) => v === null || v === undefined || typeof v === 'number';
const str = (v) => typeof v === 'string' && v.length > 0;

const PAYLOAD_VALIDATORS = {
  // Exactly one of hsn_code/category — hsn_code for a real HSN/SAC-coded item (syncable today via
  // Shanti Ops' insertGstRate), category for a slab/default-rate reference row (not yet consumable
  // by Shanti Ops — it has no default-rate concept — kept here as reference data only).
  gst_rate(p) {
    const hasHsn = str(p.hsn_code);
    const hasCategory = str(p.category);
    if (hasHsn === hasCategory) throw new Error('gst_rate payload needs exactly one of hsn_code or category');
    if (!num(p.rate_pct)) throw new Error('gst_rate payload.rate_pct must be a number');
  },
  vendor_tds_rate(p) {
    if (!str(p.section)) throw new Error('vendor_tds_rate payload.section is required');
    if (!num(p.rate_pct)) throw new Error('vendor_tds_rate payload.rate_pct must be a number');
    if (!numOrNull(p.threshold_amount)) throw new Error('vendor_tds_rate payload.threshold_amount must be a number or null');
  },
  income_tax_slab(p) {
    if (!str(p.financial_year)) throw new Error('income_tax_slab payload.financial_year is required (e.g. "2026-27")');
    if (!num(p.min_income)) throw new Error('income_tax_slab payload.min_income must be a number');
    if (!numOrNull(p.max_income)) throw new Error('income_tax_slab payload.max_income must be a number or null');
    if (!num(p.rate_pct)) throw new Error('income_tax_slab payload.rate_pct must be a number');
  },
  professional_tax_slab(p) {
    if (!str(p.state)) throw new Error('professional_tax_slab payload.state is required');
    if (!num(p.min_gross)) throw new Error('professional_tax_slab payload.min_gross must be a number');
    if (!numOrNull(p.max_gross)) throw new Error('professional_tax_slab payload.max_gross must be a number or null');
    if (!num(p.amount)) throw new Error('professional_tax_slab payload.amount must be a number');
  },
  // Flat, partial-update shape matching Shanti Ops' STATUTORY_RATE_FIELDS — only the subset that
  // is genuinely national statutory law, not tenant policy config (overtime multiplier, standard
  // working hours, etc. deliberately excluded — those aren't "identical for every tenant").
  statutory_rate(p) {
    const ALLOWED = ['pf_employee_pct', 'pf_employer_pct', 'pf_wage_ceiling', 'esi_employee_pct',
      'esi_employer_pct', 'esi_wage_ceiling', 'standard_deduction', 'tds_rebate_income_threshold'];
    const keys = Object.keys(p);
    if (!keys.length) throw new Error('statutory_rate payload needs at least one field');
    for (const k of keys) {
      if (!ALLOWED.includes(k)) throw new Error(`statutory_rate payload has unsupported field "${k}" — allowed: ${ALLOWED.join(', ')}`);
      if (!numOrNull(p[k])) throw new Error(`statutory_rate payload.${k} must be a number or null`);
    }
  },
};

function validateDraft({ category, payload, effective_from }) {
  if (!CATEGORIES.includes(category)) throw new Error(`Unknown category: ${category}`);
  if (!payload || typeof payload !== 'object') throw new Error('payload is required');
  if (!effective_from) throw new Error('effective_from is required');
  PAYLOAD_VALIDATORS[category](payload);
}

// Which value-fields are optional per category, so a candidate that explicitly sets one to `null`
// compares equal to a stored row where the key was simply absent (JSON.stringify drops `undefined`
// keys, so without this a purely cosmetic key-presence difference would look like a real change).
const OPTIONAL_FIELDS = {
  gst_rate: ['description'],
  vendor_tds_rate: ['threshold_amount'],
  income_tax_slab: ['max_income'],
  professional_tax_slab: ['max_gross'],
  statutory_rate: [], // field presence IS the identity for this category — see identityKey below
};

function normalizePayload(category, payload) {
  const normalized = { ...payload };
  for (const f of OPTIONAL_FIELDS[category] ?? []) {
    if (!(f in normalized)) normalized[f] = null;
  }
  return normalized;
}

// The stable "which real-world rule is this" key per category — distinct from the value fields
// that change detection compares. gst_rate: hsn_code for a real HSN/SAC row, else the category
// label. vendor_tds_rate: section+description (description must stay a short stable label, not
// verification prose, or rewording it would fork a spurious new rule — see seed-rates.mjs).
// statutory_rate is a flat partial-update object; its identity is the *set* of field names present
// (matches how PF/ESI vs standard_deduction/rebate were already split into separate rows this
// session), not one identity per individual field.
function identityKey(category, normalizedPayload) {
  switch (category) {
    case 'gst_rate':
      return normalizedPayload.hsn_code ? `hsn:${normalizedPayload.hsn_code}` : `cat:${normalizedPayload.category}`;
    case 'vendor_tds_rate':
      return `${normalizedPayload.section}|${normalizedPayload.description ?? ''}`;
    case 'income_tax_slab':
      return `${normalizedPayload.financial_year}|${normalizedPayload.min_income}`;
    case 'professional_tax_slab':
      return `${normalizedPayload.state}|${normalizedPayload.min_gross}`;
    case 'statutory_rate':
      return Object.keys(normalizedPayload).sort().join(',');
    default:
      throw new Error(`no identity rule for category "${category}"`);
  }
}

function payloadsEqual(a, b) {
  try { deepStrictEqual(a, b); return true; } catch { return false; }
}

export async function createDraft({ category, payload, effective_from, effective_to, source_ref, submitted_by }) {
  validateDraft({ category, payload, effective_from });
  const { lastInsertRowid } = await execute(
    `INSERT INTO rate_changes (category, payload, effective_from, effective_to, source_ref, submitted_by)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [category, JSON.stringify(payload), effective_from, effective_to ?? null, source_ref ?? null, submitted_by ?? null]
  );
  return Number(lastInsertRowid);
}

// One round trip for many drafts — used by seed scripts so a large batch doesn't mean N
// sequential inserts (or N separate API calls, for anything driving this over HTTP).
export async function createDraftsBulk(items) {
  items.forEach(validateDraft);
  const statements = items.map(({ category, payload, effective_from, effective_to, source_ref, submitted_by }) => ({
    sql: `INSERT INTO rate_changes (category, payload, effective_from, effective_to, source_ref, submitted_by)
          VALUES (?, ?, ?, ?, ?, ?)`,
    args: [category, JSON.stringify(payload), effective_from, effective_to ?? null, source_ref ?? null, submitted_by ?? null],
  }));
  await batch(statements);
}

export async function approve(id, approved_by) {
  const { rowsAffected } = await execute(
    `UPDATE rate_changes SET approved_at = CURRENT_TIMESTAMP, approved_by = ? WHERE id = ? AND approved_at IS NULL`,
    [approved_by ?? null, id]
  );
  return rowsAffected > 0;
}

// One round trip to approve many rows at once (e.g. an admin approving a reviewed batch) instead
// of N sequential approve() calls.
export async function approveBulk(ids, approved_by) {
  const statements = ids.map((id) => ({
    sql: `UPDATE rate_changes SET approved_at = CURRENT_TIMESTAMP, approved_by = ? WHERE id = ? AND approved_at IS NULL`,
    args: [approved_by ?? null, id],
  }));
  const results = await batch(statements);
  return results.reduce((n, r) => n + r.rowsAffected, 0);
}

// For an APPROVED row that was wrong from inception (a data-entry error, not a later legal
// change) — never touches category/payload/effective_from/effective_to/source_ref, only adds
// retraction metadata. Only applies to approved rows: an unapproved draft that's wrong should just
// be deleted, retraction is specifically for undoing something that already went live. Idempotent
// like approve() — retracting an already-retracted row is a no-op, returns false.
export async function retract(id, { retracted_by, retraction_reason }) {
  if (!retraction_reason) throw new Error('retraction_reason is required');
  const { rowsAffected } = await execute(
    `UPDATE rate_changes SET retracted_at = CURRENT_TIMESTAMP, retracted_by = ?, retraction_reason = ?
     WHERE id = ? AND approved_at IS NOT NULL AND retracted_at IS NULL`,
    [retracted_by ?? null, retraction_reason, id]
  );
  return rowsAffected > 0;
}

function parseRow(r) {
  return { ...r, payload: JSON.parse(r.payload) };
}

export async function listAll() {
  const { rows } = await execute('SELECT * FROM rate_changes ORDER BY id DESC');
  return rows.map(parseRow);
}

export async function listSince(cursor, category) {
  const args = [cursor];
  let sql = 'SELECT * FROM rate_changes WHERE id > ? AND approved_at IS NOT NULL AND retracted_at IS NULL';
  if (category) { sql += ' AND category = ?'; args.push(category); }
  sql += ' ORDER BY id ASC LIMIT 500';
  const { rows } = await execute(sql, args);
  return rows.map(parseRow);
}

// Incremental refresh for provider/seed data — the replacement for "delete everything and
// reinsert" (churns ids, destroys audit history, can't express append-only versioning). Compares
// each incoming candidate against the FULL version history of its identity (not just the latest —
// re-sending the current live value must be a no-op even when a newer draft already exists for the
// same rule) and only ever inserts new rows; an approved row is never mutated or deleted.
//
// - unchanged (same identity, same normalized payload, same effective_from as some existing
//   version) -> skipped, not counted as an error.
// - conflict (same effective_from as an existing version but a different payload, OR effective_from
//   not strictly later than every existing version while the value differs) -> rejected, not
//   drafted. This includes a candidate that predates every known version of a rule: distinguishing
//   "legitimate historical backfill" from "wrong date" isn't a call this automated path makes
//   silently — a real backfill goes through a manual admin insert instead.
// - new version (value differs, effective_from strictly later than every existing version) ->
//   queued as a new draft; any existing UNAPPROVED draft for the same identity is deleted first
//   (a pending draft carries no historical weight, and piling up competing unapproved guesses for
//   the same rule defeats the point of a review queue) — an approved row is never touched.
// - new identity -> queued as a new draft.
//
// Deletes of superseded drafts and inserts of new drafts happen in one batch() call (one
// transaction), not two separate ones, so a crash mid-refresh can't leave a rule's identity with
// zero drafts. Retracted rows (see retract() below) don't participate in this at all — they're
// excluded from version/conflict detection entirely, so a corrected replacement can reuse the same
// effective_from a retracted row had. Not handled here (deliberately): genuine repeals of a rule
// that WAS correctly in force and later legitimately ceased (would need effective_to set on a live
// approved row for a reason other than admin error — retract() is specifically for our own mistakes,
// not for the law changing); income_tax_slab bracket *restructuring* within one financial_year
// (this model can add/change a bracket but not remove one, since Shanti Ops treats a whole FY's
// slab set as one unit); effective_to is not factored into "what's in force on date X", only
// effective_from ordering is.
export async function diffAndDraft(incoming, { submitted_by } = {}) {
  incoming.forEach((c) => {
    validateDraft(c);
    if (!c.source_ref) throw new Error(`diffAndDraft: source_ref is required (category=${c.category})`);
  });

  const existingRows = await listAll();
  const groups = new Map(); // "category::identity" -> array of { id, effective_from, approved_at, normalizedPayload }
  const addToGroup = (category, payload, meta) => {
    const normalized = normalizePayload(category, payload);
    const key = `${category}::${identityKey(category, normalized)}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ ...meta, normalizedPayload: normalized });
  };
  // Retracted rows are excluded entirely from version/conflict detection — a corrected
  // replacement can reuse the exact same effective_from a retracted row had, since the retracted
  // row no longer counts as an "existing version" of this rule.
  for (const row of existingRows) {
    if (row.retracted_at) continue;
    addToGroup(row.category, row.payload, { id: row.id, effective_from: row.effective_from, approved_at: row.approved_at });
  }

  const toInsert = [];
  const staleDraftIds = [];
  const rejected = [];
  let unchanged = 0;

  for (const candidate of incoming) {
    const normalized = normalizePayload(candidate.category, candidate.payload);
    const key = `${candidate.category}::${identityKey(candidate.category, normalized)}`;
    const versions = groups.get(key) ?? [];

    const exactMatch = versions.find((v) => v.effective_from === candidate.effective_from && payloadsEqual(v.normalizedPayload, normalized));
    if (exactMatch) { unchanged++; continue; }

    const sameDateConflict = versions.find((v) => v.effective_from === candidate.effective_from);
    if (sameDateConflict) {
      rejected.push({ candidate, reason: `conflicting value already exists at effective_from=${candidate.effective_from} (existing row id ${sameDateConflict.id})` });
      continue;
    }

    const isLaterThanAllExisting = versions.every((v) => candidate.effective_from > v.effective_from);
    if (!isLaterThanAllExisting) {
      rejected.push({ candidate, reason: `effective_from=${candidate.effective_from} is not later than every existing version of this rule — retroactive/out-of-order changes are rejected; use a manual admin insert for a deliberate historical backfill` });
      continue;
    }

    const draftVersions = versions.filter((v) => !v.approved_at);
    for (const d of draftVersions) staleDraftIds.push(d.id);
    toInsert.push(candidate);
    // so a later candidate in this same call, targeting the same identity, diffs against this one
    addToGroup(candidate.category, candidate.payload, { id: null, effective_from: candidate.effective_from, approved_at: null });
  }

  const uniqueStaleIds = [...new Set(staleDraftIds)];
  const statements = [
    ...uniqueStaleIds.map((id) => ({ sql: `DELETE FROM rate_changes WHERE id = ? AND approved_at IS NULL`, args: [id] })),
    ...toInsert.map(({ category, payload, effective_from, effective_to, source_ref, submitted_by: rowSubmittedBy }) => ({
      sql: `INSERT INTO rate_changes (category, payload, effective_from, effective_to, source_ref, submitted_by)
            VALUES (?, ?, ?, ?, ?, ?)`,
      args: [category, JSON.stringify(payload), effective_from, effective_to ?? null, source_ref, submitted_by ?? rowSubmittedBy ?? null],
    })),
  ];
  if (statements.length) await batch(statements);

  return { created: toInsert.length, unchanged, rejected, supersededDraftsRemoved: uniqueStaleIds.length };
}
