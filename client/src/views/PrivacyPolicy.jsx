import React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import leadosLogo from '../assets/leadoslogo.png';
import { Building2, Globe, Mail, Phone, MapPin, FileText } from 'lucide-react';
import { useAuth } from '../hooks/useAuth.js';

export function PrivacyPolicy() {
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
              Legal Document
            </span>
            <h1 style={{ fontFamily: "'Syne', sans-serif", fontSize: 32, fontWeight: 800, color: '#f8fafc', margin: '0 0 8px 0' }}>
              Lead OS Privacy Policy
            </h1>
          </div>

          <article style={{ lineHeight: 1.7, fontSize: 14, color: '#cbd5e1' }}>
            <section style={{ marginBottom: 32 }}>
              <h2 style={{ fontSize: 20, fontWeight: 700, color: '#f1f5f9', borderLeft: '4px solid #f97316', paddingLeft: 12, marginBottom: 14 }}>
                1. Introduction
              </h2>
              <p>
                Welcome to <strong>Lead OS</strong> ("we," "our," or "us"). We are committed to protecting your privacy and ensuring the security of your personal information. This Privacy Policy explains how we collect, use, disclose, and safeguard your data when you use our Lead OS application and related services.
              </p>
              <p style={{ marginTop: 12 }}>
                By accessing or using Lead OS, you agree to the terms of this Privacy Policy. If you do not agree with the practices described herein, please do not use our services.
              </p>
            </section>

            <section style={{ marginBottom: 32 }}>
              <h2 style={{ fontSize: 20, fontWeight: 700, color: '#f1f5f9', borderLeft: '4px solid #f97316', paddingLeft: 12, marginBottom: 14 }}>
                2. Information We Collect
              </h2>
              <h3 style={{ fontSize: 16, fontWeight: 600, color: '#e2e8f0', marginTop: 16, marginBottom: 10 }}>2.1 Personal Information</h3>
              <p>We collect the following categories of personal information from our users and leads:</p>
              <div style={{ overflowX: 'auto', margin: '16px 0' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', background: '#060c17', borderRadius: 10, border: '1px solid #1a2e4a' }}>
                  <thead>
                    <tr style={{ background: '#111d33', textTransform: 'uppercase', fontSize: 11, color: '#94a3b8', textAlign: 'left' }}>
                      <th style={{ padding: '12px 16px', borderBottom: '1px solid #1a2e4a' }}>Category</th>
                      <th style={{ padding: '12px 16px', borderBottom: '1px solid #1a2e4a' }}>Examples</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td style={{ padding: '10px 16px', borderBottom: '1px solid #1a2e4a', fontWeight: 600, color: '#f8fafc' }}>Contact Information</td>
                      <td style={{ padding: '10px 16px', borderBottom: '1px solid #1a2e4a', color: '#94a3b8' }}>Name, phone number, email address, physical address</td>
                    </tr>
                    <tr>
                      <td style={{ padding: '10px 16px', borderBottom: '1px solid #1a2e4a', fontWeight: 600, color: '#f8fafc' }}>Business Information</td>
                      <td style={{ padding: '10px 16px', borderBottom: '1px solid #1a2e4a', color: '#94a3b8' }}>Brand name, company name, business type, industry</td>
                    </tr>
                    <tr>
                      <td style={{ padding: '10px 16px', borderBottom: '1px solid #1a2e4a', fontWeight: 600, color: '#f8fafc' }}>Lead Details</td>
                      <td style={{ padding: '10px 16px', borderBottom: '1px solid #1a2e4a', color: '#94a3b8' }}>Interest level, lead source, assigned representative, conversation history</td>
                    </tr>
                    <tr>
                      <td style={{ padding: '10px 16px', borderBottom: '1px solid #1a2e4a', fontWeight: 600, color: '#f8fafc' }}>Communication Data</td>
                      <td style={{ padding: '10px 16px', borderBottom: '1px solid #1a2e4a', color: '#94a3b8' }}>WhatsApp messages, SMS content, email correspondence</td>
                    </tr>
                    <tr>
                      <td style={{ padding: '10px 16px', fontWeight: 600, color: '#f8fafc' }}>Account Credentials</td>
                      <td style={{ padding: '10px 16px', color: '#94a3b8' }}>Username, password (encrypted), authentication tokens</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <h3 style={{ fontSize: 16, fontWeight: 600, color: '#e2e8f0', marginTop: 20, marginBottom: 10 }}>2.2 Automatically Collected Information</h3>
              <p>When you access our platform, we automatically collect:</p>
              <ul style={{ paddingLeft: 20, margin: '8px 0' }}>
                <li><strong>Device Information:</strong> IP address, browser type, operating system, device identifiers.</li>
                <li><strong>Usage Data:</strong> Pages visited, features used, time spent on application, interaction patterns.</li>
                <li><strong>Analytics Data:</strong> Navigation paths, click streams, session duration, error logs.</li>
              </ul>

              <h3 style={{ fontSize: 16, fontWeight: 600, color: '#e2e8f0', marginTop: 20, marginBottom: 10 }}>2.3 Information from Third Parties</h3>
              <p>We may receive information from third-party sources including WhatsApp API (message content, sender information), integration partners, CRM systems, advertising & lead generation platforms, and publicly available business directories.</p>
            </section>

            <section style={{ marginBottom: 32 }}>
              <h2 style={{ fontSize: 20, fontWeight: 700, color: '#f1f5f9', borderLeft: '4px solid #f97316', paddingLeft: 12, marginBottom: 14 }}>
                3. How We Use Your Information
              </h2>
              <h3 style={{ fontSize: 16, fontWeight: 600, color: '#e2e8f0', marginTop: 16, marginBottom: 10 }}>3.1 Primary Uses</h3>
              <ol style={{ paddingLeft: 20, margin: '8px 0' }}>
                <li style={{ marginBottom: 10 }}>
                  <strong>Lead Management:</strong> Creating, updating, and managing lead profiles; tracking lead status and progression through sales pipelines; assigning leads to sales representatives; recording lead interactions and conversation history.
                </li>
                <li style={{ marginBottom: 10 }}>
                  <strong>Communication Services:</strong> Sending and receiving WhatsApp messages; facilitating two-way communication between leads and our team; automating message responses and follow-ups; managing inbox conversations and message history.
                </li>
                <li style={{ marginBottom: 10 }}>
                  <strong>AI-Powered Features:</strong> Analyzing lead conversations using AI brain functionality; scoring and qualifying leads based on interaction patterns; generating automated responses and content suggestions; identifying potential opportunities and gaps.
                </li>
                <li style={{ marginBottom: 10 }}>
                  <strong>Business Operations:</strong> Campaign management and tracking; performance analytics and reporting; client subscription and billing management; template management for communications.
                </li>
              </ol>

              <h3 style={{ fontSize: 16, fontWeight: 600, color: '#e2e8f0', marginTop: 20, marginBottom: 10 }}>3.2 Additional Uses</h3>
              <p>We may also use your information for improving and optimizing platform functionality, conducting research and analytics, detecting and preventing fraudulent activities, and complying with legal obligations.</p>
            </section>

            <section style={{ marginBottom: 32 }}>
              <h2 style={{ fontSize: 20, fontWeight: 700, color: '#f1f5f9', borderLeft: '4px solid #f97316', paddingLeft: 12, marginBottom: 14 }}>
                4. Data Storage and Security
              </h2>
              <p><strong>Location:</strong> Your data is stored on secure servers operated by us or our third-party hosting providers.</p>
              <p><strong>Retention:</strong> We retain personal information for as long as your account is active or as needed to provide services.</p>
              <p><strong>Backup:</strong> Regular automated backups are performed to ensure data integrity.</p>

              <h3 style={{ fontSize: 16, fontWeight: 600, color: '#e2e8f0', marginTop: 16, marginBottom: 10 }}>4.1 Security Measures</h3>
              <div style={{ overflowX: 'auto', margin: '16px 0' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', background: '#060c17', borderRadius: 10, border: '1px solid #1a2e4a' }}>
                  <thead>
                    <tr style={{ background: '#111d33', textTransform: 'uppercase', fontSize: 11, color: '#94a3b8', textAlign: 'left' }}>
                      <th style={{ padding: '12px 16px', borderBottom: '1px solid #1a2e4a' }}>Security Layer</th>
                      <th style={{ padding: '12px 16px', borderBottom: '1px solid #1a2e4a' }}>Implementation</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td style={{ padding: '10px 16px', borderBottom: '1px solid #1a2e4a', fontWeight: 600, color: '#f8fafc' }}>Encryption</td>
                      <td style={{ padding: '10px 16px', borderBottom: '1px solid #1a2e4a', color: '#94a3b8' }}>TLS/SSL encryption for data in transit; AES-256 encryption for data at rest</td>
                    </tr>
                    <tr>
                      <td style={{ padding: '10px 16px', borderBottom: '1px solid #1a2e4a', fontWeight: 600, color: '#f8fafc' }}>Access Control</td>
                      <td style={{ padding: '10px 16px', borderBottom: '1px solid #1a2e4a', color: '#94a3b8' }}>Role-based access control (RBAC) limiting data access to authorized personnel</td>
                    </tr>
                    <tr>
                      <td style={{ padding: '10px 16px', borderBottom: '1px solid #1a2e4a', fontWeight: 600, color: '#f8fafc' }}>Authentication</td>
                      <td style={{ padding: '10px 16px', borderBottom: '1px solid #1a2e4a', color: '#94a3b8' }}>Secure login with password protection and session management</td>
                    </tr>
                    <tr>
                      <td style={{ padding: '10px 16px', borderBottom: '1px solid #1a2e4a', fontWeight: 600, color: '#f8fafc' }}>Monitoring</td>
                      <td style={{ padding: '10px 16px', borderBottom: '1px solid #1a2e4a', color: '#94a3b8' }}>Regular security audits, logging, and intrusion detection systems</td>
                    </tr>
                    <tr>
                      <td style={{ padding: '10px 16px', fontWeight: 600, color: '#f8fafc' }}>Training</td>
                      <td style={{ padding: '10px 16px', color: '#94a3b8' }}>Staff training on data protection and privacy best practices</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </section>

            <section style={{ marginBottom: 32 }}>
              <h2 style={{ fontSize: 20, fontWeight: 700, color: '#f1f5f9', borderLeft: '4px solid #f97316', paddingLeft: 12, marginBottom: 14 }}>
                5. Data Sharing and Disclosure
              </h2>
              <p>We may share your information with your consent, with vetted service providers (hosting, AI, WhatsApp Meta API, payment processors), during business transfers, or to comply with legal requirements.</p>
              <div style={{ background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.3)', borderRadius: 10, padding: 16, marginTop: 16, color: '#fca5a5' }}>
                <strong>No Sale of Personal Information:</strong> We do not sell, rent, or trade your personal information to third parties for marketing purposes.
              </div>
            </section>

            <section style={{ marginBottom: 32 }}>
              <h2 style={{ fontSize: 20, fontWeight: 700, color: '#f1f5f9', borderLeft: '4px solid #f97316', paddingLeft: 12, marginBottom: 14 }}>
                6. Your Rights and Choices
              </h2>
              <p>You have the right to request access to your personal information, request correction or deletion, obtain data portability, and opt out of marketing communications.</p>
              <p style={{ marginTop: 12 }}>
                To exercise any of these rights, please contact our Data Protection Officer at: <strong>admin@abmgroups.org</strong>. We will respond to your request within 30 days of receipt.
              </p>
            </section>

            <section style={{ marginBottom: 32 }}>
              <h2 style={{ fontSize: 20, fontWeight: 700, color: '#f1f5f9', borderLeft: '4px solid #f97316', paddingLeft: 12, marginBottom: 14 }}>
                7. Data Retention Periods
              </h2>
              <div style={{ overflowX: 'auto', margin: '16px 0' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', background: '#060c17', borderRadius: 10, border: '1px solid #1a2e4a' }}>
                  <thead>
                    <tr style={{ background: '#111d33', textTransform: 'uppercase', fontSize: 11, color: '#94a3b8', textAlign: 'left' }}>
                      <th style={{ padding: '12px 16px', borderBottom: '1px solid #1a2e4a' }}>Data Category</th>
                      <th style={{ padding: '12px 16px', borderBottom: '1px solid #1a2e4a' }}>Retention Period</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td style={{ padding: '10px 16px', borderBottom: '1px solid #1a2e4a', fontWeight: 600, color: '#f8fafc' }}>Active Lead Data</td>
                      <td style={{ padding: '10px 16px', borderBottom: '1px solid #1a2e4a', color: '#94a3b8' }}>While account is active + 2 years</td>
                    </tr>
                    <tr>
                      <td style={{ padding: '10px 16px', borderBottom: '1px solid #1a2e4a', fontWeight: 600, color: '#f8fafc' }}>Conversation History</td>
                      <td style={{ padding: '10px 16px', borderBottom: '1px solid #1a2e4a', color: '#94a3b8' }}>3 years from date of interaction</td>
                    </tr>
                    <tr>
                      <td style={{ padding: '10px 16px', borderBottom: '1px solid #1a2e4a', fontWeight: 600, color: '#f8fafc' }}>Account Credentials</td>
                      <td style={{ padding: '10px 16px', borderBottom: '1px solid #1a2e4a', color: '#94a3b8' }}>Duration of account activity</td>
                    </tr>
                    <tr>
                      <td style={{ padding: '10px 16px', fontWeight: 600, color: '#f8fafc' }}>Analytics Data</td>
                      <td style={{ padding: '10px 16px', color: '#94a3b8' }}>1 year from date of collection</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </section>

            <section style={{ marginBottom: 32 }}>
              <h2 style={{ fontSize: 20, fontWeight: 700, color: '#f1f5f9', borderLeft: '4px solid #f97316', paddingLeft: 12, marginBottom: 14 }}>
                8. Governing Law & Contact Information
              </h2>
              <p>This Privacy Policy shall be governed by and construed in accordance with the laws of <strong>Puducherry, India</strong>.</p>

              <div style={{ background: '#060c17', border: '1px solid #1a2e4a', borderRadius: 12, padding: 20, marginTop: 16 }}>
                <h4 style={{ margin: '0 0 10px 0', color: '#f8fafc', fontSize: 15 }}>Contact Details</h4>
                <div style={{ fontSize: 13, color: '#94a3b8', display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <div><strong>Data Protection Officer:</strong> ABM Groups Support Team</div>
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

export default PrivacyPolicy;
