// Factory portal links. A link is a random UUID tied to one invitation
// (project_factories row), so it grants access to exactly one factory's view of
// one project. Links are single-use for submitting and expire after 30 days.
import { config } from '../../config.js';
import { queryOne, type Db } from '../../db/pool.js';

export type LinkPurpose = 'quote' | 'revision';
export const LINK_TTL_DAYS = 30;

export const portalUrl = (token: string) => `${config.appUrl}/vendor?token=${token}`;

/** The newest still-usable link for an invitation, if any. */
export async function activeLink(db: Db, projectFactoryId: number, purpose?: LinkPurpose) {
  return queryOne<{ id: number; token: string; expires_at: Date }>(
    db,
    `SELECT id, token, expires_at FROM vendor_tokens
      WHERE project_factory_id = $1 AND used_at IS NULL AND expires_at > now()
        AND ($2::text IS NULL OR purpose = $2)
      ORDER BY created_at DESC LIMIT 1`,
    [projectFactoryId, purpose ?? null],
  );
}

export async function mintLink(db: Db, projectFactoryId: number, purpose: LinkPurpose, userId: number | null) {
  const row = await queryOne<{ id: number; token: string; expires_at: Date }>(
    db,
    `INSERT INTO vendor_tokens (project_factory_id, project_id, purpose, expires_at, created_by)
     SELECT pf.id, pf.project_id, $2, now() + ($3 || ' days')::interval, $4
       FROM project_factories pf WHERE pf.id = $1
     RETURNING id, token, expires_at`,
    [projectFactoryId, purpose, String(LINK_TTL_DAYS), userId],
  );
  return row!;
}

export async function ensureLink(db: Db, projectFactoryId: number, purpose: LinkPurpose, userId: number | null) {
  return (await activeLink(db, projectFactoryId, purpose)) ?? mintLink(db, projectFactoryId, purpose, userId);
}
