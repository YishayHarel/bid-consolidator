import { useState, useEffect, useRef } from 'react';
import api from '../utils/api';

const STATUS_COLORS = {
  pending: { bg: '#fef9c3', color: '#854d0e' },
  reviewed: { bg: '#dbeafe', color: '#1e40af' },
  approved: { bg: '#dcfce7', color: '#166534' },
  rejected: { bg: '#fee2e2', color: '#991b1b' },
};

export default function SubmissionsTab() {
  const [submissions, setSubmissions] = useState([]);
  const [projects, setProjects] = useState([]);
  const [filterProject, setFilterProject] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadProject, setUploadProject] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef();

  useEffect(() => {
    api.get('/projects').then(r => setProjects(r.data)).catch(() => {});
    loadSubmissions();
  }, []);

  async function loadSubmissions() {
    setLoading(true);
    try {
      const params = {};
      if (filterProject) params.project_id = filterProject;
      if (filterStatus) params.status = filterStatus;
      const { data } = await api.get('/submissions', { params });
      setSubmissions(data);
    } catch {}
    setLoading(false);
  }

  useEffect(() => { loadSubmissions(); }, [filterProject, filterStatus]);

  async function handleUpload(file) {
    if (!file || !/\.(xlsx|xls)$/i.test(file.name)) return;
    setUploading(true);
    const form = new FormData();
    form.append('file', file);
    if (uploadProject) form.append('project_id', uploadProject);
    try {
      await api.post('/submissions/upload', form);
      loadSubmissions();
    } catch (err) {
      alert(err.response?.data?.error || 'Upload failed');
    }
    setUploading(false);
  }

  async function updateStatus(id, status) {
    try {
      await api.patch(`/submissions/${id}`, { status });
      setSubmissions(s => s.map(x => x.id === id ? { ...x, status } : x));
    } catch {}
  }

  return (
    <div>
      <div style={s.topBar}>
        <h2 style={s.title}>Submissions</h2>
        <div style={s.filters}>
          <select style={s.select} value={filterProject} onChange={e => setFilterProject(e.target.value)}>
            <option value="">All Projects</option>
            {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <select style={s.select} value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
            <option value="">All Statuses</option>
            <option value="pending">Pending</option>
            <option value="reviewed">Reviewed</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
          </select>
        </div>
      </div>

      <div style={s.uploadSection}>
        <div style={s.uploadLeft}>
          <select style={s.select} value={uploadProject} onChange={e => setUploadProject(e.target.value)}>
            <option value="">No project</option>
            {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
        <div
          style={{ ...s.dropzone, ...(dragOver ? s.dropOver : {}) }}
          onDragOver={e => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={e => { e.preventDefault(); setDragOver(false); handleUpload(e.dataTransfer.files[0]); }}
          onClick={() => fileRef.current?.click()}
        >
          <input ref={fileRef} type="file" accept=".xlsx,.xls" style={{ display: 'none' }}
            onChange={e => handleUpload(e.target.files[0])} />
          {uploading ? 'Uploading...' : 'Upload Excel quote sheet'}
        </div>
      </div>

      {loading ? (
        <div style={{ color: '#94a3b8', padding: 24 }}>Loading...</div>
      ) : submissions.length === 0 ? (
        <div style={s.empty}>No submissions found.</div>
      ) : (
        <div style={s.tableWrap}>
          <table style={s.table}>
            <thead>
              <tr>
                {['Factory', 'Project', 'Division', 'File', 'Products', 'Submitted', 'Status', 'Actions'].map(h => (
                  <th key={h} style={s.th}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {submissions.map(sub => {
                const sc = STATUS_COLORS[sub.status] || STATUS_COLORS.pending;
                return (
                  <tr key={sub.id} style={s.tr}>
                    <td style={s.td}><strong>{sub.factory_name}</strong></td>
                    <td style={s.td}>{sub.project_name || '—'}</td>
                    <td style={s.td}>{sub.division || '—'}</td>
                    <td style={s.td}><span style={s.fileName}>{sub.file_name}</span></td>
                    <td style={s.td}>{sub.product_count}</td>
                    <td style={s.td}>{new Date(sub.submitted_at).toLocaleDateString()}</td>
                    <td style={s.td}>
                      <span style={{ ...s.badge, background: sc.bg, color: sc.color }}>
                        {sub.status}
                      </span>
                    </td>
                    <td style={s.td}>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button style={s.approveBtn} onClick={() => updateStatus(sub.id, 'approved')}>Approve</button>
                        <button style={s.rejectBtn} onClick={() => updateStatus(sub.id, 'rejected')}>Reject</button>
                      </div>
                    </td>
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

const s = {
  topBar: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 },
  title: { fontSize: 20, fontWeight: 700, color: '#0f172a' },
  filters: { display: 'flex', gap: 8 },
  select: { padding: '7px 10px', border: '1px solid #e2e8f0', borderRadius: 6, fontSize: 13, background: '#fff', outline: 'none' },
  uploadSection: { display: 'flex', gap: 10, marginBottom: 20, alignItems: 'center' },
  uploadLeft: {},
  dropzone: { border: '1.5px dashed #cbd5e1', borderRadius: 8, padding: '10px 20px', cursor: 'pointer', fontSize: 13, color: '#64748b', background: '#fff', transition: 'all 0.15s' },
  dropOver: { borderColor: '#3b82f6', background: '#eff6ff', color: '#1d4ed8' },
  empty: { color: '#94a3b8', padding: '40px 0', textAlign: 'center' },
  tableWrap: { overflowX: 'auto', background: '#fff', borderRadius: 10, border: '1px solid #e2e8f0' },
  table: { width: '100%', borderCollapse: 'collapse' },
  th: { padding: '11px 14px', textAlign: 'left', fontSize: 12, fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.04em', borderBottom: '1px solid #e2e8f0', background: '#f8fafc' },
  tr: { borderBottom: '1px solid #f1f5f9' },
  td: { padding: '12px 14px', fontSize: 13, color: '#334155' },
  badge: { padding: '2px 8px', borderRadius: 10, fontSize: 11, fontWeight: 600, textTransform: 'capitalize' },
  fileName: { color: '#64748b', fontSize: 12, fontFamily: 'monospace' },
  approveBtn: { padding: '4px 10px', background: '#dcfce7', color: '#166534', border: '1px solid #86efac', borderRadius: 5, fontSize: 12, fontWeight: 600, cursor: 'pointer' },
  rejectBtn: { padding: '4px 10px', background: '#fee2e2', color: '#991b1b', border: '1px solid #fca5a5', borderRadius: 5, fontSize: 12, fontWeight: 600, cursor: 'pointer' },
};
