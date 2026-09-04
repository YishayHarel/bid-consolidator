import { useState, useEffect } from 'react';
import api from '../utils/api';

const DIVISIONS = ['Hydration', 'Pet Beauty', 'Hard Coolers', 'Soft Coolers', 'Kitchen', 'General'];

export default function FactoriesTab() {
  const [factories, setFactories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [edits, setEdits] = useState({});
  const [newName, setNewName] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newContact, setNewContact] = useState('');
  const [newDivisions, setNewDivisions] = useState([]);
  const [adding, setAdding] = useState(false);
  const [filter, setFilter] = useState('All');

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
      const { data } = await api.post('/factories', {
        name: newName.trim(), email: newEmail.trim(), contact_name: newContact.trim(), divisions: newDivisions,
      });
      setFactories(fs => [...fs, data].sort((a, b) => a.name.localeCompare(b.name)));
      setNewName(''); setNewEmail(''); setNewContact(''); setNewDivisions([]);
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to add factory');
    }
    setAdding(false);
  }

  async function saveEdit(id) {
    const edit = edits[id];
    if (!edit) return;
    const f = factories.find(x => x.id === id);
    try {
      const { data } = await api.patch(`/factories/${id}`, {
        name: edit.name, email: edit.email, contact_name: edit.contact_name, divisions: f?.divisions || [],
      });
      setFactories(fs => fs.map(x => x.id === id ? data : x));
      setEdits(e => ({ ...e, [id]: undefined }));
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to save');
    }
  }

  // Toggle a division on a factory and persist immediately.
  async function toggleDivision(f, division) {
    const current = f.divisions || [];
    const next = current.includes(division) ? current.filter(d => d !== division) : [...current, division];
    try {
      const { data } = await api.patch(`/factories/${f.id}`, {
        name: f.name, email: f.email, contact_name: f.contact_name, divisions: next,
      });
      setFactories(fs => fs.map(x => x.id === f.id ? data : x));
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to update divisions');
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
    setEdits(e => ({ ...e, [f.id]: { name: fieldValue(f, 'name'), email: fieldValue(f, 'email'), contact_name: fieldValue(f, 'contact_name'), ...e[f.id], [key]: value } }));
  }
  function toggleNewDivision(d) {
    setNewDivisions(ds => ds.includes(d) ? ds.filter(x => x !== d) : [...ds, d]);
  }

  const shown = filter === 'All' ? factories : factories.filter(f => (f.divisions || []).includes(filter));

  return (
    <div>
      <h2 style={{ fontSize: 20, fontWeight: 700, color: '#0f172a', marginBottom: 6 }}>Factories</h2>
      <div style={{ fontSize: 12, color: '#64748b', marginBottom: 18 }}>
        Shared company directory — every account sees and uses the same factory list. Tag each factory with the division(s) it serves; a factory can belong to several. Multiple emails are comma-separated.
      </div>

      <form onSubmit={addFactory} style={s.addForm}>
        <input style={s.input} placeholder="Factory name" value={newName} onChange={e => setNewName(e.target.value)} />
        <input style={{ ...s.input, minWidth: 240, flex: 1 }} placeholder="Emails (comma-separated)" value={newEmail} onChange={e => setNewEmail(e.target.value)} />
        <input style={s.input} placeholder="Contact name" value={newContact} onChange={e => setNewContact(e.target.value)} />
        <button style={s.saveBtn} disabled={adding}>{adding ? 'Adding...' : '+ Add Factory'}</button>
        <div style={{ flexBasis: '100%', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12, color: '#64748b', fontWeight: 600 }}>Divisions:</span>
          {DIVISIONS.map(d => (
            <button type="button" key={d} onClick={() => toggleNewDivision(d)}
              style={{ ...s.chip, ...(newDivisions.includes(d) ? s.chipOn : s.chipOff) }}>
              {d}
            </button>
          ))}
        </div>
      </form>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
        <label style={{ fontSize: 13, fontWeight: 600, color: '#475569' }}>Show division:</label>
        <select style={s.input} value={filter} onChange={e => setFilter(e.target.value)}>
          <option value="All">All divisions</option>
          {DIVISIONS.map(d => <option key={d} value={d}>{d}</option>)}
        </select>
        <span style={{ fontSize: 12, color: '#94a3b8' }}>{shown.length} factor{shown.length === 1 ? 'y' : 'ies'}</span>
      </div>

      {loading ? (
        <div style={{ color: '#94a3b8', padding: 24 }}>Loading...</div>
      ) : shown.length === 0 ? (
        <div style={s.empty}>{filter === 'All' ? 'No factories yet. Add one above.' : `No factories in ${filter} yet.`}</div>
      ) : (
        <div style={s.tableWrapper}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
                <th style={s.th}>Name</th>
                <th style={s.th}>Emails (comma-separated)</th>
                <th style={s.th}>Contact Name</th>
                <th style={s.th}>Divisions</th>
                <th style={s.th}></th>
              </tr>
            </thead>
            <tbody>
              {shown.map(f => (
                <tr key={f.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                  <td style={s.td}>
                    <input style={s.rowInput} value={fieldValue(f, 'name')}
                      onChange={e => setField(f, 'name', e.target.value)} onBlur={() => saveEdit(f.id)} />
                  </td>
                  <td style={s.td}>
                    <input style={s.rowInput} value={fieldValue(f, 'email')}
                      onChange={e => setField(f, 'email', e.target.value)} onBlur={() => saveEdit(f.id)} />
                  </td>
                  <td style={s.td}>
                    <input style={s.rowInput} placeholder="—" value={fieldValue(f, 'contact_name')}
                      onChange={e => setField(f, 'contact_name', e.target.value)} onBlur={() => saveEdit(f.id)} />
                  </td>
                  <td style={{ ...s.td, minWidth: 300 }}>
                    <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                      {DIVISIONS.map(d => (
                        <button type="button" key={d} onClick={() => toggleDivision(f, d)}
                          title={(f.divisions || []).includes(d) ? `Remove from ${d}` : `Add to ${d}`}
                          style={{ ...s.chip, ...((f.divisions || []).includes(d) ? s.chipOn : s.chipOff) }}>
                          {d}
                        </button>
                      ))}
                    </div>
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
  addForm: { display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' },
  input: { padding: '8px 11px', border: '1px solid #e2e8f0', borderRadius: 6, fontSize: 13, outline: 'none' },
  rowInput: { padding: '6px 8px', border: '1px solid transparent', borderRadius: 5, fontSize: 13, outline: 'none', width: '100%', boxSizing: 'border-box', background: 'transparent' },
  saveBtn: { padding: '9px 20px', background: '#0f172a', color: '#fff', border: 'none', borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: 'pointer' },
  empty: { color: '#94a3b8', textAlign: 'center', padding: 60, fontSize: 15 },
  tableWrapper: { background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, overflow: 'hidden' },
  th: { padding: '10px 12px', textAlign: 'left', fontSize: 11, fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.04em' },
  td: { padding: '6px 12px', fontSize: 13, color: '#334155', verticalAlign: 'middle' },
  delBtn: { background: 'none', border: 'none', color: '#cbd5e1', cursor: 'pointer', fontSize: 16, padding: '0 4px', lineHeight: 1 },
  chip: { padding: '3px 9px', borderRadius: 12, fontSize: 11, fontWeight: 600, cursor: 'pointer', transition: 'all 0.1s' },
  chipOn: { background: '#0f172a', color: '#fff', border: '1px solid #0f172a' },
  chipOff: { background: '#fff', color: '#94a3b8', border: '1px solid #e2e8f0' },
};
