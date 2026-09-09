import { useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useNavigate, Link } from 'react-router-dom';
import leadosLogo from './assets/leadoslogo.png';
import { Building2, Globe, Mail, Phone, MapPin, FileText, ShieldCheck, ArrowRight, Lock } from 'lucide-react';
import { STYLE } from './constants/theme.js';
import { PrivacyPolicy } from './views/PrivacyPolicy.jsx';
import { TermsAndConditions } from './views/TermsAndConditions.jsx';
import { LandingPage } from './views/LandingPage.jsx';
import { Sidebar } from './components/layout/Sidebar.jsx';
import { Header } from './components/layout/Header.jsx';
import { useAuth } from './hooks/useAuth.js';
import { Dashboard } from './views/Dashboard.jsx';
import { SalesTasksView } from './views/SalesTasksView.jsx';
import { LeadsView } from './views/LeadsView.jsx';
import { InboxView } from './views/InboxView.jsx';
import { CampaignsView } from './views/CampaignsView.jsx';
import { TemplatesView } from './views/TemplatesView.jsx';
import { AIBrainView } from './views/AIBrainView.jsx';
import { AIImageGeneratorView } from './views/AIImageGeneratorView.jsx';
import { ReportsView } from './views/ReportsView.jsx';
import { FounderReportsView } from './views/FounderReportsView.jsx';
import { ClientsView } from './views/ClientsView.jsx';
import { SettingsView } from './views/SettingsView.jsx';
import { WorkflowsView } from './views/WorkflowsView.jsx';
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
import ContentOSDashboard from '../contentos/ContentOSDashboard.jsx';

import KeywordTracking from './views/thedal/KeywordTracking.jsx';
import ThedalHQ from './views/thedal/ThedalHQ.jsx';
import GscIntel from './views/thedal/GscIntel.jsx';
import OnPageAudit from './views/thedal/OnPageAudit.jsx';
import ContentFactory from './views/thedal/ContentFactory.jsx';
import MonthlyReport from './views/thedal/MonthlyReport.jsx';
import RankDropAlert from './views/thedal/RankDropAlert.jsx';
import ClientOnboard from './views/thedal/ClientOnboard.jsx';
import SerpRadar from './views/thedal/SerpRadar.jsx';
import GapHunter from './views/thedal/GapHunter.jsx';
import SchemaLibrary from './views/thedal/SchemaLibrary.jsx';
import CompetitorSpy from './views/thedal/CompetitorSpy.jsx';
import BacklinkTracker from './views/thedal/BacklinkTracker.jsx';
import LocalCitations from './views/thedal/LocalCitations.jsx';
import LocalSeoBridge from './views/thedal/LocalSeoBridge.jsx';
import PlanManagement from './views/thedal/PlanManagement.jsx';
import PlanSubscription from './views/thedal/PlanSubscription.jsx';
import { ClientProvider } from './contexts/ClientContext.jsx';
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

