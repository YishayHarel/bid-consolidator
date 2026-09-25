// Routes. The current project lives in the URL (/app/projects/:projectId/...),
// so switching tabs never loses it and any view can be bookmarked or shared.
// Old paths keep working: /admin (sign-in), /internal/* (old dashboard), and
// /vendor?token=… (links already emailed to factories).
import { lazy, Suspense } from 'react';
import { createBrowserRouter, Navigate, Outlet, RouterProvider, useLocation } from 'react-router';
import { AppLayout } from './components/AppLayout';
import { Loading } from './components/ui';
import { useAuth } from './lib/auth';
import { LoginPage } from './pages/LoginPage';
import { VendorPortalPage } from './pages/VendorPortalPage';

const ProjectsPage = lazy(() => import('./pages/ProjectsPage'));
const ProjectLayout = lazy(() => import('./pages/project/ProjectLayout'));
const ComparePage = lazy(() => import('./pages/project/ComparePage'));
const FactoriesPage = lazy(() => import('./pages/project/FactoriesPage'));
const EmailsPage = lazy(() => import('./pages/project/EmailsPage'));
const LandedCostPage = lazy(() => import('./pages/project/LandedCostPage'));
const VendorLinksPage = lazy(() => import('./pages/VendorLinksPage'));
const SettingsPage = lazy(() => import('./pages/SettingsPage'));

function RequireAuth() {
  const { status } = useAuth();
  const location = useLocation();
  if (status === 'loading') return <Loading label="Signing you in…" />;
  if (status === 'signed-out') return <Navigate to="/admin" replace state={{ from: location.pathname + location.search }} />;
  return (
    <AppLayout>
      <Suspense fallback={<Loading />}><Outlet /></Suspense>
    </AppLayout>
  );
}

function Home() {
  const { status } = useAuth();
  if (status === 'loading') return <Loading />;
  return <Navigate to={status === 'signed-in' ? '/app' : '/admin'} replace />;
}

const router = createBrowserRouter([
  { path: '/', element: <Home /> },
  { path: '/admin', element: <LoginPage /> },
  { path: '/login', element: <Navigate to="/admin" replace /> },
  { path: '/vendor', element: <VendorPortalPage /> },
  { path: '/internal/*', element: <Navigate to="/app" replace /> },
  {
    path: '/app',
    element: <RequireAuth />,
    children: [
      { index: true, element: <ProjectsPage /> },
      {
        path: 'projects/:projectId',
        element: <ProjectLayout />,
        children: [
          { index: true, element: <Navigate to="compare" replace /> },
          { path: 'compare', element: <ComparePage /> },
          { path: 'factories', element: <FactoriesPage /> },
          { path: 'emails', element: <EmailsPage /> },
          { path: 'landed-cost', element: <LandedCostPage /> },
        ],
      },
      { path: 'links', element: <VendorLinksPage /> },
      { path: 'settings', element: <SettingsPage /> },
    ],
  },
  { path: '*', element: <Navigate to="/" replace /> },
]);

export default function App() {
  return <RouterProvider router={router} />;
}
