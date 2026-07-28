import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../utils/api';

export default function LoginPage() {
  const [mode, setMode] = useState('signin'); // 'signin' | 'signup'
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const isSignup = mode === 'signup';

  function switchMode() {
    setMode(isSignup ? 'signin' : 'signup');
    setError('');
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const { data } = isSignup
        ? await api.post('/auth/register', { name, email, password })
        : await api.post('/auth/login', { email, password });
      localStorage.setItem('token', data.token);
      navigate('/internal');
    } catch (err) {
      setError(err.response?.data?.error || (isSignup ? 'Sign up failed' : 'Login failed'));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={styles.page}>
      <div style={styles.card}>
        <div style={styles.logo}>
          <div style={styles.logoMark}>BC</div>
          <div>
            <div style={styles.logoTitle}>Bid Consolidator</div>
            <div style={styles.logoSub}>Supplier Quote Comparison</div>
          </div>
        </div>

        <div style={styles.heading}>{isSignup ? 'Create your account' : 'Sign in to your account'}</div>

        <form onSubmit={handleSubmit}>
          {isSignup && (
            <div style={styles.field}>
              <label style={styles.label}>Name</label>
              <input
                style={styles.input}
                type="text"
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="Jane Doe"
                required
                autoFocus
              />
            </div>
          )}
          <div style={styles.field}>
            <label style={styles.label}>Email</label>
            <input
              style={styles.input}
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="you@company.com"
              required
              autoFocus={!isSignup}
            />
          </div>
          <div style={styles.field}>
            <label style={styles.label}>Password</label>
            <input
              style={styles.input}
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder={isSignup ? 'At least 6 characters' : ''}
              required
            />
          </div>
          {error && <div style={styles.error}>{error}</div>}
          <button style={{ ...styles.btn, opacity: loading ? 0.7 : 1 }} disabled={loading}>
            {loading
              ? (isSignup ? 'Creating account...' : 'Signing in...')
              : (isSignup ? 'Create Account' : 'Sign In')}
          </button>
        </form>

        <div style={styles.switchRow}>
          {isSignup ? 'Already have an account?' : "Don't have an account?"}
          <button type="button" style={styles.switchBtn} onClick={switchMode}>
            {isSignup ? 'Sign in' : 'Sign up'}
          </button>
        </div>
      </div>
    </div>
  );
}

const styles = {
  page: {
    minHeight: '100vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: '#f1f5f9',
  },
  card: {
    background: '#fff',
    borderRadius: 12,
    padding: '40px 36px',
    width: 360,
    boxShadow: '0 4px 24px rgba(0,0,0,0.08)',
  },
  logo: {
    display: 'flex',
    alignItems: 'center',
    gap: 14,
    marginBottom: 32,
  },
  logoMark: {
    width: 44,
    height: 44,
    background: '#0f172a',
    color: '#fff',
    borderRadius: 10,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 22,
    fontWeight: 700,
  },
  logoTitle: { fontSize: 16, fontWeight: 700, color: '#0f172a' },
  logoSub: { fontSize: 12, color: '#64748b', marginTop: 1 },
  heading: { fontSize: 15, fontWeight: 600, color: '#0f172a', marginBottom: 20 },
  field: { marginBottom: 16 },
  label: { display: 'block', fontSize: 13, fontWeight: 500, color: '#475569', marginBottom: 6 },
  input: {
    width: '100%',
    padding: '9px 12px',
    border: '1px solid #e2e8f0',
    borderRadius: 7,
    fontSize: 14,
    outline: 'none',
    transition: 'border-color 0.15s',
  },
  error: {
    background: '#fef2f2',
    color: '#dc2626',
    padding: '8px 12px',
    borderRadius: 6,
    fontSize: 13,
    marginBottom: 14,
  },
  btn: {
    width: '100%',
    padding: '10px',
    background: '#0f172a',
    color: '#fff',
    border: 'none',
    borderRadius: 7,
    fontSize: 14,
    fontWeight: 600,
    marginTop: 8,
    cursor: 'pointer',
  },
  switchRow: {
    marginTop: 20,
    textAlign: 'center',
    fontSize: 13,
    color: '#64748b',
  },
  switchBtn: {
    background: 'none',
    border: 'none',
    color: '#0f172a',
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
    padding: '0 0 0 6px',
    textDecoration: 'underline',
  },
};
