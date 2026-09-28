// Sending one project email, shared by the single "Send" button and batch
// sends. Recipients come from the factory record (never the request), the
// portal link is inserted at send time (a fresh one for Best & Final rounds),
// and every send is logged.
import { z } from 'zod';
import { pool, queryOne, withTx, type Db } from '../../db/pool.js';
import { badRequest, notFound } from '../../lib/errors.js';
import { sendAs, type Sender, type SentVia } from '../../lib/mailer.js';
import { id } from '../../lib/validate.js';
import { ensureLink, portalUrl } from '../links/tokens.js';

export const emailInput = z.object({
  type: z.enum(['vendor_invite', 'follow_up_reminder', 'revision_request', 'comparison_ready']),
  projectFactoryId: id.optional(),
  subject: z.string().trim().min(1).max(300),
  body: z.string().trim().min(1).max(20_000),
  dueDate: z.iso.date().optional(),
});
export type EmailInput = z.infer<typeof emailInput>;

export interface Prepared { input: EmailInput; to: string[]; factoryName: string | null }

const longDate = (iso: string) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });

/** Resolve recipients and check everything that can fail BEFORE anything is sent. */
export async function prepareEmail(db: Db, projectId: number, sender: Sender, input: EmailInput): Promise<Prepared> {
  if (input.type === 'comparison_ready') return { input, to: [sender.email], factoryName: null }; // internal: only ever to yourself
  if (!input.projectFactoryId) throw badRequest('Pick which factory to email.');
  const factory = await queryOne<{ name: string; emails: string[] }>(db,
    `SELECT f.name, f.emails FROM project_factories pf JOIN factories f ON f.id = pf.factory_id
      WHERE pf.id = $1 AND pf.project_id = $2`, [input.projectFactoryId, projectId]);
  if (!factory) throw notFound('Invited factory');
  if (!factory.emails.length) throw badRequest(`No email address on file for ${factory.name}. Add one in the factory directory.`);
  const text = input.dueDate ? input.body.split('[Due Date]').join(longDate(input.dueDate)) : input.body;
  if (text.includes('[Due Date]')) throw badRequest(`Pick a due date for ${factory.name}'s email.`);
  return { input, to: factory.emails, factoryName: factory.name };
}

/** Send a prepared email and log it. `batch` makes a retried batch job skip what it already sent. */
export async function deliverEmail(
  projectId: number, orgId: number, sender: Sender, p: Prepared, batch?: { jobId: number; key: string },
): Promise<{ to: string[]; via: SentVia }> {
  const { input } = p;
  let text = input.dueDate ? input.body.split('[Due Date]').join(longDate(input.dueDate)) : input.body;
  if (input.type !== 'comparison_ready' && text.includes('[Portal Link]')) {
    const link = await withTx((tx) => ensureLink(tx, input.projectFactoryId!, input.type === 'revision_request' ? 'revision' : 'quote', sender.id));
    text = text.split('[Portal Link]').join(portalUrl(link.token));
  }
  const via = await sendAs(sender, { to: p.to, subject: input.subject, text });
  await pool.query(
    `INSERT INTO email_log (org_id, project_id, project_factory_id, user_id, type, recipients, subject, job_id, item_key, sent_via)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) ON CONFLICT DO NOTHING`,
    [orgId, projectId, input.projectFactoryId ?? null, sender.id, input.type, p.to, input.subject, batch?.jobId ?? null, batch?.key ?? null, via]);
  return { to: p.to, via };
}
