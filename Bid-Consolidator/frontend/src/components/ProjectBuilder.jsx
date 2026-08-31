import { useState, useEffect, useRef } from 'react';
import api, { API_BASE } from '../utils/api';

// The CAD-driven project builder: upload design files (images/PDF), then create
// items that reference them (one CAD can back several items).
export default function ProjectBuilder({ projectId }) {
  const [cads, setCads] = useState([]);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [detecting, setDetecting] = useState(false);
  const [form, setForm] = useState({ style_num: '', description: '', moq: '', last_price: '', cad_id: '' });
  const [adding, setAdding] = useState(false);
  const [importingExcel, setImportingExcel] = useState(false);
  const fileRef = useRef();
  const excelRef = useRef();

  useEffect(() => { load(); }, [projectId]);

  async function load() {
    setLoading(true);
    try {
      const [c, i] = await Promise.all([
        api.get(`/projects/${projectId}/cads`),
        api.get(`/projects/${projectId}/items`),
      ]);
      setCads(c.data);
      setItems(i.data);
    } catch {}
    setLoading(false);
  }

  async function uploadCads(files) {
    if (!files || !files.length) return;
    setUploading(true);
    const fd = new FormData();
    [...files].forEach(f => fd.append('files', f));
    try {
      const { data } = await api.post(`/projects/${projectId}/cads`, fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      await load();
      if (data.ai) await detectItems(); // AI available → auto-split CADs into items
    } catch (err) {
      alert(err.response?.data?.error || 'Upload failed');
    }
    setUploading(false);
    if (fileRef.current) fileRef.current.value = '';
  }

  // Import items from a structured Excel sheet (classic outbound format).
  async function uploadExcel(files) {
    if (!files || !files.length) return;
    setImportingExcel(true);
    const fd = new FormData();
    fd.append('file', files[0]);
    try {
      await api.post(`/projects/${projectId}/items-from-excel`, fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      await load();
    } catch (err) {
      alert(err.response?.data?.error || 'Excel import failed');
    }
    setImportingExcel(false);
    if (excelRef.current) excelRef.current.value = '';
  }

  // Run the AI pass that reads each CAD and creates an item per detected product.
  async function detectItems() {
    setDetecting(true);
    try {
      await api.post(`/projects/${projectId}/detect-items`);
      await load();
    } catch (err) {
      alert(err.response?.data?.error || 'AI detection failed');
    }
    setDetecting(false);
  }

  async function deleteCad(id) {
    if (!confirm('Delete this design file? Items using it keep their image but lose the link.')) return;
    try {
      await api.delete(`/projects/${projectId}/cads/${id}`);
      setCads(cs => cs.filter(c => c.id !== id));
      load();
    } catch {}
  }

  async function addItem(e) {
    e.preventDefault();
    if (!form.style_num.trim() && !form.cad_id) { alert('Give the item a name or pick a design file.'); return; }
    setAdding(true);
    try {
      await api.post(`/projects/${projectId}/items`, { ...form, cad_id: form.cad_id || null });
      setForm({ style_num: '', description: '', moq: '', last_price: '', cad_id: '' });
      await load();
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to add item');
    }
    setAdding(false);
  }

  function setItemField(idx, key, value) {
    setItems(its => its.map(x => x.item_index === idx ? { ...x, [key]: value } : x));
  }
  async function saveItem(idx, patch) {
    try {
      await api.patch(`/projects/${projectId}/items/${idx}`, patch);
      if ('cad_id' in patch) load(); // refresh thumbnail
    } catch { alert('Save failed'); }
  }
  async function deleteItem(idx) {
    if (!confirm('Delete this item?')) return;
    try { await api.delete(`/projects/${projectId}/items/${idx}`); load(); } catch {}
  }

  const cadById = Object.fromEntries(cads.map(c => [c.id, c]));
  const isImg = (c) => c && (c.content_type || '').startsWith('image/');

  function CadThumb({ cadId, size = 54 }) {
    const c = cadById[cadId];
    if (!cadId || !c) return <div style={{ ...s.thumb, width: size, height: size, ...s.thumbEmpty }}>—</div>;
    if (isImg(c)) {
      return <img src={`${API_BASE}/projects/${projectId}/cad/${cadId}`} style={{ ...s.thumb, width: size, height: size, objectFit: 'contain' }}
        onError={(e) => { e.target.style.display = 'none'; }} title={c.original_name} />;
    }
    return <a href={`${API_BASE}/projects/${projectId}/cad/${cadId}`} target="_blank" rel="noreferrer"
      style={{ ...s.thumb, width: size, height: size, ...s.thumbPdf }} title={c.original_name}>PDF</a>;
  }

  return (
    <div style={s.wrap}>
      {/* ---- Design files ---- */}
      <div style={s.sectionHead}>
        <h4 style={s.h4}>Design Files (CADs) {cads.length > 0 && <span style={s.count}>{cads.length}</span>}</h4>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          {cads.length > 0 && (
            <button style={s.aiBtn} onClick={detectItems} disabled={detecting || uploading}>
              {detecting ? 'Analyzing…' : '✨ Detect items (AI)'}
            </button>
          )}
          <button style={s.addBtn2} onClick={() => fileRef.current?.click()} disabled={uploading || detecting}>
            {uploading ? 'Uploading…' : '+ Upload CADs'}
          </button>
          <button style={s.excelBtn} onClick={() => excelRef.current?.click()} disabled={importingExcel || uploading}>
            {importingExcel ? 'Importing…' : '+ Import Excel'}
          </button>
        </div>
        <input ref={fileRef} type="file" multiple
          accept=".png,.jpg,.jpeg,.gif,.webp,.bmp,.tif,.tiff,.heic,.heif,.svg,.pdf,.ai,.eps,.psd,image/*"
          style={{ display: 'none' }} onChange={e => uploadCads(e.target.files)} />
        <input ref={excelRef} type="file" accept=".xlsx,.xls"
          style={{ display: 'none' }} onChange={e => uploadExcel(e.target.files)} />
      </div>
      {detecting && <div style={s.aiBanner}>✨ Reading your designs and splitting them into items — this can take a moment per page…</div>}
      {loading ? <div style={s.muted}>Loading…</div> : cads.length === 0 ? (
        <div style={s.emptyBox}>Two ways to build the item list: <strong>Upload CADs</strong> (images/PDF — AI reads each and splits it into items, even several products on one sheet), or <strong>Import Excel</strong> (a structured sheet with one item per row + photos, like the classic outbound file). Everything lands in the table below to review and edit.</div>
      ) : (
        <div style={s.cadGrid}>
          {cads.map(c => (
            <div key={c.id} style={s.cadCard}>
              <CadThumb cadId={c.id} size={90} />
              <div style={s.cadName} title={c.original_name}>{c.original_name}</div>
              <button style={s.cadDel} onClick={() => deleteCad(c.id)} title="Delete">✕</button>
            </div>
          ))}
        </div>
      )}

      {/* ---- Items ---- */}
      <div style={{ ...s.sectionHead, marginTop: 22 }}>
        <h4 style={s.h4}>Items {items.length > 0 && <span style={s.count}>{items.length}</span>}</h4>
      </div>

      <form onSubmit={addItem} style={s.addItemRow}>
        <input style={{ ...s.input, flex: 1.4 }} placeholder="Item name / style" value={form.style_num}
          onChange={e => setForm(f => ({ ...f, style_num: e.target.value }))} />
        <input style={{ ...s.input, flex: 2 }} placeholder="Specs / description" value={form.description}
          onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
        <input style={{ ...s.input, width: 90 }} placeholder="MOQ" value={form.moq}
          onChange={e => setForm(f => ({ ...f, moq: e.target.value }))} />
        <input style={{ ...s.input, width: 110 }} placeholder="Target $" value={form.last_price}
          onChange={e => setForm(f => ({ ...f, last_price: e.target.value }))} />
        <select style={{ ...s.input, width: 150 }} value={form.cad_id}
          onChange={e => setForm(f => ({ ...f, cad_id: e.target.value }))}>
          <option value="">No design file</option>
          {cads.map(c => <option key={c.id} value={c.id}>{c.original_name}</option>)}
        </select>
        <button style={s.saveBtn} disabled={adding}>{adding ? '…' : '+ Add'}</button>
      </form>

      {items.length > 0 && (
        <div style={s.tableWrap}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
                <th style={s.th}>Design</th>
                <th style={s.th}>Name / Style</th>
                <th style={s.th}>Specs</th>
                <th style={s.th}>MOQ</th>
                <th style={s.th}>Target $</th>
                <th style={s.th}>Design file</th>
                <th style={s.th}></th>
              </tr>
            </thead>
            <tbody>
              {items.map(it => (
                <tr key={it.item_index} style={{ borderBottom: '1px solid #f1f5f9' }}>
                  <td style={{ ...s.td, width: 66 }}><CadThumb cadId={it.cad_id} /></td>
                  <td style={s.td}>
                    <input style={s.rowInput} value={it.style_num || ''}
                      onChange={e => setItemField(it.item_index, 'style_num', e.target.value)}
                      onBlur={e => saveItem(it.item_index, { style_num: e.target.value })} />
                  </td>
                  <td style={s.td}>
                    <input style={s.rowInput} value={it.description || ''}
                      onChange={e => setItemField(it.item_index, 'description', e.target.value)}
                      onBlur={e => saveItem(it.item_index, { description: e.target.value })} />
                  </td>
                  <td style={{ ...s.td, width: 80 }}>
                    <input style={s.rowInput} value={it.moq ?? ''}
                      onChange={e => setItemField(it.item_index, 'moq', e.target.value)}
                      onBlur={e => saveItem(it.item_index, { moq: e.target.value })} />
                  </td>
                  <td style={{ ...s.td, width: 90 }}>
                    <input style={s.rowInput} value={it.last_price ?? ''}
                      onChange={e => setItemField(it.item_index, 'last_price', e.target.value)}
                      onBlur={e => saveItem(it.item_index, { last_price: e.target.value })} />
                  </td>
                  <td style={{ ...s.td, width: 160 }}>
                    <select style={s.rowInput} value={it.cad_id || ''}
                      onChange={e => { const v = e.target.value || null; setItemField(it.item_index, 'cad_id', v); saveItem(it.item_index, { cad_id: v }); }}>
                      <option value="">None</option>
                      {cads.map(c => <option key={c.id} value={c.id}>{c.original_name}</option>)}
                    </select>
                  </td>
                  <td style={{ ...s.td, width: 40 }}>
                    <button style={s.delBtn} onClick={() => deleteItem(it.item_index)} title="Delete item">✕</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

const s = {
  wrap: { background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, padding: 18, marginBottom: 20 },
  sectionHead: { display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 },
  h4: { fontSize: 14, fontWeight: 700, color: '#0f172a', margin: 0 },
  count: { fontSize: 12, fontWeight: 600, color: '#64748b', background: '#f1f5f9', borderRadius: 10, padding: '1px 8px', marginLeft: 6 },
  muted: { color: '#94a3b8', fontSize: 13, padding: 8 },
  emptyBox: { color: '#64748b', fontSize: 13, background: '#f8fafc', border: '1px dashed #cbd5e1', borderRadius: 8, padding: 16 },
  addBtn: { marginLeft: 'auto', background: '#0f172a', color: '#fff', border: 'none', borderRadius: 6, padding: '7px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer' },
  addBtn2: { background: '#0f172a', color: '#fff', border: 'none', borderRadius: 6, padding: '7px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer' },
  aiBtn: { background: '#6366f1', color: '#fff', border: 'none', borderRadius: 6, padding: '7px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer' },
  excelBtn: { background: '#047857', color: '#fff', border: 'none', borderRadius: 6, padding: '7px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer' },
  aiBanner: { background: '#eef2ff', border: '1px solid #c7d2fe', color: '#3730a3', borderRadius: 8, padding: '10px 14px', fontSize: 13, marginBottom: 12 },
  cadGrid: { display: 'flex', flexWrap: 'wrap', gap: 12 },
  cadCard: { width: 110, border: '1px solid #e2e8f0', borderRadius: 8, padding: 8, position: 'relative', textAlign: 'center' },
  cadName: { fontSize: 10, color: '#64748b', marginTop: 6, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  cadDel: { position: 'absolute', top: 3, right: 5, background: 'none', border: 'none', color: '#cbd5e1', cursor: 'pointer', fontSize: 13 },
  thumb: { borderRadius: 6, border: '1px solid #e2e8f0', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: '#f8fafc' },
  thumbEmpty: { color: '#cbd5e1', fontSize: 12 },
  thumbPdf: { color: '#dc2626', fontWeight: 800, fontSize: 12, textDecoration: 'none', background: '#fef2f2', borderColor: '#fecaca' },
  addItemRow: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 },
  input: { padding: '8px 10px', border: '1px solid #e2e8f0', borderRadius: 6, fontSize: 13, outline: 'none', boxSizing: 'border-box' },
  saveBtn: { background: '#0284c7', color: '#fff', border: 'none', borderRadius: 6, padding: '8px 16px', fontSize: 13, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' },
  tableWrap: { border: '1px solid #e2e8f0', borderRadius: 8, overflow: 'hidden' },
  th: { padding: '8px 10px', textAlign: 'left', fontSize: 10.5, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '.04em' },
  td: { padding: '6px 10px', fontSize: 13, color: '#334155', verticalAlign: 'middle' },
  rowInput: { padding: '6px 8px', border: '1px solid transparent', borderRadius: 5, fontSize: 13, outline: 'none', width: '100%', boxSizing: 'border-box', background: 'transparent' },
  delBtn: { background: 'none', border: 'none', color: '#cbd5e1', cursor: 'pointer', fontSize: 15 },
};
