# Statutory Rates Hub

Central, human-verified registry of Indian statutory rates (GST, TDS, PF/ESI, income-tax
slabs, professional-tax slabs), pulled by any number of tenant Shanti Ops installs.

No rate-scraping, no auto-detection of law changes — there is no reliable machine-readable
government source for these, and getting a compliance-critical number wrong unattended is worse
than a human checking a few times a year (after the Union Budget, after a GST Council meeting).
This service only solves the *second* problem: once a rate is verified once, get it into every
tenant DB without re-typing it N times.

## Workflow

```
you read an actual CBIC/CBDT notification
              ↓
        POST /api/rates            (draft, x-admin-key)
              ↓
   POST /api/rates/:id/approve     (x-admin-key)
              ↓
   GET /api/rates/since?cursor=…   (x-api-key, one per tenant)
              ↓
      tenant inserts into its own gst_rates / vendor_tds_rates / statutory_rates / …
```

`rate_changes` is one generic append-only table for every rate category — the payload is
whatever JSON shape the tenant's own insert route already expects (e.g. `{hsn_code, description,
rate_pct}` for `gst_rate`). The hub doesn't need to understand the field names, only carry them.

## Running it

```bash
npm install
cp .env.example .env.local   # fill in ADMIN_KEY (and TURSO_URL/TOKEN for production)
npm run dev                  # http://localhost:3100, admin UI at /
```

Add a tenant (prints an API key, give it to that install):

```bash
npm run add-tenant -- "Client Company Name"
```

Self-check (draft → approve → pull → no duplicate pull):

```bash
npm run selfcheck
```

## Explicitly not built

- No scraper / change-detection against government sites — checking happens around known trigger
  dates (Budget, GST Council meetings), by a human reading the actual notification.
- No push/webhook to tenants — pull-based cron on the tenant side is enough for something that
  changes a handful of times a year.
- No per-tenant rate customization — GST/TDS/PF/ESI are national law, identical for every tenant.
- No roles/workflow beyond draft → approved — there's one admin.
