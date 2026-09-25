import { useState, type FormEvent } from 'react';
import { Navigate, useLocation, useNavigate, useSearchParams } from 'react-router';
import { api, errorMessage } from '../api/client';
import type { Session } from '../api/types';
import { Button, Field, Input } from '../components/ui';
import { useAuth } from '../lib/auth';

export function LoginPage() {
  const { status, signIn, notice } = useAuth();
  const [params] = useSearchParams();
  const inviteToken = params.get('invite') ?? undefined;
  const [mode, setMode] = useState<'signin' | 'signup'>(inviteToken ? 'signup' : 'signin');
  const [name, setName] = useState('');
  const [email, setEmail] = useState(params.get('email') ?? '');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();
  const from = (useLocation().state as { from?: string } | null)?.from ?? '/app';

  if (status === 'signed-in') return <Navigate to={from} replace />;
  const signup = mode === 'signup';

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const session = signup
        ? await api.post<Session>('/auth/register', { name, email, password, ...(inviteToken ? { inviteToken } : {}) })
        : await api.post<Session>('/auth/login', { email, password });
      signIn(session);
      navigate(from, { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth">
      <form className="auth__card" onSubmit={submit} noValidate>
        <div className="auth__brand">
          <span className="brand__mark brand__mark--dark">BC</span>
          <div>
            <div className="auth__title">Bid Consolidator</div>
            <div className="auth__sub">Supplier quote comparison</div>
          </div>
        </div>
        <h1 className="auth__heading">
          {signup ? (inviteToken ? 'Accept your invitation' : 'Create your account') : 'Sign in'}
        </h1>
        {notice && !error && <div className="notice">{notice}</div>}
        {signup && (
          <Field label="Name">
            <Input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" required autoFocus />
          </Field>
        )}
        <Field label="Work email">
          <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email"
            required autoFocus={!signup} readOnly={!!inviteToken && !!params.get('email')} />
        </Field>
        <Field label="Password" hint={signup ? 'At least 8 characters' : undefined}>
          <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
            autoComplete={signup ? 'new-password' : 'current-password'} required />
        </Field>
        {error && <div className="form-error" role="alert">{error}</div>}
        <Button type="submit" variant="primary" className="btn--block" busy={busy}>
          {signup ? 'Create account' : 'Sign in'}
        </Button>
        {!inviteToken && (
          <p className="auth__switch">
            {signup ? 'Already have an account?' : 'New here?'}{' '}
            <button type="button" className="link-btn" onClick={() => { setMode(signup ? 'signin' : 'signup'); setError(null); }}>
              {signup ? 'Sign in' : 'Create an account'}
            </button>
          </p>
        )}
        {signup && !inviteToken && <p className="auth__fine">Sign-up is open to company email addresses. Everyone else needs an invite from an admin.</p>}
      </form>
    </div>
  );
}
