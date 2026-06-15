import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import LoginPage from './pages/LoginPage';
import InternalDashboard from './pages/InternalDashboard';
import VendorPortal from './pages/VendorPortal';

function RequireAuth({ children }) {
  const token = localStorage.getItem('token');
  return token ? children : <Navigate to="/login" replace />;
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/vendor" element={<VendorPortal />} />
        <Route
          path="/internal/*"
          element={
            <RequireAuth>
              <InternalDashboard />
            </RequireAuth>
          }
        />
        <Route path="/" element={<Navigate to="/internal" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
