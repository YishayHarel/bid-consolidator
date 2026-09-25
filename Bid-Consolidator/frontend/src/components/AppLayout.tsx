// Signed-in shell: org-branded header (from /auth/me — no hardcoded company),
// top navigation, live quote notifications, and sign-out.
import { useCallback, useState, type ReactNode } from 'react';
import { Link, NavLink, useNavigate } from 'react-router';
import { useAuth } from '../lib/auth';
import { useRealtime } from '../lib/realtime';
import { useFeedback } from './feedback';

export function AppLayout({ children }: { children: ReactNode }) {
  const { user, org, signOut } = useAuth();
  const { toast } = useFeedback();
  const navigate = useNavigate();
  const [live, setLive] = useState<string | null>(null);

  const onQuote = useCallback((e: { projectId: number; projectName: string; factoryName: string }) => {
    setLive(`${e.factoryName} submitted a quote on ${e.projectName}`);
    toast(`New quote: ${e.factoryName} — ${e.projectName}`, 'success');
    setTimeout(() => setLive(null), 8000);
  }, [toast]);
  useRealtime(!!user, onQuote);

  const b = org?.branding;
  return (
    <div className="shell">
      <header className="topbar" style={b?.color ? { background: b.color } : undefined}>
        <Link to="/app" className="brand">
          <span className="brand__mark">{b?.mark ?? 'B'}</span>
          <span>
            <span className="brand__title">{b?.title ?? 'Bid Consolidator'}</span>
            <span className="brand__sub">{b?.subtitle ?? 'Bid Consolidator'}</span>
          </span>
        </Link>
        <nav className="topnav">
          <NavLink to="/app" end className="topnav__link">Projects</NavLink>
          <NavLink to="/app/links" className="topnav__link">Vendor Links</NavLink>
          <NavLink to="/app/settings" className="topnav__link">Settings</NavLink>
        </nav>
        <div className="topbar__right">
          {live && <span className="live-pill"><span className="live-dot" />{live}</span>}
          <span className="topbar__user" title={user?.email}>{user?.name}</span>
          <button className="btn btn--on-dark btn--sm" onClick={() => { signOut(); navigate('/admin'); }}>Sign out</button>
        </div>
      </header>
      <main className="main">{children}</main>
    </div>
  );
}
