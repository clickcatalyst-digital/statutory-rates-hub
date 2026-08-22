// lib/rates.js — the whole workflow: draft, approve, list, pull-since. Deliberately flat;
// approval is just approved_at going from null to a timestamp, not a status state machine.
import { execute } from './db.js';

export const CATEGORIES = ['gst_rate', 'vendor_tds_rate', 'statutory_rate', 'income_tax_slab', 'professional_tax_slab'];

export async function createDraft({ category, payload, effective_from, effective_to, source_ref, submitted_by }) {
  if (!CATEGORIES.includes(category)) throw new Error(`Unknown category: ${category}`);
  if (!payload || typeof payload !== 'object') throw new Error('payload is required');
  if (!effective_from) throw new Error('effective_from is required');
  const { lastInsertRowid } = await execute(
    `INSERT INTO rate_changes (category, payload, effective_from, effective_to, source_ref, submitted_by)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [category, JSON.stringify(payload), effective_from, effective_to ?? null, source_ref ?? null, submitted_by ?? null]
  );
  return Number(lastInsertRowid);
}

export async function approve(id, approved_by) {
  const { rowsAffected } = await execute(
    `UPDATE rate_changes SET approved_at = CURRENT_TIMESTAMP, approved_by = ? WHERE id = ? AND approved_at IS NULL`,
    [approved_by ?? null, id]
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
  let sql = 'SELECT * FROM rate_changes WHERE id > ? AND approved_at IS NOT NULL';
  if (category) { sql += ' AND category = ?'; args.push(category); }
  sql += ' ORDER BY id ASC LIMIT 500';
  const { rows } = await execute(sql, args);
  return rows.map(parseRow);
}
