import { useState, useEffect } from 'react';
import api from '../utils/api';
import ComparisonItemView from './ComparisonItemView';

export default function CompareTab() {
  const [projects, setProjects] = useState([]);
  const [selectedId, setSelectedId] = useState('');
  const [styles, setStyles] = useState([]);
  const [deleted, setDeleted] = useState([]);
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
    setProject(projects.find(p => String(p.id) === selectedId) || null);
    reload();
  }, [selectedId]);

  function reload() {
    if (!selectedId) return;
    setLoading(true);
    Promise.all([
      api.get(`/projects/${selectedId}/styles`),
      api.get(`/projects/${selectedId}/items/deleted`).catch(() => ({ data: [] })),
    ])
      .then(([s, d]) => { setStyles(s.data); setDeleted(d.data); })
      .catch(err => { console.error('Failed to load styles:', err); setStyles([]); })
      .finally(() => setLoading(false));
  }

  async function restoreItem(itemIndex) {
    try { await api.post(`/projects/${selectedId}/items/${itemIndex}/restore`); reload(); }
    catch { alert('Restore failed'); }
  }

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
          {deleted.length > 0 && (
            <div style={s.trash}>
              <span style={{ fontWeight: 600 }}>🗑 Deleted items ({deleted.length}):</span>
              {deleted.map(d => (
                <button key={d.item_index} style={s.restoreBtn} onClick={() => restoreItem(d.item_index)}>
                  ↺ Restore {d.style_num || `Item ${d.item_index + 1}`}
                </button>
              ))}
            </div>
          )}
          {styles.map(style => (
            <ComparisonItemView
              key={style.item_index}
              projectId={selectedId}
              itemIndex={style.item_index}
              styleNum={style.style_num}
              description={style.description}
              imageCount={style.image_count}
              lastPrice={style.last_price}
              moq={style.moq}
              innerPack={style.inner_pack}
              masterPack={style.master_pack}
              division={project?.division}
              onDeleted={reload}
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
  trash: { background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: '10px 14px', marginBottom: 20, fontSize: 13, color: '#7f1d1d', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
  restoreBtn: { background: '#fff', border: '1px solid #fca5a5', color: '#b91c1c', borderRadius: 6, padding: '4px 10px', fontSize: 12, fontWeight: 600, cursor: 'pointer' },
};
