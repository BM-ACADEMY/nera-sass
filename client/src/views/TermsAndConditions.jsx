import React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import leadosLogo from '../assets/leadoslogo.png';
import { Building2, Globe, Mail, Phone, MapPin, FileText } from 'lucide-react';
import { useAuth } from '../hooks/useAuth.js';

export function TermsAndConditions() {
  const navigate = useNavigate();
  const { user } = useAuth();

  return (
    <div style={{
      minHeight: '100vh',
      width: '100%',
      overflowY: 'auto',
      WebkitOverflowScrolling: 'touch',
      background: '#040812',
      color: '#e2e8f0',
      fontFamily: "'Inter', system-ui, -apple-system, sans-serif",
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'space-between'
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

        {/* Auth CTAs */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button
            onClick={() => navigate(user ? '/dashboard' : '/login')}
            style={{
              background: 'linear-gradient(135deg, #f97316 0%, #ea580c 100%)',
              border: 'none',
              borderRadius: 9,
              padding: '9px 20px',
              color: '#fff',
              fontSize: 14,
              fontWeight: 600,
              cursor: 'pointer',
              boxShadow: '0 4px 20px rgba(249, 115, 22, 0.35)'
            }}>
            {user ? 'Dashboard' : 'Login'}
          </button>
        </div>
      </header>

      {/* Main Content */}
      <main style={{ maxWidth: 900, margin: '0 auto', padding: '48px 24px 80px' }}>
        <div style={{
          background: '#0c1525',
          border: '1px solid #1a2e4a',
          borderRadius: 20,
          padding: '40px 48px',
          boxShadow: '0 20px 60px rgba(0,0,0,0.5)'
        }}>
          {/* Document Header */}
          <div style={{ borderBottom: '1px solid #1a2e4a', pb: 24, marginBottom: 32 }}>
            <span style={{
              background: 'rgba(249,115,22,0.12)',
              color: '#f97316',
              border: '1px solid rgba(249,115,22,0.3)',
              borderRadius: 20,
              padding: '4px 14px',
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: 0.5,
              textTransform: 'uppercase',
              display: 'inline-block',
              marginBottom: 12
            }}>
              Legal Agreement
            </span>
            <h1 style={{ fontFamily: "'Syne', sans-serif", fontSize: 32, fontWeight: 800, color: '#f8fafc', margin: '0 0 8px 0' }}>
              Terms & Conditions
            </h1>
          </div>

          <article style={{ lineHeight: 1.7, fontSize: 14, color: '#cbd5e1' }}>
            <section style={{ marginBottom: 32 }}>
              <h2 style={{ fontSize: 20, fontWeight: 700, color: '#f1f5f9', borderLeft: '4px solid #f97316', paddingLeft: 12, marginBottom: 14 }}>
                1. Acceptance of Terms
              </h2>
              <p>
                These Terms and Conditions ("Terms") govern your access to and use of the <strong>LeadOS</strong> platform, website, applications, and services operated by <strong>ABM Groups - Powered by BM TechX</strong> ("we," "us," or "our").
              </p>
              <p style={{ marginTop: 12 }}>
                By creating an account, logging in, accessing, or using any part of LeadOS, you agree to be bound by these Terms. If you do not agree to all of these Terms, you must not use or access our services.
              </p>
            </section>

            <section style={{ marginBottom: 32 }}>
              <h2 style={{ fontSize: 20, fontWeight: 700, color: '#f1f5f9', borderLeft: '4px solid #f97316', paddingLeft: 12, marginBottom: 14 }}>
                2. Description of Services
              </h2>
              <p>
                LeadOS provides a cloud-based Software-as-a-Service (SaaS) platform designed for lead management, customer relationship management (CRM), AI-driven customer intelligence, message automation, and WhatsApp API communication tools.
              </p>
              <ul style={{ paddingLeft: 20, margin: '12px 0' }}>
                <li>Lead qualification, tracking, and pipeline management</li>
                <li>AI Brain analytics and automated interaction suggestions</li>
                <li>Messaging integrations including WhatsApp Business API</li>
                <li>Campaign tracking, reporting, and team collaboration tools</li>
              </ul>
            </section>

            <section style={{ marginBottom: 32 }}>
              <h2 style={{ fontSize: 20, fontWeight: 700, color: '#f1f5f9', borderLeft: '4px solid #f97316', paddingLeft: 12, marginBottom: 14 }}>
                3. User Account Responsibilities
              </h2>
              <p>
                To access LeadOS features, you must maintain active and valid credentials. You are responsible for:
              </p>
              <ul style={{ paddingLeft: 20, margin: '8px 0' }}>
                <li>Maintaining the strict confidentiality of your login credentials</li>
                <li>All activities, data entries, and communications conducted under your account</li>
                <li>Promptly notifying ABM Groups Support of any unauthorized account access</li>
              </ul>
            </section>

            <section style={{ marginBottom: 32 }}>
              <h2 style={{ fontSize: 20, fontWeight: 700, color: '#f1f5f9', borderLeft: '4px solid #f97316', paddingLeft: 12, marginBottom: 14 }}>
                4. Acceptable Use Policy & Compliance
              </h2>
              <p>
                You agree not to use LeadOS for any unlawful purpose or in violation of third-party policies. Specifically, you agree:
              </p>
              <ul style={{ paddingLeft: 20, margin: '8px 0' }}>
                <li>Not to send unsolicited bulk messages (spam) or violate Meta/WhatsApp Business Terms</li>
                <li>Not to upload or store harmful code, malware, or unlawful content</li>
                <li>Not to reverse engineer, decompile, or attempt to extract source code of LeadOS</li>
                <li>To obtain appropriate consent from contacts before sending communications</li>
              </ul>
            </section>

            <section style={{ marginBottom: 32 }}>
              <h2 style={{ fontSize: 20, fontWeight: 700, color: '#f1f5f9', borderLeft: '4px solid #f97316', paddingLeft: 12, marginBottom: 14 }}>
                5. Subscriptions, Fees & Payments
              </h2>
              <p>
                Access to certain features or plans requires a valid subscription. All fees are specified in your subscription agreement or order details. Fees are payable in advance and are non-refundable except as explicitly required by law or agreed in writing.
              </p>
            </section>

            <section style={{ marginBottom: 32 }}>
              <h2 style={{ fontSize: 20, fontWeight: 700, color: '#f1f5f9', borderLeft: '4px solid #f97316', paddingLeft: 12, marginBottom: 14 }}>
                6. Intellectual Property Rights
              </h2>
              <p>
                All rights, titles, and interests in LeadOS, including software code, interfaces, logos, trademarks ("LeadOS", "ABM Groups", "BM TechX"), and documentation are owned exclusively by ABM Groups and its licensors. You retain ownership of all lead data and content uploaded by you.
              </p>
            </section>

            <section style={{ marginBottom: 32 }}>
              <h2 style={{ fontSize: 20, fontWeight: 700, color: '#f1f5f9', borderLeft: '4px solid #f97316', paddingLeft: 12, marginBottom: 14 }}>
                7. Limitation of Liability
              </h2>
              <p>
                To the maximum extent permitted by applicable law, ABM Groups and BM TechX shall not be liable for any indirect, incidental, special, consequential, or punitive damages, or any loss of profits or revenues, arising out of your use of or inability to use the platform.
              </p>
            </section>

            <section style={{ marginBottom: 32 }}>
              <h2 style={{ fontSize: 20, fontWeight: 700, color: '#f1f5f9', borderLeft: '4px solid #f97316', paddingLeft: 12, marginBottom: 14 }}>
                8. Governing Law & Jurisdiction
              </h2>
              <p>
                These Terms are governed by and construed in accordance with the laws of <strong>Puducherry, India</strong>. Any legal dispute or claim arising under these Terms shall be subject to the exclusive jurisdiction of the courts located in Puducherry, India.
              </p>
            </section>

            <section style={{ marginBottom: 32 }}>
              <h2 style={{ fontSize: 20, fontWeight: 700, color: '#f1f5f9', borderLeft: '4px solid #f97316', paddingLeft: 12, marginBottom: 14 }}>
                9. Contact Information
              </h2>
              <div style={{ background: '#060c17', border: '1px solid #1a2e4a', borderRadius: 12, padding: 20, marginTop: 16 }}>
                <h4 style={{ margin: '0 0 10px 0', color: '#f8fafc', fontSize: 15 }}>Legal & Support Contacts</h4>
                <div style={{ fontSize: 13, color: '#94a3b8', display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <div><strong>Company:</strong> ABM Groups - Powered by BM TechX</div>
                  <div><strong>Email:</strong> <a href="mailto:admin@abmgroups.org" style={{ color: '#f97316' }}>admin@abmgroups.org</a></div>
                  <div><strong>Address:</strong> 252, 2nd Floor, MG Road, Kottakuppam, Vanur, Puducherry, 605104</div>
                  <div><strong>Phone:</strong> +91 9944940051</div>
                </div>
              </div>
            </section>
          </article>
        </div>
      </main>

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
  );
}

export default TermsAndConditions;
