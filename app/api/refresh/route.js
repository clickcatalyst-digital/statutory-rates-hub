// app/api/refresh/route.js — triggered by a scheduled caller (a Cloudflare Worker's Cron Trigger,
// not created yet — this endpoint is what it will call). POST runs the refresh, x-refresh-key
// gated (a separate, lower-privilege secret from x-admin-key). GET returns the last run's status,
// admin-key gated, for manual/monitoring checks.
import { NextResponse } from 'next/server';
import { checkAdminKey, checkRefreshKey } from '@/lib/auth';
import { runRefresh, latestRefreshRun } from '@/lib/refresh';

export async function POST(req) {
  if (!checkRefreshKey(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const result = await runRefresh();
    return NextResponse.json(result);
  } catch (e) {
    // Non-2xx on any failure — a Cron Trigger caller needs the status code to know to alert,
    // not just a 200 with an error field it might not check.
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function GET(req) {
  if (!checkAdminKey(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const run = await latestRefreshRun();
  return NextResponse.json(run);
}
