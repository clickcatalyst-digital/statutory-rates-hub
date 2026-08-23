// app/api/rates/bulk-approve/route.js — admin-only: approve exactly the given ids in one round
// trip. See lib/rates.js's approveBulk().
import { NextResponse } from 'next/server';
import { checkAdminKey } from '@/lib/auth';
import { approveBulk } from '@/lib/rates';

export async function POST(req) {
  if (!checkAdminKey(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { ids } = await req.json();
  if (!Array.isArray(ids) || !ids.length) return NextResponse.json({ error: 'ids array is required' }, { status: 400 });
  const approvedCount = await approveBulk(ids, req.headers.get('x-admin-name') ?? 'admin');
  return NextResponse.json({ approvedCount });
}
