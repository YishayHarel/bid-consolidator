// Email drafts, sending, and per-user templates.
//
// Drafts are READ-ONLY (the old GET minted portal tokens as a side effect).
// Sending resolves recipients from the factory record on the server — the
// request can't choose arbitrary addresses — and inserts a valid portal link at
// send time (a fresh one for Best & Final rounds). Every send is logged.
import { Router } from 'express';
import { z } from 'zod';
import { pool, query, queryOne, withTx } from '../../db/pool.js';
import { badRequest, notFound } from '../../lib/errors.js';
import { sendMail } from '../../lib/mailer.js';
import { id, parseBody, parseParams } from '../../lib/validate.js';
import { formatOverpricedLines, overpricedByFactory } from '../../domain/bestAndFinal.js';
import { DEFAULT_TEMPLATES, fillTemplate, TEMPLATE_TYPES, type TemplateType } from '../../domain/emailTemplates.js';
import { currentProject, currentUser, loadProject, requireAuth } from '../../middleware/auth.js';
import { ensureLink, portalUrl } from '../links/tokens.js';

// ---- Templates (per user) ------------------------------------------------------
export const templatesRouter = Router();
templatesRouter.use(requireAuth);

async function templatesFor(userId: number) {
  const rows = await query<{ type: TemplateType; subject: string | null; body: string | null }>(pool,
    'SELECT type, subject, body FROM user_email_templates WHERE user_id = $1', [userId]);
  const custom = new Map(rows.map((r) => [r.type, r]));
  return Object.fromEntries(TEMPLATE_TYPES.map((t) => {
    const c = custom.get(t);
    return [t, { type: t, subject: c?.subject || DEFAULT_TEMPLATES[t].subject, body: c?.body || DEFAULT_TEMPLATES[t].body, isCustom: !!c }];
  })) as Record<TemplateType, { type: TemplateType; subject: string; body: string; isCustom: boolean }>;
}

templatesRouter.get('/', async (req, res) => {
  res.json(Object.values(await templatesFor(currentUser(req).id)));
});

const templateType = z.object({ type: z.enum(TEMPLATE_TYPES) });
templatesRouter.put('/:type', async (req, res) => {
  const { type } = parseParams(req, templateType);
  const body = parseBody(req, z.object({ subject: z.string().trim().min(1).max(300), body: z.string().trim().min(1).max(20_000) }));
  await pool.query(
    `INSERT INTO user_email_templates (user_id, type, subject, body, updated_at) VALUES ($1, $2, $3, $4, now())
     ON CONFLICT (user_id, type) DO UPDATE SET subject = EXCLUDED.subject, body = EXCLUDED.body, updated_at = now()`,
    [currentUser(req).id, type, body.subject, body.body]);
  res.json((await templatesFor(currentUser(req).id))[type]);
});

templatesRouter.delete('/:type', async (req, res) => {
  const { type } = parseParams(req, templateType);
  await pool.query('DELETE FROM user_email_templates WHERE user_id = $1 AND type = $2', [currentUser(req).id, type]);
  res.json((await templatesFor(currentUser(req).id))[type]);
});

// ---- Project drafts + send ---------------------------------------------------------
export const projectEmailsRouter = Router({ mergeParams: true });
projectEmailsRouter.use(requireAuth, loadProject);

interface InviteeRow {
  pf_id: number; factory_name: string; emails: string[]; contact_name: string | null;
  invited_at: Date; submitted_at: Date | null; link_token: string | null; last_sent_at: Date | null;
}

