import { useState, useEffect, useRef } from 'react';
import api from '../utils/api';
import ComparisonItemView from './ComparisonItemView';

export default function CompareTab() {
  const [projects, setProjects] = useState([]);
  const [selectedId, setSelectedId] = useState('');
  const [styles, setStyles] = useState([]);
  const [deleted, setDeleted] = useState([]);
  const [cadCount, setCadCount] = useState(0);
  const [project, setProject] = useState(null);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [detecting, setDetecting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [adding, setAdding] = useState(false);
  const [newItem, setNewItem] = useState({ style_num: '', description: '', moq: '', last_price: '' });
  const cadRef = useRef();
  const excelRef = useRef();

  useEffect(() => {
    api.get('/projects').then(r => {
      setProjects(r.data);
      if (r.data.length > 0 && !selectedId) setSelectedId(String(r.data[0].id));
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
      api.get(`/projects/${selectedId}/cads`).catch(() => ({ data: [] })),
    ])
      .then(([s, d, c]) => { setStyles(s.data); setDeleted(d.data); setCadCount(c.data.length); })
      .catch(err => { console.error('Failed to load compare sheet:', err); setStyles([]); })
      .finally(() => setLoading(false));
  }

  async function uploadCads(files) {
    if (!files || !files.length) return;
    setUploading(true);
    const fd = new FormData();
    [...files].forEach(f => fd.append('files', f));
    try {
      const { data } = await api.post(`/projects/${selectedId}/cads`, fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      if (data.ai) await detectItems(); else reload();
    } catch (err) { alert(err.response?.data?.error || 'Upload failed'); }
    setUploading(false);
    if (cadRef.current) cadRef.current.value = '';
  }

  async function detectItems() {
    setDetecting(true);
    try { await api.post(`/projects/${selectedId}/detect-items`); reload(); }
    catch (err) { alert(err.response?.data?.error || 'AI detection failed'); }
    setDetecting(false);
  }

  async function uploadExcel(files) {
    if (!files || !files.length) return;
    setImporting(true);
    const fd = new FormData();
    fd.append('file', files[0]);
    try { await api.post(`/projects/${selectedId}/items-from-excel`, fd, { headers: { 'Content-Type': 'multipart/form-data' } }); reload(); }
    catch (err) { alert(err.response?.data?.error || 'Excel import failed'); }
    setImporting(false);
    if (excelRef.current) excelRef.current.value = '';
  }

  async function addItem(e) {
    e.preventDefault();
    if (!newItem.style_num.trim() && !newItem.description.trim()) { alert('Give the item a name or specs.'); return; }
    setAdding(true);
    try {
      await api.post(`/projects/${selectedId}/items`, newItem);
      setNewItem({ style_num: '', description: '', moq: '', last_price: '' });
      reload();
    } catch (err) { alert(err.response?.data?.error || 'Failed to add item'); }
    setAdding(false);
  }

  async function restoreItem(itemIndex) {
    try { await api.post(`/projects/${selectedId}/items/${itemIndex}/restore`); reload(); }
    catch { alert('Restore failed'); }
  }

  const busy = uploading || detecting || importing;

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 20, flexWrap: 'wrap' }}>
        <h2 style={{ fontSize: 20, fontWeight: 700, color: '#0f172a', margin: 0 }}>Compare Sheet</h2>
        <select style={s.select} value={selectedId} onChange={e => setSelectedId(e.target.value)}>
          <option value="">— Select project —</option>
          {projects.map(p => <option key={p.id} value={String(p.id)}>{p.name}</option>)}
        </select>
      </div>

      {!selectedId ? (
        <div style={s.empty}>Select a project to build and compare its quotes.</div>
      ) : (
        <>
          {/* ---- Build toolbar: this is where the sheet gets built ---- */}
          <div style={s.toolbar}>
            <div style={{ fontSize: 13, color: '#475569' }}>
              Build the sheet: <strong>upload CADs</strong> (AI reads &amp; splits them) or <strong>import a sorted Excel</strong>. Then fill any field the file didn’t have — right on the sheet.
            </div>
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {cadCount > 0 && (
                <button style={s.aiBtn} onClick={detectItems} disabled={busy}>{detecting ? 'Analyzing…' : '✨ Detect items (AI)'}</button>
              )}
              <button style={s.cadBtn} onClick={() => cadRef.current?.click()} disabled={busy}>{uploading ? 'Uploading…' : '+ Upload CADs'}</button>
              <button style={s.excelBtn} onClick={() => excelRef.current?.click()} disabled={busy}>{importing ? 'Importing…' : '+ Import Excel'}</button>
            </div>
            <input ref={cadRef} type="file" multiple
              accept=".png,.jpg,.jpeg,.gif,.webp,.bmp,.tif,.tiff,.heic,.heif,.svg,.pdf,.ai,.eps,.psd,image/*"
              style={{ display: 'none' }} onChange={e => uploadCads(e.target.files)} />
            <input ref={excelRef} type="file" accept=".xlsx,.xls" style={{ display: 'none' }} onChange={e => uploadExcel(e.target.files)} />
          </div>
          {detecting && <div style={s.aiBanner}>✨ Reading your designs and splitting them into items — this can take a moment per page…</div>}

          {/* ---- Manual add row ---- */}
          <form onSubmit={addItem} style={s.addRow}>
            <input style={{ ...s.input, flex: 1.4 }} placeholder="Item name / style" value={newItem.style_num}
              onChange={e => setNewItem(n => ({ ...n, style_num: e.target.value }))} />
            <input style={{ ...s.input, flex: 2 }} placeholder="Specs / description" value={newItem.description}
              onChange={e => setNewItem(n => ({ ...n, description: e.target.value }))} />
            <input style={{ ...s.input, width: 90 }} placeholder="MOQ" value={newItem.moq}
              onChange={e => setNewItem(n => ({ ...n, moq: e.target.value }))} />
            <input style={{ ...s.input, width: 100 }} placeholder="Target $" value={newItem.last_price}
              onChange={e => setNewItem(n => ({ ...n, last_price: e.target.value }))} />
            <button style={s.addBtn} disabled={adding}>{adding ? '…' : '+ Add item'}</button>
          </form>

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

          {loading ? (
            <div style={{ color: '#94a3b8', padding: 24 }}>Loading...</div>
          ) : styles.length === 0 ? (
            <div style={s.empty}>No items yet. Upload CADs or import an Excel sheet above to build this project.</div>
          ) : (
            <div>
              <div style={s.note}>
                Fields in each item’s header are your targets/specs — edit them inline. Factory quotes appear as rows below each item; click <strong>Select</strong> to mark a winner.
              </div>
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
                  onChanged={reload}
                />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

const s = {
  select: { padding: '7px 12px', border: '1px solid #e2e8f0', borderRadius: 7, fontSize: 13, outline: 'none', minWidth: 220 },
  empty: { color: '#94a3b8', textAlign: 'center', padding: 60 },
  toolbar: { display: 'flex', alignItems: 'center', gap: 12, background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, padding: 14, marginBottom: 14, flexWrap: 'wrap' },
  cadBtn: { background: '#0f172a', color: '#fff', border: 'none', borderRadius: 6, padding: '8px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer' },
  aiBtn: { background: '#6366f1', color: '#fff', border: 'none', borderRadius: 6, padding: '8px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer' },
  excelBtn: { background: '#047857', color: '#fff', border: 'none', borderRadius: 6, padding: '8px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer' },
  aiBanner: { background: '#eef2ff', border: '1px solid #c7d2fe', color: '#3730a3', borderRadius: 8, padding: '10px 14px', fontSize: 13, marginBottom: 14 },
  addRow: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 16 },
  input: { padding: '8px 11px', border: '1px solid #e2e8f0', borderRadius: 6, fontSize: 13, outline: 'none', boxSizing: 'border-box' },
  addBtn: { background: '#0284c7', color: '#fff', border: 'none', borderRadius: 6, padding: '8px 16px', fontSize: 13, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' },
  note: { background: '#f0f9ff', border: '1px solid #bae6fd', borderRadius: 8, padding: '12px 14px', marginBottom: 24, fontSize: 13, color: '#0369a1' },
  trash: { background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: '10px 14px', marginBottom: 20, fontSize: 13, color: '#7f1d1d', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
  restoreBtn: { background: '#fff', border: '1px solid #fca5a5', color: '#b91c1c', borderRadius: 6, padding: '4px 10px', fontSize: 12, fontWeight: 600, cursor: 'pointer' },
};
