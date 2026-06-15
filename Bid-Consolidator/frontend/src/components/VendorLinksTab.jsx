import { useState, useEffect } from 'react';
import api from '../utils/api';

export default function VendorLinksTab() {
  const [tokens, setTokens] = useState([]);
  const [projects, setProjects] = useState([]);
  const [form, setForm] = useState({ factory_name: '', project_id: '', expires_in_days: 7 });
  const [generating, setGenerating] = useState(false);
  const [copied, setCopied] = useState({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/projects').then(r => setProjects(r.data)).catch(() => {});
    loadTokens();
  }, []);

  async function loadTokens() {
    setLoading(true);
    try {
      const { data } = await api.get('/vendor/tokens');
      setTokens(data);
    } catch {}
    setLoading(false);
  }

  async function generate(e) {
    e.preventDefault();
    setGenerating(true);
    try {
      const { data } = await api.post('/vendor/tokens', form);
      const link = `${window.location.origin}/vendor?token=${data.token}`;
      await navigator.clipboard.writeText(link);
      setTokens(ts => [{ ...data, _link: link }, ...ts]);
      setForm(f => ({ ...f, factory_name: '' }));
      setCopied(c => ({ ...c, [data.id]: true }));
      setTimeout(() => setCopied(c => ({ ...c, [data.id]: false })), 3000);
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

  function copyLink(token) {
    const link = `${window.location.origin}/vendor?token=${token.token}`;
    navigator.clipboard.writeText(link);
    setCopied(c => ({ ...c, [token.id]: true }));
    setTimeout(() => setCopied(c => ({ ...c, [token.id]: false })), 2000);
  }

  function tokenStatus(t) {
    if (t.used_at) return { label: 'Used', style: { background: '#f1f5f9', color: '#64748b' } };
    if (new Date(t.expires_at) < new Date()) return { label: 'Expired', style: { background: '#fee2e2', color: '#991b1b' } };
    return { label: 'Pending', style: { background: '#fef9c3', color: '#854d0e' } };
  }

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <h2 style={{ fontSize: 20, fontWeight: 700, color: '#0f172a', marginBottom: 14 }}>Vendor Links</h2>

        <form onSubmit={generate} style={s.form}>
          <input
            style={s.input}
            placeholder="Factory name"
            value={form.factory_name}
            onChange={e => setForm(f => ({ ...f, factory_name: e.target.value }))}
            required
          />
          <select style={s.input} value={form.project_id} onChange={e => setForm(f => ({ ...f, project_id: e.target.value }))}>
            <option value="">No project</option>
            {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <select style={s.input} value={form.expires_in_days} onChange={e => setForm(f => ({ ...f, expires_in_days: e.target.value }))}>
            <option value={3}>3 days</option>
            <option value={7}>7 days</option>
            <option value={14}>14 days</option>
            <option value={30}>30 days</option>
          </select>
          <button style={s.genBtn} disabled={generating}>{generating ? 'Generating...' : 'Generate Link'}</button>
        </form>
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
                {['Factory', 'Project', 'Expires', 'Status', 'Actions'].map(h => (
                  <th key={h} style={s.th}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {tokens.map(t => {
                const st = tokenStatus(t);
                const link = t._link || `${window.location.origin}/vendor?token=${t.token}`;
                return (
                  <tr key={t.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                    <td style={s.td}><strong>{t.factory_name}</strong></td>
                    <td style={s.td}>{t.project_name || '—'}</td>
                    <td style={s.td}>{new Date(t.expires_at).toLocaleDateString()}</td>
                    <td style={s.td}>
                      <span style={{ ...s.badge, ...st.style }}>{st.label}</span>
                    </td>
                    <td style={s.td}>
                      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                        <span style={s.linkText}>{link.replace(window.location.origin, '').substring(0, 28)}...</span>
                        <button
                          style={{ ...s.copyBtn, ...(copied[t.id] ? s.copiedBtn : {}) }}
                          onClick={() => copyLink(t)}
                        >
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
  form: { display: 'flex', gap: 10, background: '#fff', padding: 16, borderRadius: 10, border: '1px solid #e2e8f0', flexWrap: 'wrap', alignItems: 'center' },
  input: { padding: '8px 12px', border: '1px solid #e2e8f0', borderRadius: 6, fontSize: 13, outline: 'none', minWidth: 150 },
  genBtn: { padding: '8px 16px', background: '#0f172a', color: '#fff', border: 'none', borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: 'pointer' },
  th: { padding: '11px 14px', textAlign: 'left', fontSize: 12, fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.04em', borderBottom: '1px solid #e2e8f0', background: '#f8fafc' },
  td: { padding: '12px 14px', fontSize: 13, color: '#334155' },
  badge: { padding: '2px 8px', borderRadius: 10, fontSize: 11, fontWeight: 600 },
  linkText: { fontSize: 11, color: '#94a3b8', fontFamily: 'monospace' },
  copyBtn: { padding: '4px 10px', background: '#0f172a', color: '#fff', border: 'none', borderRadius: 5, fontSize: 12, fontWeight: 600, cursor: 'pointer' },
  copiedBtn: { background: '#166534' },
  deleteBtn: { padding: '4px 10px', background: '#fee2e2', color: '#991b1b', border: '1px solid #fca5a5', borderRadius: 5, fontSize: 12, fontWeight: 600, cursor: 'pointer' },
};
