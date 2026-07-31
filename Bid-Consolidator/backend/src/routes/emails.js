const express = require('express');
const nodemailer = require('nodemailer');
const path = require('path');
const fs = require('fs');
const pool = require('../db/pool');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

let emailTransporter = null;
if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
  emailTransporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === 'true',
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
}

// Built-in default email formats. A user's saved templates (user_email_templates)
// override these per type. Bodies use [Placeholder] tokens filled in per email:
//   [Contact Name] [Project Name] [Portal Link] [Sender Name] [Items] [Quote Count] [Due Date]
const DEFAULT_TEMPLATES = {
  vendor_invite: {
    subject: 'Quote Request: [Project Name]',
    body: `Hi [Contact Name],\n\nWe'd like to invite you to quote on our [Project Name] program.\n\nPlease open the Supplier Portal below to download the quote template, complete it with your best FOB pricing for each item, and submit it back through the same portal. If the file includes more than one tab, please quote all of them.\n\nSupplier Portal:\n[Portal Link]\n\nThank you, and we look forward to your quotation.\n\nBest regards,\n[Sender Name]`,
  },
  follow_up_reminder: {
    subject: 'Reminder: Quote Request for [Project Name]',
    body: `Hi [Contact Name],\n\nJust following up — we haven't received your quote for [Project Name] yet, and the deadline is approaching.\n\nPlease submit your best FOB pricing as soon as possible through our Supplier Portal:\n[Portal Link]\n\nThank you!\n[Sender Name]`,
  },
  comparison_ready: {
    subject: 'Quote Comparison Ready: [Project Name]',
    body: `Hi Team,\n\nWe've received [Quote Count] quote(s) for [Project Name]. The comparison is now available in the system.\n\nReview the Compare tab to see pricing and details.\n\nBest regards,\n[Sender Name]`,
  },
  revision_request: {
    subject: 'Best & Final Pricing Request: [Project Name]',
    body: `Hi [Contact Name],\n\nThank you for submitting your quotation.\n\nAfter reviewing all supplier quotations, we'd like to give you one final opportunity to revise your pricing.\n\nThe following item(s) came in above our current best price:\n\n[Items]\n\nIf you would like to remain competitive for this project, please review your pricing and submit your best and final quotation through the Supplier Portal.\n\nSupplier Portal: [Portal Link]\n\nPlease submit any revised pricing by [Due Date].\n\nThank you, and we look forward to your updated quotation.\n\nBest Regards,\n[Sender Name]`,
  },
};
const TEMPLATE_TYPES = Object.keys(DEFAULT_TEMPLATES);

// Replace [Token] placeholders present in `vars`. Tokens not in `vars` (e.g.
// [Due Date]) are left as-is for the frontend to handle.
function fillTemplate(text, vars) {
  let out = text || '';
  for (const [k, v] of Object.entries(vars)) {
    out = out.split(`[${k}]`).join(v == null ? '' : String(v));
  }
  return out;
}

// Get (or reuse) an unused, unexpired portal token for a factory so it can
// submit REVISED pricing. Their original invite token is single-use and already
// spent once they've quoted, so we issue a fresh one for the best-and-final round.
async function ensureRevisionLink(projectId, factoryName, frontendUrl) {
  const { rows: existing } = await pool.query(
    `SELECT token FROM vendor_tokens
     WHERE project_id=$1 AND factory_name=$2 AND used_at IS NULL AND expires_at > NOW()
     ORDER BY created_at DESC LIMIT 1`,
    [projectId, factoryName]
  );
  let token = existing[0]?.token;
  if (!token) {
    const { rows: pf } = await pool.query(
      'SELECT id FROM project_factories WHERE project_id=$1 AND factory_name=$2',
      [projectId, factoryName]
    );
    const { rows: created } = await pool.query(
      `INSERT INTO vendor_tokens (factory_name, project_id, project_factory_id, expires_at)
       VALUES ($1,$2,$3, NOW() + interval '30 days') RETURNING token`,
      [factoryName, projectId, pf[0]?.id || null]
    );
    token = created[0].token;
  }
  return `${frontendUrl}/vendor?token=${token}`;
}

