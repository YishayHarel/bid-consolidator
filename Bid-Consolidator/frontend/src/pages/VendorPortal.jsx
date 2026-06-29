import { useState, useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import axios from 'axios';

export default function VendorPortal() {
  const [params] = useSearchParams();
  const token = params.get('token');

  // Token mode
  const [tokenStatus, setTokenStatus] = useState(token ? 'validating' : null);
  const [tokenFactory, setTokenFactory] = useState('');
  const [tokenProjectId, setTokenProjectId] = useState(null);

  // Open mode
  const [factoryName, setFactoryName] = useState('');
  const [projects, setProjects] = useState([]);
  const [selectedProject, setSelectedProject] = useState('');

  // Shared
  const [uploadState, setUploadState] = useState('idle');
  const [uploadError, setUploadError] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef();

  useEffect(() => {
    if (token) {
      axios.get(`/api/vendor/validate/${token}`)
        .then(({ data }) => {
          if (data.status === 'valid') {
            setTokenStatus('valid');
            setTokenFactory(data.factory_name);
            setTokenProjectId(data.project_id);
          } else {
            setTokenStatus(data.status);
          }
        })
        .catch(() => setTokenStatus('invalid'));
    } else {
      axios.get('/api/vendor/open-projects')
        .then(({ data }) => {
          setProjects(data);
          if (data.length > 0) setSelectedProject(String(data[0].id));
        })
        .catch(() => {});
    }
  }, [token]);

  async function handleFile(file) {
    if (!file) return;
    if (!/\.(xlsx|xls)$/i.test(file.name)) {
      setUploadError('Please upload an Excel file (.xlsx or .xls)');
      return;
    }
    if (!token && !factoryName.trim()) {
      setUploadError('Please enter your factory name first.');
      return;
    }
    if (!token && !selectedProject) {
      setUploadError('Please select a project.');
      return;
    }
    setUploadError('');
    setUploadState('uploading');

    const form = new FormData();
    form.append('file', file);

    try {
      if (token) {
        await axios.post(`/api/vendor/submit/${token}`, form);
      } else {
        form.append('factory_name', factoryName.trim());
        form.append('project_id', selectedProject);
        await axios.post('/api/vendor/submit-open', form);
      }
      setUploadState('success');
    } catch (err) {
      setUploadError(err.response?.data?.error || 'Upload failed. Please try again.');
      setUploadState('idle');
    }
  }

  function onDrop(e) {
    e.preventDefault();
    setDragOver(false);
    handleFile(e.dataTransfer.files[0]);
  }

  const displayName = token ? tokenFactory : factoryName;

  if (token && tokenStatus === 'validating') {
    return <Screen><p style={{ color: '#64748b' }}>Validating link...</p></Screen>;
  }
  if (token && tokenStatus === 'invalid') {
    return <Screen><StatusBox color="#fee2e2" border="#fca5a5" title="Invalid Link" message="This upload link is invalid." /></Screen>;
  }
  if (token && tokenStatus === 'expired') {
    return <Screen><StatusBox color="#fff7ed" border="#fdba74" title="Link Expired" message="This upload link has expired. Please contact Shalom International for a new link." /></Screen>;
  }
  if (token && tokenStatus === 'used') {
    return <Screen><StatusBox color="#f0fdf4" border="#86efac" title="Already Submitted" message={`A quote from ${tokenFactory} has already been submitted with this link.`} /></Screen>;
  }

  if (uploadState === 'success') {
    return (
      <Screen>
        <StatusBox color="#f0fdf4" border="#86efac"
          title="Quote Submitted!"
          message={`Thank you${displayName ? `, ${displayName}` : ''}. Your quote has been received.`} />
      </Screen>
    );
  }

  return (
    <Screen>
      <div style={s.card}>
        <div style={s.header}>
          <div style={s.logoMark}>S</div>
          <div>
            <div style={s.company}>Shalom International</div>
            <div style={s.sub}>Factory Quote Upload</div>
          </div>
        </div>

        {token && tokenFactory && (
          <div style={s.factoryBadge}>
            <span style={{ color: '#64748b' }}>Factory:</span> <strong>{tokenFactory}</strong>
          </div>
        )}

        {!token && (
          <>
            <div style={s.fieldWrap}>
              <label style={s.label}>Your Factory Name</label>
              <input style={s.input} type="text" placeholder="e.g. Sunrise Manufacturing Co."
                value={factoryName} onChange={e => setFactoryName(e.target.value)}
                disabled={uploadState === 'uploading'} />
            </div>
            <div style={s.fieldWrap}>
              <label style={s.label}>Project</label>
              {projects.length === 0 ? (
                <div style={{ fontSize: 13, color: '#94a3b8' }}>No open projects available.</div>
              ) : (
                <select style={s.input} value={selectedProject} onChange={e => setSelectedProject(e.target.value)}>
                  {projects.map(p => <option key={p.id} value={String(p.id)}>{p.name}</option>)}
                </select>
              )}
            </div>
          </>
        )}

        <div
          style={{ ...s.dropzone, ...(dragOver ? s.dropzoneOver : {}), ...(uploadState === 'uploading' ? s.dropzoneUploading : {}) }}
          onDragOver={e => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          onClick={() => uploadState !== 'uploading' && fileRef.current?.click()}
        >
          <input ref={fileRef} type="file" accept=".xlsx,.xls" style={{ display: 'none' }}
            onChange={e => handleFile(e.target.files[0])} />
          <div style={s.uploadIcon}>
            <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="1.5">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
              <polyline points="17 8 12 3 7 8"/>
              <line x1="12" y1="3" x2="12" y2="15"/>
            </svg>
          </div>
          <div style={s.dropText}>{uploadState === 'uploading' ? 'Uploading...' : 'Drop your Excel file here'}</div>
          <div style={s.dropSub}>or click to browse — .xlsx or .xls, max 10MB</div>
        </div>

        {uploadError && <div style={s.errorBox}>{uploadError}</div>}

        <div style={s.instructions}>
          <div style={s.instTitle}>Your quote sheet should include:</div>
          <ul style={s.instList}>
            <li>Factory name in cell A1</li>
            <li>Style #, Description, Category</li>
            <li>Color, Scent / Fragrance, Packaging</li>
            <li>MOQ, Price 1</li>
            <li>Benchmark Product Link (optional)</li>
          </ul>
        </div>
      </div>
    </Screen>
  );
}

function Screen({ children }) {
  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f8fafc', padding: 20 }}>
      {children}
    </div>
  );
}

function StatusBox({ color, border, title, message }) {
  return (
    <div style={{ background: color, border: `1px solid ${border}`, borderRadius: 12, padding: '36px 40px', maxWidth: 440, textAlign: 'center' }}>
      <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 8 }}>{title}</div>
      <div style={{ color: '#475569', lineHeight: 1.6 }}>{message}</div>
    </div>
  );
}

