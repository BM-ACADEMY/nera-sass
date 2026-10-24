import { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useNavigate, useParams } from 'react-router-dom';
import { ConfigProvider, theme } from 'antd';
import { Building2, Globe, Mail, Phone, MapPin, FileText, ShieldCheck, ArrowRight, Lock } from 'lucide-react';
import { STYLE } from './constants/theme.js';
import { PrivacyPolicy } from './views/PrivacyPolicy.jsx';
import { TermsAndConditions } from './views/TermsAndConditions.jsx';
import AppSidebar from './components/layout/AppSidebar.jsx';
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar';
import WhatsAppNumberPage from './views/whatsapp/WhatsAppNumberPage.jsx';
import { Header } from './components/layout/Header.jsx';
import { useAuth, syncCurrentUser } from './hooks/useAuth.js';
import { NOTICE_KEY } from './services/session.js';
import { Dashboard } from './views/Dashboard.jsx';
import { SalesTasksView } from './views/SalesTasksView.jsx';
import { LeadsView } from './views/LeadsView.jsx';
import { InboxView } from './views/InboxView.jsx';
import { CampaignsView } from './views/CampaignsView.jsx';
import TemplatesPage from './components/templates/TemplatesPage.jsx';
import { AIBrainView } from './views/AIBrainView.jsx';
import { ReportsView } from './views/ReportsView.jsx';
import { SettingsView } from './views/SettingsView.jsx';
import { LoginScreen } from './views/auth/LoginScreen.jsx';
import { api } from './services/api.js';





// Sign-in (password, then two-step verification). The previous page may
// leave a notice (session ended, signed out everywhere).
function LoginPage({ login, completeSession, authLoading }) {
  const [notice] = useState(() => sessionStorage.getItem(NOTICE_KEY));
  useEffect(() => { sessionStorage.removeItem(NOTICE_KEY); }, []);
  return <LoginScreen login={login} completeSession={completeSession} authLoading={authLoading} initialNotice={notice} />;
}

import { Toaster } from 'react-hot-toast';

// /templates, /templates/new, /templates/<template id>
function TemplatesRoute() {
  const { itemId } = useParams();
  return <TemplatesPage itemId={itemId} basePath="/templates" />;
}

function AppLayout({ user, logout, leadRefresh, setLeadRefresh }) {
  const navigate = useNavigate();

  // Keep the displayed name and role in step with the server (display only;
  // the server checks the role on every request).
  useEffect(() => {
    api.getMe().then(syncCurrentUser).catch(() => {});
  }, []);

  const handleLeadClick = (lead) => {
    navigate('/inbox', { state: { leadId: lead.id } });
  };
  return (
    <>
      <style>{STYLE}</style>
      <Toaster position="top-right" containerStyle={{ zIndex: 999999 }} toastOptions={{ style: { background: '#1e293b', color: '#e2e8f0', border: '1px solid #334155' } }} />
      {/* Same shell as the admin panel: shadcn sidebar + inset with a sticky top bar. */}
      <SidebarProvider className="h-svh overflow-hidden">
        <AppSidebar onLogout={logout} />
        <SidebarInset className="min-w-0 overflow-hidden">
          <Header />
          <div className="min-h-0 flex-1 overflow-y-auto bg-background">
            <Routes>
              {/* Only the pages in the sidebar (and Settings in the profile menu).
                  Any other address, typed or old, goes to the dashboard. */}
              <Route path="/" element={<Navigate to="/dashboard" replace />} />
              <Route path="/dashboard" element={<Dashboard />} />
              <Route path="/leads" element={<LeadsView onLeadClick={handleLeadClick} refreshTrigger={leadRefresh} />} />
              <Route path="/sales-tasks" element={<SalesTasksView />} />
              <Route path="/inbox" element={<InboxView />} />
              <Route path="/whatsapp" element={<WhatsAppNumberPage />} />
              <Route path="/templates/:itemId?" element={<TemplatesRoute />} />
              <Route path="/campaigns" element={<CampaignsView />} />
              <Route path="/brain" element={<AIBrainView />} />
              <Route path="/reports" element={<ReportsView />} />
              <Route path="/settings" element={<SettingsView />} />
              <Route path="*" element={<Navigate to="/dashboard" replace />} />
            </Routes>
          </div>
        </SidebarInset>
      </SidebarProvider>
    </>
  );
}

export default function App() {
  const { user, login, logout, completeSession, loading: authLoading, error: authError } = useAuth();
  const [selectedLead, setSelectedLead] = useState(null);
  const [leadRefresh, setLeadRefresh] = useState(0);

  return (
    <ConfigProvider 
      // antd styled like the admin panel's shadcn/ui (slate + blue, Inter).
      theme={{
        token: {
          colorPrimary: '#2563eb',
          colorInfo: '#2563eb',
          colorSuccess: '#16a34a',
          colorWarning: '#d97706',
          colorError: '#ef4444',
          colorText: '#1e293b',
          colorTextSecondary: '#64748b',
          colorTextTertiary: '#94a3b8',
          colorBorder: '#e2e8f0',
          colorBorderSecondary: '#e2e8f0',
          colorBgLayout: '#f8fafc',
          colorFillAlter: '#f8fafc',
          fontFamily: "'Inter', system-ui, sans-serif",
          fontSize: 14,
          borderRadius: 8,
          borderRadiusLG: 12,
          controlHeight: 36,
          boxShadowTertiary: '0 1px 2px 0 rgb(0 0 0 / 0.05)',
        },
        components: {
          Card: { headerFontSize: 15, paddingLG: 20 },
          Table: { headerBg: '#f8fafc', headerColor: '#475569', headerSplitColor: 'transparent', rowHoverBg: '#f8fafc', borderColor: '#e2e8f0' },
          Button: { fontWeight: 500, primaryShadow: 'none', defaultShadow: 'none', dangerShadow: 'none' },
          Modal: { titleFontSize: 17 },
          Tabs: { itemSelectedColor: '#0f172a', inkBarColor: '#2563eb', titleFontSize: 14 },
          Menu: { itemSelectedBg: '#eff6ff', itemSelectedColor: '#1d4ed8' },
          Input: { activeShadow: '0 0 0 3px rgb(37 99 235 / 0.15)' },
          Select: { optionSelectedBg: '#eff6ff' },
        },
      }}
    >
      <BrowserRouter>
        <Routes>
          <Route path="/privacy-policy" element={<PrivacyPolicy />} />
          <Route path="/terms-and-conditions" element={<TermsAndConditions />} />
          <Route
            path="/login"
            element={
              user ? (
                <Navigate to="/dashboard" replace />
              ) : (
                <LoginPage login={login} completeSession={completeSession} authLoading={authLoading} authError={authError} />
              )
            }
          />
          <Route
            path="*"
            element={
              user ? (
                <AppLayout
                  user={user}
                  logout={logout}
                  leadRefresh={leadRefresh}
                  setLeadRefresh={setLeadRefresh}
                />
              ) : (
                <Navigate to="/login" replace />
              )
            }
          />
        </Routes>
      </BrowserRouter>
    </ConfigProvider>
  );
}
