import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import LoginPage from './pages/LoginPage';
import InternalDashboard from './pages/InternalDashboard';
import VendorPortal from './pages/VendorPortal';

function RequireAuth({ children }) {
  const token = localStorage.getItem('token');
  return token ? children : <Navigate to="/admin" replace />;
}

export default function App() {
  const isLoggedIn = !!localStorage.getItem('token');

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/admin" element={<LoginPage />} />
        <Route path="/vendor" element={<VendorPortal />} />
        <Route
          path="/internal/*"
          element={
            <RequireAuth>
              <InternalDashboard />
            </RequireAuth>
          }
        />
        {/* Root: send staff to dashboard, vendors to vendor portal */}
        <Route path="/" element={<Navigate to={isLoggedIn ? '/internal' : '/vendor'} replace />} />
        <Route path="/login" element={<Navigate to="/admin" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