function LoginPage({ login, authLoading, authError }) {
  const [email, setEmail] = useState('');
  const [pass, setPass] = useState('');
  const [loginError, setLoginError] = useState('');
  const navigate = useNavigate();

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoginError('');
    const success = await login(email, pass);
    if (!success) {
      setLoginError('Invalid email or password');
    }
  };

  return (
    <>
      <style>{STYLE}</style>
      <div style={{
        minHeight: '100vh',
        width: '100%',
        background: '#040812',
        color: '#e2e8f0',
        fontFamily: "'Inter', system-ui, -apple-system, sans-serif",
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        overflowX: 'hidden'
      }}>
        {/* ---------------- STICKY NAVBAR ---------------- */}
        <header style={{
          position: 'sticky',
          top: 0,
          zIndex: 100,
          background: 'rgba(6, 12, 23, 0.85)',
          backdropFilter: 'blur(16px)',
          borderBottom: '1px solid rgba(30, 41, 59, 0.7)',
          padding: '14px 28px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between'
        }}>
          {/* Logo */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, cursor: 'pointer' }} onClick={() => navigate('/')}>
            <img
              src={leadosLogo}
              alt="Lead OS Logo"
              style={{
                height: 56,
                width: 'auto',
                objectFit: 'contain',
                borderRadius: 8,
                filter: 'drop-shadow(0 2px 10px rgba(249, 115, 22, 0.35))'
              }}
            />
            <div>
              <div style={{ fontFamily: "'Syne', sans-serif", fontWeight: 800, fontSize: 22, color: '#f8fafc', letterSpacing: '-0.02em', lineHeight: 1.1 }}>
                Lead OS
              </div>
            </div>
          </div>

          {/* Navigation Links */}
          <nav style={{ display: 'flex', alignItems: 'center', gap: 24 }} className="nav-links">
            <Link to="/#about" style={{ color: '#94a3b8', textDecoration: 'none', fontSize: 14, fontWeight: 500, transition: 'color 0.2s' }}>About Lead OS</Link>
            <Link to="/#how-it-works" style={{ color: '#94a3b8', textDecoration: 'none', fontSize: 14, fontWeight: 500, transition: 'color 0.2s' }}>How It Works</Link>
            <Link to="/#security" style={{ color: '#94a3b8', textDecoration: 'none', fontSize: 14, fontWeight: 500, transition: 'color 0.2s' }}>Security & OAuth</Link>
            <Link to="/#preview" style={{ color: '#94a3b8', textDecoration: 'none', fontSize: 14, fontWeight: 500, transition: 'color 0.2s' }}>Dashboard Preview</Link>
            <Link to="/#faq" style={{ color: '#94a3b8', textDecoration: 'none', fontSize: 14, fontWeight: 500, transition: 'color 0.2s' }}>FAQ</Link>
          </nav>

          {/* Home CTA */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <button
              onClick={() => navigate('/')}
              style={{
                background: 'transparent',
                border: '1px solid #334155',
                borderRadius: 9,
                padding: '9px 18px',
                color: '#e2e8f0',
                fontSize: 14,
                fontWeight: 600,
                cursor: 'pointer',
                transition: 'all 0.2s'
              }}>
              ← Home Page
            </button>
          </div>
        </header>

        {/* ---------------- LOGIN CARD CONTAINER ---------------- */}
        <div style={{
          padding: '60px 20px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          position: 'relative'
        }}>
          <div style={{
            position: 'absolute',
            inset: 0,
            background: 'radial-gradient(circle at 25% 25%, rgba(249,115,22,0.06) 0%, transparent 50%), radial-gradient(circle at 75% 75%, rgba(59,130,246,0.06) 0%, transparent 50%)',
            pointerEvents: 'none'
          }} />

          <div style={{
            background: '#0c1525',
            border: '1px solid #1a2e4a',
            borderRadius: 18,
            padding: 42,
            width: 420,
            maxWidth: '100%',
            position: 'relative',
            boxShadow: '0 20px 60px rgba(0,0,0,0.6)'
          }}>
            <div style={{ textAlign: 'center', marginBottom: 30 }}>
              <img
                src={leadosLogo}
                alt="Lead OS Logo"
                style={{
                  height: 52,
                  width: 'auto',
                  objectFit: 'contain',
                  margin: '0 auto 12px auto',
                  filter: 'drop-shadow(0 2px 10px rgba(249, 115, 22, 0.35))'
                }}
              />
              <h1 style={{ fontFamily: "'Syne', sans-serif", fontSize: 24, fontWeight: 800, color: '#f8fafc' }}>
                Sign In to Lead OS
              </h1>
              <p style={{ color: '#64748b', fontSize: 12, marginTop: 4 }}>
                ABM Groups - Powered by BM TechX
              </p>
            </div>

            <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div>
                <label style={{ display: 'block', fontSize: 10, color: '#64748b', marginBottom: 6, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase' }}>Email</label>
                <input
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  type="email"
                  placeholder="Enter email"
                  style={{ width: '100%', background: '#060c17', border: '1px solid #1a2e4a', borderRadius: 9, padding: '12px 14px', color: '#e2e8f0', fontSize: 13, outline: 'none' }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: 10, color: '#64748b', marginBottom: 6, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase' }}>Password</label>
                <input
                  value={pass}
                  onChange={(e) => setPass(e.target.value)}
                  type="password"
                  placeholder="Enter password"
                  style={{ width: '100%', background: '#060c17', border: '1px solid #1a2e4a', borderRadius: 9, padding: '12px 14px', color: '#e2e8f0', fontSize: 13, outline: 'none' }}
                />
              </div>

              {(loginError || authError) && (
                <div style={{ background: '#2d1010', border: '1px solid #7c2d12', borderRadius: 7, padding: 10, color: '#ef4444', fontSize: 12 }}>
                  {loginError || authError}
                </div>
              )}

              <button
                type="submit"
                disabled={authLoading}
                style={{
                  width: '100%',
                  background: 'linear-gradient(135deg, #f97316 0%, #ea580c 100%)',
                  border: 'none',
                  borderRadius: 9,
                  padding: 14,
                  color: '#fff',
                  fontSize: 14,
                  fontWeight: 700,
                  boxShadow: '0 4px 20px rgba(249, 115, 22, 0.35)',
                  opacity: authLoading ? 0.6 : 1,
                  cursor: authLoading ? 'not-allowed' : 'pointer'
                }}>
                {authLoading ? 'Signing in...' : 'Sign In to Lead OS'}
              </button>
            </form>

            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 14, marginTop: 24, paddingTop: 18, borderTop: '1px solid #1a2e4a', fontSize: 12 }}>
              <Link to="/" style={{ color: '#f97316', textDecoration: 'none', fontWeight: 600 }}>
                ← Back to Home
              </Link>
              <span style={{ color: '#334155' }}>•</span>
              <Link to="/privacy-policy" style={{ color: '#94a3b8', textDecoration: 'none', fontWeight: 500 }}>
                Privacy Policy
              </Link>
            </div>
          </div>
        </div>

        {/* ---------------- GOOGLE DISCLAIMER BANNER ---------------- */}
        <section style={{
          padding: '20px 20px',
          maxWidth: 1050,
          margin: '20px auto 0 auto',
          textAlign: 'center',
          borderTop: '1px solid rgba(30, 41, 59, 0.5)'
        }}>
          <p style={{
            fontSize: 11,
            color: '#64748b',
            lineHeight: 1.6,
            maxWidth: 820,
            margin: '0 auto'
          }}>
            <strong>Disclaimer:</strong> Lead OS uses Google Business Profile APIs and Google OAuth 2.0 for authentication. Lead OS is an independent application and is not affiliated with, endorsed by, or sponsored by Google LLC.
          </p>
        </section>

        {/* ---------------- FOOTER WITH CONTACT & LEGAL ---------------- */}
        <footer style={{
          background: '#02050c',
          borderTop: '1px solid #1a2e4a',
          padding: '40px 24px 30px 24px',
          marginTop: 20
        }}>
          <div style={{ maxWidth: 1050, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 30 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 30 }}>
              {/* Column 1 - App Branding */}
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
                  <img
                    src={leadosLogo}
                    alt="Lead OS Logo"
                    style={{
                      height: 48,
                      width: 'auto',
                      objectFit: 'contain',
                      borderRadius: 8,
                      filter: 'drop-shadow(0 2px 8px rgba(249, 115, 22, 0.3))'
                    }}
                  />
                  <span style={{ fontFamily: "'Syne', sans-serif", fontWeight: 800, fontSize: 20, color: '#f8fafc' }}>Lead OS</span>
                </div>
                <p style={{ fontSize: 12, color: '#64748b', maxWidth: 300, lineHeight: 1.5 }}>
                  Lead OS is an AI-powered Google Business Profile management platform.
                </p>
                <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 8, fontWeight: 600 }}>
                  ABM Groups - Powered by BM TechX
                </div>
              </div>

              {/* Column 2 - Organization & Contact Info */}
              <div style={{ maxWidth: 340 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#f97316', marginBottom: 10, textTransform: 'uppercase' }}>Organization & Contact</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10, fontSize: 12, color: '#94a3b8' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Building2 size={15} style={{ color: '#f97316', flexShrink: 0 }} />
                    <span>Company: <b>ABM Groups - Powered by BM TechX</b></span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Globe size={15} style={{ color: '#a855f7', flexShrink: 0 }} />
                    <span>Website: <a href="https://abmgroups.org" target="_blank" rel="noopener noreferrer" style={{ color: '#a855f7', textDecoration: 'none' }}>abmgroups.org</a></span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Mail size={15} style={{ color: '#38bdf8', flexShrink: 0 }} />
                    <span>Support Email: <a href="mailto:admin@abmgroups.org" style={{ color: '#38bdf8', textDecoration: 'none' }}>admin@abmgroups.org</a></span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Phone size={15} style={{ color: '#10b981', flexShrink: 0 }} />
                    <span>Phone: <a href="tel:+919944940051" style={{ color: '#10b981', textDecoration: 'none' }}>+91 9944940051</a></span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                    <MapPin size={15} style={{ color: '#f59e0b', flexShrink: 0, marginTop: 2 }} />
                    <span style={{ lineHeight: 1.4 }}>Address: 252, 2nd Floor, MG Road, Kottakuppam, Vanur, Puducherry, 605104</span>
                  </div>
                </div>
              </div>

              {/* Column 3 - Legal Links */}
              <div>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#f97316', marginBottom: 10, textTransform: 'uppercase' }}>Legal Policies</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 12 }}>
                  <Link to="/privacy-policy" style={{ color: '#94a3b8', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 6 }}>
                    <FileText size={14} />
                    <span>Privacy Policy</span>
                  </Link>
                  <Link to="/terms-and-conditions" style={{ color: '#94a3b8', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 6 }}>
                    <FileText size={14} />
                    <span>Terms & Conditions</span>
                  </Link>
                </div>
              </div>
            </div>

            <div style={{ borderTop: '1px solid #1e293b', paddingTop: 20, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 14, fontSize: 12, color: '#64748b' }}>
              <div>© {new Date().getFullYear()} Lead OS • ABM Groups. All rights reserved.</div>
              <div style={{ display: 'flex', gap: 16 }}>
                <span>Secure Google OAuth 2.0 Integration</span>
              </div>
            </div>
          </div>
        </footer>
      </div>
    </>
  );
}

