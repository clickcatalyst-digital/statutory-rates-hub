// lib/auth.js — two flat keys, no user/session system. There's exactly one admin (you) and a
// handful of tenant installs; a role table would be solving a problem that doesn't exist yet.
import { timingSafeEqual } from 'node:crypto';
import { execute } from './db.js';

export function checkAdminKey(req) {
  const key = req.headers.get('x-admin-key');
  return Boolean(key) && key === process.env.ADMIN_KEY;
}

// A separate secret from ADMIN_KEY, deliberately — the daily refresh job only needs permission to
// trigger a diffAndDraft run, not full admin access (create/approve/retract anything). Least
// privilege: whatever ends up holding this secret (a Cloudflare Worker's cron trigger) shouldn't
// also be able to approve rates if it were ever compromised. Timing-safe compare since this is a
// bearer credential checked on every request, not a value ever meant to be brute-forced by timing.
export function checkRefreshKey(req) {
  const key = req.headers.get('x-refresh-key');
  const expected = process.env.REFRESH_JOB_SECRET;
  if (!key || !expected) return false;
  const a = Buffer.from(key);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function tenantForKey(req) {
  const key = req.headers.get('x-api-key');
  if (!key) return null;
  const { rows } = await execute('SELECT id, name FROM tenants WHERE api_key = ?', [key]);
  return rows[0] ?? null;
}