const s = {
  card: { background: '#fff', borderRadius: 12, padding: 36, width: '100%', maxWidth: 500, boxShadow: '0 4px 24px rgba(0,0,0,0.08)' },
  header: { display: 'flex', alignItems: 'center', gap: 14, marginBottom: 24 },
  logoMark: { width: 40, height: 40, background: '#0f172a', color: '#fff', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, fontWeight: 700 },
  company: { fontSize: 16, fontWeight: 700, color: '#0f172a' },
  sub: { fontSize: 12, color: '#64748b' },
  factoryBadge: { background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 7, padding: '8px 14px', fontSize: 13, marginBottom: 20 },
  fieldWrap: { marginBottom: 16 },
  label: { display: 'block', fontSize: 13, fontWeight: 500, color: '#475569', marginBottom: 6 },
  input: { width: '100%', padding: '9px 12px', border: '1px solid #e2e8f0', borderRadius: 7, fontSize: 14, outline: 'none', boxSizing: 'border-box' },
  dropzone: { border: '2px dashed #cbd5e1', borderRadius: 10, padding: '36px 20px', textAlign: 'center', cursor: 'pointer', transition: 'all 0.15s', marginBottom: 12 },
  dropzoneOver: { borderColor: '#3b82f6', background: '#eff6ff' },
  dropzoneUploading: { opacity: 0.6, cursor: 'default' },
  uploadIcon: { marginBottom: 10, display: 'flex', justifyContent: 'center' },
  dropText: { fontSize: 15, fontWeight: 600, color: '#334155', marginBottom: 4 },
  dropSub: { fontSize: 12, color: '#94a3b8' },
  errorBox: { background: '#fef2f2', color: '#dc2626', padding: '8px 12px', borderRadius: 6, fontSize: 13, marginBottom: 12 },
  instructions: { background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, padding: '14px 16px' },
  instTitle: { fontSize: 13, fontWeight: 600, color: '#475569', marginBottom: 6 },
  instList: { paddingLeft: 18, color: '#64748b', fontSize: 13, lineHeight: 2, margin: 0 },
};
