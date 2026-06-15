import { useState, useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import axios from 'axios';

export default function VendorPortal() {
  const [params] = useSearchParams();
  const token = params.get('token');
  const [state, setState] = useState('validating'); // validating | valid | invalid | expired | used | uploading | success | error
  const [factoryName, setFactoryName] = useState('');
  const [projectName, setProjectName] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const fileRef = useRef();

  useEffect(() => {
    if (!token) { setState('invalid'); return; }
    axios.get(`/api/vendor/validate/${token}`)
      .then(({ data }) => {
        setState(data.status === 'valid' ? 'valid' : data.status);
        setFactoryName(data.factory_name || '');
        setProjectName(data.project_name || '');
      })
      .catch(() => setState('invalid'));
  }, [token]);

  async function handleFile(file) {
    if (!file) return;
    if (!/\.(xlsx|xls)$/i.test(file.name)) {
      setUploadError('Please upload an Excel file (.xlsx or .xls)');
      return;
    }
    setUploadError('');
    setState('uploading');
    const form = new FormData();
    form.append('file', file);
    try {
      await axios.post(`/api/vendor/submit/${token}`, form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setState('success');
    } catch (err) {
      setUploadError(err.response?.data?.error || 'Upload failed. Please try again.');
      setState('valid');
    }
  }

  function onDrop(e) {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    handleFile(file);
  }

  if (state === 'validating') {
    return <Screen><p style={{ color: '#64748b' }}>Validating your upload link...</p></Screen>;
  }

  if (state === 'invalid') {
    return (
      <Screen>
        <StatusBox color="#fee2e2" border="#fca5a5" icon="&#x26A0;" title="Invalid Link"
          message="This upload link is invalid or has already been used." />
      </Screen>
    );
  }

  if (state === 'expired') {
    return (
      <Screen>
        <StatusBox color="#fff7ed" border="#fdba74" icon="&#x23F0;" title="Link Expired"
          message="This upload link has expired. Please contact Shalom International for a new link." />
      </Screen>
    );
  }

  if (state === 'used') {
    return (
      <Screen>
        <StatusBox color="#f0fdf4" border="#86efac" icon="&#x2713;" title="Already Submitted"
          message={`A quote from ${factoryName} has already been submitted with this link.`} />
      </Screen>
    );
  }

  if (state === 'success') {
    return (
      <Screen>
        <StatusBox color="#f0fdf4" border="#86efac" icon="&#x2713;" title="Quote Submitted!"
          message={`Thank you, ${factoryName}. Your quote has been received and is under review.`} />
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

        <div style={s.factoryBadge}>
          {factoryName && <><span style={{ color: '#64748b' }}>Factory:</span> <strong>{factoryName}</strong></>}
          {projectName && <><span style={{ color: '#64748b', marginLeft: 16 }}>Project:</span> <strong>{projectName}</strong></>}
        </div>

        <div
          style={{ ...s.dropzone, ...(dragOver ? s.dropzoneOver : {}) }}
          onDragOver={e => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          onClick={() => fileRef.current?.click()}
        >
          <input ref={fileRef} type="file" accept=".xlsx,.xls" style={{ display: 'none' }}
            onChange={e => handleFile(e.target.files[0])} />
          <div style={s.uploadIcon}>
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="1.5">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
              <polyline points="17 8 12 3 7 8"/>
              <line x1="12" y1="3" x2="12" y2="15"/>
            </svg>
          </div>
          <div style={s.dropText}>
            {state === 'uploading' ? 'Uploading...' : 'Drop your Excel file here'}
          </div>
          <div style={s.dropSub}>or click to browse — .xlsx or .xls, max 10MB</div>
        </div>

        {uploadError && <div style={s.errorBox}>{uploadError}</div>}

        <div style={s.instructions}>
          <div style={s.instTitle}>Your quote sheet should include:</div>
          <ul style={s.instList}>
            <li>Factory name in cell A1</li>
            <li>Style #, Factory Style, Description</li>
            <li>Packaging, Color / Scent</li>
            <li>MOQ, Price 1</li>
            <li>Units per 40" HQ Container</li>
            <li>Benchmark / reference link</li>
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

function StatusBox({ color, border, icon, title, message }) {
  return (
    <div style={{ background: color, border: `1px solid ${border}`, borderRadius: 12, padding: '36px 40px', maxWidth: 440, textAlign: 'center' }}>
      <div style={{ fontSize: 36, marginBottom: 12 }}>{icon}</div>
      <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 8 }}>{title}</div>
      <div style={{ color: '#475569', lineHeight: 1.6 }}>{message}</div>
    </div>
  );
}

const s = {
  card: { background: '#fff', borderRadius: 12, padding: 36, width: '100%', maxWidth: 520, boxShadow: '0 4px 24px rgba(0,0,0,0.08)' },
  header: { display: 'flex', alignItems: 'center', gap: 14, marginBottom: 20 },
  logoMark: { width: 40, height: 40, background: '#0f172a', color: '#fff', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, fontWeight: 700 },
  company: { fontSize: 16, fontWeight: 700, color: '#0f172a' },
  sub: { fontSize: 12, color: '#64748b' },
  factoryBadge: { background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 7, padding: '8px 14px', fontSize: 13, marginBottom: 20 },
  dropzone: { border: '2px dashed #cbd5e1', borderRadius: 10, padding: '40px 20px', textAlign: 'center', cursor: 'pointer', transition: 'all 0.15s', marginBottom: 12 },
  dropzoneOver: { borderColor: '#3b82f6', background: '#eff6ff' },
  uploadIcon: { marginBottom: 12, display: 'flex', justifyContent: 'center' },
  dropText: { fontSize: 15, fontWeight: 600, color: '#334155', marginBottom: 4 },
  dropSub: { fontSize: 12, color: '#94a3b8' },
  errorBox: { background: '#fef2f2', color: '#dc2626', padding: '8px 12px', borderRadius: 6, fontSize: 13, marginBottom: 12 },
  instructions: { background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, padding: '16px 18px' },
  instTitle: { fontSize: 13, fontWeight: 600, color: '#475569', marginBottom: 8 },
  instList: { paddingLeft: 18, color: '#64748b', fontSize: 13, lineHeight: 2 },
};
