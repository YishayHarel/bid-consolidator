import { useState, useEffect } from 'react';
import api from '../utils/api';

export default function CompareTab() {
  const [projects, setProjects] = useState([]);
  const [selectedId, setSelectedId] = useState('');
  const [quotes, setQuotes] = useState([]);
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
    api.get(`/projects/${selectedId}/quotes`).then(r => {
      setQuotes(r.data);
    }).catch(() => setQuotes([])).finally(() => setLoading(false));
  }, [selectedId]);

  async function deleteQuote(id) {
    try {
      await api.delete(`/projects/quotes/${id}`);
      setQuotes(qs => qs.filter(q => q.id !== id));
    } catch {}
  }

  // Compute best (lowest) price per style group
  const bestPriceByStyle = {};
  quotes.forEach(q => {
    const key = (q.style_num || '').trim().toLowerCase() || `__id_${q.id}`;
    const p = parseFloat(q.price);
    if (!isNaN(p) && (bestPriceByStyle[key] === undefined || p < bestPriceByStyle[key])) {
      bestPriceByStyle[key] = p;
    }
  });

  function isBest(q) {
    const p = parseFloat(q.price);
    if (isNaN(p)) return false;
    const key = (q.style_num || '').trim().toLowerCase() || `__id_${q.id}`;
    return bestPriceByStyle[key] === p;
  }

  const lastPrice = project ? parseFloat(project.last_price) : NaN;
  const target = !isNaN(lastPrice) && lastPrice > 0 ? lastPrice * 0.90 : null;

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 16, flexWrap: 'wrap' }}>
        <h2 style={{ fontSize: 20, fontWeight: 700, color: '#0f172a', margin: 0 }}>Compare</h2>
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

      {/* Target price banner */}
      {project && target !== null && (
        <div style={s.targetBanner}>
          <span style={s.targetLabel}>Target Price</span>
          <span style={s.targetPrice}>${target.toFixed(2)}</span>
          <span style={s.targetNote}>Last price was ${lastPrice.toFixed(2)} — factories need to beat this by 10% to be competitive</span>
        </div>
      )}

      {!selectedId ? (
        <div style={s.empty}>Select a project to compare quotes.</div>
      ) : loading ? (
        <div style={{ color: '#94a3b8', padding: 24 }}>Loading...</div>
      ) : quotes.length === 0 ? (
        <div style={s.empty}>No quotes yet for this project. Upload an Excel file in the Upload tab.</div>
      ) : (
        <>
          <div style={s.legend}>
            <span style={s.legendGreen} /> Best price per style
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={s.table}>
              <thead>
                <tr>
                  {['Factory', 'Style #', 'Description', 'Category', 'Color', 'Scent / Fragrance', 'Packaging', 'MOQ', 'Price', 'Benchmark', ''].map(h => (
                    <th key={h} style={s.th}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {quotes.map(q => {
                  const best = isBest(q);
                  const rowBg = best ? '#f0fdf4' : '#fff';
                  const priceFmt = parseFloat(q.price) > 0 ? `$${parseFloat(q.price).toFixed(4).replace(/\.?0+$/, '').replace(/(\.\d\d)\d+/, '$1')}` : '—';
                  return (
                    <tr key={q.id} style={{ background: rowBg, borderBottom: '1px solid #f1f5f9' }}>
                      <td style={{ ...s.td, fontWeight: 600 }}>{q.factory_name}</td>
                      <td style={s.td}>{q.style_num || '—'}</td>
                      <td style={{ ...s.td, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{q.description || '—'}</td>
                      <td style={s.td}>{q.category || '—'}</td>
                      <td style={s.td}>{q.color || '—'}</td>
                      <td style={s.td}>{q.scent_fragrance || '—'}</td>
                      <td style={s.td}>{q.packaging || '—'}</td>
                      <td style={{ ...s.td, textAlign: 'right' }}>{q.moq ? q.moq.toLocaleString() : '—'}</td>
                      <td style={{ ...s.td, textAlign: 'right', fontWeight: best ? 700 : 400, color: best ? '#16a34a' : '#0f172a' }}>
                        {best && <span style={{ marginRight: 4 }}>✓</span>}
                        {priceFmt}
                      </td>
                      <td style={s.td}>
                        {q.benchmark_link ? (
                          <a href={q.benchmark_link} target="_blank" rel="noreferrer" style={s.link}>View</a>
                        ) : '—'}
                      </td>
                      <td style={s.td}>
                        <button style={s.delBtn} onClick={() => deleteQuote(q.id)}>✕</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

const s = {
  select: { padding: '7px 12px', border: '1px solid #e2e8f0', borderRadius: 7, fontSize: 13, outline: 'none', minWidth: 220 },
  targetBanner: { background: '#f0fdf4', border: '1px solid #86efac', borderRadius: 8, padding: '12px 18px', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' },
  targetLabel: { fontSize: 12, fontWeight: 700, color: '#15803d', textTransform: 'uppercase', letterSpacing: '0.05em' },
  targetPrice: { fontSize: 22, fontWeight: 800, color: '#15803d' },
  targetNote: { fontSize: 12, color: '#166534' },
  legend: { display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#64748b', marginBottom: 10 },
  legendGreen: { display: 'inline-block', width: 14, height: 14, background: '#f0fdf4', border: '1.5px solid #86efac', borderRadius: 3 },
  empty: { color: '#94a3b8', textAlign: 'center', padding: 60 },
  table: { width: '100%', borderCollapse: 'collapse', background: '#fff', borderRadius: 10, overflow: 'hidden', border: '1px solid #e2e8f0', fontSize: 13 },
  th: { padding: '10px 12px', background: '#f8fafc', textAlign: 'left', fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.04em', borderBottom: '1px solid #e2e8f0', whiteSpace: 'nowrap' },
  td: { padding: '10px 12px', color: '#334155', whiteSpace: 'nowrap' },
  link: { color: '#3b82f6', textDecoration: 'none', fontSize: 12 },
  delBtn: { background: 'none', border: 'none', color: '#cbd5e1', cursor: 'pointer', fontSize: 14, padding: '0 4px', lineHeight: 1 },
};
