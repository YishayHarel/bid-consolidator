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

    const p = project[0];
    const drafts = [];
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';

    // 1. Initial vendor invite emails
    factories.forEach(f => {
      const token = tokenMap[f.factory_name];
      const link = token ? `${frontendUrl}/vendor?token=${token}` : `${frontendUrl}/vendor`;
      drafts.push({
        type: 'vendor_invite',
        factory_name: f.factory_name,
        subject: `Quote Request: ${p.name}`,
        body: `Hi ${greet(f.factory_name)},\n\nI hope you're doing well!\n\nWe're very excited about launching our new ${p.name} program and believe it has tremendous potential. As you know, the market has become extremely competitive, with pricing coming down significantly over the past year — so it's very important that we receive the most competitive FOB pricing possible. With the right partner, we believe this program can grow into a significant, long-term business.\n\nPlease see the attached Excel file with the items we've selected for our initial launch. If the file includes more than one tab, please quote all of them.\n\nPlease complete the attached file with your best FOB pricing for each item. We are looking for:\n\n• The most competitive pricing\n• Excellent quality\n\nYou can submit your completed pricing through our Supplier Portal:\n${link}\n\nWe're excited about the opportunity to build both a successful launch and a long-term business together, and we look forward to reviewing your pricing.\n\nThank you!\n${senderName}`,
        status: f.status,
        to: emailMap[f.factory_name] || null,
        project_id: p.id,
        attachment: p.template_path ? path.basename(p.template_path).replace(/^\d+-/, '') : null,
      });
    });

    // 2. Follow-up emails for non-responders (2+ days)
    factories
      .filter(f => f.status === 'no_response')
      .forEach(f => {
        const token = tokenMap[f.factory_name];
        const link = token ? `${frontendUrl}/vendor?token=${token}` : `${frontendUrl}/vendor`;
        drafts.push({
          type: 'follow_up_reminder',
          factory_name: f.factory_name,
          subject: `Reminder: Quote Request for ${p.name}`,
          body: `Hi ${greet(f.factory_name)},\n\nJust following up — we haven't received your quote for ${p.name} yet, and the deadline is approaching.\n\nPlease submit your best FOB pricing as soon as possible through our Supplier Portal:\n${link}\n\nThank you!\n${senderName}`,
          status: 'no_response',
          to: emailMap[f.factory_name] || null,
          project_id: p.id,
        });
      });

    // 3. Comparison available email (once submissions exist)
    if (quotes.length > 0) {
      drafts.push({
        type: 'comparison_ready',
        factory_name: null,
        subject: `Quote Comparison Ready: ${p.name}`,
        body: `Hi Team,\n\nWe've received ${quotes.length} quote(s) for ${p.name}. The comparison is now available in the system.\n\nReview the Compare tab to see pricing and details.\n\nBest regards,\nShalom International`,
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

    for (const [factoryName, items] of Object.entries(highByFactory)) {
      const link = await ensureRevisionLink(projectId, factoryName, frontendUrl);
      const lines = items
        .map(it => `• ${it.label}\n    Our current best FOB: $${it.best_price.toFixed(2)}   |   Your quote: $${it.their_price.toFixed(2)}   (${it.pct_higher.toFixed(1)}% higher)`)
        .join('\n');
      drafts.push({
        type: 'revision_request',
        factory_name: factoryName,
        subject: `Best & Final Pricing Request: ${p.name}`,
        body: `Hi ${greet(factoryName)},\n\nThank you for submitting your quotation.\n\nAfter reviewing all supplier quotations, we'd like to give you one final opportunity to revise your pricing.\n\nThe following item(s) came in above our current best price:\n\n${lines}\n\nIf you would like to remain competitive for this project, please review your pricing and submit your best and final quotation through the Supplier Portal.\n\nSupplier Portal: ${link}\n\nPlease submit any revised pricing by [Due Date].\n\nThank you, and we look forward to your updated quotation.\n\nBest Regards,\n${senderName}`,
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
    // Attach the project's outbound file to the initial invite email only.
    let attachments;
    if (type === 'vendor_invite' && project_id) {
      const { rows } = await pool.query('SELECT template_path FROM projects WHERE id=$1', [project_id]);
      const templatePath = rows[0]?.template_path;
      if (templatePath && fs.existsSync(templatePath)) {
        attachments = [{ filename: path.basename(templatePath), path: templatePath }];
      }
    }

    await emailTransporter.sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      to,
      subject,
      text: body,
      ...(attachments ? { attachments } : {}),
    });
    res.json({ success: true });
  } catch (err) {
    console.error('Email send error:', err);
    res.status(500).json({ error: 'Failed to send email' });
  }
});

module.exports = router;
