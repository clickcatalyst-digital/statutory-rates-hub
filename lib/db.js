// lib/db.js — single source of truth for verified Indian statutory rates,
// pulled by any number of tenant Shanti Ops installs. Two tables, no ORM.
import { createClient } from '@libsql/client';

let db = null;

function getClient() {
  if (db) return db;
  db = process.env.TURSO_URL
    ? createClient({ url: process.env.TURSO_URL, authToken: process.env.TURSO_AUTH_TOKEN, intMode: 'number' })
    : createClient({ url: `file:${process.env.DB_PATH || './statutory-rates-hub-local.db'}`, intMode: 'number' });
  return db;
}

async function migrate(client) {
  await client.execute(`CREATE TABLE IF NOT EXISTS tenants (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    api_key TEXT NOT NULL UNIQUE,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // category: gst_rate | vendor_tds_rate | statutory_rate | income_tax_slab | professional_tax_slab.
  // payload is JSON matching the shape the tenant's own insert route already expects for that
  // category (e.g. {hsn_code, description, rate_pct} for gst_rate) — the hub doesn't need to know
  // the field names, it just carries them through.
  await client.execute(`CREATE TABLE IF NOT EXISTS rate_changes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    category TEXT NOT NULL,
    payload TEXT NOT NULL,
    effective_from DATE NOT NULL,
    effective_to DATE,
    source_ref TEXT,
    submitted_by TEXT,
    approved_at DATETIME,
    approved_by TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
}

let initPromise = null;
export async function db_() {
  const client = getClient();
  if (!initPromise) initPromise = migrate(client);
  await initPromise;
  return client;
}

export async function execute(sql, args = []) {
  const client = await db_();
  return client.execute({ sql, args });
}
