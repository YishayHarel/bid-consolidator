// Job status for the signed-in user (progress is also pushed over WebSocket).
import { Router } from 'express';
import { z } from 'zod';
import { pool, query } from '../../db/pool.js';
import { notFound } from '../../lib/errors.js';
import { getJobForOrg, jobDTO, type JobRow } from '../../lib/jobs.js';
import { id, parseParams, parseQuery } from '../../lib/validate.js';
import { currentUser, requireAuth } from '../../middleware/auth.js';

export const jobsRouter = Router();
jobsRouter.use(requireAuth);

jobsRouter.get('/', async (req, res) => {
  const { projectId, active } = parseQuery(req, z.object({
    projectId: id.optional(),
    active: z.enum(['true', 'false']).optional(),
  }));
  const u = currentUser(req);
  const rows = await query<JobRow>(pool,
    `SELECT * FROM jobs
      WHERE org_id = $1 AND user_id = $2
        AND ($3::int IS NULL OR project_id = $3)
        AND ($4::boolean IS NOT TRUE OR state IN ('queued', 'running'))
      ORDER BY id DESC LIMIT 50`,
    [u.orgId, u.id, projectId ?? null, active === 'true']);
  res.json(rows.map(jobDTO));
});

jobsRouter.get('/:jobId', async (req, res) => {
  const { jobId } = parseParams(req, z.object({ jobId: id }));
  const u = currentUser(req);
  const job = await getJobForOrg(pool, jobId, u.orgId);
  if (!job || (job.user_id !== u.id && u.role !== 'admin')) throw notFound('Job');
  res.json(jobDTO(job));
});
