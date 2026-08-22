// lib/auth.js — two flat keys, no user/session system. There's exactly one admin (you) and a
// handful of tenant installs; a role table would be solving a problem that doesn't exist yet.
import { execute } from './db.js';

export function checkAdminKey(req) {
  const key = req.headers.get('x-admin-key');
  return Boolean(key) && key === process.env.ADMIN_KEY;
}

export async function tenantForKey(req) {
  const key = req.headers.get('x-api-key');
  if (!key) return null;
  const { rows } = await execute('SELECT id, name FROM tenants WHERE api_key = ?', [key]);
  return rows[0] ?? null;
}
