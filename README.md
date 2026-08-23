# Statutory Rates Hub

Central, human-verified registry of Indian statutory rates (GST, TDS, PF/ESI, income-tax
slabs, professional-tax slabs), pulled by any number of tenant Shanti Ops installs.

No rate-scraping, no auto-detection of law changes — there is no reliable machine-readable
government source for these (checked this session: GST Accelerator's webhooks aren't live,
Sandbox has no rate-lookup endpoint, no CBIC/CBDT API exists), and getting a compliance-critical
number wrong unattended is worse than a human checking a few times a year (after the Union
Budget, after a GST Council meeting). This service solves two problems: once a rate is verified
once, (1) get it into every tenant DB without re-typing it N times, and (2) make sure a committed
correction to the dataset actually gets applied on schedule instead of relying on someone
remembering to run a script.

## Data lifecycle

```
you read an actual CBIC/CBDT notification, edit lib/seed-data.js
              ↓
   POST /api/refresh   (x-refresh-key, daily cron — see below)
   or  npm run seed-rates   (manual, same effect)
              ↓
   diffAndDraft(): compares against the full version history per rule —
   unchanged data → no-op; changed/new data → a new DRAFT; a same-date
   conflicting value → rejected, not drafted; never mutates an approved row
              ↓
   you review drafts, POST /api/rates/:id/approve (or approveBulk)
              ↓
   GET /api/rates/since?cursor=…   (x-api-key, one per tenant — approved,
   non-retracted rows only)
              ↓
      tenant inserts into its own gst_rates / vendor_tds_rates / statutory_rates / …
```

If an already-*approved* row turns out to have been wrong from inception (a data-entry error,
not a later legal change), it's `retract()`ed rather than edited — the original row and its
approval record stay intact forever (audit trail), a corrected replacement is drafted separately
(can reuse the same `effective_from`), and the retracted row is permanently excluded from
`/api/rates/since`.

`rate_changes` is one generic append-only table for every rate category — the payload is
whatever JSON shape the tenant's own insert route already expects (e.g. `{hsn_code, description,
rate_pct}` for `gst_rate`). The hub doesn't need to understand the field names beyond validating
them against each category's canonical shape (`lib/rates.js`'s `PAYLOAD_VALIDATORS`) — that shape
is a direct mirror of what the tenant consumer requires, so a row that validates is guaranteed
syncable.

## Daily refresh job

```bash
POST /api/refresh   x-refresh-key: <REFRESH_JOB_SECRET>
```

Runs `diffAndDraft` against `lib/seed-data.js` and records a heartbeat row (`refresh_runs`:
`running` → `success`/`failed`). **This does not fetch anything external** — there is no live
statutory-rate source to fetch from (see above). Its only job is to make sure a human-edited
change to `lib/seed-data.js`, once committed, gets drafted on the next scheduled run rather than
sitting until someone remembers to run `npm run seed-rates` by hand. It never approves anything.

Called by a Cloudflare Worker's Cron Trigger — `workers/hub-refresh-cron/` (deployed, same pattern
as `shanti-ops/workers/rate-sync-cron`). Schedule: `30 20 * * *` (20:30 UTC = 02:00 IST daily) —
30 minutes ahead of Shanti Ops' own sync cron, so the Hub finishes refreshing before any tenant
pulls from it. The Worker pings a dedicated healthchecks.io check on success/failure (secrets:
`REFRESH_JOB_SECRET`, `HEALTHCHECK_URL`, set via `wrangler secret put`, never committed) — if the
cron itself stops firing, healthchecks.io emails, since nothing else can detect that.

`GET /api/refresh` (`x-admin-key`) returns the most recent heartbeat, for manual/monitoring checks
— also shown at the top of the admin UI.

**Deferred, not built**: an independent "Discovery" layer that polls real government/provider
sources, flags a *potential* change as "review required" in the Hub, and leaves it to a human to
verify and approve — kept separate from this refresh job on purpose, since no live source exists
yet to poll, and bolting speculative discovery onto the working sync pipeline would complicate the
one part of this system that's actually finished. Revisit if a genuine effective-dated rate-feed
API is ever found (GST Accelerator, Sandbox, and Cleartax/Zoho-style paid compliance APIs were all
checked this session — none currently qualify).

## Sandbox (Quicko) integration

```bash
POST /api/gstin/verify   x-api-key: <tenant key>   {"gstin": "..."}
```

Live GSTIN lookup, tenant-key-authed. This is the *only* thing Sandbox is used for — their API has
no rate-lookup/slab endpoint for GST, TDS, or Income Tax (checked directly against their docs;
Income Tax is calculators/OCR/reports only, GST is compliance/filing/reconciliation only, TDS is
per-transaction calculators only). Not part of the rates lifecycle above, not touched by the
refresh job, not a source `lib/seed-data.js` is derived from.

## Admin UI

`app/page.js` — shadcn/ui + Tailwind v4 (`nova` preset, base-ui primitives). Shows the daily
refresh heartbeat, lets you create/approve/bulk-approve/retract rows without hitting the API
directly:

- **Approve** (single) and **Approve selected** (checkbox-driven bulk, calls
  `POST /api/rates/bulk-approve`) for drafts.
- **Retract** for approved rows — prompts for a reason (required), calls
  `POST /api/rates/:id/retract`. A retracted row's status badge and reason are shown inline, not
  conflated with "approved" (an earlier version of this UI didn't distinguish them at all — a
  retracted row looked identical to a live approved one, which is actively misleading for
  compliance data).

## Running it

```bash
npm install
# .env.local (not committed) needs: ADMIN_KEY, TURSO_URL, TURSO_AUTH_TOKEN,
# SANDBOX_API_KEY, SANDBOX_API_SECRET, REFRESH_JOB_SECRET
npm run dev                  # http://localhost:3100, admin UI at /
```

Add a tenant (prints an API key, give it to that install):

```bash
npm run add-tenant -- "Client Company Name"
```

Regression suite (validation, draft/approval isolation, change detection, versioning, historical
immutability, retraction, bulk ops, cursor pagination, the refresh job):

```bash
npm test
```

Fast smoke test (draft → approve → pull → no duplicate pull):

```bash
npm run selfcheck
```

## Explicitly not built

- No scraper / change-detection against government sites — checking happens around known trigger
  dates (Budget, GST Council meetings), by a human reading the actual notification and editing
  `lib/seed-data.js`. The daily refresh job automates *applying* that edit, not *finding* it — see
  "Deferred" above.
- No push/webhook to tenants — pull-based cron on the tenant side is enough for something that
  changes a handful of times a year.
- No per-tenant rate customization — GST/TDS/PF/ESI are national law, identical for every tenant.
- No roles/workflow beyond draft → approved (→ retracted) — there's one admin.
