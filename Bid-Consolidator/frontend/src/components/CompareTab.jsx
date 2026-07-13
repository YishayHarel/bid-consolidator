import { useState, useEffect } from 'react';
import api from '../utils/api';
import ComparisonItemView from './ComparisonItemView';

export default function CompareTab() {
  const [projects, setProjects] = useState([]);
  const [selectedId, setSelectedId] = useState('');
  const [styles, setStyles] = useState([]);
  const [project, setProject] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    api.get('/projects').then(r => {
      setProjects(r.data);
      if (r.data.length > 0 && !selectedId) {
        setSelectedId(String(r.data[0].id));
      }
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (!selectedId) return;
    setLoading(true);
    const proj = projects.find(p => String(p.id) === selectedId);
    setProject(proj || null);
    api.get(`/projects/${selectedId}/styles`)
      .then(r => setStyles(r.data))
      .catch(err => {
        console.error('Failed to load styles:', err);
        setStyles([]);
      })
      .finally(() => setLoading(false));
  }, [selectedId]);

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 24, flexWrap: 'wrap' }}>
        <h2 style={{ fontSize: 20, fontWeight: 700, color: '#0f172a', margin: 0 }}>Factory Comparison</h2>
        <select
          style={s.select}
          value={selectedId}
          onChange={e => setSelectedId(e.target.value)}
        >
          <option value="">— Select project —</option>
          {projects.map(p => (
            <option key={p.id} value={String(p.id)}>{p.name}</option>
          ))}
        </select>
      </div>

      {!selectedId ? (
        <div style={s.empty}>Select a project to compare quotes.</div>
      ) : loading ? (
        <div style={{ color: '#94a3b8', padding: 24 }}>Loading...</div>
      ) : styles.length === 0 ? (
        <div style={s.empty}>No quotes yet for this project. Upload Excel files in the Upload tab.</div>
      ) : (
        <div>
          <div style={s.note}>
            Click <strong>Select</strong> to choose the winning factory for each item. You can add notes to compare quality, finishes, and other factors.
          </div>
          {styles.map(style => (
            <ComparisonItemView
              key={style.style_num}
              projectId={selectedId}
              styleNum={style.style_num}
              description={style.description}
            />
          ))}
        </div>
      )}
    </div>
  );
}

const s = {
  select: { padding: '7px 12px', border: '1px solid #e2e8f0', borderRadius: 7, fontSize: 13, outline: 'none', minWidth: 220 },
  empty: { color: '#94a3b8', textAlign: 'center', padding: 60 },
  note: { background: '#f0f9ff', border: '1px solid #bae6fd', borderRadius: 8, padding: '12px 14px', marginBottom: 24, fontSize: 13, color: '#0369a1' },
};
