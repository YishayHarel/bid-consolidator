import { useState, useEffect } from 'react';
import api from '../utils/api';

export default function FactoriesTab() {
  const [factories, setFactories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [edits, setEdits] = useState({});
  const [newName, setNewName] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [adding, setAdding] = useState(false);

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    try {
      const { data } = await api.get('/factories');
      setFactories(data);
    } catch {}
    setLoading(false);
  }

  async function addFactory(e) {
    e.preventDefault();
    if (!newName.trim()) return;
    setAdding(true);
    try {
      const { data } = await api.post('/factories', { name: newName.trim(), email: newEmail.trim() });
      setFactories(fs => [...fs, data].sort((a, b) => a.name.localeCompare(b.name)));
      setNewName('');
      setNewEmail('');
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to add factory');
    }
    setAdding(false);
  }

  async function saveEdit(id) {
    const edit = edits[id];
    if (!edit) return;
    try {
      const { data } = await api.patch(`/factories/${id}`, { name: edit.name, email: edit.email });
      setFactories(fs => fs.map(f => f.id === id ? data : f));
      setEdits(e => ({ ...e, [id]: undefined }));
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to save');
    }
  }

  async function deleteFactory(id) {
    if (!confirm('Remove this factory from the directory?')) return;
    try {
      await api.delete(`/factories/${id}`);
      setFactories(fs => fs.filter(f => f.id !== id));
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to delete');
    }
  }

  function fieldValue(f, key) {
    return edits[f.id]?.[key] ?? f[key] ?? '';
  }

  function setField(f, key, value) {
    setEdits(e => ({ ...e, [f.id]: { name: fieldValue(f, 'name'), email: fieldValue(f, 'email'), ...e[f.id], [key]: value } }));
  }

  return (
    <div>
      <h2 style={{ fontSize: 20, fontWeight: 700, color: '#0f172a', marginBottom: 6 }}>Factories</h2>
      <div style={{ fontSize: 12, color: '#64748b', marginBottom: 18 }}>
        Your own factory list — only you can see it. A factory can have multiple emails; separate them with commas.
      </div>

      <form onSubmit={addFactory} style={s.addForm}>
        <input style={s.input} placeholder="Factory name" value={newName} onChange={e => setNewName(e.target.value)} />
        <input style={{ ...s.input, minWidth: 320, flex: 1 }} placeholder="Emails (comma-separated)" value={newEmail} onChange={e => setNewEmail(e.target.value)} />
        <button style={s.saveBtn} disabled={adding}>{adding ? 'Adding...' : '+ Add Factory'}</button>
      </form>

      {loading ? (
        <div style={{ color: '#94a3b8', padding: 24 }}>Loading...</div>
      ) : factories.length === 0 ? (
        <div style={s.empty}>No factories yet. Add one above.</div>
      ) : (
        <div style={s.tableWrapper}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
                <th style={s.th}>Name</th>
                <th style={s.th}>Emails (comma-separated)</th>
                <th style={s.th}></th>
              </tr>
            </thead>
            <tbody>
              {factories.map(f => (
                <tr key={f.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                  <td style={s.td}>
                    <input style={s.rowInput} value={fieldValue(f, 'name')}
                      onChange={e => setField(f, 'name', e.target.value)}
                      onBlur={() => saveEdit(f.id)} />
                  </td>
                  <td style={s.td}>
                    <input style={s.rowInput} value={fieldValue(f, 'email')}
                      onChange={e => setField(f, 'email', e.target.value)}
                      onBlur={() => saveEdit(f.id)} />
                  </td>
                  <td style={s.td}>
                    <button style={s.delBtn} onClick={() => deleteFactory(f.id)}>✕</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

const s = {
  addForm: { display: 'flex', gap: 10, marginBottom: 20, flexWrap: 'wrap' },
  input: { padding: '8px 11px', border: '1px solid #e2e8f0', borderRadius: 6, fontSize: 13, outline: 'none' },
  rowInput: { padding: '6px 8px', border: '1px solid transparent', borderRadius: 5, fontSize: 13, outline: 'none', width: '100%', boxSizing: 'border-box', background: 'transparent' },
  saveBtn: { padding: '9px 20px', background: '#0f172a', color: '#fff', border: 'none', borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: 'pointer' },
  empty: { color: '#94a3b8', textAlign: 'center', padding: 60, fontSize: 15 },
  tableWrapper: { background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, overflow: 'hidden' },
  th: { padding: '10px 12px', textAlign: 'left', fontSize: 11, fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.04em' },
  td: { padding: '6px 12px', fontSize: 13, color: '#334155' },
  delBtn: { background: 'none', border: 'none', color: '#cbd5e1', cursor: 'pointer', fontSize: 16, padding: '0 4px', lineHeight: 1 },
};
