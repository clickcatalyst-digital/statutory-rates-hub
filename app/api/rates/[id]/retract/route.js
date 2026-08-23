// app/api/rates/[id]/retract/route.js — admin-only: mark an approved row as retracted (a
// data-entry error, not a later legal change). Never mutates the row's rule content — see
// lib/rates.js's retract().
import { NextResponse } from 'next/server';
import { checkAdminKey } from '@/lib/auth';
import { retract } from '@/lib/rates';

export async function POST(req, { params }) {
  if (!checkAdminKey(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const b = await req.json();
  try {
    const ok = await retract(Number(params.id), {
      retracted_by: req.headers.get('x-admin-name') ?? 'admin',
      retraction_reason: b.retraction_reason,
    });
    if (!ok) return NextResponse.json({ error: 'Not found, not approved, or already retracted' }, { status: 400 });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}
