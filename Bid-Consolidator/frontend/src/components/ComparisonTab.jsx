import { useState, useEffect } from 'react';
import api from '../utils/api';

export default function ComparisonTab() {
  const [submissions, setSubmissions] = useState([]);
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [aiSummary, setAiSummary] = useState('');
  const [aiLoading, setAiLoading] = useState(false);

  useEffect(() => {
    api.get('/submissions').then(r => setSubmissions(r.data)).catch(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!submissions.length) { setLoading(false); return; }
    setLoading(true);
    const subs = submissions.filter(s => s.status !== 'rejected');
    Promise.all(subs.map(s => api.get(`/submissions/${s.id}/products`).then(r => r.data)))
      .then(results => { setProducts(results.flat()); setLoading(false); })
      .catch(() => setLoading(false));
  }, [submissions]);

  const styleMap = {};
  for (const p of products) {
    if (!styleMap[p.style_num]) styleMap[p.style_num] = { style_num: p.style_num, description: p.description, packaging: p.packaging, factories: {} };
    styleMap[p.style_num].factories[p.factory_name] = p;
  }
  const styles = Object.values(styleMap);
  const factories = [...new Set(products.map(p => p.factory_name))].sort();

  // Soft distinct column tints — one per factory, cycling
  const FACTORY_TINTS = [
    { header: '#bfdbfe', cell: '#dbeafe' }, // blue
    { header: '#e9d5ff', cell: '#f3e8ff' }, // purple
    { header: '#fed7aa', cell: '#ffedd5' }, // orange
    { header: '#99f6e4', cell: '#ccfbf1' }, // teal
    { header: '#fde68a', cell: '#fef9c3' }, // yellow
    { header: '#fbcfe8', cell: '#fce7f3' }, // pink
    { header: '#a7f3d0', cell: '#d1fae5' }, // green
    { header: '#e2e8f0', cell: '#f1f5f9' }, // gray
  ];

  function cellColor(price, lowestPrice, tintCell) {
    if (!price) return { background: tintCell };
    if (!lowestPrice) return { background: tintCell };
    if (price === lowestPrice) return { background: '#fefce8', color: '#854d0e', fontWeight: 700 };
    if (price <= lowestPrice * 1.10) return { background: '#f0fdf4', color: '#166534' };
    return { background: '#fef2f2', color: '#991b1b' };
  }

  async function getAiSummary() {
    if (!products.length) return;
    setAiLoading(true);
    setAiSummary('');
    try {
      const { data } = await api.post('/submissions/ai-summary', { products, factories });
      setAiSummary(data.summary);
    } catch {
      setAiSummary('AI summary unavailable.');
    }
    setAiLoading(false);
  }

  return (
    <div>
      <div style={s.topBar}>
        <h2 style={s.title}>Factory Comparison</h2>
        {products.length > 0 && (
          <button style={s.aiBtn} onClick={getAiSummary} disabled={aiLoading}>
            {aiLoading ? 'Analyzing...' : 'AI Summary'}
          </button>
        )}
      </div>

      {aiSummary && (
        <div style={s.aiBox}>
          <div style={s.aiLabel}>AI Executive Summary</div>
          <p style={s.aiText}>{aiSummary}</p>
        </div>
      )}

      <div style={s.legend}>
        <span style={{ ...s.dot, background: '#fefce8', border: '1px solid #fde68a' }} /> Lowest Bid
        <span style={{ ...s.dot, background: '#f0fdf4', border: '1px solid #86efac', marginLeft: 12 }} /> Competitive (within 10%)
        <span style={{ ...s.dot, background: '#fef2f2', border: '1px solid #fca5a5', marginLeft: 12 }} /> Too High
      </div>

      {loading ? (
        <div style={s.empty}>Loading...</div>
      ) : styles.length === 0 ? (
        <div style={s.empty}>No submissions yet. Upload factory quote sheets from the Submissions tab.</div>
      ) : (
        <div style={{ overflowX: 'auto', background: '#fff', borderRadius: 10, border: '1px solid #e2e8f0' }}>
          <table style={s.table}>
            <thead>
              <tr>
                <th style={s.th}>Style #</th>
                <th style={s.th}>Description</th>
                <th style={s.th}>Packaging</th>
                {factories.map((f, i) => {
                  const tint = FACTORY_TINTS[i % FACTORY_TINTS.length];
                  return <th key={f} style={{ ...s.th, background: tint.header, borderTop: `3px solid ${tint.header.replace('ff', 'cc')}` }}>{f}</th>;
                })}
                <th style={{ ...s.th, background: '#fefce8' }}>Lowest Bid</th>
                <th style={{ ...s.th, background: '#f0fdf4' }}>Target +10%</th>
              </tr>
            </thead>
            <tbody>
              {styles.map(row => {
                const prices = factories.map(f => row.factories[f]?.price).filter(Boolean);
                const lowest = prices.length ? Math.min(...prices) : null;
                const target = lowest ? +(lowest * 1.10).toFixed(4) : null;
                return (
                  <tr key={row.style_num} style={{ borderBottom: '1px solid #f1f5f9' }}>
                    <td style={s.td}><strong>{row.style_num}</strong></td>
                    <td style={s.td}>{row.description}</td>
                    <td style={s.td}>{row.packaging}</td>
                    {factories.map((f, i) => {
                      const p = row.factories[f];
                      const price = p?.price;
                      const tint = FACTORY_TINTS[i % FACTORY_TINTS.length];
                      const cs = cellColor(price, lowest, tint.cell);
                      return (
                        <td key={f} style={{ ...s.td, ...cs }}>
                          {price ? `$${Number(price).toFixed(2)}` : <span style={{ color: '#cbd5e1' }}>—</span>}
                        </td>
                      );
                    })}
                    <td style={{ ...s.td, background: '#fefce8', fontWeight: 700 }}>
                      {lowest ? `$${lowest.toFixed(2)}` : '—'}
                    </td>
                    <td style={{ ...s.td, background: '#f0fdf4' }}>
                      {target ? `$${target.toFixed(2)}` : '—'}
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
  topBar: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 },
  title: { fontSize: 20, fontWeight: 700, color: '#0f172a' },
  select: { padding: '7px 10px', border: '1px solid #e2e8f0', borderRadius: 6, fontSize: 13, background: '#fff' },
  aiBtn: { padding: '7px 14px', background: '#1e293b', color: '#fff', border: 'none', borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: 'pointer' },
  aiBox: { background: '#f0f9ff', border: '1px solid #bae6fd', borderRadius: 8, padding: '14px 18px', marginBottom: 16 },
  aiLabel: { fontSize: 12, fontWeight: 700, color: '#0369a1', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 },
  aiText: { fontSize: 13, color: '#1e3a5f', lineHeight: 1.7 },
  legend: { display: 'flex', alignItems: 'center', fontSize: 12, color: '#64748b', marginBottom: 12 },
  dot: { display: 'inline-block', width: 12, height: 12, borderRadius: 3, marginRight: 4 },
  empty: { color: '#94a3b8', padding: '40px 0', textAlign: 'center' },
  table: { width: '100%', borderCollapse: 'collapse' },
  th: { padding: '11px 14px', textAlign: 'left', fontSize: 12, fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.04em', borderBottom: '1px solid #e2e8f0', background: '#f8fafc', whiteSpace: 'nowrap' },
  td: { padding: '11px 14px', fontSize: 13, color: '#334155', whiteSpace: 'nowrap' },
};
