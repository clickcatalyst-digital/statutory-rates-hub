// app/api/gstin/verify/route.js — tenant-authed passthrough to Sandbox GSTIN lookup. Not part of
// the rates reference-data flow; this is a live vendor-verification utility.
import { NextResponse } from 'next/server';
import { tenantForKey } from '@/lib/auth';
import { verifyGstin } from '@/lib/sandbox';

export async function POST(req) {
  const tenant = await tenantForKey(req);
  if (!tenant) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { gstin } = await req.json();
  if (!gstin) return NextResponse.json({ error: 'gstin is required' }, { status: 400 });

  try {
    const data = await verifyGstin(gstin);
    return NextResponse.json(data);
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}
