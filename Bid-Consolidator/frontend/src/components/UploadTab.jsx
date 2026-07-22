import { useState, useEffect, useRef } from 'react';
import api from '../utils/api';

export default function UploadTab() {
  const [projects, setProjects] = useState([]);
  const [selectedId, setSelectedId] = useState('');
  const [factories, setFactories] = useState([]);
  const [factory, setFactory] = useState('');
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const fileRef = useRef();

  useEffect(() => {
    api.get('/projects').then(r => {
      setProjects(r.data);
      if (r.data.length > 0) setSelectedId(String(r.data[0].id));
    }).catch(() => {});
    api.get('/factories').then(r => setFactories(r.data)).catch(() => {});
  }, []);

  async function handleFile(file) {
    if (!file) return;
    if (!/\.(xlsx|xls)$/i.test(file.name)) { setError('Only .xlsx or .xls files are accepted.'); return; }
    if (!selectedId) { setError('Please select a project first.'); return; }
    if (!factory.trim()) { setError('Please enter which factory this quote is from.'); return; }
    setError('');
    setResult(null);
    setUploading(true);
    const form = new FormData();
    form.append('file', file);
    form.append('factory_name', factory.trim());
    try {
      const { data } = await api.post(`/projects/${selectedId}/upload`, form);
      setResult(data);
    } catch (err) {
      setError(err.response?.data?.error || 'Upload failed');
    }
    setUploading(false);
  }

  return (
    <div>
      <h2 style={{ fontSize: 20, fontWeight: 700, color: '#0f172a', marginBottom: 6 }}>Upload Quote Sheet</h2>
      <p style={{ fontSize: 13, color: '#64748b', marginBottom: 20 }}>
        Upload a factory's Excel quote file. Each row becomes a quote in the selected project.
      </p>

      <div style={s.card}>
        <div style={s.field}>
          <label style={s.label}>Project</label>
          {projects.length === 0 ? (
            <div style={{ fontSize: 13, color: '#ef4444' }}>No projects yet — create one in the Projects tab first.</div>
          ) : (
            <select style={s.select} value={selectedId} onChange={e => setSelectedId(e.target.value)}>
              {projects.map(p => <option key={p.id} value={String(p.id)}>{p.name}</option>)}
            </select>
          )}
        </div>

        <div style={s.field}>
          <label style={s.label}>Factory *</label>
          <input style={s.select} type="text" list="upload-factories-list" placeholder="Which factory sent this quote?"
            value={factory} onChange={e => setFactory(e.target.value)} />
          <datalist id="upload-factories-list">
            {factories.map(f => <option key={f.id} value={f.name} />)}
          </datalist>
        </div>

        <div
          style={{ ...s.dropzone, ...(dragOver ? s.dropOver : {}), ...(uploading ? s.dropUploading : {}) }}
          onDragOver={e => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={e => { e.preventDefault(); setDragOver(false); handleFile(e.dataTransfer.files[0]); }}
          onClick={() => !uploading && fileRef.current?.click()}
        >
          <input ref={fileRef} type="file" accept=".xlsx,.xls" style={{ display: 'none' }}
            onChange={e => handleFile(e.target.files[0])} />
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="1.5" style={{ marginBottom: 10 }}>
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
            <polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>
          </svg>
          <div style={s.dropText}>{uploading ? 'Uploading...' : 'Drop Excel file here, or click to browse'}</div>
          <div style={s.dropSub}>.xlsx or .xls — max 10MB</div>
        </div>

        {error && <div style={s.errorBox}>{error}</div>}

        {result && (
          <div style={s.successBox}>
            <strong>✓ {result.count} quotes added</strong> from {result.factory_name}
          </div>
        )}

        <div style={s.hint}>
          <strong>How it works:</strong> pick the project and the factory, then drop their Excel quote.
          Each product row becomes a quote, its photos are pulled in as "Their Image", and re-uploading
          the same factory replaces their previous submission.
        </div>
      </div>
    </div>
  );
}

const s = {
  card: { background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, padding: 24, maxWidth: 600 },
  field: { marginBottom: 20 },
  label: { display: 'block', fontSize: 12, fontWeight: 600, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 7 },
  select: { padding: '8px 12px', border: '1px solid #e2e8f0', borderRadius: 6, fontSize: 13, outline: 'none', width: '100%' },
  dropzone: { border: '2px dashed #cbd5e1', borderRadius: 8, padding: '36px 20px', textAlign: 'center', cursor: 'pointer', transition: 'all 0.15s', marginBottom: 14 },
  dropOver: { borderColor: '#3b82f6', background: '#eff6ff' },
  dropUploading: { opacity: 0.6, cursor: 'default' },
  dropText: { fontSize: 14, fontWeight: 600, color: '#334155', marginBottom: 4 },
  dropSub: { fontSize: 12, color: '#94a3b8' },
  errorBox: { background: '#fef2f2', color: '#dc2626', padding: '10px 14px', borderRadius: 6, fontSize: 13, marginBottom: 12 },
  successBox: { background: '#f0fdf4', color: '#166534', padding: '10px 14px', borderRadius: 6, fontSize: 13, marginBottom: 12 },
  hint: { fontSize: 12, color: '#94a3b8', lineHeight: 1.7, borderTop: '1px solid #f1f5f9', paddingTop: 14 },
};
