import { useState, useEffect } from 'react';
import api from '../utils/api';

export default function VendorLinksTab() {
  const [tokens, setTokens] = useState([]);
  const [projects, setProjects] = useState([]);
  const [form, setForm] = useState({ factory_name: '', project_id: '' });
  const [generating, setGenerating] = useState(false);
  const [copied, setCopied] = useState({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      api.get('/vendor/tokens'),
      api.get('/vendor/projects'),
    ]).then(([t, p]) => {
      setTokens(t.data);
      setProjects(p.data);
      if (p.data.length > 0) setForm(f => ({ ...f, project_id: String(p.data[0].id) }));
    }).catch(() => {}).finally(() => setLoading(false));
  }, []);

  async function generate(e) {
    e.preventDefault();
    if (!form.factory_name.trim() || !form.project_id) return;
    setGenerating(true);
    try {
      const { data } = await api.post('/vendor/tokens', {
        factory_name: form.factory_name.trim(),
        project_id: parseInt(form.project_id),
      });
      const link = `${window.location.origin}/vendor?token=${data.token}`;
      await navigator.clipboard.writeText(link);
      const proj = projects.find(p => p.id === parseInt(form.project_id));
      setTokens(ts => [{ ...data, project_name: proj?.name, _link: link }, ...ts]);
      setForm(f => ({ ...f, factory_name: '' }));
      setCopied(c => ({ ...c, [data.id]: true }));
      setTimeout(() => setCopied(c => ({ ...c, [data.id]: false })), 4000);
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to generate link');
    }
    setGenerating(false);
  }

  async function deleteToken(id) {
    if (!confirm('Delete this link?')) return;
    try {
      await api.delete(`/vendor/tokens/${id}`);
      setTokens(ts => ts.filter(t => t.id !== id));
    } catch {}
  }

  function copyLink(t) {
    const link = `${window.location.origin}/vendor?token=${t.token}`;
    navigator.clipboard.writeText(link);
    setCopied(c => ({ ...c, [t.id]: true }));
    setTimeout(() => setCopied(c => ({ ...c, [t.id]: false })), 2000);
  }

  function tokenStatus(t) {
    if (t.used_at)                           return { label: 'Used',    style: { background: '#f1f5f9', color: '#64748b' } };
    if (new Date(t.expires_at) < new Date()) return { label: 'Expired', style: { background: '#fee2e2', color: '#991b1b' } };
    return                                          { label: 'Active',   style: { background: '#dcfce7', color: '#166534' } };
  }

  const formReady = form.factory_name.trim() && form.project_id;

  return (
    <div>
      <h2 style={{ fontSize: 20, fontWeight: 700, color: '#0f172a', marginBottom: 6 }}>Vendor Links</h2>
      <p style={{ fontSize: 13, color: '#64748b', marginBottom: 20 }}>
        Generate a one-time link for a factory. When they upload, their quotes go directly into the linked project.
      </p>

      <form onSubmit={generate} style={s.form}>
        <div style={s.formRow}>
          <div style={s.fieldGroup}>
            <label style={s.label}>Project</label>
            <select style={s.select} value={form.project_id} required
              onChange={e => setForm(f => ({ ...f, project_id: e.target.value }))}>
              <option value="">Select project...</option>
              {projects.map(p => <option key={p.id} value={String(p.id)}>{p.name}</option>)}
            </select>
          </div>

          <div style={s.arrow}>→</div>

          <div style={s.fieldGroup}>
            <label style={s.label}>Factory Name</label>
            <input style={s.select} type="text" placeholder="e.g. Sunrise Manufacturing"
              value={form.factory_name} required
              onChange={e => setForm(f => ({ ...f, factory_name: e.target.value }))} />
          </div>

          <button style={{ ...s.genBtn, opacity: formReady ? 1 : 0.5 }} disabled={generating || !formReady}>
            {generating ? 'Generating...' : 'Generate & Copy Link'}
          </button>
        </div>
      </form>

      {/* General link */}
      <div style={s.generalLink}>
        <div>
          <div style={{ fontWeight: 600, color: '#0f172a', marginBottom: 2 }}>General Upload Link</div>
          <div style={{ fontSize: 12, color: '#64748b' }}>For factories without a token — they pick the project themselves.</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={s.linkText}>{window.location.origin}/vendor</span>
          <button style={s.copySmall} onClick={() => navigator.clipboard.writeText(`${window.location.origin}/vendor`)}>Copy</button>
        </div>
      </div>

      {loading ? (
        <div style={{ color: '#94a3b8', padding: 24 }}>Loading...</div>
      ) : tokens.length === 0 ? (
        <div style={{ color: '#94a3b8', textAlign: 'center', padding: 40 }}>No links generated yet.</div>
      ) : (
        <div style={{ background: '#fff', borderRadius: 10, border: '1px solid #e2e8f0', overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                {['Factory', 'Project', 'Expires', 'Status', ''].map(h => (
                  <th key={h} style={s.th}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {tokens.map(t => {
                const st = tokenStatus(t);
                return (
                  <tr key={t.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                    <td style={s.td}><strong>{t.factory_name}</strong></td>
                    <td style={s.td}>{t.project_name || '—'}</td>
                    <td style={s.td}>{new Date(t.expires_at).toLocaleDateString()}</td>
                    <td style={s.td}><span style={{ ...s.badge, ...st.style }}>{st.label}</span></td>
                    <td style={s.td}>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button style={{ ...s.copyBtn, ...(copied[t.id] ? s.copiedBtn : {}) }} onClick={() => copyLink(t)}>
                          {copied[t.id] ? 'Copied!' : 'Copy Link'}
                        </button>
                        <button style={s.deleteBtn} onClick={() => deleteToken(t.id)}>Delete</button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

const s = {
  form: { background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, padding: '20px 24px', marginBottom: 16 },
  formRow: { display: 'flex', alignItems: 'flex-end', gap: 12, flexWrap: 'wrap' },
  fieldGroup: { display: 'flex', flexDirection: 'column', gap: 5 },
  label: { fontSize: 12, fontWeight: 600, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.04em' },
  select: { padding: '8px 12px', border: '1px solid #e2e8f0', borderRadius: 6, fontSize: 13, outline: 'none', minWidth: 200 },
  arrow: { color: '#94a3b8', fontSize: 18, paddingBottom: 6 },
  genBtn: { padding: '9px 18px', background: '#0f172a', color: '#fff', border: 'none', borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' },
  generalLink: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, padding: '12px 16px', marginBottom: 16, gap: 16 },
  linkText: { fontSize: 12, color: '#64748b', fontFamily: 'monospace' },
  copySmall: { padding: '4px 10px', background: '#0f172a', color: '#fff', border: 'none', borderRadius: 5, fontSize: 12, cursor: 'pointer' },
  th: { padding: '11px 14px', textAlign: 'left', fontSize: 12, fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.04em', borderBottom: '1px solid #e2e8f0', background: '#f8fafc' },
  td: { padding: '12px 14px', fontSize: 13, color: '#334155' },
  badge: { padding: '2px 8px', borderRadius: 10, fontSize: 11, fontWeight: 600 },
  copyBtn: { padding: '4px 12px', background: '#0f172a', color: '#fff', border: 'none', borderRadius: 5, fontSize: 12, fontWeight: 600, cursor: 'pointer' },
  copiedBtn: { background: '#166534' },
  deleteBtn: { padding: '4px 10px', background: '#fee2e2', color: '#991b1b', border: '1px solid #fca5a5', borderRadius: 5, fontSize: 12, fontWeight: 600, cursor: 'pointer' },
};