// Get email drafts for a project
router.get('/project/:projectId', requireAuth, async (req, res) => {
  const projectId = req.params.projectId;
  try {
    const { rows: project } = await pool.query('SELECT * FROM projects WHERE id=$1', [projectId]);
    if (!project.length) return res.status(404).json({ error: 'Project not found' });
    if (project[0].created_by !== req.user.id) return res.status(404).json({ error: 'Project not found' });

    const { rows: factories } = await pool.query(
      `SELECT pf.*,
              CASE WHEN pf.submitted_at IS NOT NULL THEN 'submitted'
                   WHEN pf.submitted_at IS NULL AND NOW() - pf.invited_at > interval '2 days' THEN 'no_response'
                   ELSE 'pending' END as status
       FROM project_factories pf
       WHERE pf.project_id=$1
       ORDER BY pf.factory_name`,
      [projectId]
    );

    const { rows: quotes } = await pool.query(
      'SELECT DISTINCT factory_name FROM quotes WHERE project_id=$1',
      [projectId]
    );

    // Get tokens + all email addresses for each factory. A factory can have
    // several emails; we join them so a single message goes to all of them.
    const { rows: tokens } = await pool.query(
      `SELECT pf.factory_name, vt.token, array_to_string(f.emails, ', ') AS email, f.contact_name
       FROM project_factories pf
       LEFT JOIN vendor_tokens vt ON vt.project_factory_id = pf.id
       LEFT JOIN factories f ON f.id = pf.factory_id
       WHERE pf.project_id = $1
       ORDER BY pf.factory_name`,
      [projectId]
    );

    const tokenMap = {};
    const emailMap = {};
    const contactMap = {};
    tokens.forEach(t => {
      tokenMap[t.factory_name] = t.token;
      emailMap[t.factory_name] = t.email || null;
      if (t.contact_name) contactMap[t.factory_name] = t.contact_name;
    });
    // Greet the contact person if we have one, otherwise the factory name.
    const greet = (factoryName) => contactMap[factoryName] || factoryName;
    // Sign as the logged-in user (falls back to the org name).
    const senderName = req.user.name || 'Shalom International';

    // This user's personalized email templates (override the defaults per type).
    const { rows: tRows } = await pool.query(
      'SELECT type, subject, body FROM user_email_templates WHERE user_id=$1',
      [req.user.id]
    );
    const userT = {};
    tRows.forEach(r => { userT[r.type] = r; });
    const tpl = (type) => ({
      subject: userT[type]?.subject || DEFAULT_TEMPLATES[type].subject,
      body: userT[type]?.body || DEFAULT_TEMPLATES[type].body,
    });

    const p = project[0];
    const drafts = [];
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';

    const inviteT = tpl('vendor_invite');
    const inviteSubject = fillTemplate(inviteT.subject, { 'Project Name': p.name });

    // 0. Master invite template (this user's saved format). Its raw body keeps
    //    all placeholders; the frontend renders each factory invite from it and
    //    cascades edits down to every invite below (unless one is overridden).
    drafts.push({
      type: 'invite_master',
      factory_name: null,
      subject: inviteSubject,
      body: inviteT.body,
      status: 'template',
      to: null,
      project_id: p.id,
    });

    // 1. Initial vendor invite emails (one per factory)
    factories.forEach(f => {
      const token = tokenMap[f.factory_name];
      const link = token ? `${frontendUrl}/vendor?token=${token}` : `${frontendUrl}/vendor`;
      const contact = greet(f.factory_name);
      drafts.push({
        type: 'vendor_invite',
        factory_name: f.factory_name,
        subject: inviteSubject,
        body: fillTemplate(inviteT.body, {
          'Contact Name': contact, 'Project Name': p.name, 'Portal Link': link, 'Sender Name': senderName,
        }),
        contact,
        link,
        project_name: p.name,
        sender_name: senderName,
        status: f.status,
        to: emailMap[f.factory_name] || null,
        project_id: p.id,
      });
    });

    // 2. Follow-up emails for non-responders (2+ days)
    const followT = tpl('follow_up_reminder');
    factories
      .filter(f => f.status === 'no_response')
      .forEach(f => {
        const token = tokenMap[f.factory_name];
        const link = token ? `${frontendUrl}/vendor?token=${token}` : `${frontendUrl}/vendor`;
        drafts.push({
          type: 'follow_up_reminder',
          factory_name: f.factory_name,
          subject: fillTemplate(followT.subject, { 'Project Name': p.name }),
          body: fillTemplate(followT.body, {
            'Contact Name': greet(f.factory_name), 'Project Name': p.name, 'Portal Link': link, 'Sender Name': senderName,
          }),
          status: 'no_response',
          to: emailMap[f.factory_name] || null,
          project_id: p.id,
        });
      });

    // 3. Comparison available email (once submissions exist)
    if (quotes.length > 0) {
      const compT = tpl('comparison_ready');
      drafts.push({
        type: 'comparison_ready',
        factory_name: null,
        subject: fillTemplate(compT.subject, { 'Project Name': p.name }),
        body: fillTemplate(compT.body, {
          'Quote Count': quotes.length, 'Project Name': p.name, 'Sender Name': senderName,
        }),
        status: 'ready',
        to: null,
        project_id: p.id,
      });
    }

    // 4. Best & Final / revision requests — one email per factory that is above
    //    the current lowest FOB on any item, but only where there's competition
    //    (2+ factories quoted that item). The 10%-below target stays internal.
    const { rows: itemQuotes } = await pool.query(
      `SELECT item_index, factory_name, price, style_num, description
       FROM quotes
       WHERE project_id=$1 AND item_index IS NOT NULL AND price IS NOT NULL`,
      [projectId]
    );
    const { rows: outboundItems } = await pool.query(
      'SELECT item_index, style_num, description FROM project_items WHERE project_id=$1',
      [projectId]
    );
    const itemMeta = {};
    outboundItems.forEach(it => { itemMeta[it.item_index] = it; });

    const byItem = {};
    itemQuotes.forEach(q => { (byItem[q.item_index] = byItem[q.item_index] || []).push(q); });

    // For each competitive item, flag every factory priced strictly above the lowest.
    const highByFactory = {};
    Object.entries(byItem).forEach(([idx, qs]) => {
      const distinctFactories = new Set(qs.map(q => q.factory_name));
      if (distinctFactories.size < 2) return; // no competition on this item
      const prices = qs.map(q => parseFloat(q.price)).filter(n => !isNaN(n));
      if (!prices.length) return;
      const lowest = Math.min(...prices);
      qs.forEach(q => {
        const theirs = parseFloat(q.price);
        if (isNaN(theirs) || theirs <= lowest) return; // the lowest (and ties) are already competitive
        const meta = itemMeta[idx] || {};
        const label = q.style_num || meta.style_num || q.description || meta.description || `Item ${idx}`;
        (highByFactory[q.factory_name] = highByFactory[q.factory_name] || []).push({
          label,
          best_price: lowest,
          their_price: theirs,
          pct_higher: ((theirs - lowest) / lowest) * 100,
        });
      });
    });

    const revisionT = tpl('revision_request');
    for (const [factoryName, items] of Object.entries(highByFactory)) {
      const link = await ensureRevisionLink(projectId, factoryName, frontendUrl);
      const lines = items
        .map(it => `• ${it.label}\n    Our current best FOB: $${it.best_price.toFixed(2)}   |   Your quote: $${it.their_price.toFixed(2)}   (${it.pct_higher.toFixed(1)}% higher)`)
        .join('\n');
      drafts.push({
        type: 'revision_request',
        factory_name: factoryName,
        subject: fillTemplate(revisionT.subject, { 'Project Name': p.name }),
        // [Due Date] is intentionally left as a placeholder for the date picker.
        body: fillTemplate(revisionT.body, {
          'Contact Name': greet(factoryName), 'Project Name': p.name, 'Items': lines, 'Portal Link': link, 'Sender Name': senderName,
        }),
        status: 'competitive',
        to: emailMap[factoryName] || null,
        project_id: p.id,
      });
    }

    res.json(drafts);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Send email
router.post('/send', requireAuth, async (req, res) => {
  const { to, subject, body, project_id, type } = req.body;
  if (!to || !subject || !body) {
    return res.status(400).json({ error: 'to, subject, and body required' });
  }
  if (!emailTransporter) {
    return res.status(500).json({ error: 'Email service not configured. Set SMTP_HOST, SMTP_USER, SMTP_PASS in .env' });
  }
  try {
    // The outbound file is no longer attached — factories download it from the
    // Supplier Portal link in the email body instead.
    await emailTransporter.sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      to,
      subject,
      text: body,
    });
    res.json({ success: true });
  } catch (err) {
    console.error('Email send error:', err);
    res.status(500).json({ error: 'Failed to send email' });
  }
});

// List this user's effective templates (their saved overrides, or the defaults).
router.get('/templates', requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT type, subject, body FROM user_email_templates WHERE user_id=$1',
      [req.user.id]
    );
    const saved = {};
    rows.forEach(r => { saved[r.type] = r; });
    const out = {};
    for (const type of TEMPLATE_TYPES) {
      out[type] = {
        subject: saved[type]?.subject || DEFAULT_TEMPLATES[type].subject,
        body: saved[type]?.body || DEFAULT_TEMPLATES[type].body,
        is_custom: !!saved[type],
      };
    }
    res.json(out);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Save (personalize) one of this user's email templates.
router.post('/templates', requireAuth, async (req, res) => {
  const { type, subject, body } = req.body;
  if (!TEMPLATE_TYPES.includes(type)) return res.status(400).json({ error: 'Unknown template type' });
  if (!body || !body.trim()) return res.status(400).json({ error: 'Body required' });
  try {
    await pool.query(
      `INSERT INTO user_email_templates (user_id, type, subject, body, updated_at)
       VALUES ($1,$2,$3,$4,NOW())
       ON CONFLICT (user_id, type) DO UPDATE SET subject=EXCLUDED.subject, body=EXCLUDED.body, updated_at=NOW()`,
      [req.user.id, type, subject || null, body]
    );
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Reset one of this user's templates back to the built-in default.
router.delete('/templates/:type', requireAuth, async (req, res) => {
  try {
    await pool.query('DELETE FROM user_email_templates WHERE user_id=$1 AND type=$2', [req.user.id, req.params.type]);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
