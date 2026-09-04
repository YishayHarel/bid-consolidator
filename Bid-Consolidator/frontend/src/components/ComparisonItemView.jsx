import { useState, useEffect } from 'react';
import api, { API_BASE } from '../utils/api';

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

// Inner/Master pack columns are a GM-division format for now.
const isGM = (division) => /^(gm|general)/i.test(String(division || '').trim());

export default function ComparisonItemView({ projectId, itemIndex, styleNum, description, imageCount = 0, lastPrice, moq, innerPack, masterPack, division, onDeleted }) {
  const showPack = isGM(division);
  const [quotes, setQuotes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editingNotes, setEditingNotes] = useState({});
  const [saving, setSaving] = useState({});
  const [lastPriceVal, setLastPriceVal] = useState(lastPrice ?? '');
  const [innerVal, setInnerVal] = useState(innerPack ?? '');
  const [masterVal, setMasterVal] = useState(masterPack ?? '');
  const [descExpanded, setDescExpanded] = useState(false);

  useEffect(() => { setLastPriceVal(lastPrice ?? ''); }, [lastPrice]);
  useEffect(() => { setInnerVal(innerPack ?? ''); }, [innerPack]);
  useEffect(() => { setMasterVal(masterPack ?? ''); }, [masterPack]);

  useEffect(() => {
    api.get(`/projects/${projectId}/comparison/${itemIndex}`)
      .then(r => {
        setQuotes(r.data);
        setLoading(false);
      })
      .catch(err => {
        console.error('Failed to load comparison:', err);
        setLoading(false);
      });
  }, [projectId, itemIndex]);

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

  function toggleWinner(quote) {
    // Clicking the winner again clears it; otherwise select it and clear others.
    if (quote.is_selected_winner) {
      updateQuote(quote.id, { is_selected_winner: false });
      return;
    }
    quotes.forEach(q => {
      if (q.is_selected_winner && q.id !== quote.id) {
        updateQuote(q.id, { is_selected_winner: false });
      }
    });
    updateQuote(quote.id, { is_selected_winner: true });
  }

  async function saveLastPrice() {
    try {
      await api.patch(`/projects/${projectId}/items/${itemIndex}`, {
        last_price: lastPriceVal === '' ? null : parseFloat(lastPriceVal),
      });
    } catch (err) {
      console.error('Last Price save failed:', err);
    }
  }

  async function saveItemField(field, value) {
    try {
      await api.patch(`/projects/${projectId}/items/${itemIndex}`, { [field]: value === '' ? null : parseInt(value) });
    } catch (err) {
      console.error(field + ' save failed:', err);
    }
  }

  async function removeItem() {
    if (!confirm('Remove this item? You can restore it from the "Deleted items" bar at the top.')) return;
    try {
      await api.delete(`/projects/${projectId}/items/${itemIndex}`);
      onDeleted && onDeleted();
    } catch { alert('Delete failed'); }
  }

  const ourImageCols = Array.from({ length: imageCount || 0 }, (_, k) => k);

  // Description is clipped to one line by default; click toggles it to wrap
  // and expand downward.
  const descCell = (
    <td style={s.descTd}>
      <div
        onClick={() => setDescExpanded(v => !v)}
        style={descExpanded ? s.descExpanded : s.descClamped}
        title={descExpanded ? 'Click to collapse' : 'Click to expand'}
      >
        {description || '—'}
      </div>
    </td>
  );

  if (loading) return <div style={s.loading}>Loading...</div>;

  return (
    <div style={s.container}>
      <div style={s.productHeader}>
        <div>
          <div style={s.productTitle}>{styleNum || `Item ${itemIndex}`}</div>
          <div style={s.productDesc}>{description}</div>
        </div>
        <button style={s.removeItemBtn} onClick={removeItem} title="Remove this item">✕ Remove item</button>
      </div>

      <div style={s.tableWrapper}>
        <table style={s.table}>
          <thead>
            <tr>
              <th style={s.th}>Factory</th>
              {ourImageCols.map(k => <th key={k} style={s.th}>Our Image #{k + 1}</th>)}
              <th style={s.th}>Description</th>
              <th style={s.th}>Last Price</th>
              {showPack && <th style={s.th}>Inner #</th>}
              {showPack && <th style={s.th}>Master #</th>}
              <th style={s.th}>Their Image</th>
              <th style={s.th}>MOQ</th>
              <th style={s.th}>Price</th>
              <th style={s.th}>Lead Time</th>
              <th style={s.th}>Notes</th>
              <th style={s.th}>Select</th>
            </tr>
          </thead>
          <tbody>
            {quotes.length === 0 && (
              <tr style={{ ...s.row, background: '#fff' }}>
                <td style={s.td}><div style={{ color: '#94a3b8', fontStyle: 'italic' }}>Awaiting quotes</div></td>
                {ourImageCols.map(k => (
                  <td key={k} style={s.imageTd}>
                    <img src={`${API_BASE}/projects/${projectId}/item-image/${itemIndex}/${k}`} style={s.productImage}
                      onError={(e) => { e.target.style.display = 'none'; }} />
                  </td>
                ))}
                {descCell}
                <td style={s.priceTd}>
                  <input type="number" step="0.01" placeholder="—" value={lastPriceVal}
                    onChange={(e) => setLastPriceVal(e.target.value)} onBlur={saveLastPrice} style={s.lastPriceInput} />
                </td>
                {showPack && (
                  <>
                    <td style={s.priceTd}>
                      <input type="number" placeholder="—" value={innerVal}
                        onChange={(e) => setInnerVal(e.target.value)} onBlur={() => saveItemField('inner_pack', innerVal)} style={s.lastPriceInput} />
                    </td>
                    <td style={s.priceTd}>
                      <input type="number" placeholder="—" value={masterVal}
                        onChange={(e) => setMasterVal(e.target.value)} onBlur={() => saveItemField('master_pack', masterVal)} style={s.lastPriceInput} />
                    </td>
                  </>
                )}
                <td style={s.imageTd}><div style={s.imagePlaceholder}>—</div></td>
                <td style={s.td}>{moq != null ? Number(moq).toLocaleString() : '—'}</td>
                <td style={s.td}>$—</td>
                <td style={s.td}>—</td>
                <td style={s.noteTd}></td>
                <td style={s.td}></td>
              </tr>
            )}
            {quotes.map((quote, idx) => {
              const tint = FACTORY_TINTS[tintKeys[idx % tintKeys.length]];
              const isWinner = quote.is_selected_winner;

              return (
                <tr key={quote.id} style={{ ...s.row, background: isWinner ? tint.bg : '#fff' }}>
                  <td style={s.td}>
                    <div style={{ fontWeight: 700, color: tint.text }}>{quote.factory_name}</div>
                  </td>
                  {ourImageCols.map(k => (
                    <td key={k} style={s.imageTd}>
                      <img
                        src={`${API_BASE}/projects/${projectId}/item-image/${itemIndex}/${k}`}
                        style={s.productImage}
                        onError={(e) => { e.target.style.display = 'none'; }}
                      />
                    </td>
                  ))}
                  {descCell}
                  <td style={s.priceTd}>
                    <input
                      type="number"
                      step="0.01"
                      placeholder="—"
                      value={lastPriceVal}
                      onChange={(e) => setLastPriceVal(e.target.value)}
                      onBlur={saveLastPrice}
                      style={s.lastPriceInput}
                    />
                  </td>
                  {showPack && (
                    <>
                      <td style={s.priceTd}>
                        <input type="number" placeholder="—" value={innerVal}
                          onChange={(e) => setInnerVal(e.target.value)} onBlur={() => saveItemField('inner_pack', innerVal)} style={s.lastPriceInput} />
                      </td>
                      <td style={s.priceTd}>
                        <input type="number" placeholder="—" value={masterVal}
                          onChange={(e) => setMasterVal(e.target.value)} onBlur={() => saveItemField('master_pack', masterVal)} style={s.lastPriceInput} />
                      </td>
                    </>
                  )}
                  <td style={s.imageTd}>
                    {quote.image_path ? (
                      <img
                        src={`${API_BASE}/projects/${projectId}/quote-image/${quote.id}`}
                        style={s.productImage}
                        onError={(e) => { e.target.style.display = 'none'; }}
                      />
                    ) : (
                      <div style={s.imagePlaceholder}>—</div>
                    )}
                  </td>
                  <td style={s.td}>{quote.moq != null ? Number(quote.moq).toLocaleString() : (moq != null ? Number(moq).toLocaleString() : '—')}</td>
                  <td style={{ ...s.td, fontWeight: 700, color: tint.text }}>
                    ${quote.price ? parseFloat(quote.price).toFixed(2) : '—'}
                  </td>
                  <td style={s.td}>{quote.lead_time || '—'}</td>
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
                      onClick={() => toggleWinner(quote)}
                      title={isWinner ? 'Winner — click to unselect' : 'Select as winner'}
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
  productHeader: { background: '#f8fafc', borderBottom: '1px solid #e2e8f0', padding: '16px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 },
  removeItemBtn: { background: '#fff', border: '1px solid #fca5a5', color: '#b91c1c', borderRadius: 6, padding: '5px 10px', fontSize: 12, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0 },
  productTitle: { fontSize: 16, fontWeight: 700, color: '#0f172a', marginBottom: 4 },
  productDesc: { fontSize: 13, color: '#64748b' },
  tableWrapper: { overflowX: 'auto' },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 12 },
  th: { padding: '10px 12px', textAlign: 'left', background: '#f8fafc', fontWeight: 600, color: '#64748b', borderBottom: '1px solid #e2e8f0', whiteSpace: 'nowrap', textTransform: 'uppercase', fontSize: 11 },
  row: { borderBottom: '1px solid #e2e8f0', transition: 'background 0.2s' },
  td: { padding: '16px 12px', color: '#334155', whiteSpace: 'nowrap', verticalAlign: 'middle' },
  imageTd: { padding: '10px', textAlign: 'center', verticalAlign: 'middle' },
  imagePlaceholder: { color: '#cbd5e1', fontSize: 12 },
  productImage: { maxWidth: 110, maxHeight: 110, objectFit: 'contain' },
  descTd: { padding: '16px 12px', color: '#334155', verticalAlign: 'top', maxWidth: 240 },
  descClamped: { maxWidth: 240, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', cursor: 'pointer' },
  descExpanded: { maxWidth: 240, whiteSpace: 'normal', wordBreak: 'break-word', lineHeight: 1.5, cursor: 'pointer' },
  priceTd: { padding: '10px 12px', verticalAlign: 'middle' },
  lastPriceInput: { width: 80, padding: '6px 8px', fontSize: 12, border: '1px solid #e2e8f0', borderRadius: 4, textAlign: 'right' },
  noteTd: { padding: '10px', width: 160, verticalAlign: 'middle' },
  noteInput: { width: '100%', padding: '6px', fontSize: 11, border: '1px solid #e2e8f0', borderRadius: 4, fontFamily: 'inherit', resize: 'vertical', minHeight: 48 },
  selectBtn: { padding: '8px 14px', border: 'none', borderRadius: 4, fontSize: 12, fontWeight: 600, cursor: 'pointer', transition: 'all 0.2s' },
  loading: { color: '#94a3b8', padding: 20, textAlign: 'center' },
  empty: { color: '#94a3b8', padding: 20, textAlign: 'center' },
};
