import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import axios from 'axios';
import { API_BASE } from '../utils/api';

export default function VendorPortal() {
  const [params] = useSearchParams();
  const token = params.get('token');

  const [status, setStatus] = useState(token ? 'validating' : 'no-token'); // validating|valid|invalid|expired|used|no-token
  const [factory, setFactory] = useState('');
  const [projectName, setProjectName] = useState('');
  const [projectId, setProjectId] = useState(null);
  const [division, setDivision] = useState(null);
  const [items, setItems] = useState([]);
  const [rows, setRows] = useState({});      // item_index -> { bidding, price, moq, lead_time }
  const [saving, setSaving] = useState({});   // item_index -> bool
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!token) return;
    axios.get(`${API_BASE}/vendor/items/${token}`)
      .then(({ data }) => {
        if (data.status !== 'valid') { setStatus(data.status); setFactory(data.factory_name || ''); return; }
        setStatus('valid');
        setFactory(data.factory_name);
        setProjectName(data.project_name);
        setProjectId(data.project_id);
        setDivision(data.division);
        setItems(data.items);
        const init = {};
        data.items.forEach(it => {
          const q = it.quote;
          init[it.item_index] = {
            bidding: !!q,
            price: q?.price ?? '',
            moq: q?.moq ?? '',
            lead_time: q?.lead_time ?? '',
          };
        });
        setRows(init);
      })
      .catch(() => setStatus('invalid'));
  }, [token]);

  function setField(idx, key, value) {
    setRows(r => ({ ...r, [idx]: { ...r[idx], [key]: value } }));
  }

  async function saveItem(idx, override) {
    const row = { ...rows[idx], ...(override || {}) };
    const item = items.find(i => i.item_index === idx);
    setSaving(s => ({ ...s, [idx]: true }));
    try {
      await axios.post(`${API_BASE}/vendor/quote-item/${token}`, {
        item_index: idx,
        bidding: row.bidding,
        price: row.price,
        moq: row.moq,
        lead_time: row.lead_time,
        style_num: item?.style_num,
        description: item?.description,
      });
    } catch (err) {
      setError(err.response?.data?.error || 'Save failed');
    }
    setSaving(s => ({ ...s, [idx]: false }));
  }

  function toggleBid(idx) {
    const next = !rows[idx]?.bidding;
    setField(idx, 'bidding', next);
    saveItem(idx, { bidding: next });
  }

  async function submitAll() {
    setSubmitting(true);
    try {
      await axios.post(`${API_BASE}/vendor/submit-quotes/${token}`, {});
      setSubmitted(true);
    } catch (err) {
      setError(err.response?.data?.error || 'Submit failed');
    }
    setSubmitting(false);
  }

  // ---- status screens ----
  if (status === 'no-token') {
    return <Screen><StatusBox color="#fff7ed" border="#fdba74" title="Invite Link Required" message="Please use the personal quote link we emailed you. If you don't have one, contact Shalom International and we'll send it over." /></Screen>;
  }
  if (status === 'validating') return <Screen><p style={{ color: '#64748b' }}>Loading your quote sheet…</p></Screen>;
  if (status === 'invalid') return <Screen><StatusBox color="#fee2e2" border="#fca5a5" title="Invalid Link" message="This quote link is invalid." /></Screen>;
  if (status === 'expired') return <Screen><StatusBox color="#fff7ed" border="#fdba74" title="Link Expired" message="This quote link has expired. Please contact Shalom International for a new one." /></Screen>;
  if (status === 'used') return <Screen><StatusBox color="#f0fdf4" border="#86efac" title="Already Submitted" message={`A quote from ${factory || 'your factory'} has already been submitted with this link.`} /></Screen>;
  if (submitted) return <Screen><StatusBox color="#f0fdf4" border="#86efac" title="Quote Submitted!" message={`Thank you, ${factory}. Your pricing has been received.`} /></Screen>;

  const biddingCount = Object.values(rows).filter(r => r?.bidding).length;
  const showPack = /^(gm|general)/i.test((division || '').trim()); // Inner/Master are GM-only for now

  return (
    <div style={s.page}>
      <div style={s.card}>
        <div style={s.header}>
          <div style={s.logoMark}>S</div>
          <div style={{ flex: 1 }}>
            <div style={s.company}>Shalom International — Supplier Quote Portal</div>
            <div style={s.sub}>{projectName} · <strong>{factory}</strong></div>
          </div>
          <div style={s.sealed}>🔒 Your pricing is private</div>
        </div>

        {items.length === 0 ? (
          <div style={{ color: '#94a3b8', padding: 24, textAlign: 'center' }}>No items to quote yet.</div>
        ) : (
          <>
            <div style={s.instructions}>
              Enter your best FOB pricing for the items you want. Tick <strong>Bid</strong> to quote an item, or leave it unticked to skip it. Your entries save automatically.
            </div>
            <div style={s.tableWrap}>
              <table style={s.table}>
                <thead>
                  <tr>
                    <th style={{ ...s.th, textAlign: 'center' }}>Bid?</th>
                    <th style={s.th}>Design</th>
                    <th style={s.th}>Item</th>
                    {showPack && <th style={s.th}>Inner #</th>}
                    {showPack && <th style={s.th}>Master #</th>}
                    <th style={s.th}>Your FOB $</th>
                    <th style={s.th}>MOQ</th>
                    <th style={s.th}>Lead time</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map(it => {
                    const r = rows[it.item_index] || {};
                    const on = !!r.bidding;
                    return (
                      <tr key={it.item_index} style={{ ...s.row, opacity: on ? 1 : 0.55 }}>
                        <td style={{ ...s.td, textAlign: 'center' }}>
                          <input type="checkbox" checked={on} onChange={() => toggleBid(it.item_index)} style={{ width: 16, height: 16 }} />
                        </td>
                        <td style={s.td}>
                          <img src={`${API_BASE}/projects/${projectId}/item-image/${it.item_index}/0`} style={s.thumb}
                            onError={(e) => { e.target.style.visibility = 'hidden'; }} />
                        </td>
                        <td style={s.td}>
                          <div style={{ fontWeight: 700 }}>{it.style_num || `Item ${it.item_index + 1}`}</div>
                          {it.description && <div style={s.itemDesc}>{it.description}</div>}
                        </td>
                        {showPack && <td style={s.td}>{it.inner_pack ?? '—'}</td>}
                        {showPack && <td style={s.td}>{it.master_pack ?? '—'}</td>}
                        <td style={s.td}>
                          <span style={s.dollar}>$</span>
                          <input type="number" step="0.01" disabled={!on} value={r.price ?? ''}
                            onChange={e => setField(it.item_index, 'price', e.target.value)}
                            onBlur={() => saveItem(it.item_index)} style={s.inp} placeholder="—" />
                        </td>
                        <td style={s.td}>
                          <input type="number" disabled={!on} value={r.moq ?? ''}
                            onChange={e => setField(it.item_index, 'moq', e.target.value)}
                            onBlur={() => saveItem(it.item_index)} style={s.inp} placeholder="—" />
                        </td>
                        <td style={s.td}>
                          <input type="text" disabled={!on} value={r.lead_time ?? ''}
                            onChange={e => setField(it.item_index, 'lead_time', e.target.value)}
                            onBlur={() => saveItem(it.item_index)} style={{ ...s.inp, width: 90 }} placeholder="e.g. 45 days" />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {error && <div style={s.errorBox}>{error}</div>}

            <div style={s.footer}>
              <div style={{ fontSize: 13, color: '#64748b' }}>Quoting <strong>{biddingCount}</strong> of {items.length} items · saved automatically</div>
              <button style={{ ...s.submitBtn, opacity: submitting ? 0.7 : 1 }} disabled={submitting || biddingCount === 0} onClick={submitAll}>
                {submitting ? 'Submitting…' : 'Submit my quote →'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Screen({ children }) {
  return <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f8fafc', padding: 20 }}>{children}</div>;
}
function StatusBox({ color, border, title, message }) {
  return (
    <div style={{ background: color, border: `1px solid ${border}`, borderRadius: 12, padding: '36px 40px', maxWidth: 460, textAlign: 'center' }}>
      <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 8 }}>{title}</div>
      <div style={{ color: '#475569', lineHeight: 1.6 }}>{message}</div>
    </div>
  );
}

const s = {
  page: { minHeight: '100vh', background: '#f8fafc', padding: '28px 20px', display: 'flex', justifyContent: 'center' },
  card: { background: '#fff', borderRadius: 12, width: '100%', maxWidth: 960, boxShadow: '0 4px 24px rgba(0,0,0,0.08)', overflow: 'hidden' },
  header: { display: 'flex', alignItems: 'center', gap: 12, padding: '16px 20px', background: '#0f172a', color: '#fff' },
  logoMark: { width: 34, height: 34, background: '#fff', color: '#0f172a', borderRadius: 7, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, fontWeight: 800 },
  company: { fontSize: 15, fontWeight: 700 },
  sub: { fontSize: 12, color: '#94a3b8', marginTop: 1 },
  sealed: { fontSize: 12, background: '#064e3b', color: '#6ee7b7', padding: '5px 12px', borderRadius: 20, whiteSpace: 'nowrap' },
  instructions: { fontSize: 13, color: '#475569', padding: '14px 20px', background: '#f8fafc', borderBottom: '1px solid #e2e8f0', lineHeight: 1.5 },
  tableWrap: { overflowX: 'auto' },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 13 },
  th: { padding: '10px 12px', textAlign: 'left', background: '#f8fafc', fontWeight: 700, color: '#64748b', borderBottom: '1px solid #e2e8f0', textTransform: 'uppercase', fontSize: 10.5, letterSpacing: '.04em', whiteSpace: 'nowrap' },
  row: { borderBottom: '1px solid #f1f5f9', transition: 'opacity .15s' },
  td: { padding: '10px 12px', color: '#334155', verticalAlign: 'middle' },
  thumb: { width: 60, height: 52, objectFit: 'contain', borderRadius: 6, border: '1px solid #e2e8f0', background: '#f8fafc' },
  itemDesc: { fontSize: 11, color: '#64748b', marginTop: 2, maxWidth: 320 },
  dollar: { color: '#94a3b8', marginRight: 3 },
  inp: { width: 84, padding: '7px 9px', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: 13, outline: 'none' },
  errorBox: { background: '#fef2f2', color: '#dc2626', padding: '8px 12px', margin: '0 20px', borderRadius: 6, fontSize: 13 },
  footer: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', background: '#f8fafc', borderTop: '1px solid #e2e8f0', gap: 12, flexWrap: 'wrap' },
  submitBtn: { background: '#0284c7', color: '#fff', border: 'none', borderRadius: 8, padding: '11px 22px', fontSize: 14, fontWeight: 700, cursor: 'pointer' },
};
