// Process entry point: validate config (on import), apply pending migrations,
// start HTTP + WebSocket + background workers, and shut down gracefully on
// SIGTERM (Render sends it on every deploy) so in-flight requests and jobs
// finish instead of being cut off.
import http from 'node:http';
import { config } from './config.js';
import { createApp } from './app.js';
import { runMigrations } from './db/migrate.js';
import { pool, query } from './db/pool.js';
import { enqueue, startWorkers } from './lib/jobs.js';
import { logger } from './lib/logger.js';
import { attachRealtime } from './lib/realtime.js';
import './modules/jobs/handlers.js'; // registers job handlers

async function main() {
  if (config.MIGRATE_ON_START) await runMigrations('up');

  const app = createApp();
  const server = http.createServer(app);
  server.keepAliveTimeout = 65_000; // longer than Render's proxy idle timeout
  const stopRealtime = attachRealtime(server);
  const stopWorkers = config.RUN_JOBS ? startWorkers() : async () => {};

  // Sweep storage for anything left marked for deletion (e.g. after a restart).
  if (config.RUN_JOBS) {
    const pending = await query<{ org_id: number }>(pool,
      `SELECT DISTINCT org_id FROM stored_objects WHERE delete_requested_at IS NOT NULL AND deleted_at IS NULL LIMIT 1`);
    if (pending[0]) await enqueue(pool, { orgId: pending[0].org_id, userId: null, projectId: null, type: 'purge-objects', payload: { reason: 'startup-sweep' } });
  }

  server.listen(config.PORT, () => {
    logger.info({ port: config.PORT, storage: config.storageMode, ai: config.aiEnabled, smtp: config.smtpEnabled }, 'server listening');
  });

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'shutting down');
    const force = setTimeout(() => process.exit(1), 30_000).unref();
    server.close();
    await Promise.allSettled([stopRealtime(), stopWorkers()]);
    await pool.end().catch(() => {});
    clearTimeout(force);
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

process.on('unhandledRejection', (err) => logger.error({ err }, 'unhandled promise rejection'));

main().catch((err) => {
  logger.fatal({ err }, 'failed to start');
  process.exit(1);
});
