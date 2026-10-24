import { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import { ConfigProvider, theme } from 'antd';
import { Building2, Globe, Mail, Phone, MapPin, FileText, ShieldCheck, ArrowRight, Lock } from 'lucide-react';
import { STYLE } from './constants/theme.js';
import { PrivacyPolicy } from './views/PrivacyPolicy.jsx';
import { TermsAndConditions } from './views/TermsAndConditions.jsx';
import { Sidebar } from './components/layout/Sidebar.jsx';
import { Header } from './components/layout/Header.jsx';
import { useAuth, syncCurrentUser } from './hooks/useAuth.js';
import { NOTICE_KEY } from './services/session.js';
import { Dashboard } from './views/Dashboard.jsx';
import { SalesTasksView } from './views/SalesTasksView.jsx';
import { LeadsView } from './views/LeadsView.jsx';
import { InboxView } from './views/InboxView.jsx';
import { CampaignsView } from './views/CampaignsView.jsx';
import { TemplatesView } from './views/TemplatesView.jsx';
import { AIBrainView } from './views/AIBrainView.jsx';
import { AIImageGeneratorView } from './views/AIImageGeneratorView.jsx';
import { ReportsView } from './views/ReportsView.jsx';
import { ClientsView } from './views/ClientsView.jsx';
import { SettingsView } from './views/SettingsView.jsx';
import { LoginScreen } from './views/auth/LoginScreen.jsx';
import { api } from './services/api.js';
import { IntegrationsView } from './views/IntegrationsView.jsx';


import { AllianceDashboard } from './views/alliance/AllianceDashboard.jsx';
import { UploadLeads } from './views/alliance/UploadLeads.jsx';
import { LeadList } from './views/alliance/LeadList.jsx';
import { Pipeline } from './views/alliance/Pipeline.jsx';
import { LeadProfile } from './views/alliance/LeadProfile.jsx';
import { KnowledgeBase } from './views/alliance/KnowledgeBase.jsx';
import { PromptManager } from './views/alliance/PromptManager.jsx';
import { AllianceInboxView } from './views/alliance/AllianceInboxView.jsx';
import { CampaignPlanner } from './views/alliance/CampaignPlanner.jsx';
import { EmailSetup } from './views/alliance/EmailSetup.jsx';
import { EmailCampaignBuilder } from './views/alliance/EmailCampaignBuilder.jsx';
import { WhatsAppCampaignBuilder } from './views/alliance/WhatsAppCampaignBuilder.jsx';
import ContentOSDashboard from './contentos/ContentOSDashboard.jsx';


import AddClientMafiya from './views/mafiya/AddClient.jsx';
import LoyaltyMafiya from './views/mafiya/Loyalty.jsx';
import GmbBrain from './views/mafiya/GmbBrain.jsx';
import StreetPosts from './views/mafiya/StreetPosts.jsx';
import GbpInsights from './views/mafiya/GbpInsights.jsx';
import RivalFamilies from './views/mafiya/RivalFamilies.jsx';
import Citations from './views/mafiya/Citations.jsx';
import UsageMafiya from './views/mafiya/Usage.jsx';
import MafiyaOrders from './views/mafiya/Orders.jsx';
import PlanManagementMafiya from './views/mafiya/PlanManagement.jsx';
import Family from './views/mafiya/Family.jsx';

// Sign-in (password, then two-step verification). The previous page may
// leave a notice (session ended, signed out everywhere).
function LoginPage({ login, completeSession, authLoading }) {
  const [notice] = useState(() => sessionStorage.getItem(NOTICE_KEY));
  useEffect(() => { sessionStorage.removeItem(NOTICE_KEY); }, []);
  return <LoginScreen login={login} completeSession={completeSession} authLoading={authLoading} initialNotice={notice} />;
}

import { Toaster } from 'react-hot-toast';

function AppLayout({ user, logout, leadRefresh, setLeadRefresh }) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  // Desktop: the sidebar folds to icons (remembered). Phone: it is a drawer.
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try { return localStorage.getItem('getnera_sidebar_collapsed') === '1'; } catch { return false; }
  });
  const toggleSidebar = () => {
    if (window.innerWidth <= 768) { setMobileMenuOpen(open => !open); return; }
    setSidebarCollapsed(prev => {
      try { localStorage.setItem('getnera_sidebar_collapsed', prev ? '0' : '1'); } catch { /* storage unavailable */ }
      return !prev;
    });
  };
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
      <div style={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>
        <Sidebar onLogout={logout} collapsed={sidebarCollapsed} mobileOpen={mobileMenuOpen} setMobileOpen={setMobileMenuOpen} />
        <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden', width: '100%' }}>
          <Header onMenuClick={toggleSidebar} />
          <div style={{ flex: 1, overflowY: 'auto' }}>
            <Routes>
              <Route path="/" element={<Navigate to="/dashboard" replace />} />
              <Route path="/dashboard" element={<Dashboard />} />
              <Route path="/sales-tasks" element={<SalesTasksView />} />
                <Route path="/leads" element={<LeadsView onLeadClick={handleLeadClick} refreshTrigger={leadRefresh} />} />
              <Route path="/inbox" element={<InboxView />} />
              <Route path="/campaigns" element={<CampaignsView />} />
              <Route path="/templates" element={<TemplatesView />} />
              <Route path="/brain" element={<AIBrainView />} />
              <Route path="/ai-image" element={<AIImageGeneratorView />} />
              <Route path="/reports" element={<ReportsView />} />
              <Route path="/founder-reports" element={<Navigate to="/dashboard" replace />} />
              <Route path="/clients" element={<Navigate to="/dashboard" replace />} />
              <Route path="/settings" element={<SettingsView />} />
              <Route path="/workflows" element={<Navigate to="/dashboard" replace />} />
              <Route path="/integrations" element={<IntegrationsView />} />
              
              <Route path="/alliance-dashboard" element={<AllianceDashboard />} />
              <Route path="/upload-leads" element={<UploadLeads />} />
              <Route path="/lead-list" element={<LeadList />} />
              <Route path="/pipeline" element={<Pipeline />} />
              <Route path="/lead-profile" element={<LeadProfile />} />
              <Route path="/knowledge-base" element={<KnowledgeBase />} />
              <Route path="/prompt-manager" element={<PromptManager />} />
              <Route path="/alliance-inbox" element={<AllianceInboxView />} />
              <Route path="/alliance/planner" element={<CampaignPlanner />} />
              <Route path="/alliance/email-setup" element={<EmailSetup />} />
              <Route path="/alliance/email-campaigns/new" element={<EmailCampaignBuilder />} />
              <Route path="/alliance/whatsapp-campaigns/new" element={<WhatsAppCampaignBuilder />} />
              <Route path="/alliance/prospects" element={<LeadList />} />
              <Route path="/alliance/number-health" element={<Pipeline />} />
              <Route path="/alliance/replies" element={<LeadProfile />} />
              <Route path="/alliance/replies/:prospectId" element={<LeadProfile />} />
              <Route path="/alliance/ai-brain" element={<KnowledgeBase />} />
              <Route path="/alliance/prompts" element={<PromptManager />} />
              <Route path="/alliance/analytics" element={<AllianceDashboard />} />
              <Route path="/alliance/upload" element={<UploadLeads />} />
              <Route path="/admin/content-os/approval" element={<ContentOSDashboard defaultPage="approval" />} />
              <Route path="/admin/content-os/monitors" element={<ContentOSDashboard defaultPage="monitors" />} />
              <Route path="/admin/content-os/scheduler" element={<ContentOSDashboard defaultPage="scheduler" />} />
              <Route path="/admin/content-os/captions" element={<ContentOSDashboard defaultPage="captions" />} />
              <Route path="/admin/content-os/social-connection" element={<ContentOSDashboard defaultPage="accounts" />} />
              <Route path="/admin/content-os/tokens" element={<ContentOSDashboard defaultPage="tokens" />} />
              <Route path="/admin/content-os/logs" element={<ContentOSDashboard defaultPage="logs" />} />
              <Route path="/admin/content-os/reach" element={<ContentOSDashboard defaultPage="reach" />} />
              <Route path="/admin/content-os/failed" element={<ContentOSDashboard defaultPage="failed" />} />
              <Route path="/admin/content-os/thumbnail-brain" element={<ContentOSDashboard defaultPage="thumbnail-brain" />} />



              <Route path="/mafiya/orders" element={<MafiyaOrders />} />
              <Route path="/mafiya/plans" element={<PlanManagementMafiya />} />
              <Route path="/mafiya/add-client" element={<AddClientMafiya />} />
              <Route path="/mafiya/family" element={<Family />} />
              <Route path="/mafiya/loyalty" element={<LoyaltyMafiya />} />
              <Route path="/mafiya/brain" element={<GmbBrain />} />
              <Route path="/mafiya/street-posts" element={<StreetPosts />} />
              <Route path="/mafiya/citations" element={<Citations />} />
              <Route path="/mafiya/gbp-insights" element={<GbpInsights />} />
              <Route path="/mafiya/rivals" element={<RivalFamilies />} />
              <Route path="/mafiya/usage" element={<UsageMafiya />} />

              <Route path="/privacy-policy" element={<PrivacyPolicy />} />
              <Route path="/terms-and-conditions" element={<TermsAndConditions />} />

              <Route path="*" element={<Navigate to="/dashboard" replace />} />
            </Routes>
          </div>
        </div>
      </div>
    </>
  );
}

export default function App() {
  const { user, login, logout, completeSession, loading: authLoading, error: authError } = useAuth();
  const [selectedLead, setSelectedLead] = useState(null);
  const [leadRefresh, setLeadRefresh] = useState(0);

  return (
    <ConfigProvider 
      theme={{ 
        token: { 
          colorPrimary: '#1677ff',
          fontFamily: "'Inter', system-ui, sans-serif",
          borderRadius: 8,
          controlHeight: 40,
          fontSize: 14,
        } 
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
