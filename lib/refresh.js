// lib/refresh.js — the daily statutory refresh job. Runs the existing draft/diff pipeline against
// the canonical dataset (lib/seed-data.js) and records a heartbeat row so a monitor can tell "did
// this run today" from "when did it last succeed" without needing log access.
//
// No live external source exists for this data (see lib/seed-data.js's header) — this job's only
// job is to make sure a human-edited change to that file gets drafted automatically, on schedule,
// instead of requiring someone to remember `npm run seed-rates` after every edit. It never
// approves anything — diffAndDraft only ever creates DRAFTS.
//
// Idempotent and safe to retry by construction, not by any extra locking here: diffAndDraft's own
// identity+effective_from comparison means re-running against unchanged data always reports
// created:0 (see lib/rates.js), and its insert/delete happen in one batch() transaction, so a
// crash mid-run can't leave a rule half-applied. A retry after a failed run just re-derives the
// same diff and either finishes what didn't apply or reports nothing new — no separate
// idempotency-key bookkeeping needed. Overlapping concurrent runs (a retry firing while a previous
// invocation is still in flight) aren't locked against — a daily cron with occasional manual
// retries doesn't produce genuine concurrent overlap, and even if it did, two diffAndDraft calls
// racing would at worst report a duplicate "unchanged" or a benign double-draft insert covered by
// the same conflict-rejection logic used for any other same-day duplicate. Not worth a lock for
// this cadence — noted here so it isn't silently assumed to be handled by something that isn't.
import { execute } from './db.js';
import { diffAndDraft } from './rates.js';
import { getSeedRows, SEED_SUBMITTED_BY } from './seed-data.js';

// `rows` param is a testability hook (default: the real dataset) — lets tests exercise the
// success/failure/heartbeat mechanics against small synthetic input instead of the full production
// dataset, and exercise the failure path by handing it a row that fails validation.
export async function runRefresh({ rows = getSeedRows() } = {}) {
  const { lastInsertRowid } = await execute(
    `INSERT INTO refresh_runs (status) VALUES ('running')`
  );
  const runId = Number(lastInsertRowid);

  try {
    const result = await diffAndDraft(rows, { submitted_by: SEED_SUBMITTED_BY });

    await execute(
      `UPDATE refresh_runs SET completed_at = CURRENT_TIMESTAMP, status = 'success',
       created = ?, unchanged = ?, rejected = ?, superseded_drafts_removed = ?
       WHERE id = ?`,
      [result.created, result.unchanged, result.rejected.length, result.supersededDraftsRemoved, runId]
    );

    return { runId, ...result };
  } catch (err) {
    await execute(
      `UPDATE refresh_runs SET completed_at = CURRENT_TIMESTAMP, status = 'failed', error_message = ? WHERE id = ?`,
      [String(err?.message ?? err), runId]
    );
    throw err;
  }
}

export async function latestRefreshRun() {
  const { rows } = await execute(`SELECT * FROM refresh_runs ORDER BY id DESC LIMIT 1`);
  return rows[0] ?? null;
}
