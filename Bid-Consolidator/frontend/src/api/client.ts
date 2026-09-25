// Minimal typed HTTP client over fetch. Adds the session token, normalizes
// errors into ApiError (with the server's friendly message), and signs the
// user out on an expired session — but NOT on a failed login attempt, so the
// login form can show "Incorrect email or password".

// Prod: the backend's absolute URL (Vercel env VITE_API_URL). Dev: Vite proxies /api.
export const API_BASE = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/+$/, '') || '/api';

/** Resolve a signed file path from the API (e.g. "/files/…") to a usable URL. */
export const apiUrl = (path: string | null | undefined) => (path ? `${API_BASE}${path}` : undefined);

export class ApiError extends Error {
  constructor(public status: number, message: string, public code?: string, public details?: unknown) {
    super(message);
  }
}

const TOKEN_KEY = 'bc.session';
export const tokenStore = {
  get: () => { try { return localStorage.getItem(TOKEN_KEY); } catch { return null; } },
  set: (t: string) => { try { localStorage.setItem(TOKEN_KEY, t); } catch { /* private mode */ } },
  clear: () => { try { localStorage.removeItem(TOKEN_KEY); localStorage.removeItem('token'); } catch { /* ignore */ } },
};

let onSessionExpired: () => void = () => {};
export function setSessionExpiredHandler(fn: () => void) { onSessionExpired = fn; }

type Body = Record<string, unknown> | unknown[] | FormData | undefined;

async function request<T>(method: string, path: string, body?: Body, opts: { auth?: boolean } = {}): Promise<T> {
  const headers: Record<string, string> = {};
  const token = opts.auth === false ? null : tokenStore.get();
  if (token) headers.Authorization = `Bearer ${token}`;
  let payload: BodyInit | undefined;
  if (body instanceof FormData) payload = body;
  else if (body !== undefined) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }

  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, { method, headers, body: payload });
  } catch {
    throw new ApiError(0, "Can't reach the server. Check your connection — if the app was idle it may take ~30 seconds to wake up.");
  }
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const isAuthAttempt = path.startsWith('/auth/login') || path.startsWith('/auth/register');
    if (res.status === 401 && token && !isAuthAttempt) onSessionExpired();
    throw new ApiError(res.status, data?.error ?? `Request failed (${res.status})`, data?.code, data?.details);
  }
  return data as T;
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: Body) => request<T>('POST', path, body),
  put: <T>(path: string, body?: Body) => request<T>('PUT', path, body),
  patch: <T>(path: string, body?: Body) => request<T>('PATCH', path, body),
  delete: <T = void>(path: string) => request<T>('DELETE', path),
  /** Public (no session) — the factory portal. */
  public: {
    get: <T>(path: string) => request<T>('GET', path, undefined, { auth: false }),
    put: <T>(path: string, body?: Body) => request<T>('PUT', path, body, { auth: false }),
    post: <T>(path: string, body?: Body) => request<T>('POST', path, body, { auth: false }),
  },
};

export const errorMessage = (err: unknown) =>
  err instanceof ApiError ? err.message : err instanceof Error ? err.message : 'Something went wrong';
