// scripts/seed-rates.mjs — bulk seed of currently-applicable Indian statutory rates, researched
// 2026-08-22, in the canonical payload shape lib/rates.js validates (matching what Shanti Ops'
// insert*/patch functions actually require — see lib/rates.js PAYLOAD_VALIDATORS). Inserted as
// DRAFTS ONLY — review and approve in the admin UI before tenants pull anything.
//
// source_ref suffixes:
//   [UNVERIFIED] / [aggregator-only] — not confirmed against a primary government source, don't
//     approve without checking (CBIC/CBDT/EPFO/ESIC/state portal, per the row's own note).
//   [not yet syncable] — a gst_rate `category` row (no real HSN/SAC code). Shanti Ops has no
//     default-rate concept today, so these are Hub reference data only until that changes.
//
// Deliberately excluded from this seed, not just unverified:
//   - West Bengal / Tamil Nadu / Gujarat professional_tax_slab: no confirmed numeric min_gross/
//     amount exists at all (only an annual cap was found, even after step-5 verification). Shanti
//     Ops' schema requires real numbers — inserting a fabricated 0 would misstate an unknown rate
//     as "no tax", which is worse than leaving the state out entirely. Add once real slab data is
//     found.
//   - GST conditional-rate items (restaurant tariff tiers, tobacco cess) — Shanti Ops' gst_rates
//     table is a flat hsn_code -> rate_pct map with no room for a business condition like "room
//     tariff >= Rs.7500"; two different rates can't both be encoded under the same SAC code with
//     no way to pick between them. Kept as `category` (non-syncable reference) rows instead of
//     forcing a fake single rate onto a conditional HSN/SAC.
//   - PF EDLI (0.5%, employer-only) — Shanti Ops' statutory_rates table has no EDLI field; noted
//     here in comments only, nothing to seed.
//
// usage: npm run seed-rates
import { config as loadEnv } from 'dotenv';
loadEnv({ path: '.env.local' });
import { diffAndDraft } from '../lib/rates.js';

const CBIC_NOTIF = 'CBIC Notification No. 09/2025-Central Tax (Rate), dated 17.09.2025';
const submitted_by = 'seed-rates.mjs (web research, 2026-08-22)';

