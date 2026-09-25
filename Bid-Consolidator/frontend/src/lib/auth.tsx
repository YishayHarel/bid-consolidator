// Session state. The token is validated on load (expiry decoded client-side,
// then confirmed with /auth/me), an expired session anywhere signs you out
// cleanly, and Sign Out goes to the sign-in page (it used to go to /vendor).
import { useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, setSessionExpiredHandler, tokenStore } from '../api/client';
import type { Org, Session, User } from '../api/types';

interface AuthState {
  user: User | null;
  org: Org | null;
  status: 'loading' | 'signed-in' | 'signed-out';
  signIn: (s: Session) => void;
  signOut: (reason?: string) => void;
  notice: string | null;
}
const AuthContext = createContext<AuthState | null>(null);

function tokenExpired(token: string): boolean {
  try {
    const payload = JSON.parse(atob(token.split('.')[1]!.replace(/-/g, '+').replace(/_/g, '/'))) as { exp?: number };
    return !payload.exp || payload.exp * 1000 < Date.now();
  } catch {
    return true;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const [user, setUser] = useState<User | null>(null);
  const [org, setOrg] = useState<Org | null>(null);
  const [status, setStatus] = useState<AuthState['status']>('loading');
  const [notice, setNotice] = useState<string | null>(null);

  const signOut = useCallback((reason?: string) => {
    tokenStore.clear();
    qc.clear();
    setUser(null);
    setOrg(null);
    setStatus('signed-out');
    setNotice(reason ?? null);
  }, [qc]);

  const signIn = useCallback((s: Session) => {
    tokenStore.set(s.token);
    setUser(s.user);
    setOrg(s.org);
    setNotice(null);
    setStatus('signed-in');
  }, []);

  useEffect(() => {
    setSessionExpiredHandler(() => signOut('Your session expired — please sign in again.'));
    const token = tokenStore.get();
    if (!token || tokenExpired(token)) {
      tokenStore.clear();
      setStatus('signed-out');
      return;
    }
    api.get<{ user: User; org: Org }>('/auth/me')
      .then((me) => { setUser(me.user); setOrg(me.org); setStatus('signed-in'); })
      .catch(() => signOut());
  }, [signOut]);

  const value = useMemo(() => ({ user, org, status, signIn, signOut, notice }), [user, org, status, signIn, signOut, notice]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
