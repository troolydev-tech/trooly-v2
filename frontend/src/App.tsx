import { BrowserRouter, Routes, Route, NavLink, Navigate } from 'react-router-dom';
import { CampaignsPage } from './CampaignsPage';
import { CampaignDetailPage } from './CampaignDetailPage';
import { CompaniesPage } from './CompaniesPage';
import './App.css';

function App() {
  return (
    <BrowserRouter>
      <div className="app-shell">
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
        </nav>

        <Routes>
          <Route path="/" element={<Navigate to="/campaigns" replace />} />
          <Route path="/campaigns" element={<CampaignsPage />} />
          <Route path="/campaigns/:id" element={<CampaignDetailPage />} />
          <Route path="/companies" element={<CompaniesPage />} />
        </Routes>
      </div>
    </BrowserRouter>
  );
}

export default App;