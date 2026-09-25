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
        {/* Root: logged-in staff go to the dashboard, everyone else to the login page.
            Vendors reach the upload portal directly via /vendor (their invite links point there). */}
        <Route path="/" element={<Navigate to={isLoggedIn ? '/internal' : '/admin'} replace />} />
        <Route path="/login" element={<Navigate to="/admin" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