const rows = [
  // ---------- gst_rate ----------
  // category rows: slab-structure reference, not tied to a real HSN/SAC — not yet syncable.
  { category: 'gst_rate', effective_from: '2025-09-22', source_ref: CBIC_NOTIF + ' [not yet syncable]',
    payload: { category: 'nil rate — unprocessed food, education, basic healthcare', rate_pct: 0 } },
  { category: 'gst_rate', effective_from: '2025-09-22', source_ref: CBIC_NOTIF + ' [not yet syncable]',
    payload: { category: 'essential goods (Schedule I) — food staples, medicines, agricultural inputs', rate_pct: 5 } },
  { category: 'gst_rate', effective_from: '2025-09-22', source_ref: CBIC_NOTIF + ' [not yet syncable]',
    payload: { category: 'standard/default rate — most goods and services incl. B2B professional services', rate_pct: 18 } },
  { category: 'gst_rate', effective_from: '2025-09-22', source_ref: CBIC_NOTIF + ' [not yet syncable]',
    payload: { category: 'luxury/sin goods (de-merit) — tobacco, pan masala, luxury cars, aerated drinks', rate_pct: 40 } },
  { category: 'gst_rate', effective_from: '2025-09-22',
    source_ref: 'CBIC Notification No. 15/2025-Central Tax (Rate), dated 17.09.2025 [not yet syncable — verified: Rs.7500 tariff cutoff corroborated across 6+ independent sources incl. taxguru, cleartax, bajajfinserv, carajput, all citing the same notification number; primary PDF still not directly fetched]',
    payload: { category: 'restaurant services (SAC 9963), non-hotel or room tariff < Rs.7500/night — 5% without ITC', rate_pct: 5 } },
  { category: 'gst_rate', effective_from: '2025-09-22',
    source_ref: 'CBIC Notification No. 15/2025-Central Tax (Rate), dated 17.09.2025 [not yet syncable — verified, see prior row]',
    payload: { category: 'restaurant/F&B in "specified premises" (hotel where any room exceeded Rs.7500/night in preceding FY), SAC 9963, full ITC', rate_pct: 18 } },
  { category: 'gst_rate', effective_from: '2025-09-22', source_ref: CBIC_NOTIF + ' [not yet syncable]',
    payload: { category: 'outdoor catering, full ITC', rate_pct: 18 } },
  { category: 'gst_rate', effective_from: '2025-09-22', effective_to: '2026-02-01',
    source_ref: 'Health Security National Security Cess Act, 2025 + Central Excise (Amendment) Act, 2025, effective 2026-02-01 [not yet syncable — verified: mechanism and date corroborated across taxo.online, businesstoday.in, a2ztaxcorp; primary gazette text still not directly fetched. Compensation cess is REPLACED by new excise/health-cess instruments on this date, not simply removed — tobacco settles at plain 40% GST thereafter]',
    payload: { category: 'tobacco products (transitional) — cigarettes, gutkha, pan masala, bidi, zarda; compensation cess layer ends 2026-02-01, replaced by Central Excise + Health Security cess', rate_pct: 40 } },
  // hsn_code rows: single unconditional rate per code — genuinely syncable today.
  { category: 'gst_rate', effective_from: '2025-09-22', source_ref: CBIC_NOTIF,
    payload: { hsn_code: '9983', description: 'Software/IT services (SAC 9983)', rate_pct: 18 } },
  { category: 'gst_rate', effective_from: '2025-09-22', source_ref: CBIC_NOTIF,
    payload: { hsn_code: '9984', description: 'SaaS/IT-enabled services (SAC 9984), supply of service regardless of delivery mode', rate_pct: 18 } },

  // ---------- vendor_tds_rate ----------
  // Section renumbering RESOLVED: Section 393 = TDS, Section 394 = TCS, Section 397(2) = PAN-not-
  // furnished, all effective 2026-04-01 — confirmed convergently across incometaxindia.gov.in
  // search snippets, tdsman.com (a specialist TDS-compliance blog citing table serial numbers/
  // payment codes), taxguru, cleartax, aaaa.co.in. Shanti Ops' own doc guess of "392/393" appears
  // to be wrong — 393/394/397 is the confirmed structure. Old section numbers kept as the primary
  // key (unambiguous, still universally used in practice); new Act section noted in description.
  // Underlying rates/thresholds were already stable pre-existing law, not re-verified this pass.
  // NOTE: `description` is part of vendor_tds_rate's identity key (section+description) — it stays
  // as the exact prose it was first approved with, even though that prose is now longer than
  // ideal (a lesson learned mid-session: Gap B originally proposed shortening these, but 10 of these
  // 12 rows are already approved in production, and rewording an identity field would make
  // diffAndDraft see a "new identity" and draft a duplicate alongside the approved original instead
  // of recognizing it as the same rule). Going forward, write NEW rows with a short stable label
  // from the start — do not reword an existing row's description once it exists.
  { category: 'vendor_tds_rate', effective_from: '2026-04-01',
    source_ref: 'Income-tax Act 2025 Sec 393(1) [section number verified — see file header note; rate/threshold not independently re-checked, long-stable figures]',
    payload: { section: '194C', description: 'Contractors/sub-contractors, individual/HUF payee — new Act Section 393(1). Single-payment threshold Rs.30,000 also applies (not representable — this row uses the aggregate).', rate_pct: 1, threshold_amount: 100000 } },
  { category: 'vendor_tds_rate', effective_from: '2026-04-01',
    source_ref: 'Income-tax Act 2025 Sec 393(1) [section number verified — see file header note; rate/threshold not independently re-checked, long-stable figures]',
    payload: { section: '194C', description: 'Contractors/sub-contractors, other entities — new Act Section 393(1). Single-payment threshold Rs.30,000 also applies (not representable — this row uses the aggregate).', rate_pct: 2, threshold_amount: 100000 } },
  { category: 'vendor_tds_rate', effective_from: '2026-04-01',
    source_ref: 'Income-tax Act 2025 Sec 393(1) [section number verified — see file header note; rate/threshold not independently re-checked]',
    payload: { section: '194H', description: 'Commission or brokerage — new Act Section 393(1)', rate_pct: 2, threshold_amount: 20000 } },
  { category: 'vendor_tds_rate', effective_from: '2026-04-01',
    source_ref: 'Income-tax Act 2025 Sec 393(1) Table Sl.2, verified directly against the bare Act text (Income_Tax_Act_2025_as_amended_by_FA_Act_2026.pdf, incometaxindia.gov.in) — CORRECTED 2026-08-23: threshold is Rs.50,000 PER MONTH OR PART OF A MONTH, not an annual Rs.2,40,000 figure (the old 1961-Act structure). description kept unchanged (identity-bearing field) — the "per month" unit lives here in source_ref since threshold_amount is a bare number with no period field.',
    payload: { section: '194I', description: 'Rent — plant & machinery — new Act Section 393(1)', rate_pct: 2, threshold_amount: 50000 } },
  { category: 'vendor_tds_rate', effective_from: '2026-04-01',
    source_ref: 'Income-tax Act 2025 Sec 393(1) Table Sl.2, verified directly against the bare Act text (Income_Tax_Act_2025_as_amended_by_FA_Act_2026.pdf, incometaxindia.gov.in) — CORRECTED 2026-08-23: threshold is Rs.50,000 PER MONTH OR PART OF A MONTH, not an annual Rs.2,40,000 figure (the old 1961-Act structure). description kept unchanged (identity-bearing field) — the "per month" unit lives here in source_ref since threshold_amount is a bare number with no period field.',
    payload: { section: '194I', description: 'Rent — land / building / furniture — new Act Section 393(1)', rate_pct: 10, threshold_amount: 50000 } },
  { category: 'vendor_tds_rate', effective_from: '2026-04-01',
    source_ref: 'Income-tax Act 2025 Sec 393(1) Table S.No. 6(iii) [section number verified — see file header note; rate/threshold not independently re-checked]',
    payload: { section: '194J', description: 'Professional fees — new Act Section 393(1) Table S.No. 6(iii)', rate_pct: 10, threshold_amount: 50000 } },
  { category: 'vendor_tds_rate', effective_from: '2026-04-01',
    source_ref: 'Income-tax Act 2025 Sec 393(1) [section number verified — see file header note; rate/threshold not independently re-checked]',
    payload: { section: '194J', description: 'Technical services / call-centre / certain royalties — new Act Section 393(1)', rate_pct: 2, threshold_amount: 50000 } },
  { category: 'vendor_tds_rate', effective_from: '2026-04-01',
    source_ref: 'Income-tax Act 2025 Sec 393(1) [section number verified — see file header note; rate/threshold not independently re-checked]',
    payload: { section: '194Q', description: 'Purchase of goods (buyer TDS, buyer turnover > 10cr preceding year) — new Act Section 393(1) — overrides 206C(1H) where both apply', rate_pct: 0.1, threshold_amount: 5000000 } },
  // 206C(1H) — DELIBERATELY ABSENT, not merely omitted by oversight. This provision does not exist
  // in Income-tax Act 2025 Section 394's TCS table (confirmed against the bare Act text 2026-08-23
  // — no generic goods-sale item anywhere in Sl.1-9). Finance Act 2025 made it inapplicable from
  // 2025-04-01, independently corroborated (taxguru.in, SAP KB 3574318/3576728, indiafilings.com).
  // The approved row that once represented this (id 215) was RETRACTED on 2026-08-23 as an
  // admin error, with no replacement — do not re-add a candidate for this identity; retracted rows
  // are excluded from diffAndDraft's version detection, so re-adding one here would be treated as
  // a brand-new identity and silently draft a rule that doesn't exist under current law.
  { category: 'vendor_tds_rate', effective_from: '2026-04-01',
    source_ref: 'Income-tax Act 2025 Sec 393(1) Table Sl.5(iii), verified directly against the bare Act text (Income_Tax_Act_2025_as_amended_by_FA_Act_2026.pdf, incometaxindia.gov.in) on 2026-08-23: this row represents the general/other-specified-person case (Sl.5(iii)), threshold Rs.10,000, confirmed correct classification (not the bank/co-op/post-office case, Sl.5(ii), which separately has Rs.50,000/Rs.1,00,000 senior-citizen thresholds, not modeled here). Corrected replacement for a RETRACTED approved row (id 216, incorrectly had threshold Rs.5,000) — same effective_from, per the Hub RETRACTED lifecycle. Still a draft, pending approval.',
    payload: { section: '194A', description: 'Interest other than on securities — general payer threshold (bank/post-office deposit thresholds differ, not representable in one field) — new Act Section 393(1)', rate_pct: 10, threshold_amount: 10000 } },
  { category: 'vendor_tds_rate', effective_from: '2026-04-01',
    source_ref: 'Income-tax Act 2025 Sec 397(2) [verified: consolidation of old 206AA+206CC into 397(2) corroborated across tdsman.com, taxguru, cleartax, aaaa.co.in; primary Act text not directly fetched]',
    payload: { section: '206AA/206CC', description: 'PAN not furnished — higher of: section rate, 20%, or rate in force — new Act Section 397(2). Note: purchase-of-goods (194Q) and e-commerce exceptions use 5% instead of 20% per some sources — not verified, this row is the general case.', rate_pct: 20, threshold_amount: null } },
  { category: 'vendor_tds_rate', effective_from: '2026-04-01',
    source_ref: 'Income-tax Act 2025 Sec 393(3), Table S.No. 7, Payment Code 1067 [verified: rate/threshold/effective-date corroborated across incometaxindia.gov.in-adjacent search snippet, tdsman.com, vakilsearch, cleartax, taxguru — was previously Section 194T (Finance (No.2) Act 2024), now consolidated into the new Act]',
    payload: { section: '194T', description: 'TDS on salary/remuneration/commission/bonus/interest paid by a partnership firm to its partners — new Act Section 393(3)', rate_pct: 10, threshold_amount: 20000 } },

  // ---------- statutory_rate — split into two rows by verification status, not one bundled row.
  // patchStatutoryRates only touches keys present in the payload it's given, so two separate
  // patches (one per row, applied whenever each is approved/synced) is equivalent to one combined
  // patch — splitting costs nothing functionally and lets PF/ESI (well-sourced) be approved
  // without also approving standard_deduction/rebate (PIB-sourced, still unconfirmed). ----------
  { category: 'statutory_rate', effective_from: '2026-04-01',
    source_ref: 'PF wage ceiling Rs.15,000: Gazette Notification S.O. 2702(E), dated 29-May-2026, under Code on Social Security 2020 Ch.III [verified: specific gazette number corroborated across zeenews, livelaw, scconline, praansconsultech; raw gazette PDF not directly fetched]. ESI ceiling Rs.21,000: unchanged since Jan-2017 [verified: confirmed unchanged by 8+ independent 2026 sources incl. cleartax, tallysolutions; no 2026 gazette notification found for any change, consistent negative result]. PF/ESI percentages (12/12, 0.75/3.25): long-stable, not separately re-verified.',
    payload: {
      pf_employee_pct: 12, pf_employer_pct: 12, pf_wage_ceiling: 15000,
      esi_employee_pct: 0.75, esi_employer_pct: 3.25, esi_wage_ceiling: 21000,
    } },
  { category: 'statutory_rate', effective_from: '2026-04-01',
    source_ref: 'Income-tax Act 2025 Sec 19 (standard deduction, Rs.75,000 or salary whichever less) + Sec 156(2) (rebate: 100% of tax or Rs.60,000 whichever less, for income under Sec 202(1) not exceeding Rs.12,00,000) — verified directly against the bare Act text (Income_Tax_Act_2025_as_amended_by_FA_Act_2026.pdf, incometaxindia.gov.in) on 2026-08-23. Both figures confirmed exact.',
    payload: { standard_deduction: 75000, tds_rebate_income_threshold: 1200000 } },

  // ---------- income_tax_slab — new/default regime (the only regime Shanti Ops' payroll query
  // and insert function support today), Income-tax Act 2025, FY 2026-27 ----------
  { category: 'income_tax_slab', effective_from: '2026-04-01',
    source_ref: 'Income-tax Act 2025 Section 202(1) Table — verified directly against the bare Act text (Income_Tax_Act_2025_as_amended_by_FA_Act_2026.pdf, incometaxindia.gov.in) on 2026-08-23. All 7 slabs confirmed byte-for-byte exact.',
    payload: { financial_year: '2026-27', min_income: 0, max_income: 400000, rate_pct: 0 } },
  { category: 'income_tax_slab', effective_from: '2026-04-01', source_ref: 'Income-tax Act 2025 Section 202(1) Table [verified — see note on first row]',
    payload: { financial_year: '2026-27', min_income: 400001, max_income: 800000, rate_pct: 5 } },
  { category: 'income_tax_slab', effective_from: '2026-04-01', source_ref: 'Income-tax Act 2025 Section 202(1) Table [verified — see note on first row]',
    payload: { financial_year: '2026-27', min_income: 800001, max_income: 1200000, rate_pct: 10 } },
  { category: 'income_tax_slab', effective_from: '2026-04-01', source_ref: 'Income-tax Act 2025 Section 202(1) Table [verified — see note on first row]',
    payload: { financial_year: '2026-27', min_income: 1200001, max_income: 1600000, rate_pct: 15 } },
  { category: 'income_tax_slab', effective_from: '2026-04-01', source_ref: 'Income-tax Act 2025 Section 202(1) Table [verified — see note on first row]',
    payload: { financial_year: '2026-27', min_income: 1600001, max_income: 2000000, rate_pct: 20 } },
  { category: 'income_tax_slab', effective_from: '2026-04-01', source_ref: 'Income-tax Act 2025 Section 202(1) Table [verified — see note on first row]',
    payload: { financial_year: '2026-27', min_income: 2000001, max_income: 2400000, rate_pct: 25 } },
  { category: 'income_tax_slab', effective_from: '2026-04-01', source_ref: 'Income-tax Act 2025 Section 202(1) Table [verified — see note on first row]',
    payload: { financial_year: '2026-27', min_income: 2400001, max_income: null, rate_pct: 30 } },

  // ---------- professional_tax_slab — Maharashtra, Karnataka, AP, Telangana only.
  // WB/TN/Gujarat excluded: no confirmed numeric slabs exist (see file header).
  // All 6 previously-flagged rows below were independently verified 2026-08-23 against primary
  // government sources (fetched directly, not aggregator summaries) — see each source_ref. ----------
  { category: 'professional_tax_slab', effective_from: '2023-04-06', source_ref: 'Maharashtra Profession Tax Act 1975, official Rate Schedule PDF "As on 31.03.2025" (mahagst.gov.in/public/uploads/menufiles/PT Rate Schedule updated upto 31.03.2025.pdf) — fetched and read directly 2026-08-23. Schedule I Entry 1, period "1/4/2023 onwards", men (i)(a): confirmed exact.',
    payload: { state: 'Maharashtra', min_gross: 0, max_gross: 7500, amount: 0 } },
  { category: 'professional_tax_slab', effective_from: '2023-04-06',
    source_ref: 'Maharashtra official Rate Schedule PDF, Entry 1(i)(b), men [verified — see prior row]. Women have a separate, higher exemption band (Nil up to Rs.25,000/month) under the same Entry 1(ii) — not representable in this schema (no gender field); this row and the next represent the mens bands only, which is what was already approved.',
    payload: { state: 'Maharashtra', min_gross: 7501, max_gross: 10000, amount: 175 } },
  { category: 'professional_tax_slab', effective_from: '2023-04-06',
    source_ref: 'Maharashtra official Rate Schedule PDF, Entry 1(i)(c), men [verified — see first row]. CONFIRMED: Rs.2,500/year paid as Rs.200/month except February, Rs.300 in February — exact quote from the schedule PDF. This row uses the non-Feb amount (200); the schema has no month-of-year field to represent the Feb exception, noted here in source_ref only.',
    payload: { state: 'Maharashtra', min_gross: 10001, max_gross: null, amount: 200 } },
  { category: 'professional_tax_slab', effective_from: '2025-04-01',
    source_ref: 'Karnataka Notification No. DPAL 08 SHASANA 2025, dated 15.04.2025 — independently corroborated across 5+ compliance/legal sources (AscentHR x2, Vishnu Daya & Co LLP, United Consultancy Services, JSA Semi-Annual Employment Law Compendium) all citing the identical notification number and figures on 2026-08-23. Exemption raised Rs.15,000 -> Rs.25,000 from 01-Apr-2025.',
    payload: { state: 'Karnataka', min_gross: 0, max_gross: 24999, amount: 0 } },
  { category: 'professional_tax_slab', effective_from: '2025-04-01',
    source_ref: 'Karnataka Notification No. DPAL 08 SHASANA 2025, dated 15.04.2025 [verified — see prior row]. CONFIRMED: annual Rs.2,500 (raised from Rs.2,400) paid as Rs.200/month except February, Rs.300 in February — explicit in the notification per all 5+ corroborating sources.',
    payload: { state: 'Karnataka', min_gross: 25000, max_gross: null, amount: 200 } },
  // Andhra Pradesh — CORRECTED 2026-08-23, not just re-cited: the previously-drafted single-tier
  // row (exemption up to Rs.20,000) was WRONG. G.O.Ms.No. 82, dated 04-02-2013 (Andhra Pradesh
  // Commercial Taxes Dept) sets exemption at Rs.15,000, not Rs.20,000 — confirmed via taxguru.in's
  // direct reproduction of the G.O. text, cross-checked against 3 independent aggregators citing
  // the same G.O. number. No report found of any AP-specific amendment since 2013 despite search —
  // this is the same underlying pre-2014-bifurcation rate structure Telangana also carried forward,
  // which is why AP and Telangana end up numerically identical here (not an assumption, a finding).
  { category: 'professional_tax_slab', effective_from: '2013-02-04', source_ref: 'Andhra Pradesh G.O.Ms.No. 82, dated 04-02-2013 — quoted directly by taxguru.in, corroborated by bankbazaar/greythr/paisabazaar/simpliance independently citing the same figures. "No Profession Tax on salaries less than 15,000" — replaces the previously-drafted (wrong) Rs.20,000 exemption ceiling.',
    payload: { state: 'Andhra Pradesh', min_gross: 0, max_gross: 15000, amount: 0 } },
  { category: 'professional_tax_slab', effective_from: '2013-02-04', source_ref: 'Andhra Pradesh G.O.Ms.No. 82, dated 04-02-2013 [verified — see prior row]. This tier did not exist at all in the previously-drafted data.',
    payload: { state: 'Andhra Pradesh', min_gross: 15001, max_gross: 20000, amount: 150 } },
  { category: 'professional_tax_slab', effective_from: '2013-02-04', source_ref: 'Andhra Pradesh G.O.Ms.No. 82, dated 04-02-2013 [verified — see first AP row]. This tier did not exist at all in the previously-drafted data.',
    payload: { state: 'Andhra Pradesh', min_gross: 20001, max_gross: null, amount: 200 } },
  // Telangana: previously flagged aggregator-only, now confirmed by fetching the official schedule
  // page directly — exact match to what was already drafted, including the (confirmed, not assumed)
  // absence of any February surcharge, unlike Maharashtra/Karnataka.
  { category: 'professional_tax_slab', effective_from: '1987-06-15', source_ref: 'Telangana Tax on Professions, Trades, Callings and Employments Act, 1987 — official schedule page tgct.gov.in/tgportal/AllActs/APPT/APPTSchedule.aspx, fetched and read directly 2026-08-23: "Up to Rs.15,000: Nil". No February exception stated anywhere on the official schedule (confirmed absent, not merely unmentioned).',
    payload: { state: 'Telangana', min_gross: 0, max_gross: 15000, amount: 0 } },
  { category: 'professional_tax_slab', effective_from: '1987-06-15', source_ref: 'Telangana official schedule page [verified — see prior row]: "Rs.15,001 to Rs.20,000: Rs.150".',
    payload: { state: 'Telangana', min_gross: 15001, max_gross: 20000, amount: 150 } },
  { category: 'professional_tax_slab', effective_from: '1987-06-15', source_ref: 'Telangana official schedule page [verified — see first Telangana row]: "Above Rs.20,000: Rs.200", flat monthly rate, no February surcharge.',
    payload: { state: 'Telangana', min_gross: 20001, max_gross: null, amount: 200 } },
];

