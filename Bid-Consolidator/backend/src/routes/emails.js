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

// Get email drafts for a project
router.get('/project/:projectId', requireAuth, async (req, res) => {
  const projectId = req.params.projectId;
  try {
    const { rows: project } = await pool.query('SELECT * FROM projects WHERE id=$1', [projectId]);
    if (!project.length) return res.status(404).json({ error: 'Project not found' });

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

    // Get tokens + real email for each factory
    const { rows: tokens } = await pool.query(
      `SELECT pf.factory_name, vt.token, f.email
       FROM project_factories pf
       LEFT JOIN vendor_tokens vt ON vt.project_factory_id = pf.id
       LEFT JOIN factories f ON f.id = pf.factory_id
       WHERE pf.project_id = $1
       ORDER BY pf.factory_name`,
      [projectId]
    );

    const tokenMap = {};
    const emailMap = {};
    tokens.forEach(t => {
      tokenMap[t.factory_name] = t.token;
      emailMap[t.factory_name] = t.email;
    });

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
        body: `Hi ${f.factory_name},\n\nWe're requesting a quote for the following project:\n\nProject: ${p.name}\nBuyer: ${p.buyer || 'N/A'}\nDivision: ${p.division || 'N/A'}\n\nPlease submit your quote using this link:\n${link}\n\nIf you have any questions, please let us know.\n\nBest regards,\nShalom International`,
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
          body: `Hi ${f.factory_name},\n\nWe haven't received your quote for ${p.name} yet. The deadline is approaching.\n\nPlease submit your quote as soon as possible using this link:\n${link}\n\nThank you!`,
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
