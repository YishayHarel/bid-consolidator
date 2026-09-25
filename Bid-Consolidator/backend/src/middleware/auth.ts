// Authentication + authorization middleware.
//   requireAuth   — valid session token (Authorization: Bearer …) → req.user
//   requireAdmin  — the user is an org admin
//   loadProject   — the :projectId exists, is in the user's org, and is theirs
//                   → req.project. Returns 404 (not 403) for other people's
//                   projects so ids can't be probed.
import type { NextFunction, Request, Response } from 'express';
import { queryOne, pool } from '../db/pool.js';
import { verifySession, type SessionUser } from '../lib/auth.js';
import { forbidden, notFound, unauthorized } from '../lib/errors.js';
import { id } from '../lib/validate.js';

export interface ProjectRow {
  id: number;
  org_id: number;
  created_by: number | null;
  name: string;
  buyer: string | null;
  division: string | null;
  status: string | null;
  last_price: number | null;
  settings: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
}

declare module 'express-serve-static-core' {
  interface Request {
    user?: SessionUser;
    project?: ProjectRow;
  }
}

export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  if (req.user) return next(); // already authenticated by an outer router
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return next(unauthorized());
  req.user = verifySession(header.slice(7));
  next();
}

export function requireAdmin(req: Request, _res: Response, next: NextFunction) {
  if (req.user?.role !== 'admin') return next(forbidden('Only organization admins can do this'));
  next();
}

export async function loadProject(req: Request, _res: Response, next: NextFunction) {
  const parsed = id.safeParse(req.params.projectId);
  if (!parsed.success) return next(notFound('Project'));
  if (req.project?.id === parsed.data) return next(); // already loaded by an outer router
  const project = await queryOne<ProjectRow>(
    pool,
    'SELECT * FROM projects WHERE id = $1 AND org_id = $2 AND created_by = $3',
    [parsed.data, req.user!.orgId, req.user!.id],
  );
  if (!project) return next(notFound('Project'));
  req.project = project;
  next();
}

/** Typed accessors for handlers that run after the middleware above. */
export const currentUser = (req: Request): SessionUser => req.user!;
export const currentProject = (req: Request): ProjectRow => req.project!;
