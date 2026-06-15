import { useState, useEffect } from 'react';
import api from '../utils/api';

export default function VendorLinksTab() {
  const [tokens, setTokens] = useState([]);
  const [form, setForm] = useState({ factory_name: '', expires_in_days: 7 });
  const [generating, setGenerating] = useState(false);
  const [copied, setCopied] = useState({});
  const [loading, setLoading] = useState(true);

  useEffect(() => { loadTokens(); }, []);

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

  function copyLink(token) {
    const link = `${window.location.origin}/vendor?token=${token.token}`;
    navigator.clipboard.writeText(link);
    setCopied(c => ({ ...c, [token.id]: true }));
    setTimeout(() => setCopied(c => ({ ...c, [token.id]: false })), 2000);
  }

  function tokenStatus(t) {
    if (t.used_at) return { label: 'Used', style: { background: '#f1f5f9', color: '#64748b' } };
    if (new Date(t.expires_at) < new Date()) return { label: 'Expired', style: { background: '#fee2e2', color: '#991b1b' } };
    return { label: 'Active', style: { background: '#dcfce7', color: '#166534' } };
  }

  return (
    <div>
      <h2 style={{ fontSize: 20, fontWeight: 700, color: '#0f172a', marginBottom: 16 }}>Vendor Links</h2>

      <div style={s.generalLink}>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 600, color: '#0f172a', marginBottom: 4 }}>General Upload Link</div>
          <div style={{ fontSize: 12, color: '#64748b', marginBottom: 10 }}>
            Send this to any factory. They enter their name and upload — no account or token needed.
          </div>
          <span style={s.linkTextLarge}>{window.location.origin}/vendor</span>
        </div>
        <button style={s.genBtn} onClick={() => { navigator.clipboard.writeText(`${window.location.origin}/vendor`); }}>
          Copy Link
        </button>
      </div>

      <div style={s.divider}>
        <span style={s.dividerLabel}>or generate a named one-time link for a specific factory</span>
      </div>

      <form onSubmit={generate} style={s.form}>
        <input
          style={s.input}
          placeholder="Factory name (e.g. Sunrise Manufacturing)"
          value={form.factory_name}
          onChange={e => setForm(f => ({ ...f, factory_name: e.target.value }))}
          required
          autoFocus
        />
        <select style={{ ...s.input, width: 'auto' }} value={form.expires_in_days}
          onChange={e => setForm(f => ({ ...f, expires_in_days: e.target.value }))}>
          <option value={3}>Expires in 3 days</option>
          <option value={7}>Expires in 7 days</option>
          <option value={14}>Expires in 14 days</option>
          <option value={30}>Expires in 30 days</option>
        </select>
        <button style={s.genBtn} disabled={generating}>
          {generating ? 'Generating...' : 'Generate & Copy Link'}
        </button>
      </form>

      {loading ? (
        <div style={{ color: '#94a3b8', padding: 24 }}>Loading...</div>
      ) : tokens.length === 0 ? (
        <div style={{ color: '#94a3b8', textAlign: 'center', padding: 40 }}>No links generated yet.</div>
      ) : (
        <div style={{ background: '#fff', borderRadius: 10, border: '1px solid #e2e8f0', overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                {['Factory', 'Created', 'Expires', 'Status', 'Link', ''].map(h => (
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
                    <td style={s.td}>{new Date(t.created_at).toLocaleDateString()}</td>
                    <td style={s.td}>{new Date(t.expires_at).toLocaleDateString()}</td>
                    <td style={s.td}>
                      <span style={{ ...s.badge, ...st.style }}>{st.label}</span>
                    </td>
                    <td style={s.td}>
                      <span style={s.linkText}>{link}</span>
                    </td>
                    <td style={s.td}>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button
                          style={{ ...s.copyBtn, ...(copied[t.id] ? s.copiedBtn : {}) }}
                          onClick={() => copyLink(t)}
                        >
                          {copied[t.id] ? 'Copied!' : 'Copy'}
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
  form: { display: 'flex', gap: 10, background: '#fff', padding: 16, borderRadius: 10, border: '1px solid #e2e8f0', marginBottom: 20, alignItems: 'center', flexWrap: 'wrap' },
  input: { padding: '8px 12px', border: '1px solid #e2e8f0', borderRadius: 6, fontSize: 13, outline: 'none', flex: 1, minWidth: 200 },
  genBtn: { padding: '8px 18px', background: '#0f172a', color: '#fff', border: 'none', borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' },
  th: { padding: '11px 14px', textAlign: 'left', fontSize: 12, fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.04em', borderBottom: '1px solid #e2e8f0', background: '#f8fafc' },
  td: { padding: '12px 14px', fontSize: 13, color: '#334155' },
  badge: { padding: '2px 8px', borderRadius: 10, fontSize: 11, fontWeight: 600 },
  generalLink: { background: '#f0f9ff', border: '1px solid #bae6fd', borderRadius: 10, padding: '18px 20px', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 16 },
  linkTextLarge: { fontSize: 13, color: '#0369a1', fontFamily: 'monospace', fontWeight: 600 },
  divider: { display: 'flex', alignItems: 'center', margin: '20px 0' },
  dividerLabel: { fontSize: 12, color: '#94a3b8', background: '#f8fafc', padding: '0 12px', whiteSpace: 'nowrap' },
  linkText: { fontSize: 11, color: '#94a3b8', fontFamily: 'monospace', wordBreak: 'break-all' },
  copyBtn: { padding: '4px 12px', background: '#0f172a', color: '#fff', border: 'none', borderRadius: 5, fontSize: 12, fontWeight: 600, cursor: 'pointer' },
  copiedBtn: { background: '#166534' },
  deleteBtn: { padding: '4px 10px', background: '#fee2e2', color: '#991b1b', border: '1px solid #fca5a5', borderRadius: 5, fontSize: 12, fontWeight: 600, cursor: 'pointer' },
};
