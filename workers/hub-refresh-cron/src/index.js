// workers/hub-refresh-cron/src/index.js — Cloudflare Worker, daily Cron Trigger.
// Same pattern as shanti-ops/workers/rate-sync-cron. Calls the Hub's own refresh endpoint
// (POST /api/refresh — re-diffs lib/seed-data.js against rate_changes, drafts only, never
// approves) and reports success/failure to a healthchecks.io dead-man's-switch: pings on
// success/failure, and healthchecks.io itself emails if no ping arrives at all — the only way to
// catch "the cron stopped firing", since this Worker's own code can't detect its own
// non-invocation.
//
// Does not touch the refresh logic itself (lib/refresh.js / app/api/refresh) — this is purely the
// scheduler + failure/heartbeat layer around that already-idempotent, already-verified endpoint.

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runRefresh(env));
  },

  // Manual trigger for testing, gated by the same shared secret the cron uses — lets you confirm
  // the whole chain (Worker -> Hub /api/refresh -> healthchecks.io) works without waiting for
  // 2:00 AM IST. Not part of the cron path itself.
  async fetch(req, env) {
    if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
    const key = req.headers.get('x-trigger-key');
    if (!key || key !== env.REFRESH_JOB_SECRET) return new Response('Unauthorized', { status: 401 });
    const result = await runRefresh(env);
    return new Response(JSON.stringify(result), {
      status: result.ok ? 200 : 502,
      headers: { 'content-type': 'application/json' },
    });
  },
};

async function runRefresh(env) {
  const refreshUrl = env.REFRESH_URL || 'https://statutory-rates-hub.onrender.com/api/refresh';

  let res, body;
  try {
    res = await fetch(refreshUrl, { method: 'POST', headers: { 'x-refresh-key': env.REFRESH_JOB_SECRET } });
    body = await res.text();
  } catch (e) {
    const detail = `fetch failed: ${e.message}`;
    await pingHealthcheck(env, 'fail', detail);
    return { ok: false, error: detail };
  }

  // Any non-2xx (401 bad secret, 500 refresh pipeline error — see lib/refresh.js) is a failed run,
  // no special-casing by status code here — that distinction already happened server-side.
  if (!res.ok) {
    const detail = `HTTP ${res.status}: ${body.slice(0, 500)}`;
    await pingHealthcheck(env, 'fail', detail);
    return { ok: false, status: res.status, body };
  }

  await pingHealthcheck(env, 'success', body);
  return { ok: true, status: res.status, body };
}

async function pingHealthcheck(env, kind, detail) {
  const base = env.HEALTHCHECK_URL;
  if (!base) return; // not configured — refresh still ran, just no external heartbeat this time
  const url = kind === 'success' ? base : `${base}/fail`;
  try {
    await fetch(url, { method: 'POST', body: String(detail || '').slice(0, 1000) });
  } catch {
    // Healthcheck ping itself failing shouldn't throw out of runRefresh — the refresh result
    // already computed above is what matters and gets returned/logged regardless.
  }
}
