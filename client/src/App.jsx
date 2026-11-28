import { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useNavigate, useParams } from 'react-router-dom';
import { ConfigProvider, theme } from 'antd';
import { Building2, Globe, Mail, Phone, MapPin, FileText, ShieldCheck, ArrowRight, Lock } from 'lucide-react';
import { STYLE } from './constants/theme.js';
import { PrivacyPolicy } from './views/PrivacyPolicy.jsx';
import { TermsAndConditions } from './views/TermsAndConditions.jsx';
import AppSidebar, { SECTIONS as MENU } from './components/layout/AppSidebar.jsx';
import { mySections, hasSection, homePath } from './views/settings/teamPolicy.js';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
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
import BrainPage from './views/brain/BrainPage.jsx';
import CalendarPage from './views/calendar/CalendarPage.jsx';
import PluginsPage from './views/plugins/PluginsPage.jsx';
import { ReportsView } from './views/ReportsView.jsx';
import { SettingsView } from './views/SettingsView.jsx';
import TeamPage from './views/team/TeamPage.jsx';
import BillingPage from './views/billing/BillingPage.jsx';
import SessionsPage from './views/account/SessionsPage.jsx';
import { LoginScreen } from './views/auth/LoginScreen.jsx';
import { SetPasswordPage } from './views/auth/SetPasswordPage.jsx';
import { ChangePasswordRequired } from './views/auth/ChangePasswordRequired.jsx';
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

// A page this person was not given (Settings > Team sections). The server
// refuses its data too; this says so instead of showing a broken page.
function NoAccess({ home }) {
  const navigate = useNavigate();
  return (
    <div className="p-4 md:p-8">
      <Card className="mx-auto max-w-lg items-center gap-3 px-6 py-12 text-center">
        <Lock className="size-7 text-slate-400" />
        <div className="text-base font-semibold">You don't have access to this page</div>
        <p className="text-sm text-muted-foreground">Ask the workspace Owner to give you access to it in Team.</p>
        <Button variant="outline" onClick={() => navigate(home, { replace: true })}>Go to my workspace</Button>
      </Card>
    </div>
  );
}

// Shows the page only to people with that section (Owners have all). The
// dashboard, the first page after sign-in, sends others to their first page.
function SectionRoute({ user, section, children, sendHome = false }) {
  const sections = mySections(user);
  if (hasSection(sections, section)) return children;
  const home = homePath(sections, MENU);
  return sendHome ? <Navigate to={home} replace /> : <NoAccess home={home} />;
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
              {/* Only the pages in the sidebar (and Settings and Billing in the profile menu).
                  Any other address, typed or old, goes to the dashboard. */}
              <Route path="/" element={<Navigate to="/dashboard" replace />} />
              <Route path="/dashboard" element={<SectionRoute user={user} section="dashboard" sendHome><Dashboard /></SectionRoute>} />
              <Route path="/leads" element={<SectionRoute user={user} section="leads"><LeadsView onLeadClick={handleLeadClick} refreshTrigger={leadRefresh} /></SectionRoute>} />
              <Route path="/sales-tasks" element={<SectionRoute user={user} section="sales_tasks"><SalesTasksView /></SectionRoute>} />
              <Route path="/inbox" element={<SectionRoute user={user} section="inbox"><InboxView /></SectionRoute>} />
              {/* Connecting the WhatsApp number is for Owners. */}
              <Route path="/whatsapp" element={user?.role === 'owner' ? <WhatsAppNumberPage /> : <NoAccess home={homePath(mySections(user), MENU)} />} />
              <Route path="/templates/:itemId?" element={<SectionRoute user={user} section="templates"><TemplatesRoute /></SectionRoute>} />
              <Route path="/campaigns" element={<SectionRoute user={user} section="campaigns"><CampaignsView /></SectionRoute>} />
              <Route path="/calendar" element={<SectionRoute user={user} section="plugins"><CalendarPage /></SectionRoute>} />
              <Route path="/plugins" element={<SectionRoute user={user} section="plugins"><PluginsPage /></SectionRoute>} />
              <Route path="/brain" element={<SectionRoute user={user} section="ai_brain"><BrainPage /></SectionRoute>} />
              <Route path="/reports" element={<SectionRoute user={user} section="reports"><ReportsView /></SectionRoute>} />
              <Route path="/team" element={<TeamPage />} />
              {/* Team used to be a Settings section: old links keep working. */}
              <Route path="/settings/team" element={<Navigate to="/team" replace />} />
              <Route path="/settings/:section?" element={<SettingsView />} />
              {/* Billing: Owners pay, Admins can look; not for Staff. */}
              <Route path="/billing" element={user?.role === 'staff' ? <NoAccess home={homePath(mySections(user), MENU)} /> : <BillingPage />} />
              <Route path="/account/sessions" element={<SessionsPage />} />
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
          {/* One-time links (password set/reset, invitations): open whether signed in or not. */}
          <Route path="/reset-password/:token" element={<SetPasswordPage mode="reset" />} />
          <Route path="/invite/:token" element={<SetPasswordPage mode="invite" />} />
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
              // On a temporary password (Settings > Team): nothing else until it is changed.
              user?.must_change_password ? (
                <ChangePasswordRequired user={user} onSignOut={logout} />
              ) : user ? (
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
