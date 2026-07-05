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
      .catch(() => setLoading(false));
  }, [projectId, styleNum]);

  async function updateQuote(quoteId, updates) {
    setSaving(s => ({ ...s, [quoteId]: true }));
    try {
      const updated = await api.patch(`/projects/${projectId}/quotes/${quoteId}`, updates);
      setQuotes(qs => qs.map(q => q.id === quoteId ? updated.data : q));
    } catch (err) {
      alert('Save failed');
    }
    setSaving(s => ({ ...s, [quoteId]: false }));
  }

  function selectWinner(quoteId) {
    // Deselect all, select this one
    quotes.forEach(q => {
      if (q.is_selected_winner && q.id !== quoteId) {
        updateQuote(q.id, { is_selected_winner: false });
      }
    });
    updateQuote(quoteId, { is_selected_winner: true });
  }

  if (loading) return <div style={{ color: '#94a3b8', padding: 20 }}>Loading...</div>;
  if (!quotes.length) return <div style={{ color: '#94a3b8', padding: 20 }}>No quotes for this item.</div>;

  return (
    <div style={{ marginBottom: 32 }}>
      <div style={{ marginBottom: 16 }}>
        <h3 style={{ fontSize: 16, fontWeight: 700, color: '#0f172a', marginBottom: 4 }}>{styleNum}</h3>
        <p style={{ fontSize: 13, color: '#64748b' }}>{description || 'No description'}</p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.min(quotes.length, 5)}, 1fr)`, gap: 12 }}>
        {quotes.map((quote, idx) => {
          const tint = FACTORY_TINTS[tintKeys[idx % tintKeys.length]];
          const isWinner = quote.is_selected_winner;

          return (
            <div key={quote.id} style={{
              background: isWinner ? tint.bg : '#fff',
              border: isWinner ? `2px solid ${tint.text}` : '1px solid #e2e8f0',
              borderRadius: 10,
              padding: 16,
              position: 'relative',
            }}>
              {isWinner && (
                <div style={{
                  position: 'absolute',
                  top: 8,
                  right: 8,
                  fontSize: 20,
                }}>
                  ✓
                </div>
              )}

              {/* Factory name */}
              <div style={{ fontSize: 13, fontWeight: 700, color: tint.text, marginBottom: 12 }}>
                {quote.factory_name}
              </div>

              {/* Their Image */}
              {quote.image_path && (
                <div style={{
                  width: '100%',
                  height: 120,
                  background: '#f8fafc',
                  borderRadius: 6,
                  marginBottom: 12,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  overflow: 'hidden',
                }}>
                  <img
                    src={`/api/projects/${projectId}/quote-image/${quote.id}`}
                    style={{
                      maxWidth: '100%',
                      maxHeight: '100%',
                      objectFit: 'contain',
                    }}
                    onError={(e) => {
                      e.target.style.display = 'none';
                    }}
                  />
                </div>
              )}

              {/* Price */}
              <div style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: '#64748b', textTransform: 'uppercase', marginBottom: 4 }}>Price</div>
                <div style={{ fontSize: 16, fontWeight: 700, color: tint.text }}>
                  ${quote.price ? quote.price.toFixed(2) : '—'}
                </div>
              </div>

              {/* Color */}
              {quote.color && (
                <div style={{ marginBottom: 12 }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: '#64748b', textTransform: 'uppercase', marginBottom: 4 }}>Color</div>
                  <div style={{ fontSize: 12, color: '#334155' }}>{quote.color}</div>
                </div>
              )}

              {/* Notes */}
              <div style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: '#64748b', textTransform: 'uppercase', marginBottom: 4 }}>Notes</div>
                <textarea
                  value={editingNotes[quote.id] ?? quote.comparison_notes ?? ''}
                  onChange={(e) => setEditingNotes(n => ({ ...n, [quote.id]: e.target.value }))}
                  onBlur={() => {
                    if (editingNotes[quote.id] !== undefined) {
                      updateQuote(quote.id, { comparison_notes: editingNotes[quote.id] });
                      setEditingNotes(n => ({ ...n, [quote.id]: undefined }));
                    }
                  }}
                  placeholder="Add notes..."
                  style={{
                    width: '100%',
                    padding: '8px 10px',
                    border: '1px solid #e2e8f0',
                    borderRadius: 6,
                    fontSize: 12,
                    fontFamily: 'inherit',
                    resize: 'vertical',
                    minHeight: 60,
                  }}
                />
              </div>

              {/* Select button */}
              <button
                onClick={() => selectWinner(quote.id)}
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  background: isWinner ? tint.text : '#e2e8f0',
                  color: isWinner ? '#fff' : '#475569',
                  border: 'none',
                  borderRadius: 6,
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: 'pointer',
                  transition: 'all 0.2s',
                }}
                disabled={saving[quote.id]}
              >
                {saving[quote.id] ? 'Saving...' : isWinner ? 'Selected ✓' : 'Select'}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
