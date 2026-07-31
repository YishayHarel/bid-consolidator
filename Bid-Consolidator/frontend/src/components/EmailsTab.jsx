import { useState, useEffect } from 'react';
import api from '../utils/api';

export default function EmailsTab() {
  const [projects, setProjects] = useState([]);
  const [selectedId, setSelectedId] = useState('');
  const [drafts, setDrafts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState({});
  const [sending, setSending] = useState({});
  const [sentStatus, setSentStatus] = useState({});
  const [editedBodies, setEditedBodies] = useState({});
  const [master, setMaster] = useState(''); // editable master invite template

  useEffect(() => {
    api.get('/projects').then(r => {
      setProjects(r.data);
      if (r.data.length > 0) setSelectedId(String(r.data[0].id));
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (!selectedId) return;
    setLoading(true);
    setEditedBodies({});
    api.get(`/emails/project/${selectedId}`).then(r => {
      setDrafts(r.data);
      const m = r.data.find(d => d.type === 'invite_master');
      setMaster(m ? m.body : '');
    }).catch(() => { setDrafts([]); setMaster(''); }).finally(() => setLoading(false));
  }, [selectedId]);

  // Fill the master template's personalized slots for a specific factory invite.
  function renderInvite(tpl, draft) {
    return (tpl || '')
      .split('[Contact Name]').join(draft.contact || draft.factory_name || '')
      .split('[Portal Link]').join(draft.link || '');
  }

  // The body actually shown/sent for a draft: an individually-edited body wins;
  // otherwise factory invites render live from the (editable) master template.
  function effectiveBody(draft, draftId) {
    if (draft.type === 'invite_master') return master;
    if (editedBodies[draftId] != null) return editedBodies[draftId];
    if (draft.type === 'vendor_invite') return renderInvite(master, draft);
    return draft.body;
  }

  // Replace the [Due Date] placeholder in a draft's body with a chosen date.
  function applyDueDate(draftId, fallbackBody, dateStr) {
    if (!dateStr) return;
    const formatted = new Date(dateStr + 'T00:00:00').toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    setEditedBodies(b => {
      const current = b[draftId] ?? fallbackBody;
      return { ...b, [draftId]: current.replace('[Due Date]', formatted) };
    });
  }

  function copyToClipboard(text, draftId) {
    navigator.clipboard.writeText(text);
    setCopied(c => ({ ...c, [draftId]: true }));
    setTimeout(() => setCopied(c => ({ ...c, [draftId]: false })), 2000);
  }

  async function sendEmail(draft, draftId) {
    if (!draft.to) {
      alert(draft.factory_name
        ? `No email on file for ${draft.factory_name}. Add one in Settings, or copy & send manually.`
        : 'This email needs a recipient address. Copy & send manually.');
      return;
    }
    setSending(s => ({ ...s, [draftId]: true }));
    try {
      await api.post('/emails/send', {
        to: draft.to,
        subject: draft.subject,
        body: effectiveBody(draft, draftId),
        project_id: draft.project_id,
        type: draft.type,
      });
      setSentStatus(st => ({ ...st, [draftId]: true }));
      setTimeout(() => setSentStatus(st => ({ ...st, [draftId]: false })), 3000);
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to send email. Check SMTP config.');
    }
    setSending(s => ({ ...s, [draftId]: false }));
  }

  const typeLabels = {
    invite_master: '📝 Master Invite Template',
    vendor_invite: '📬 Vendor Invite',
    follow_up_reminder: '🔔 Follow-up Reminder',
    comparison_ready: '✅ Comparison Ready',
    revision_request: '💰 Best & Final Request',
  };

  const typeColors = {
    invite_master: '#e0e7ff',
    vendor_invite: '#dbeafe',
    follow_up_reminder: '#fef08a',
    comparison_ready: '#d1fae5',
    revision_request: '#ffedd5',
  };

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 20 }}>
        <h2 style={{ fontSize: 20, fontWeight: 700, color: '#0f172a', margin: 0 }}>Email Drafts</h2>
        <select
          style={s.select}
          value={selectedId}
          onChange={e => setSelectedId(e.target.value)}
        >
          <option value="">— Select project —</option>
          {projects.map(p => <option key={p.id} value={String(p.id)}>{p.name}</option>)}
        </select>
      </div>

      {!selectedId ? (
        <div style={s.empty}>Select a project to view email drafts.</div>
      ) : loading ? (
        <div style={{ color: '#94a3b8', padding: 24 }}>Loading...</div>
      ) : drafts.length === 0 ? (
        <div style={s.empty}>No email drafts available yet.</div>
      ) : (
        <div style={{ display: 'grid', gap: 16 }}>
          {drafts.map((draft, idx) => {
            const draftId = `${draft.type}-${draft.factory_name || 'team'}-${idx}`;
            const effBody = effectiveBody(draft, draftId);
            const isMaster = draft.type === 'invite_master';
            const isRevision = draft.type === 'revision_request';
            const isOverridden = draft.type === 'vendor_invite' && editedBodies[draftId] != null;
            return (
              <div key={draftId} style={{ ...s.card, background: typeColors[draft.type], ...(isMaster ? s.masterCard : {}) }}>
                <div style={s.cardHeader}>
                  <div>
                    <div style={s.draftType}>{typeLabels[draft.type]}</div>
                    {draft.factory_name && <div style={s.factory}>{draft.factory_name}{isOverridden && <span style={s.editedTag}> · edited (won't follow the master)</span>}</div>}
                    {!isMaster && <div style={s.status}>Status: {draft.status}</div>}
                  </div>
                  {!isMaster && (
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button
                        style={{ ...s.copyBtn, ...(copied[draftId] ? s.copiedBtn : {}) }}
                        onClick={() => copyToClipboard(`Subject: ${draft.subject}\n\n${effBody}`, draftId)}
                      >
                        {copied[draftId] ? '✓ Copied' : 'Copy'}
                      </button>
                      <button
                        style={{ ...s.sendBtn, ...(sentStatus[draftId] ? s.sentBtn : {}) }}
                        onClick={() => sendEmail(draft, draftId)}
                        disabled={sending[draftId]}
                      >
                        {sentStatus[draftId] ? '✓ Sent' : sending[draftId] ? '...' : 'Send'}
                      </button>
                    </div>
                  )}
                </div>
                <div style={s.subject}>Subject: {draft.subject}</div>
                {isMaster ? (
                  <>
                    <div style={s.masterNote}>
                      Edits here apply to <strong>every factory invite below</strong>. <code>[Contact Name]</code> and <code>[Portal Link]</code> are filled in automatically per factory. If you edit an individual invite, it stops following this master.
                    </div>
                    <textarea
                      style={s.bodyEdit}
                      value={master}
                      onChange={e => setMaster(e.target.value)}
                    />
                  </>
                ) : isRevision ? (
                  <>
                    <div style={s.dueRow}>
                      <label style={s.dueLabel}>Set due date:</label>
                      <input type="date" style={s.dueInput}
                        onChange={e => applyDueDate(draftId, draft.body, e.target.value)} />
                      <span style={s.dueHint}>fills the “[Due Date]” placeholder — you can also edit the text directly</span>
                    </div>
                    <textarea
                      style={s.bodyEdit}
                      value={effBody}
                      onChange={e => setEditedBodies(b => ({ ...b, [draftId]: e.target.value }))}
                    />
                  </>
                ) : (
                  <textarea
                    style={s.bodyEdit}
                    value={effBody}
                    onChange={e => setEditedBodies(b => ({ ...b, [draftId]: e.target.value }))}
                  />
                )}
                {draft.attachment && (
                  <div style={s.attachment}>📎 {draft.attachment}</div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

const s = {
  select: { padding: '7px 12px', border: '1px solid #e2e8f0', borderRadius: 7, fontSize: 13, outline: 'none', minWidth: 220 },
  empty: { color: '#94a3b8', textAlign: 'center', padding: 60 },
  card: { border: '1px solid #e2e8f0', borderRadius: 10, padding: 18 },
  masterCard: { border: '2px solid #6366f1' },
  masterNote: { fontSize: 12, color: '#3730a3', background: 'rgba(255,255,255,0.6)', border: '1px solid rgba(99,102,241,0.3)', borderRadius: 6, padding: '8px 12px', marginBottom: 10, lineHeight: 1.5 },
  editedTag: { fontSize: 11, color: '#b45309', fontStyle: 'italic' },
  cardHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 },
  draftType: { fontSize: 14, fontWeight: 700, color: '#0f172a', marginBottom: 4 },
  factory: { fontSize: 12, color: '#64748b', marginBottom: 4 },
  status: { fontSize: 11, color: '#64748b', fontStyle: 'italic' },
  subject: { fontSize: 12, fontWeight: 600, color: '#475569', marginBottom: 8, paddingBottom: 8, borderBottom: '1px solid rgba(0,0,0,0.1)' },
  body: { fontSize: 13, color: '#334155', lineHeight: 1.6, whiteSpace: 'pre-wrap', fontFamily: 'monospace' },
  bodyEdit: { width: '100%', boxSizing: 'border-box', minHeight: 260, fontSize: 13, color: '#334155', lineHeight: 1.6, fontFamily: 'monospace', padding: 12, border: '1px solid rgba(0,0,0,0.15)', borderRadius: 8, background: 'rgba(255,255,255,0.85)', resize: 'vertical' },
  dueRow: { display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10, flexWrap: 'wrap' },
  dueLabel: { fontSize: 12, fontWeight: 600, color: '#475569' },
  dueInput: { padding: '5px 8px', border: '1px solid rgba(0,0,0,0.15)', borderRadius: 6, fontSize: 12 },
  dueHint: { fontSize: 11, color: '#78716c', fontStyle: 'italic' },
  attachment: { marginTop: 12, display: 'inline-flex', alignItems: 'center', gap: 6, background: 'rgba(255,255,255,0.7)', border: '1px solid rgba(0,0,0,0.12)', borderRadius: 6, padding: '6px 12px', fontSize: 12, fontWeight: 600, color: '#334155' },
  copyBtn: { padding: '5px 14px', background: '#0f172a', color: '#fff', border: 'none', borderRadius: 5, fontSize: 12, cursor: 'pointer', whiteSpace: 'nowrap' },
  copiedBtn: { background: '#166534' },
  sendBtn: { padding: '5px 14px', background: '#3b82f6', color: '#fff', border: 'none', borderRadius: 5, fontSize: 12, cursor: 'pointer', whiteSpace: 'nowrap' },
  sentBtn: { background: '#0ea5e9' },
};
