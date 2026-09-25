// Background job queue on Postgres.
//
// Slow work (Excel import, AI CAD reading, factory quote uploads, storage
// purges) never runs inside an HTTP request — the request enqueues a job and
// returns immediately; the client follows progress via WebSocket or polling.
//
// Workers claim jobs with `FOR UPDATE SKIP LOCKED`, so any number of server
// instances can process the queue without double-running a job. Failed jobs
// retry with exponential backoff (user errors like "bad file" fail at once);
// a job whose worker died is re-queued after its lock goes stale.
import type { PoolClient } from 'pg';
import pg from 'pg';
import { config } from '../config.js';
import { connectionConfig, pool, queryOne, type Db } from '../db/pool.js';
import { AppError } from './errors.js';
import { logger } from './logger.js';
import { publish } from './realtime.js';

export type JobType = 'import-excel' | 'detect-items' | 'import-quotes' | 'purge-objects';

export interface JobRow {
  id: number;
  org_id: number;
  user_id: number | null;
  project_id: number | null;
  type: JobType;
  payload: Record<string, unknown>;
  state: 'queued' | 'running' | 'succeeded' | 'failed';
  progress: number;
  message: string | null;
  result: unknown;
  error: string | null;
  attempts: number;
  max_attempts: number;
  created_at: Date;
  finished_at: Date | null;
}

export interface JobContext {
  job: JobRow;
  /** Report progress (0-100) and an optional status line; also renews the lock. */
  progress(pct: number, message?: string): Promise<void>;
}
type Handler = (payload: Record<string, unknown>, ctx: JobContext) => Promise<unknown>;

const handlers = new Map<JobType, Handler>();
export function registerJob(type: JobType, handler: Handler) {
  handlers.set(type, handler);
}

const WAKE_CHANNEL = 'jobs_wakeup';
const STALE_AFTER_MINUTES = 10;

export function jobDTO(j: JobRow) {
  return {
    id: j.id, type: j.type, state: j.state, progress: j.progress, message: j.message,
    result: j.result ?? null, error: j.error, projectId: j.project_id,
    createdAt: j.created_at, finishedAt: j.finished_at,
  };
}

async function notifyJob(j: JobRow) {
  await publish(j.user_id, {
    type: 'job:update',
    job: { id: j.id, type: j.type, state: j.state, progress: j.progress, message: j.message, projectId: j.project_id },
  });
}

