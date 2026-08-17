  import { BrowserRouter, Routes, Route, NavLink, Navigate, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';
import { AuthProvider, useAuth } from './AuthContext';
import { LoginPage } from './LoginPage';
import { CampaignsPage } from './CampaignsPage';
import { CampaignDetailPage } from './CampaignDetailPage';
import { CompaniesPage } from './CompaniesPage';
import './App.css';

/**
 * Protects an in-app route. If the user isn't signed in, sends them to /login.
 * If auth is still checking, shows a small loading screen so we don't flash
 * the wrong page.
 */
function ProtectedRoute({ children }: { children: ReactNode }) {
  const { session, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div style={{
        minHeight: '100vh', display: 'flex',
        alignItems: 'center', justifyContent: 'center',
        color: 'rgba(255,255,255,0.5)',
      }}>
        Loading…
      </div>
    );
  }

  if (!session) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  return <>{children}</>;
}

/**
 * The top nav (Companies / Campaigns) plus a sign-out button at the far right.
 * Only shown for signed-in users, so we render it inside ProtectedRoute.
 */
function TopNav() {
  const { user, signOut } = useAuth();
  return (
    <nav className="top-nav">
      <div className="top-nav-brand">Trooly</div>
      <div className="top-nav-links">
        <NavLink to="/companies" className={({ isActive }) => isActive ? 'nav-link active' : 'nav-link'}>
          Companies
        </NavLink>
        <NavLink to="/campaigns" className={({ isActive }) => isActive ? 'nav-link active' : 'nav-link'}>
          Campaigns
        </NavLink>
      </div>
      <div className="top-nav-user">
        <span className="user-email">{user?.email}</span>
        <button type="button" className="ghost-button" onClick={signOut}>Sign out</button>
      </div>
    </nav>
  );
}

/**
 * If a signed-in user visits /login, send them into the app.
 * If not signed in, show the login page.
 */
function LoginOrRedirect() {
  const { session, loading } = useAuth();
  if (loading) return null;
  if (session) return <Navigate to="/campaigns" replace />;
  return <LoginPage />;
}

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<LoginOrRedirect />} />

          <Route
            path="/"
            element={<Navigate to="/campaigns" replace />}
          />

          <Route
            path="/campaigns"
            element={
              <ProtectedRoute>
                <div className="app-shell">
                  <TopNav />
                  <CampaignsPage />
                </div>
              </ProtectedRoute>
            }
          />
          <Route
            path="/campaigns/:id"
            element={
              <ProtectedRoute>
                <div className="app-shell">
                  <TopNav />
                  <CampaignDetailPage />
                </div>
              </ProtectedRoute>
            }
          />
          <Route
            path="/companies"
            element={
              <ProtectedRoute>
                <div className="app-shell">
                  <TopNav />
                  <CompaniesPage />
                </div>
              </ProtectedRoute>
            }
          />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}

export default App;