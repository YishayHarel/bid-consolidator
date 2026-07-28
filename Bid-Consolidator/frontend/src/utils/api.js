import axios from 'axios';

// In production the frontend (Vercel) and backend (Render) are on different
// origins, so point at the backend via VITE_API_URL. Locally it's unset and
// falls back to '/api', which the Vite dev proxy forwards to localhost:4000.
export const API_BASE = import.meta.env.VITE_API_URL || '/api';

const api = axios.create({ baseURL: API_BASE });

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401) {
      localStorage.removeItem('token');
      window.location.href = '/admin';
    }
    return Promise.reject(err);
  }
);

export default api;
