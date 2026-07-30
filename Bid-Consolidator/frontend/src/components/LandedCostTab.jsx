import { useState, useEffect } from 'react';
import api from '../utils/api';

// duty inputs are stored as whole-number percentages (e.g. 7.2 means 7.2%)
function calcLanded({ fob_price, total_fob, units_per_container, base_duty_pct, addl_duty_pct, etc_amt }) {
  const fob        = parseFloat(fob_price)          || 0;
  const totalFob   = parseFloat(total_fob)          || 0;
  const units      = parseFloat(units_per_container)|| 0;
  const etcAmt     = parseFloat(etc_amt)            || 0.10;
  const baseDuty   = (parseFloat(base_duty_pct)     || 0) / 100;
  const addlDuty   = (parseFloat(addl_duty_pct)     || 0) / 100;

  const true_fob       = totalFob > 0 ? totalFob / 1.12 : 0;  // True FOB = Total FOB ÷ 1.12
  const vsr_fob        = true_fob;
  const commission     = totalFob > 0 ? totalFob - true_fob : 0; // Commission = Total FOB − True FOB
  const duty           = fob * (baseDuty + addlDuty);
  const freight_per_unit = units > 0 ? 7500 / units : null;
  const freight_pct    = (freight_per_unit !== null && fob > 0) ? freight_per_unit / fob : null;
  const landed         = true_fob + commission + duty + (freight_per_unit || 0) + etcAmt;

  return { vsr_fob, commission, duty, freight_per_unit, freight_pct, landed };
}

function fmt(n, dec = 2) {
  if (n === null || n === undefined || isNaN(n) || n === '') return '—';
  return '$' + Number(n).toFixed(dec);
}
function fmtPct(n) {
  if (n === null || n === undefined || isNaN(n)) return '—';
  return Number(n).toFixed(1) + '%';
}