projectEmailsRouter.get('/emails/drafts', async (req, res) => {
  const p = currentProject(req);
  const u = currentUser(req);
  const [tpl, invitees, priced, quoteCount] = await Promise.all([
    templatesFor(u.id),
    query<InviteeRow>(pool,
      `SELECT pf.id AS pf_id, f.name AS factory_name, f.emails, f.contact_name, pf.invited_at, pf.submitted_at,
              lk.token AS link_token,
              (SELECT max(sent_at) FROM email_log e WHERE e.project_factory_id = pf.id) AS last_sent_at
         FROM project_factories pf JOIN factories f ON f.id = pf.factory_id
         LEFT JOIN LATERAL (SELECT token FROM vendor_tokens vt
                             WHERE vt.project_factory_id = pf.id AND vt.used_at IS NULL AND vt.expires_at > now()
                               AND vt.purpose = 'quote'
                             ORDER BY vt.created_at DESC LIMIT 1) lk ON true
        WHERE pf.project_id = $1 ORDER BY lower(f.name)`, [p.id]),
    query<{ item_id: number; label: string; project_factory_id: number; price: number }>(pool,
      `SELECT q.item_id, COALESCE(pi.style_num, pi.description, 'Item ' || (pi.item_index + 1)) AS label,
              q.project_factory_id, q.price
         FROM quotes q JOIN project_items pi ON pi.id = q.item_id
        WHERE q.project_id = $1 AND q.price IS NOT NULL AND pi.deleted_at IS NULL`, [p.id]),
    queryOne<{ n: number }>(pool, 'SELECT count(DISTINCT project_factory_id)::int AS n FROM quotes WHERE project_id = $1', [p.id]),
  ]);

  const sender = u.name || 'Shalom International';
  const common = { 'Project Name': p.name, 'Sender Name': sender };
  const drafts: unknown[] = [];
  for (const f of invitees) {
    const vars = { ...common, 'Contact Name': f.contact_name || f.factory_name };
    const status = f.submitted_at ? 'submitted' : Date.now() - new Date(f.invited_at).getTime() > 2 * 86_400_000 ? 'no_response' : 'pending';
    const base = {
      projectFactoryId: f.pf_id, factoryName: f.factory_name, contactName: f.contact_name, to: f.emails,
      status, lastSentAt: f.last_sent_at, portalUrl: f.link_token ? portalUrl(f.link_token) : null,
    };
    drafts.push({ key: `invite:${f.pf_id}`, type: 'vendor_invite', ...base,
      subject: fillTemplate(tpl.vendor_invite.subject, vars), body: fillTemplate(tpl.vendor_invite.body, vars) });
    if (status === 'no_response') {
      drafts.push({ key: `follow_up:${f.pf_id}`, type: 'follow_up_reminder', ...base,
        subject: fillTemplate(tpl.follow_up_reminder.subject, vars), body: fillTemplate(tpl.follow_up_reminder.body, vars) });
    }
  }

  // Best & Final: one email per factory priced above the lowest on a competitive item.
  const over = overpricedByFactory(priced.map((q) => ({ itemId: q.item_id, itemLabel: q.label, projectFactoryId: q.project_factory_id, price: q.price })));
  for (const f of invitees) {
    const lines = over.get(f.pf_id);
    if (!lines?.length) continue;
    const vars = { ...common, 'Contact Name': f.contact_name || f.factory_name, Items: formatOverpricedLines(lines) };
    drafts.push({
      key: `revision:${f.pf_id}`, type: 'revision_request', projectFactoryId: f.pf_id, factoryName: f.factory_name,
      contactName: f.contact_name, to: f.emails, status: 'competitive', lastSentAt: f.last_sent_at, portalUrl: null,
      itemsAbove: lines.length,
      subject: fillTemplate(tpl.revision_request.subject, vars), body: fillTemplate(tpl.revision_request.body, vars),
    });
  }

  if ((quoteCount?.n ?? 0) > 0) {
    const vars = { ...common, 'Quote Count': quoteCount!.n };
    drafts.push({ key: 'comparison_ready', type: 'comparison_ready', projectFactoryId: null, factoryName: null, to: [u.email],
      status: 'ready', lastSentAt: null, portalUrl: null,
      subject: fillTemplate(tpl.comparison_ready.subject, vars), body: fillTemplate(tpl.comparison_ready.body, vars) });
  }

  res.json({
    // The master invite format keeps its placeholders so the UI can cascade
    // edits to every factory's invite (unless that invite was edited).
    inviteTemplate: { subject: tpl.vendor_invite.subject, body: tpl.vendor_invite.body },
    senderName: sender,
    drafts,
  });
});

// Explicitly get (or create) the portal link a draft needs — used when the
// owner copies an email to send from their own mail client. A POST, so merely
// viewing drafts never creates links.
projectEmailsRouter.post('/emails/link', async (req, res) => {
  const body = parseBody(req, z.object({
    projectFactoryId: id,
    type: z.enum(['vendor_invite', 'follow_up_reminder', 'revision_request']),
  }));
  const p = currentProject(req);
  const pf = await queryOne(pool, 'SELECT 1 FROM project_factories WHERE id = $1 AND project_id = $2', [body.projectFactoryId, p.id]);
  if (!pf) throw notFound('Invited factory');
  const link = await withTx((tx) => ensureLink(tx, body.projectFactoryId, body.type === 'revision_request' ? 'revision' : 'quote', currentUser(req).id));
  res.json({ portalUrl: portalUrl(link.token), expiresAt: link.expires_at });
});

projectEmailsRouter.post('/emails/send', async (req, res) => {
  const body = parseBody(req, z.object({
    type: z.enum(['vendor_invite', 'follow_up_reminder', 'revision_request', 'comparison_ready']),
    projectFactoryId: id.optional(),
    subject: z.string().trim().min(1).max(300),
    body: z.string().trim().min(1).max(20_000),
    dueDate: z.iso.date().optional(),
  }));
  const p = currentProject(req);
  const u = currentUser(req);

  if (body.type === 'comparison_ready') {
    // Internal summary: only ever sent to the signed-in user.
    await sendMail({ to: [u.email], subject: body.subject, text: body.body });
    await pool.query(`INSERT INTO email_log (org_id, project_id, user_id, type, recipients, subject) VALUES ($1, $2, $3, $4, $5, $6)`,
      [u.orgId, p.id, u.id, body.type, [u.email], body.subject]);
    return res.json({ sent: true, to: [u.email] });
  }

  if (!body.projectFactoryId) throw badRequest('Pick which factory to email.');
  const factory = await queryOne<{ name: string; emails: string[] }>(pool,
    `SELECT f.name, f.emails FROM project_factories pf JOIN factories f ON f.id = pf.factory_id
      WHERE pf.id = $1 AND pf.project_id = $2`, [body.projectFactoryId, p.id]);
  if (!factory) throw notFound('Invited factory');
  if (!factory.emails.length) throw badRequest(`No email address on file for ${factory.name}. Add one in the factory directory.`);

  let text = body.body;
  if (body.dueDate) {
    const due = new Date(`${body.dueDate}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
    text = text.split('[Due Date]').join(due);
  }
  if (body.type === 'revision_request' && text.includes('[Due Date]')) throw badRequest('Pick a due date for the revised pricing.');

  const link = await withTx((tx) => ensureLink(tx, body.projectFactoryId!, body.type === 'revision_request' ? 'revision' : 'quote', u.id));
  text = text.split('[Portal Link]').join(portalUrl(link.token));

  await sendMail({ to: factory.emails, subject: body.subject, text, replyTo: u.email });
  await pool.query(
    `INSERT INTO email_log (org_id, project_id, project_factory_id, user_id, type, recipients, subject)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [u.orgId, p.id, body.projectFactoryId, u.id, body.type, factory.emails, body.subject]);
  res.json({ sent: true, to: factory.emails });
});