import { Toaster } from 'react-hot-toast';

function AppLayout({ user, logout, leadRefresh, setLeadRefresh }) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const navigate = useNavigate();

  const handleLeadClick = (lead) => {
    navigate('/inbox', { state: { leadId: lead.id } });
  };
  return (
    <>
      <style>{STYLE}</style>
      <Toaster position="top-right" containerStyle={{ zIndex: 999999 }} toastOptions={{ style: { background: '#1e293b', color: '#e2e8f0', border: '1px solid #334155' } }} />
      <div style={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>
        <Sidebar onLogout={logout} mobileOpen={mobileMenuOpen} setMobileOpen={setMobileMenuOpen} />
        <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden', width: '100%' }}>
          <Header user={user} onMenuClick={() => setMobileMenuOpen(true)} />
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
              <Route path="/founder-reports" element={<FounderReportsView />} />
              <Route path="/clients" element={<ClientsView />} />
              <Route path="/settings" element={<SettingsView />} />
              <Route path="/workflows" element={<WorkflowsView />} />
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

              <Route path="/thedal/clients" element={<ClientOnboard />} />
              <Route path="/thedal/plan-subscription" element={<PlanSubscription />} />
              <Route path="/thedal/plans" element={<PlanManagement />} />
              <Route path="/thedal" element={<ThedalHQ />} />
              <Route path="/thedal/keyword-tracking" element={<KeywordTracking />} />
              <Route path="/thedal/gsc-intel" element={<GscIntel />} />
              <Route path="/thedal/on-page-audit" element={<OnPageAudit />} />
              <Route path="/thedal/content-factory" element={<ContentFactory />} />
              <Route path="/thedal/monthly-report" element={<MonthlyReport />} />
              <Route path="/thedal/rank-drop-alert" element={<RankDropAlert />} />
              <Route path="/thedal/serp-radar" element={<SerpRadar />} />
              <Route path="/thedal/gap-hunter" element={<GapHunter />} />
              <Route path="/thedal/schema-library" element={<SchemaLibrary />} />
              <Route path="/thedal/competitor-spy" element={<CompetitorSpy />} />
              <Route path="/thedal/backlink-tracker" element={<BacklinkTracker />} />
              <Route path="/thedal/local-citations" element={<LocalCitations />} />
              <Route path="/thedal/local-seo-bridge" element={<LocalSeoBridge />} />

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
              <Route path="/landing" element={<LandingPage />} />

              <Route path="*" element={<Navigate to="/dashboard" replace />} />
            </Routes>
          </div>
        </div>
      </div>
    </>
  );
}

export default function App() {
  const { user, login, logout, loading: authLoading, error: authError } = useAuth();
  const [selectedLead, setSelectedLead] = useState(null);
  const [leadRefresh, setLeadRefresh] = useState(0);

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/privacy-policy" element={<PrivacyPolicy />} />
        <Route path="/terms-and-conditions" element={<TermsAndConditions />} />
        <Route path="/landing" element={<LandingPage />} />
        <Route
          path="/login"
          element={
            user ? (
              <Navigate to="/dashboard" replace />
            ) : (
              <LoginPage login={login} authLoading={authLoading} authError={authError} />
            )
          }
        />
        <Route
          path="*"
          element={
            user ? (
              <ClientProvider>
                <AppLayout
                  user={user}
                  logout={logout}
                  leadRefresh={leadRefresh}
                  setLeadRefresh={setLeadRefresh}
                />
              </ClientProvider>
            ) : (
              <LandingPage />
            )
          }
        />
      </Routes>
    </BrowserRouter>
  );
}