export default function LandedCostTab() {
  const [projects, setProjects] = useState([]);
  const [selectedId, setSelectedId] = useState('');
  const [quotes, setQuotes]     = useState([]);
  const [rows, setRows]         = useState([]);
  const [saving, setSaving]     = useState({});
  const [saved, setSaved]       = useState({});
  const [loading, setLoading]   = useState(true);

  useEffect(() => {
    api.get('/projects').then(r => {
      setProjects(r.data);
      if (r.data.length > 0) {
        const id = String(r.data[0].id);
        setSelectedId(id);
      }
    }).catch(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!selectedId) return;
    setLoading(true);
    api.get(`/projects/${selectedId}/quotes`)
      .then(r => {
        const qs = r.data
          .filter(q => q.is_selected_winner)
          .map(q => ({
          ...q,
          _total_fob:           q.total_fob           ?? q.price ?? '',
          _base_duty_pct:       q.base_duty_pct       ?? 0,
          _addl_duty_pct:       q.addl_duty_pct       ?? 0,
          _units_per_container: q.units_per_container ?? '',
          _sell_price:          q.sell_price          ?? '',
          _retail_price:        q.retail_price        ?? '',
          _etc_amt:             q.etc_amt             ?? 0.10,
        }));
        setQuotes(qs);
        setRows(qs);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [selectedId]);

  function update(id, field, value) {
    setRows(rs => rs.map(r => r.id === id ? { ...r, [field]: value } : r));
  }

  async function saveRow(row) {
    setSaving(s => ({ ...s, [row.id]: true }));
    try {
      await api.patch(`/projects/${selectedId}/quotes/${row.id}`, {
        total_fob:            parseFloat(row._total_fob)            || null,
        base_duty_pct:        parseFloat(row._base_duty_pct)        || 0,
        addl_duty_pct:        parseFloat(row._addl_duty_pct)        || 0,
        units_per_container:  parseInt(row._units_per_container)    || null,
        sell_price:           parseFloat(row._sell_price)           || null,
        retail_price:         parseFloat(row._retail_price)         || null,
        etc_amt:              parseFloat(row._etc_amt)              ?? 0.10,
      });
      setSaved(s => ({ ...s, [row.id]: true }));
      setTimeout(() => setSaved(s => ({ ...s, [row.id]: false })), 2000);
    } catch { alert('Save failed'); }
    setSaving(s => ({ ...s, [row.id]: false }));
  }

  const inp = (color) => ({
    width: '72px', padding: '3px 5px', border: '1px solid #cbd5e1',
    borderRadius: 4, fontSize: 12, background: color, textAlign: 'right',
  });

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <h2 style={{ fontSize: 20, fontWeight: 700, color: '#0f172a' }}>Landed Cost Calculator</h2>
        {projects.length > 0 && (
          <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 10 }}>
            <label style={{ fontSize: 13, fontWeight: 500, color: '#475569' }}>Project:</label>
            <select
              value={selectedId}
              onChange={e => setSelectedId(e.target.value)}
              style={{ padding: '8px 12px', border: '1px solid #e2e8f0', borderRadius: 6, fontSize: 13, outline: 'none' }}
            >
              {projects.map(p => (
                <option key={p.id} value={String(p.id)}>{p.name}</option>
              ))}
            </select>
          </div>
        )}
      </div>

      {loading ? (
        <div style={{ color: '#94a3b8', padding: 24 }}>Loading...</div>
      ) : rows.length === 0 ? (
        <div style={{ color: '#94a3b8', textAlign: 'center', padding: 40 }}>No winners selected yet. Pick the winning factory for each item in the Compare tab.</div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ borderCollapse: 'collapse', fontSize: 12, minWidth: 1600 }}>
            <thead>
              <tr>
                <th colSpan={3} style={th('#e2e8f0')}>Product</th>
                <th colSpan={6} style={th('#FFFFCC')}>DO NOT FILL — AUTO MARGIN PURPOSES ONLY</th>
                <th colSpan={2} style={th('#CCFFCC')}>SIC Margins</th>
                <th colSpan={2} style={th('#e5e7eb')}>Retail Margins</th>
                <th colSpan={9} style={th('#FFFF00')}>ONLY ENTER HIGHLIGHTED IN VSR</th>
              </tr>
              <tr>
                <th style={th2('#f8fafc')}>Factory</th>
                <th style={th2('#f8fafc')}>Style #</th>
                <th style={th2('#f8fafc')}>Description</th>
                {/* auto section */}
                <th style={th2('#FFFFCC')}>FOB Price</th>
                <th style={th2('#FFFFCC')}>Commission</th>
                <th style={th2('#FFFFCC')}>Duty</th>
                <th style={th2('#FFFFCC')}>Freight/Unit</th>
                <th style={th2('#FFFFCC')}>Etc.</th>
                <th style={th2('#FFFFCC')}>Landed Each</th>
                {/* green */}
                <th style={th2('#CCFFCC')}>Sell</th>
                <th style={th2('#CCFFCC')}>Margin %</th>
                {/* gray */}
                <th style={th2('#f3f4f6')}>Retail $</th>
                <th style={th2('#f3f4f6')}>IMU %</th>
                {/* yellow VSR inputs */}
                <th style={th2('#FFFF00')}>Total FOB</th>
                <th style={th2('#FFFF00')}>VSR FOB</th>
                <th style={th2('#FFFF00')}>Commission<br/><span style={{ fontWeight: 400 }}>(12% fixed)</span></th>
                <th style={th2('#FFFF00')}>Duty %</th>
                <th style={th2('#FFFF00')}>Addl Duty %</th>
                <th style={th2('#FFFF00')}>Total Duty</th>
                <th style={th2('#FFFF00')}>Units/40"</th>
                <th style={th2('#FFFF00')}>Freight/Unit</th>
                <th style={th2('#FFFF00')}>Freight %</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(row => {
                const fobPrice = parseFloat(row._total_fob) || parseFloat(row.price) || 0;
                const calc = calcLanded({
                  fob_price:           fobPrice,
                  total_fob:           parseFloat(row._total_fob) || fobPrice,
                  units_per_container: row._units_per_container,
                  base_duty_pct:       row._base_duty_pct,
                  addl_duty_pct:       row._addl_duty_pct,
                  etc_amt:             row._etc_amt,
                });
                const sell   = parseFloat(row._sell_price)   || 0;
                const retail = parseFloat(row._retail_price) || 0;
                const margin = sell   > 0 ? (sell - calc.landed) / sell     : null;
                const imu    = retail > 0 ? (retail - sell)    / retail     : null;
                const totalDutyPct = (parseFloat(row._base_duty_pct) || 0) + (parseFloat(row._addl_duty_pct) || 0);

                return (
                  <tr key={row.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                    <td style={td('#fff')}>{row.factory_name}</td>
                    <td style={td('#fff')}><strong>{row.item_style_num || row.style_num}</strong></td>
                    <td style={{ ...td('#fff'), maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.item_description || row.description}</td>
                    {/* auto section — all derived from VSR inputs */}
                    <td style={td('#FFFFCC')}>{calc.vsr_fob > 0 ? fmt(calc.vsr_fob) : fmt(row.price)}</td>
                    <td style={td('#FFFFCC')}>{fmt(calc.commission)}</td>
                    <td style={td('#FFFFCC')}>{fmt(calc.duty)}</td>
                    <td style={td('#FFFFCC')}>{calc.freight_per_unit !== null ? fmt(calc.freight_per_unit) : '—'}</td>
                    <td style={td('#FFFFCC')}>{fmt(parseFloat(row._etc_amt))}</td>
                    <td style={{ ...td('#FFFFCC'), fontWeight: 700 }}>{fmt(calc.landed)}</td>
                    {/* green */}
                    <td style={td('#CCFFCC')}>
                      <input style={inp('#CCFFCC')} type="number" step="0.01"
                        value={row._sell_price} onChange={e => update(row.id, '_sell_price', e.target.value)}
                        onBlur={() => saveRow(row)} />
                    </td>
                    <td style={td('#CCFFCC')}>{margin !== null ? fmtPct(margin * 100) : '—'}</td>
                    {/* gray */}
                    <td style={td('#f3f4f6')}>
                      <input style={inp('#f3f4f6')} type="number" step="0.01"
                        value={row._retail_price} onChange={e => update(row.id, '_retail_price', e.target.value)}
                        onBlur={() => saveRow(row)} />
                    </td>
                    <td style={td('#f3f4f6')}>{imu !== null ? fmtPct(imu * 100) : '—'}</td>
                    {/* yellow VSR inputs */}
                    <td style={td('#FFFF00')}>
                      <input style={inp('#FFFF00')} type="number" step="0.01"
                        value={row._total_fob} onChange={e => update(row.id, '_total_fob', e.target.value)}
                        onBlur={() => saveRow(row)} />
                    </td>
                    <td style={td('#FFFF00')}>{calc.vsr_fob > 0 ? fmt(calc.vsr_fob) : '—'}</td>
                    <td style={{ ...td('#FFFF00'), color: '#64748b', fontWeight: 600 }}>12%</td>
                    <td style={td('#FFFF00')}>
                      <input style={inp('#FFFF00')} type="number" step="0.1" placeholder="0"
                        value={row._base_duty_pct} onChange={e => update(row.id, '_base_duty_pct', e.target.value)}
                        onBlur={() => saveRow(row)} />
                    </td>
                    <td style={td('#FFFF00')}>
                      <input style={inp('#FFFF00')} type="number" step="0.1" placeholder="0"
                        value={row._addl_duty_pct} onChange={e => update(row.id, '_addl_duty_pct', e.target.value)}
                        onBlur={() => saveRow(row)} />
                    </td>
                    <td style={td('#FFFF00')}>{fmtPct(totalDutyPct)}</td>
                    <td style={td('#FFFF00')}>
                      <input style={inp('#FFFF00')} type="number"
                        value={row._units_per_container} onChange={e => update(row.id, '_units_per_container', e.target.value)}
                        onBlur={() => saveRow(row)} />
                    </td>
                    <td style={td('#FFFF00')}>{calc.freight_per_unit !== null ? fmt(calc.freight_per_unit) : '—'}</td>
                    <td style={td('#FFFF00')}>{calc.freight_pct !== null ? fmtPct(calc.freight_pct * 100) : '—'}</td>
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

function th(bg) {
  return { padding: '7px 10px', background: bg, textAlign: 'center', fontSize: 11, fontWeight: 700, color: '#374151', border: '1px solid #e5e7eb', whiteSpace: 'nowrap' };
}
function th2(bg) {
  return { padding: '6px 10px', background: bg, textAlign: 'center', fontSize: 11, fontWeight: 600, color: '#374151', border: '1px solid #e5e7eb', whiteSpace: 'nowrap' };
}
function td(bg) {
  return { padding: '6px 8px', background: bg, border: '1px solid #e5e7eb', whiteSpace: 'nowrap', textAlign: 'right' };
}
