// scripts/add-tenant.mjs — usage: npm run add-tenant -- "Tenant Name"
// One-off CLI, not an admin-UI flow: tenant count is small and onboarding a new one is rare
// enough that typing a command beats building a form for it.
import { randomBytes } from 'node:crypto';
import { execute } from '../lib/db.js';

const name = process.argv[2];
if (!name) {
  console.error('Usage: npm run add-tenant -- "Tenant Name"');
  process.exit(1);
}

const apiKey = randomBytes(24).toString('hex');
await execute('INSERT INTO tenants (name, api_key) VALUES (?, ?)', [name, apiKey]);
console.log(`Tenant "${name}" created.`);
console.log(`API key: ${apiKey}`);
console.log('Give this to the tenant install as STATUTORY_RATES_HUB_API_KEY.');
process.exit(0);
