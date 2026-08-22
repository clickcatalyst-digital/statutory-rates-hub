// app/api/rates/[id]/approve/route.js — admin-only: flip a draft to approved.
import { NextResponse } from 'next/server';
import { checkAdminKey } from '@/lib/auth';
import { approve } from '@/lib/rates';

export async function POST(req, { params }) {
  if (!checkAdminKey(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const ok = await approve(Number(params.id), req.headers.get('x-admin-name') ?? 'admin');
  if (!ok) return NextResponse.json({ error: 'Not found or already approved' }, { status: 400 });
  return NextResponse.json({ ok: true });
}
