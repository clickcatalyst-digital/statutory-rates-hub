// app/api/rates/route.js — admin-only: list everything (drafts + approved), create a draft.
import { NextResponse } from 'next/server';
import { checkAdminKey } from '@/lib/auth';
import { createDraft, listAll } from '@/lib/rates';

export async function GET(req) {
  if (!checkAdminKey(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  return NextResponse.json(await listAll());
}

export async function POST(req) {
  if (!checkAdminKey(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const b = await req.json();
  try {
    const id = await createDraft(b);
    return NextResponse.json({ id });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}
