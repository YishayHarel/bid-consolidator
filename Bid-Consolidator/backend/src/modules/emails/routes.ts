// Email drafts, sending, and per-user templates.
//
// Drafts are READ-ONLY (the old GET minted portal tokens as a side effect).
// Sending (single or batch) lives in ./send.ts: recipients come from the
// factory record on the server, the portal link is inserted at send time, and
// each email goes out from the buyer's own Outlook when connected.
import { Router } from 'express';
import { z } from 'zod';
import { pool, query, queryOne, withTx } from '../../db/pool.js';
import { config } from '../../config.js';
import { AppError, badRequest, notFound } from '../../lib/errors.js';
import { enqueue, jobDTO } from '../../lib/jobs.js';
import { hasMailbox } from '../../lib/outlook.js';
import { id, parseBody, parseParams } from '../../lib/validate.js';
import { formatOverpricedLines, overpricedByFactory } from '../../domain/bestAndFinal.js';
import { DEFAULT_TEMPLATES, fillTemplate, TEMPLATE_TYPES, type TemplateType } from '../../domain/emailTemplates.js';
import { currentProject, currentUser, loadProject, requireAuth } from '../../middleware/auth.js';
import { ensureLink, portalUrl } from '../links/tokens.js';
import { deliverEmail, emailInput, prepareEmail } from './send.js';

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
  const input = parseBody(req, emailInput);
  const p = currentProject(req);
  const u = currentUser(req);
  const prepared = await prepareEmail(pool, p.id, u, input);
  const r = await deliverEmail(p.id, u.orgId, u, prepared);
  res.json({ sent: true, to: r.to, via: r.via });
});

// Send several reviewed emails in one go. Everything is checked up front (a
// bad row fails the whole request before anything is sent); the sending itself
// runs as a background job, paced to stay under Outlook's per-minute limit,
// and reports which emails went out and which failed.
projectEmailsRouter.post('/emails/batch', async (req, res) => {
  const { emails } = parseBody(req, z.object({
    emails: z.array(emailInput.extend({ key: z.string().min(1).max(100) })).min(1).max(200),
  }));
  const p = currentProject(req);
  const u = currentUser(req);
  if (new Set(emails.map((e) => e.key)).size !== emails.length) throw badRequest('Each email in a batch needs a unique key.');
  for (const e of emails) await prepareEmail(pool, p.id, u, e);
  if (!(await hasMailbox(u.id)) && !config.smtpEnabled && !config.isTest) {
    throw new AppError(409, 'Connect your Outlook in Settings to send email from the site.', 'mail_not_connected');
  }
  const job = await enqueue(pool, { orgId: u.orgId, userId: u.id, projectId: p.id, type: 'send-emails', payload: { projectId: p.id, emails } });
  res.status(202).json(jobDTO(job));
});
