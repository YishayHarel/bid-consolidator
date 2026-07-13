import { useState, useEffect } from 'react';
import api from '../utils/api';

const FACTORY_TINTS = {
  blue: { bg: '#dbeafe', text: '#0369a1' },
  purple: { bg: '#f3e8ff', text: '#7e22ce' },
  orange: { bg: '#ffedd5', text: '#ea580c' },
  teal: { bg: '#ccfbf1', text: '#0d9488' },
  yellow: { bg: '#fef9c3', text: '#a16207' },
  pink: { bg: '#fce7f3', text: '#be185d' },
  green: { bg: '#d1fae5', text: '#047857' },
  gray: { bg: '#f1f5f9', text: '#475569' },
};

const tintKeys = Object.keys(FACTORY_TINTS);

export default function ComparisonItemView({ projectId, styleNum, description }) {
  const [quotes, setQuotes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editingNotes, setEditingNotes] = useState({});
  const [saving, setSaving] = useState({});

  useEffect(() => {
    api.get(`/projects/${projectId}/comparison/${styleNum}`)
      .then(r => {
        setQuotes(r.data);
        setLoading(false);
      })
      .catch(err => {
        console.error('Failed to load comparison:', err);
        setLoading(false);
      });
  }, [projectId, styleNum]);

  async function updateQuote(quoteId, updates) {
    setSaving(s => ({ ...s, [quoteId]: true }));
    try {
      const { data } = await api.patch(`/projects/${projectId}/quotes/${quoteId}`, updates);
      setQuotes(qs => qs.map(q => q.id === quoteId ? data : q));
    } catch (err) {
      console.error('Update failed:', err);
      alert('Save failed');
    }
    setSaving(s => ({ ...s, [quoteId]: false }));
  }

  function selectWinner(quoteId) {
    quotes.forEach(q => {
      if (q.is_selected_winner && q.id !== quoteId) {
        updateQuote(q.id, { is_selected_winner: false });
      }
    });
    updateQuote(quoteId, { is_selected_winner: true });
  }

  if (loading) return <div style={s.loading}>Loading...</div>;
  if (!quotes.length) return <div style={s.empty}>No quotes for this style.</div>;

  return (
    <div style={s.container}>
      <div style={s.productHeader}>
        <div style={s.productTitle}>{styleNum}</div>
        <div style={s.productDesc}>{description}</div>
      </div>

      <div style={s.tableWrapper}>
        <table style={s.table}>
          <thead>
            <tr>
              <th style={s.th}>Factory</th>
              <th style={s.th}>Our Image</th>
              <th style={s.th}>Their Image</th>
              <th style={s.th}>Description</th>
              <th style={s.th}>Color</th>
              <th style={s.th}>Price</th>
              <th style={s.th}>Notes</th>
              <th style={s.th}>Select</th>
            </tr>
          </thead>
          <tbody>
            {quotes.map((quote, idx) => {
              const tint = FACTORY_TINTS[tintKeys[idx % tintKeys.length]];
              const isWinner = quote.is_selected_winner;

              return (
                <tr key={quote.id} style={{ ...s.row, background: isWinner ? tint.bg : '#fff' }}>
                  <td style={s.td}>
                    <div style={{ fontWeight: 700, color: tint.text }}>{quote.factory_name}</div>
                  </td>
                  <td style={s.imageTd}>
                    {/* Our image would go here - not in quotes table yet */}
                    <div style={s.imagePlaceholder}>—</div>
                  </td>
                  <td style={s.imageTd}>
                    {quote.image_path ? (
                      <img
                        src={`/api/projects/${projectId}/quote-image/${quote.id}`}
                        style={s.productImage}
                        onError={(e) => { e.target.style.display = 'none'; }}
                      />
                    ) : (
                      <div style={s.imagePlaceholder}>—</div>
                    )}
                  </td>
                  <td style={s.td}>{quote.description || '—'}</td>
                  <td style={s.td}>{quote.color || '—'}</td>
                  <td style={{ ...s.td, fontWeight: 700, color: tint.text }}>
                    ${quote.price ? parseFloat(quote.price).toFixed(2) : '—'}
                  </td>
                  <td style={s.noteTd}>
                    <textarea
                      value={editingNotes[quote.id] ?? quote.comparison_notes ?? ''}
                      onChange={(e) => setEditingNotes(n => ({ ...n, [quote.id]: e.target.value }))}
                      onBlur={() => {
                        if (editingNotes[quote.id] !== undefined) {
                          updateQuote(quote.id, { comparison_notes: editingNotes[quote.id] });
                          setEditingNotes(n => ({ ...n, [quote.id]: undefined }));
                        }
                      }}
                      placeholder="Notes..."
                      style={s.noteInput}
                    />
                  </td>
                  <td style={s.td}>
                    <button
                      onClick={() => selectWinner(quote.id)}
                      style={{
                        ...s.selectBtn,
                        background: isWinner ? tint.text : '#e2e8f0',
                        color: isWinner ? '#fff' : '#475569',
                      }}
                      disabled={saving[quote.id]}
                    >
                      {saving[quote.id] ? '...' : isWinner ? '✓' : 'Select'}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const s = {
  container: { marginBottom: 32, background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, overflow: 'hidden' },
  productHeader: { background: '#f8fafc', borderBottom: '1px solid #e2e8f0', padding: '16px' },
  productTitle: { fontSize: 16, fontWeight: 700, color: '#0f172a', marginBottom: 4 },
  productDesc: { fontSize: 13, color: '#64748b' },
  tableWrapper: { overflowX: 'auto' },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 12 },
  th: { padding: '10px 12px', textAlign: 'left', background: '#f8fafc', fontWeight: 600, color: '#64748b', borderBottom: '1px solid #e2e8f0', whiteSpace: 'nowrap', textTransform: 'uppercase', fontSize: 11 },
  row: { borderBottom: '1px solid #e2e8f0', transition: 'background 0.2s' },
  td: { padding: '12px', color: '#334155', whiteSpace: 'nowrap' },
  imageTd: { padding: '8px', textAlign: 'center' },
  imagePlaceholder: { color: '#cbd5e1', fontSize: 12 },
  productImage: { maxWidth: 50, maxHeight: 50, objectFit: 'contain' },
  noteTd: { padding: '8px', width: 150 },
  noteInput: { width: '100%', padding: '6px', fontSize: 11, border: '1px solid #e2e8f0', borderRadius: 4, fontFamily: 'inherit', resize: 'vertical', minHeight: 40 },
  selectBtn: { padding: '6px 12px', border: 'none', borderRadius: 4, fontSize: 12, fontWeight: 600, cursor: 'pointer', transition: 'all 0.2s' },
  loading: { color: '#94a3b8', padding: 20, textAlign: 'center' },
  empty: { color: '#94a3b8', padding: 20, textAlign: 'center' },
};
