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

// One product on the compare sheet. The HEADER holds the item-level fields you
// build/edit (name, specs, targets, and GM-only Inner/Master) — anything a CAD
// can't provide you type in here. The TABLE below shows each factory's offer.
export default function ComparisonItemView({ projectId, itemIndex, styleNum, description, imageCount = 0, lastPrice, moq, innerPack, masterPack, division, onChanged }) {
  const showPack = isGM(division);
  const [quotes, setQuotes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editingNotes, setEditingNotes] = useState({});
  const [saving, setSaving] = useState({});

  // Editable item-level fields (local copies; saved on blur).
  const [nameVal, setNameVal] = useState(styleNum ?? '');
  const [specsVal, setSpecsVal] = useState(description ?? '');
  const [priceVal, setPriceVal] = useState(lastPrice ?? '');
  const [moqVal, setMoqVal] = useState(moq ?? '');
  const [innerVal, setInnerVal] = useState(innerPack ?? '');
  const [masterVal, setMasterVal] = useState(masterPack ?? '');

  useEffect(() => { setNameVal(styleNum ?? ''); }, [styleNum]);
  useEffect(() => { setSpecsVal(description ?? ''); }, [description]);
  useEffect(() => { setPriceVal(lastPrice ?? ''); }, [lastPrice]);
  useEffect(() => { setMoqVal(moq ?? ''); }, [moq]);
  useEffect(() => { setInnerVal(innerPack ?? ''); }, [innerPack]);
  useEffect(() => { setMasterVal(masterPack ?? ''); }, [masterPack]);

  useEffect(() => {
    api.get(`/projects/${projectId}/comparison/${itemIndex}`)
      .then(r => { setQuotes(r.data); setLoading(false); })
      .catch(() => { setQuotes([]); setLoading(false); });
  }, [projectId, itemIndex]);

  // Save one item-level field. text|num|int control coercion.
  async function saveField(field, raw, kind = 'text') {
    let value = raw;
    if (raw === '' || raw == null) value = null;
    else if (kind === 'int') value = parseInt(raw);
    else if (kind === 'num') value = parseFloat(raw);
    try { await api.patch(`/projects/${projectId}/items/${itemIndex}`, { [field]: value }); }
    catch (err) { console.error(field + ' save failed:', err); }
  }

  async function updateQuote(quoteId, updates) {
    setSaving(s => ({ ...s, [quoteId]: true }));
    try {
      const { data } = await api.patch(`/projects/${projectId}/quotes/${quoteId}`, updates);
      setQuotes(qs => qs.map(q => q.id === quoteId ? data : q));
    } catch { alert('Save failed'); }
    setSaving(s => ({ ...s, [quoteId]: false }));
  }

  function toggleWinner(quote) {
    if (quote.is_selected_winner) { updateQuote(quote.id, { is_selected_winner: false }); return; }
    quotes.forEach(q => { if (q.is_selected_winner && q.id !== quote.id) updateQuote(q.id, { is_selected_winner: false }); });
    updateQuote(quote.id, { is_selected_winner: true });
  }

  async function removeItem() {
    if (!confirm('Remove this item? You can restore it from the "Deleted items" bar at the top.')) return;
    try { await api.delete(`/projects/${projectId}/items/${itemIndex}`); onChanged && onChanged(); }
    catch { alert('Delete failed'); }
  }

  if (loading) return <div style={s.loading}>Loading...</div>;

  return (
    <div style={s.container}>
      {/* ---- Item header: everything you build/edit lives here ---- */}
      <div style={s.productHeader}>
        <img src={`${API_BASE}/projects/${projectId}/item-image/${itemIndex}/0`} style={s.headerImg}
          onError={(e) => { e.target.style.visibility = 'hidden'; }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <input style={s.nameInput} value={nameVal} placeholder="Item name / style"
            onChange={e => setNameVal(e.target.value)} onBlur={() => saveField('style_num', nameVal)} />
          <textarea style={s.specsInput} value={specsVal} placeholder="Specs / description"
            onChange={e => setSpecsVal(e.target.value)} onBlur={() => saveField('description', specsVal)} rows={2} />
          <div style={s.targetRow}>
            <label style={s.targetField}>
              <span style={s.targetLabel}>Target $</span>
              <input type="number" step="0.01" style={s.targetInput} value={priceVal} placeholder="—"
                onChange={e => setPriceVal(e.target.value)} onBlur={() => saveField('last_price', priceVal, 'num')} />
            </label>
            <label style={s.targetField}>
              <span style={s.targetLabel}>Target MOQ</span>
              <input type="number" style={s.targetInput} value={moqVal} placeholder="—"
                onChange={e => setMoqVal(e.target.value)} onBlur={() => saveField('moq', moqVal, 'int')} />
            </label>
            {showPack && (
              <>
                <label style={s.targetField}>
                  <span style={s.targetLabel}>Inner #</span>
                  <input type="number" style={s.targetInput} value={innerVal} placeholder="—"
                    onChange={e => setInnerVal(e.target.value)} onBlur={() => saveField('inner_pack', innerVal, 'int')} />
                </label>
                <label style={s.targetField}>
                  <span style={s.targetLabel}>Master #</span>
                  <input type="number" style={s.targetInput} value={masterVal} placeholder="—"
                    onChange={e => setMasterVal(e.target.value)} onBlur={() => saveField('master_pack', masterVal, 'int')} />
                </label>
              </>
            )}
          </div>
        </div>
        <button style={s.removeItemBtn} onClick={removeItem} title="Remove this item">✕ Remove</button>
      </div>

      {/* ---- Factory offers ---- */}
      <div style={s.tableWrapper}>
        <table style={s.table}>
          <thead>
            <tr>
              <th style={s.th}>Factory</th>
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
                <td style={s.td}><span style={{ color: '#94a3b8', fontStyle: 'italic' }}>Awaiting quotes</span></td>
                <td style={s.imageTd}><div style={s.imagePlaceholder}>—</div></td>
                <td style={s.td}>—</td><td style={s.td}>$—</td><td style={s.td}>—</td>
                <td style={s.noteTd}></td><td style={s.td}></td>
              </tr>
            )}
            {quotes.map((quote, idx) => {
              const tint = FACTORY_TINTS[tintKeys[idx % tintKeys.length]];
              const isWinner = quote.is_selected_winner;
              return (
                <tr key={quote.id} style={{ ...s.row, background: isWinner ? tint.bg : '#fff' }}>
                  <td style={s.td}><div style={{ fontWeight: 700, color: tint.text }}>{quote.factory_name}</div></td>
                  <td style={s.imageTd}>
                    {quote.image_path ? (
                      <img src={`${API_BASE}/projects/${projectId}/quote-image/${quote.id}`} style={s.productImage}
                        onError={(e) => { e.target.style.display = 'none'; }} />
                    ) : <div style={s.imagePlaceholder}>—</div>}
                  </td>
                  <td style={s.td}>{quote.moq != null ? Number(quote.moq).toLocaleString() : '—'}</td>
                  <td style={{ ...s.td, fontWeight: 700, color: tint.text }}>${quote.price ? parseFloat(quote.price).toFixed(2) : '—'}</td>
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
                      placeholder="Notes..." style={s.noteInput}
                    />
                  </td>
                  <td style={s.td}>
                    <button onClick={() => toggleWinner(quote)}
                      title={isWinner ? 'Winner — click to unselect' : 'Select as winner'}
                      style={{ ...s.selectBtn, background: isWinner ? tint.text : '#e2e8f0', color: isWinner ? '#fff' : '#475569' }}
                      disabled={saving[quote.id]}>
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
  productHeader: { background: '#f8fafc', borderBottom: '1px solid #e2e8f0', padding: '16px', display: 'flex', gap: 14, alignItems: 'flex-start' },
  headerImg: { width: 96, height: 96, objectFit: 'contain', borderRadius: 8, border: '1px solid #e2e8f0', background: '#fff', flexShrink: 0 },
  nameInput: { width: '100%', fontSize: 16, fontWeight: 700, color: '#0f172a', border: '1px solid transparent', borderRadius: 6, padding: '4px 6px', background: 'transparent', boxSizing: 'border-box', outline: 'none' },
  specsInput: { width: '100%', fontSize: 13, color: '#475569', border: '1px solid #e2e8f0', borderRadius: 6, padding: '6px 8px', marginTop: 4, boxSizing: 'border-box', outline: 'none', resize: 'vertical', fontFamily: 'inherit' },
  targetRow: { display: 'flex', gap: 16, marginTop: 10, flexWrap: 'wrap' },
  targetField: { display: 'flex', flexDirection: 'column', gap: 3 },
  targetLabel: { fontSize: 10.5, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '.04em' },
  targetInput: { width: 96, padding: '6px 8px', fontSize: 13, border: '1px solid #e2e8f0', borderRadius: 6, outline: 'none' },
  removeItemBtn: { background: '#fff', border: '1px solid #fca5a5', color: '#b91c1c', borderRadius: 6, padding: '5px 10px', fontSize: 12, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0 },
  tableWrapper: { overflowX: 'auto' },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 12 },
  th: { padding: '10px 12px', textAlign: 'left', background: '#f8fafc', fontWeight: 600, color: '#64748b', borderBottom: '1px solid #e2e8f0', whiteSpace: 'nowrap', textTransform: 'uppercase', fontSize: 11 },
  row: { borderBottom: '1px solid #e2e8f0', transition: 'background 0.2s' },
  td: { padding: '14px 12px', color: '#334155', whiteSpace: 'nowrap', verticalAlign: 'middle' },
  imageTd: { padding: '10px', textAlign: 'center', verticalAlign: 'middle' },
  imagePlaceholder: { color: '#cbd5e1', fontSize: 12 },
  productImage: { maxWidth: 90, maxHeight: 90, objectFit: 'contain' },
  noteTd: { padding: '10px', width: 160, verticalAlign: 'middle' },
  noteInput: { width: '100%', padding: '6px', fontSize: 11, border: '1px solid #e2e8f0', borderRadius: 4, fontFamily: 'inherit', resize: 'vertical', minHeight: 40 },
  selectBtn: { padding: '8px 14px', border: 'none', borderRadius: 4, fontSize: 12, fontWeight: 600, cursor: 'pointer', transition: 'all 0.2s' },
  loading: { color: '#94a3b8', padding: 20, textAlign: 'center' },
};
