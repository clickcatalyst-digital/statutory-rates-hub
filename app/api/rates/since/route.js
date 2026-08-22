// app/api/rates/since/route.js — the only endpoint tenant installs call. Tenant-key authed
// (not admin-key) since every tenant deployment pulls the same approved feed, read-only.
import { NextResponse } from 'next/server';
import { tenantForKey } from '@/lib/auth';
import { listSince } from '@/lib/rates';

export async function GET(req) {
  const tenant = await tenantForKey(req);
  if (!tenant) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { searchParams } = new URL(req.url);
  const cursor = Number(searchParams.get('cursor') ?? 0);
  const category = searchParams.get('category') || undefined;
  const rows = await listSince(cursor, category);
  const nextCursor = rows.length ? rows[rows.length - 1].id : cursor;
  return NextResponse.json({ rows, nextCursor });
}