// Fixed placeholder, NOT `new Date()` — a handful of rows (AP/Telangana PT, Karnataka's original
// exemption row) have no confirmed effective_from yet. Using "today" would make effective_from
// drift on every re-run (tomorrow's "today" > yesterday's stored value), which diffAndDraft would
// see as a genuine new version and draft again and again. Pin it to when this data was researched.
const UNKNOWN_EFFECTIVE_DATE = '2026-08-22';
for (const r of rows) {
  if (!r.effective_from) r.effective_from = UNKNOWN_EFFECTIVE_DATE;
}

const result = await diffAndDraft(rows, { submitted_by });
console.log(`created: ${result.created}, unchanged: ${result.unchanged}, rejected: ${result.rejected.length}, superseded drafts removed: ${result.supersededDraftsRemoved}`);
if (result.rejected.length) {
  console.log('REJECTED (not drafted — review manually):');
  for (const r of result.rejected) console.log(` - ${r.candidate.category} ${JSON.stringify(r.candidate.payload)}: ${r.reason}`);
}
const unverified = rows.filter(r => /UNVERIFIED|aggregator-only/.test(r.source_ref)).length;
const notSyncable = rows.filter(r => r.source_ref.includes('not yet syncable')).length;
console.log(`${unverified} of ${rows.length} candidate rows are flagged UNVERIFIED/aggregator-only — check before approving.`);
console.log(`${notSyncable} gst_rate candidate rows are category-level reference data, not yet syncable to Shanti Ops (no default-rate concept there).`);
