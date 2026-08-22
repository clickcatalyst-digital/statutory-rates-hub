// lib/sandbox.js — thin client for the Sandbox (Quicko) API. Used for lookups that fit its actual
// product (GSTIN verification, and later e-invoice/e-way-bill/compliance workflows) — NOT for
// deriving statutory rates, which Sandbox has no endpoint for (its "calculators" compute tax on a
// given transaction, they don't expose a rate table).
const BASE_URL = 'https://api.sandbox.co.in';

let cachedToken = null;
let cachedTokenExpiry = 0;

async function getAccessToken() {
  if (cachedToken && Date.now() < cachedTokenExpiry) return cachedToken;

  const res = await fetch(`${BASE_URL}/authenticate`, {
    method: 'POST',
    headers: {
      'x-api-key': process.env.SANDBOX_API_KEY,
      'x-api-secret': process.env.SANDBOX_API_SECRET,
      'x-api-version': '1.0',
      'Content-Type': 'application/json',
    },
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`Sandbox auth failed: ${res.status} ${JSON.stringify(body)}`);

  cachedToken = body.data.access_token;
  // token is valid 24h; refresh 5min early to avoid edge-of-expiry failures
  cachedTokenExpiry = Date.now() + 23.9 * 60 * 60 * 1000;
  return cachedToken;
}

export async function verifyGstin(gstin) {
  const token = await getAccessToken();
  const res = await fetch(`${BASE_URL}/gst/compliance/public/gstin/search`, {
    method: 'POST',
    headers: {
      authorization: token,
      'x-api-key': process.env.SANDBOX_API_KEY,
      'x-api-version': '1.0.0',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ gstin }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.message || `Sandbox GSTIN search failed: ${res.status}`);
  return body.data.data;
}
