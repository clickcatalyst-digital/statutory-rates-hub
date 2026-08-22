// scripts/test-sandbox.mjs — one-off connectivity check for the Sandbox (Quicko) integration.
// usage: npm run test-sandbox [gstin]
import { config as loadEnv } from 'dotenv';
loadEnv({ path: '.env.local' });

if (!process.env.SANDBOX_API_KEY || !process.env.SANDBOX_API_SECRET) {
  console.error('Missing SANDBOX_API_KEY / SANDBOX_API_SECRET in .env.local');
  process.exit(1);
}

const { verifyGstin } = await import('../lib/sandbox.js');

const gstin = process.argv[2] || '07AABCU9603R1ZP'; // Ujjivan Small Finance Bank — known-real, for a connectivity smoke test
const data = await verifyGstin(gstin);
console.log(`GSTIN ${gstin}: ${data.lgnm} — status ${data.sts}`);