export async function enqueue(
  db: Db,
  opts: { orgId: number; userId: number | null; projectId: number | null; type: JobType; payload: Record<string, unknown>; maxAttempts?: number },
): Promise<JobRow> {
  const job = await queryOne<JobRow>(
    db,
    `INSERT INTO jobs (org_id, user_id, project_id, type, payload, max_attempts)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [opts.orgId, opts.userId, opts.projectId, opts.type, JSON.stringify(opts.payload), opts.maxAttempts ?? 3],
  );
  // Wake an idle worker right away (delivered on commit when inside a transaction).
  await db.query('SELECT pg_notify($1, $2)', [WAKE_CHANNEL, String(job!.id)]);
  return job!;
}

export async function getJobForOrg(db: Db, id: number, orgId: number) {
  return queryOne<JobRow>(db, 'SELECT * FROM jobs WHERE id = $1 AND org_id = $2', [id, orgId]);
}

// ---- Worker ------------------------------------------------------------------

async function claim(): Promise<JobRow | undefined> {
  return queryOne<JobRow>(
    pool,
    `UPDATE jobs SET state = 'running', locked_at = now(), attempts = attempts + 1, error = NULL
      WHERE id = (SELECT id FROM jobs
                   WHERE state = 'queued' AND run_after <= now()
                   ORDER BY id FOR UPDATE SKIP LOCKED LIMIT 1)
      RETURNING *`,
  );
}

async function run(job: JobRow): Promise<void> {
  const handler = handlers.get(job.type);
  const log = logger.child({ jobId: job.id, jobType: job.type, attempt: job.attempts });
  const ctx: JobContext = {
    job,
    async progress(pct, message) {
      const updated = await queryOne<JobRow>(
        pool,
        `UPDATE jobs SET progress = $2, message = COALESCE($3, message), locked_at = now()
          WHERE id = $1 AND state = 'running' RETURNING *`,
        [job.id, Math.max(0, Math.min(99, Math.round(pct))), message ?? null],
      );
      if (updated) await notifyJob(updated);
    },
  };
  try {
    if (!handler) throw new AppError(500, `no handler registered for job type ${job.type}`, 'no_handler');
    log.info('job started');
    const result = await handler(job.payload, ctx);
    const done = await queryOne<JobRow>(
      pool,
      `UPDATE jobs SET state = 'succeeded', progress = 100, result = $2, locked_at = NULL, finished_at = now()
        WHERE id = $1 RETURNING *`,
      [job.id, JSON.stringify(result ?? null)],
    );
    log.info('job succeeded');
    if (done) await notifyJob(done);
  } catch (err) {
    // User-facing errors (bad file, nothing to do) won't succeed on retry.
    const permanent = err instanceof AppError && err.status < 500;
    const retry = !permanent && job.attempts < job.max_attempts;
    const message = err instanceof AppError ? err.message : 'Something went wrong while processing — please try again.';
    log[retry ? 'warn' : 'error']({ err, retry }, 'job failed');
    const updated = await queryOne<JobRow>(
      pool,
      retry
        ? `UPDATE jobs SET state = 'queued', locked_at = NULL, error = $2,
                 run_after = now() + ($3 || ' seconds')::interval WHERE id = $1 RETURNING *`
        : `UPDATE jobs SET state = 'failed', locked_at = NULL, error = $2, finished_at = now()
            WHERE id = $1 RETURNING *`,
      retry ? [job.id, message, String(15 * 2 ** (job.attempts - 1))] : [job.id, message],
    );
    if (updated) await notifyJob(updated);
  }
}

/** Claim and run one queued job. Returns false when the queue is empty.
 *  Used by the worker loop, and directly by tests / one-off scripts. */
export async function processNextJob(): Promise<boolean> {
  const job = await claim();
  if (!job) return false;
  await run(job);
  return true;
}

/** Run queued jobs until none are left (tests; `run_after` delays respected). */
export async function drainJobs(max = 100): Promise<number> {
  let n = 0;
  while (n < max && (await processNextJob())) n++;
  return n;
}

/** Re-queue jobs whose worker vanished (crash/deploy mid-job). */
async function recoverStale() {
  await pool.query(
    `UPDATE jobs SET state = CASE WHEN attempts < max_attempts THEN 'queued' ELSE 'failed' END,
            locked_at = NULL,
            error = CASE WHEN attempts < max_attempts THEN error ELSE 'The job was interrupted — please try again.' END,
            finished_at = CASE WHEN attempts < max_attempts THEN NULL ELSE now() END
      WHERE state = 'running' AND locked_at < now() - ($1 || ' minutes')::interval`,
    [String(STALE_AFTER_MINUTES)],
  );
}

export function startWorkers(): () => Promise<void> {
  let stopping = false;
  let active = 0;
  let wakeClient: pg.Client | null = null;
  const concurrency = config.JOB_CONCURRENCY;

  async function pump() {
    while (!stopping && active < concurrency) {
      let job: JobRow | undefined;
      try { job = await claim(); } catch (err) { logger.warn({ err }, 'job claim failed'); return; }
      if (!job) return;
      active++;
      void run(job).finally(() => { active--; void pump(); });
    }
  }

  const poll = setInterval(() => void pump(), 2000);
  const stale = setInterval(() => void recoverStale().catch((err) => logger.warn({ err }, 'stale-job recovery failed')), 60_000);
  void recoverStale().catch(() => {}).then(pump);

  // Instant wake-up on enqueue.
  (async () => {
    try {
      wakeClient = new pg.Client(connectionConfig());
      await wakeClient.connect();
      await wakeClient.query(`LISTEN ${WAKE_CHANNEL}`);
      wakeClient.on('notification', () => void pump());
      wakeClient.on('error', () => { wakeClient = null; }); // polling still covers us
    } catch (err) {
      logger.warn({ err }, 'job wake listener unavailable — falling back to polling');
    }
  })();

  return async () => {
    stopping = true;
    clearInterval(poll);
    clearInterval(stale);
    await wakeClient?.end().catch(() => {});
    const deadline = Date.now() + 25_000; // let in-flight jobs finish; stale recovery covers the rest
    while (active > 0 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 250));
  };
}

export type { PoolClient };
