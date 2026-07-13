import { useState, useEffect } from 'react';
import api from '../utils/api';

const DIVISIONS = ['Hydration', 'Pet Beauty', 'Hard Coolers', 'Soft Coolers', 'Kitchen', 'General'];

export default function ProjectsTab() {
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: '', buyer: '', division: '', last_price: '', templateFile: null });
  const [saving, setSaving] = useState(false);
  const [editId, setEditId] = useState(null);
  const [editPrice, setEditPrice] = useState('');
  const [selectedProjectId, setSelectedProjectId] = useState(null);
  const [factories, setFactories] = useState([]);
  const [showAddFactories, setShowAddFactories] = useState(false);
  const [newFactories, setNewFactories] = useState('');

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    try {
      const { data } = await api.get('/projects');
      setProjects(data);
    } catch {}
    setLoading(false);
  }

  async function create(e) {
    e.preventDefault();
    setSaving(true);
    try {
      const formData = new FormData();
      formData.append('name', form.name);
      formData.append('buyer', form.buyer || null);
      formData.append('division', form.division || null);
      formData.append('last_price', form.last_price ? parseFloat(form.last_price) : null);
      if (form.templateFile) {
        formData.append('templateFile', form.templateFile);
      }
      const { data } = await api.post('/projects', formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });
      setProjects(ps => [{ ...data, quote_count: 0 }, ...ps]);
      setForm({ name: '', buyer: '', division: '', last_price: '', templateFile: null });
      setShowForm(false);
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to create project');
    }
    setSaving(false);
  }

  async function savePrice(id) {
    const last_price = parseFloat(editPrice);
    try {
      const { data } = await api.patch(`/projects/${id}`, { last_price: isNaN(last_price) ? null : last_price });
      setProjects(ps => ps.map(p => p.id === id ? { ...p, last_price: data.last_price } : p));
    } catch {}
    setEditId(null);
  }

  async function deleteProject(id) {
    if (!confirm('Delete this project and all its quotes?')) return;
    try {
      await api.delete(`/projects/${id}`);
      setProjects(ps => ps.filter(p => p.id !== id));
      setSelectedProjectId(null);
    } catch {}
  }

  async function loadFactories(projectId) {
    try {
      const { data } = await api.get(`/projects/${projectId}/factories`);
      setFactories(data);
    } catch {}
  }

  async function inviteFactories(projectId) {
    const names = newFactories
      .split('\n')
      .map(n => n.trim())
      .filter(n => n.length > 0);
    if (!names.length) return;
    try {
      const { data } = await api.post(`/projects/${projectId}/factories`, { factory_names: names });
      setFactories(fs => [...fs, ...data]);
      setNewFactories('');
      setShowAddFactories(false);
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to invite factories');
    }
  }

  async function deleteFactory(projectId, factoryId) {
    if (!confirm('Remove this factory from the project?')) return;
    try {
      await api.delete(`/projects/${projectId}/factories/${factoryId}`);
      setFactories(fs => fs.filter(f => f.id !== factoryId));
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to delete factory');
    }
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <h2 style={{ fontSize: 20, fontWeight: 700, color: '#0f172a' }}>Projects</h2>
        <button style={s.addBtn} onClick={() => setShowForm(v => !v)}>
          {showForm ? 'Cancel' : '+ New Project'}
        </button>
      </div>

      {showForm && (
        <form onSubmit={create} style={s.form}>
          <div style={s.formRow}>
            <div style={s.field}>
              <label style={s.label}>Project Name *</label>
              <input style={s.input} required placeholder="e.g. Ross Hydration Summer 2025"
                value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
            </div>
            <div style={s.field}>
              <label style={s.label}>Buyer</label>
              <input style={s.input} placeholder="e.g. Ross, TJ Maxx"
                value={form.buyer} onChange={e => setForm(f => ({ ...f, buyer: e.target.value }))} />
            </div>
            <div style={s.field}>
              <label style={s.label}>Division</label>
              <input style={s.input} type="text" list="divisions-list" placeholder="e.g. Beauty, Hydration, Kitchen"
                value={form.division} onChange={e => setForm(f => ({ ...f, division: e.target.value }))} />
              <datalist id="divisions-list">
                {DIVISIONS.map(d => <option key={d} value={d} />)}
              </datalist>
            </div>
            <div style={s.field}>
              <label style={s.label}>Last Price ($)</label>
              <input style={s.input} type="number" step="0.01" placeholder="0.00"
                value={form.last_price} onChange={e => setForm(f => ({ ...f, last_price: e.target.value }))} />
            </div>
            <div style={s.field}>
              <label style={s.label}>Template File (Optional)</label>
              <input style={s.input} type="file" accept=".xlsx,.xls"
                onChange={e => setForm(f => ({ ...f, templateFile: e.target.files[0] }))} />
              <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 4 }}>Upload your product template with images (Excel file)</div>
            </div>
          </div>
          <button style={s.saveBtn} disabled={saving}>{saving ? 'Creating...' : 'Create Project'}</button>
        </form>
      )}

      {selectedProjectId ? (
        <div>
          <button style={s.backBtn} onClick={() => setSelectedProjectId(null)}>← Back to Projects</button>
          {projects
            .filter(p => p.id === selectedProjectId)
            .map(p => (
              <div key={p.id}>
                <h3 style={{ fontSize: 18, fontWeight: 700, color: '#0f172a', marginBottom: 20 }}>{p.name}</h3>

                <div style={s.factoriesSection}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
                    <h4 style={{ fontSize: 14, fontWeight: 700, color: '#0f172a', margin: 0 }}>Invited Factories ({factories.length})</h4>
                    <button style={s.addBtn} onClick={() => setShowAddFactories(v => !v)}>
                      {showAddFactories ? 'Cancel' : '+ Add Factories'}
                    </button>
                  </div>

                  {showAddFactories && (
                    <div style={s.addForm}>
                      <textarea style={s.textarea} placeholder="Enter factory names, one per line"
                        value={newFactories} onChange={e => setNewFactories(e.target.value)} />
                      <button style={s.saveBtn} onClick={() => inviteFactories(p.id)}>Invite</button>
                    </div>
                  )}

                  {factories.length === 0 ? (
                    <div style={{ color: '#94a3b8', padding: 20 }}>No factories invited yet.</div>
                  ) : (
                    <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, overflow: 'hidden' }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                        <thead>
                          <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
                            <th style={s.th}>Factory Name</th>
                            <th style={s.th}>Status</th>
                            <th style={s.th}>Invited</th>
                            <th style={s.th}>Submitted</th>
                          </tr>
                        </thead>
                        <tbody>
                          {factories.map(f => (
                            <tr key={f.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                              <td style={s.td}><strong>{f.factory_name}</strong></td>
                              <td style={s.td}>
                                <span style={{
                                  ...s.badge,
                                  background: f.status === 'submitted' ? '#d1fae5' : f.status === 'no_response' ? '#fee2e2' : '#dbeafe',
                                  color: f.status === 'submitted' ? '#166534' : f.status === 'no_response' ? '#991b1b' : '#1e40af',
                                }}>
                                  {f.status}
                                </span>
                              </td>
                              <td style={s.td}>{new Date(f.invited_at).toLocaleDateString()}</td>
                              <td style={s.td}>{f.submitted_at ? new Date(f.submitted_at).toLocaleDateString() : '—'}</td>
                              <td style={s.td}>
                                <button style={s.delFactoryBtn} onClick={() => deleteFactory(p.id, f.id)}>✕</button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>
            ))}
        </div>
      ) : loading ? (
        <div style={{ color: '#94a3b8', padding: 24 }}>Loading...</div>
      ) : projects.length === 0 ? (
        <div style={s.empty}>No projects yet. Create your first project above.</div>
      ) : (
        <div style={s.grid}>
          {projects.map(p => {
            const lastPrice = parseFloat(p.last_price);
            const target = !isNaN(lastPrice) && lastPrice > 0 ? lastPrice * 0.90 : null;
            return (
              <div key={p.id} style={{ ...s.card, cursor: 'pointer' }} onClick={() => { setSelectedProjectId(p.id); loadFactories(p.id); }}>
                <div style={s.cardHeader}>
                  <div>
                    <div style={s.cardName}>{p.name}</div>
                    <div style={s.cardMeta}>{[p.buyer, p.division].filter(Boolean).join(' · ')}</div>
                  </div>
                  <div style={s.quoteCount}>{p.quote_count} quotes</div>
                </div>

                <div style={s.statusRow}>
                  <div style={s.statusBlock}>
                    <div style={s.statusLabel}>Factories</div>
                    <div style={s.statusVal}>{p.submitted_count}/{p.factory_count}</div>
                    {p.factory_count > 0 && (
                      <div style={s.progressBar}>
                        <div style={{ ...s.progressFill, width: `${(p.submitted_count / p.factory_count) * 100}%` }} />
                      </div>
                    )}
                  </div>
                </div>

                <div style={s.priceRow}>
                  <div style={s.priceBlock}>
                    <div style={s.priceLabel}>Last Price</div>
                    {editId === p.id ? (
                      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                        <input style={{ ...s.input, width: 90, padding: '4px 8px' }} type="number" step="0.01"
                          value={editPrice} onChange={e => setEditPrice(e.target.value)} autoFocus />
                        <button style={s.miniBtn} onClick={() => savePrice(p.id)}>Save</button>
                        <button style={s.miniCancelBtn} onClick={() => setEditId(null)}>✕</button>
                      </div>
                    ) : (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={s.priceVal}>{lastPrice > 0 ? `$${lastPrice.toFixed(2)}` : '—'}</span>
                        <button style={s.editPriceBtn} onClick={() => { setEditId(p.id); setEditPrice(p.last_price || ''); }}>
                          {lastPrice > 0 ? 'Edit' : 'Set price'}
                        </button>
                      </div>
                    )}
                  </div>
                  {target !== null && (
                    <div style={s.priceBlock}>
                      <div style={s.priceLabel}>Target (last − 10%)</div>
                      <span style={s.targetVal}>${target.toFixed(2)}</span>
                    </div>
                  )}
                </div>

                <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 14 }}>
                  <button style={s.deleteBtn} onClick={() => deleteProject(p.id)}>Delete Project</button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

const s = {
  backBtn: { padding: '6px 12px', background: 'transparent', color: '#3b82f6', border: 'none', fontSize: 13, cursor: 'pointer', marginBottom: 16 },
  addBtn: { padding: '8px 18px', background: '#0f172a', color: '#fff', border: 'none', borderRadius: 7, fontSize: 13, fontWeight: 600, cursor: 'pointer' },
  addForm: { background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, padding: 14, marginBottom: 16 },
  textarea: { width: '100%', padding: '10px', border: '1px solid #e2e8f0', borderRadius: 6, fontSize: 13, fontFamily: 'monospace', marginBottom: 10, boxSizing: 'border-box', minHeight: 80 },
  factoriesSection: { background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, padding: 20, marginBottom: 20 },
  th: { padding: '10px 12px', textAlign: 'left', fontSize: 11, fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.04em' },
  td: { padding: '10px 12px', fontSize: 13, color: '#334155' },
  badge: { padding: '2px 8px', borderRadius: 10, fontSize: 11, fontWeight: 600 },
  delFactoryBtn: { background: 'none', border: 'none', color: '#cbd5e1', cursor: 'pointer', fontSize: 16, padding: '0 4px', lineHeight: 1 },
  form: { background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, padding: 20, marginBottom: 20 },
  formRow: { display: 'flex', gap: 14, flexWrap: 'wrap', marginBottom: 14 },
  field: { display: 'flex', flexDirection: 'column', gap: 5, flex: '1 1 180px' },
  label: { fontSize: 12, fontWeight: 600, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.04em' },
  input: { padding: '8px 11px', border: '1px solid #e2e8f0', borderRadius: 6, fontSize: 13, outline: 'none' },
  saveBtn: { padding: '9px 20px', background: '#0f172a', color: '#fff', border: 'none', borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: 'pointer' },
  empty: { color: '#94a3b8', textAlign: 'center', padding: 60, fontSize: 15 },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 16 },
  card: { background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, padding: 20 },
  cardHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 },
  cardName: { fontSize: 15, fontWeight: 700, color: '#0f172a', marginBottom: 3 },
  cardMeta: { fontSize: 12, color: '#64748b' },
  quoteCount: { background: '#f1f5f9', color: '#475569', borderRadius: 20, padding: '3px 10px', fontSize: 12, fontWeight: 600 },
  statusRow: { display: 'flex', gap: 20, marginBottom: 14 },
  statusBlock: { display: 'flex', flexDirection: 'column', gap: 6 },
  statusLabel: { fontSize: 11, fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.04em' },
  statusVal: { fontSize: 16, fontWeight: 700, color: '#0f172a' },
  progressBar: { width: 120, height: 6, background: '#e5e7eb', borderRadius: 3, overflow: 'hidden' },
  progressFill: { height: '100%', background: '#3b82f6', transition: 'width 0.3s' },
  priceRow: { display: 'flex', gap: 28, flexWrap: 'wrap' },
  priceBlock: { display: 'flex', flexDirection: 'column', gap: 4 },
  priceLabel: { fontSize: 11, fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.04em' },
  priceVal: { fontSize: 18, fontWeight: 700, color: '#0f172a' },
  targetVal: { fontSize: 18, fontWeight: 700, color: '#16a34a' },
  editPriceBtn: { fontSize: 11, color: '#3b82f6', background: 'none', border: 'none', cursor: 'pointer', padding: 0 },
  miniBtn: { padding: '3px 10px', background: '#0f172a', color: '#fff', border: 'none', borderRadius: 5, fontSize: 12, cursor: 'pointer' },
  miniCancelBtn: { padding: '3px 8px', background: '#f1f5f9', color: '#64748b', border: 'none', borderRadius: 5, fontSize: 12, cursor: 'pointer' },
  deleteBtn: { padding: '5px 12px', background: '#fee2e2', color: '#991b1b', border: '1px solid #fca5a5', borderRadius: 5, fontSize: 12, cursor: 'pointer' },
};
