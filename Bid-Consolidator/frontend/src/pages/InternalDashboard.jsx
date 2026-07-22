import { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import ProjectsTab from '../components/ProjectsTab';
import CompareTab from '../components/CompareTab';
import UploadTab from '../components/UploadTab';
import LandedCostTab from '../components/LandedCostTab';
import EmailsTab from '../components/EmailsTab';
import VendorLinksTab from '../components/VendorLinksTab';
import FactoriesTab from '../components/FactoriesTab';

const TABS = [
  { id: 'projects',      label: 'Projects' },
  { id: 'compare',       label: 'Compare' },
  { id: 'upload',        label: 'Upload' },
  { id: 'emails',        label: 'Emails' },
  { id: 'landed-cost',   label: 'Landed Cost' },
  { id: 'vendor-links',  label: 'Vendor Links' },
  { id: 'settings',      label: 'Settings' },
];

export default function InternalDashboard() {
  const navigate = useNavigate();
  const location = useLocation();
  const [liveAlert, setLiveAlert] = useState(null);

  const currentTab = TABS.find(t => location.pathname.includes(t.id))?.id || 'projects';

  useEffect(() => {
    const ws = new WebSocket(`ws://${window.location.hostname}:4000/ws`);
    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === 'quote:new') {
          setLiveAlert(`New quote from ${msg.factory_name}`);
          setTimeout(() => setLiveAlert(null), 5000);
        }
      } catch {}
    };
    ws.onerror = () => {};
    return () => ws.close();
  }, []);

  function logout() {
    localStorage.removeItem('token');
    navigate('/vendor');
  }

  return (
    <div style={s.shell}>
      <header style={s.header}>
        <div style={s.headerLeft}>
          <div style={s.logoMark}>S</div>
          <div>
            <div style={s.logoTitle}>Shalom International</div>
            <div style={s.logoSub}>Bid Consolidator</div>
          </div>
        </div>
        <div style={s.headerRight}>
          {liveAlert && (
            <div style={s.liveAlert}>
              <span style={s.liveDot} />
              {liveAlert}
            </div>
          )}
          <button style={s.logoutBtn} onClick={logout}>Sign Out</button>
        </div>
      </header>

      <div style={s.tabs}>
        {TABS.map(t => (
          <button
            key={t.id}
            style={{ ...s.tab, ...(currentTab === t.id ? s.tabActive : {}) }}
            onClick={() => navigate(`/internal/${t.id}`)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <main style={s.main}>
        {currentTab === 'projects'     && <ProjectsTab />}
        {currentTab === 'compare'      && <CompareTab />}
        {currentTab === 'upload'       && <UploadTab />}
        {currentTab === 'emails'       && <EmailsTab />}
        {currentTab === 'landed-cost'  && <LandedCostTab />}
        {currentTab === 'vendor-links' && <VendorLinksTab />}
        {currentTab === 'settings'     && <FactoriesTab />}
      </main>
    </div>
  );
}

const s = {
  shell: { minHeight: '100vh', display: 'flex', flexDirection: 'column', background: '#f8fafc' },
  header: { background: '#0f172a', color: '#fff', padding: '0 24px', height: 56, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 },
  headerLeft: { display: 'flex', alignItems: 'center', gap: 12 },
  logoMark: { width: 32, height: 32, background: '#fff', color: '#0f172a', borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, fontWeight: 800 },
  logoTitle: { fontSize: 15, fontWeight: 700, lineHeight: 1.2 },
  logoSub: { fontSize: 11, color: '#94a3b8' },
  headerRight: { display: 'flex', alignItems: 'center', gap: 16 },
  liveAlert: { background: '#064e3b', color: '#6ee7b7', padding: '5px 12px', borderRadius: 20, fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 },
  liveDot: { width: 7, height: 7, background: '#34d399', borderRadius: '50%', display: 'inline-block' },
  logoutBtn: { background: 'transparent', border: '1px solid #334155', color: '#94a3b8', padding: '5px 14px', borderRadius: 6, fontSize: 13, cursor: 'pointer' },
  tabs: { background: '#fff', borderBottom: '1px solid #e2e8f0', display: 'flex', padding: '0 24px' },
  tab: { background: 'none', border: 'none', borderBottom: '2px solid transparent', padding: '14px 18px', fontSize: 13, fontWeight: 500, color: '#64748b', cursor: 'pointer', transition: 'all 0.15s' },
  tabActive: { color: '#0f172a', borderBottomColor: '#0f172a', fontWeight: 600 },
  main: { flex: 1, padding: 24, overflow: 'auto' },
};
