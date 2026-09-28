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
  const [name, setName] = useState('');
  const [email, setEmail] = useState(params.get('email') ?? '');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();
  const from = (useLocation().state as { from?: string } | null)?.from ?? '/app';

  if (status === 'signed-in') return <Navigate to={from} replace />;
  // Sign-up is invite-only: the create-account form exists only on an invite link.
  const signup = !!inviteToken;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const session = signup
        ? await api.post<Session>('/auth/register', { name, email, password, inviteToken })
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
          {signup ? 'Accept your invitation' : 'Sign in'}
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
        {!signup && <p className="auth__fine">New here? Ask an admin to invite you — accounts are by invitation only.</p>}
      </form>
    </div>
  );
}
