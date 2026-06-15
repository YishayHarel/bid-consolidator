import { useState, useEffect } from 'react';
import api from '../utils/api';

const DIVISIONS = ['Hydration', 'Pet Beauty', 'Hard Coolers', 'Soft Coolers', 'Kitchen', 'General'];

export default function ProjectsTab() {
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: '', division: 'General' });
  const [saving, setSaving] = useState(false);

  useEffect(() => { loadProjects(); }, []);

  async function loadProjects() {
    setLoading(true);
    try {
      const { data } = await api.get('/projects');
      setProjects(data);
    } catch {}
    setLoading(false);
  }

  async function createProject(e) {
    e.preventDefault();
    setSaving(true);
    try {
      const { data } = await api.post('/projects', form);
      setProjects(p => [data, ...p]);
      setForm({ name: '', division: 'General' });
      setShowForm(false);
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to create project');
    }
    setSaving(false);
  }

  async function toggleStatus(project) {
    const newStatus = project.status === 'active' ? 'archived' : 'active';
    try {
      await api.patch(`/projects/${project.id}`, { status: newStatus });
      setProjects(ps => ps.map(p => p.id === project.id ? { ...p, status: newStatus } : p));
    } catch {}
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <h2 style={{ fontSize: 20, fontWeight: 700, color: '#0f172a' }}>Projects</h2>
        <button style={s.newBtn} onClick={() => setShowForm(v => !v)}>
          {showForm ? 'Cancel' : '+ New Project'}
        </button>
      </div>

      {showForm && (
        <form onSubmit={createProject} style={s.form}>
          <input
            style={s.input}
            placeholder="Project name (e.g. Ross Q2)"
            value={form.name}
            onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
            required
            autoFocus
          />
          <select style={s.input} value={form.division} onChange={e => setForm(f => ({ ...f, division: e.target.value }))}>
            {DIVISIONS.map(d => <option key={d} value={d}>{d}</option>)}
          </select>
          <button style={s.saveBtn} disabled={saving}>{saving ? 'Saving...' : 'Create'}</button>
        </form>
      )}

      {loading ? (
        <div style={{ color: '#94a3b8', padding: 24 }}>Loading...</div>
      ) : (
        <div style={s.grid}>
          {projects.map(p => (
            <div key={p.id} style={{ ...s.card, opacity: p.status === 'archived' ? 0.6 : 1 }}>
              <div style={s.cardTop}>
                <div>
                  <div style={s.projName}>{p.name}</div>
                  <div style={s.projDiv}>{p.division}</div>
                </div>
                <span style={{ ...s.badge, ...(p.status === 'active' ? s.activeBadge : s.archivedBadge) }}>
                  {p.status}
                </span>
              </div>
              <div style={s.cardBottom}>
                <span style={s.count}>{p.submission_count} submission{p.submission_count !== 1 ? 's' : ''}</span>
                <button style={s.archiveBtn} onClick={() => toggleStatus(p)}>
                  {p.status === 'active' ? 'Archive' : 'Restore'}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const s = {
  newBtn: { padding: '8px 16px', background: '#0f172a', color: '#fff', border: 'none', borderRadius: 7, fontSize: 13, fontWeight: 600, cursor: 'pointer' },
  form: { display: 'flex', gap: 10, background: '#fff', padding: 16, borderRadius: 10, border: '1px solid #e2e8f0', marginBottom: 20, alignItems: 'center' },
  input: { padding: '8px 12px', border: '1px solid #e2e8f0', borderRadius: 6, fontSize: 13, outline: 'none' },
  saveBtn: { padding: '8px 16px', background: '#0f172a', color: '#fff', border: 'none', borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: 'pointer' },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 14 },
  card: { background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, padding: 18 },
  cardTop: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 14 },
  projName: { fontWeight: 700, fontSize: 15, color: '#0f172a', marginBottom: 2 },
  projDiv: { fontSize: 12, color: '#64748b' },
  badge: { padding: '2px 8px', borderRadius: 10, fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap' },
  activeBadge: { background: '#dcfce7', color: '#166534' },
  archivedBadge: { background: '#f1f5f9', color: '#64748b' },
  cardBottom: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
  count: { fontSize: 12, color: '#94a3b8' },
  archiveBtn: { fontSize: 12, background: 'none', border: '1px solid #e2e8f0', borderRadius: 5, padding: '3px 10px', cursor: 'pointer', color: '#64748b' },
};
