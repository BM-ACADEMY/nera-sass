import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import leadosLogo from '../assets/leadoslogo.png';
import {
  Zap,
  Target,
  Share2,
  Search,
  MapPin,
  ShieldCheck,
  Users,
  CheckCircle2,
  ArrowRight,
  Sparkles,
  Layers,
  ChevronDown,
  ChevronUp,
  Lock,
  Mail,
  Phone,
  Building2,
  MessageSquare,
  BarChart3,
  Globe,
  FileText,
  Star,
  Clock,
  ExternalLink
} from 'lucide-react';

export function LandingPage() {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState('reviews');
  const [openFaqIndex, setOpenFaqIndex] = useState(0);

  const toggleFaq = (index) => {
    setOpenFaqIndex(openFaqIndex === index ? null : index);
  };

  return (
    <div style={{
      minHeight: '100vh',
      width: '100%',
      background: '#040812',
      color: '#e2e8f0',
      fontFamily: "'Inter', system-ui, -apple-system, sans-serif",
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
          <a href="#about" style={{ color: '#94a3b8', textDecoration: 'none', fontSize: 14, fontWeight: 500, transition: 'color 0.2s' }}>About Lead OS</a>
          <a href="#how-it-works" style={{ color: '#94a3b8', textDecoration: 'none', fontSize: 14, fontWeight: 500, transition: 'color 0.2s' }}>How It Works</a>
          <a href="#security" style={{ color: '#94a3b8', textDecoration: 'none', fontSize: 14, fontWeight: 500, transition: 'color 0.2s' }}>Security & OAuth</a>
          <a href="#preview" style={{ color: '#94a3b8', textDecoration: 'none', fontSize: 14, fontWeight: 500, transition: 'color 0.2s' }}>Dashboard Preview</a>
          <a href="#faq" style={{ color: '#94a3b8', textDecoration: 'none', fontSize: 14, fontWeight: 500, transition: 'color 0.2s' }}>FAQ</a>
        </nav>

        {/* Auth CTAs */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button
            onClick={() => navigate('/login')}
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
            Login
          </button>
          <button
            onClick={() => navigate('/login')}
            style={{
              background: 'linear-gradient(135deg, #f97316 0%, #ea580c 100%)',
              border: 'none',
              borderRadius: 9,
              padding: '9px 20px',
              color: '#fff',
              fontSize: 14,
              fontWeight: 600,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              boxShadow: '0 4px 20px rgba(249, 115, 22, 0.35)',
              transition: 'all 0.2s'
            }}>
            <span>Get Started</span>
            <ArrowRight size={16} />
          </button>
        </div>
      </header>

      {/* ---------------- 1. HERO SECTION ---------------- */}
      <section style={{
        position: 'relative',
        padding: '60px 20px 50px 20px',
        maxWidth: 1050,
        margin: '0 auto',
        textAlign: 'center'
      }}>
        {/* Glow background */}
        <div style={{
          position: 'absolute',
          top: -40,
          left: '50%',
          transform: 'translateX(-50%)',
          width: 550,
          height: 300,
          background: 'radial-gradient(circle, rgba(249, 115, 22, 0.15) 0%, rgba(59, 130, 246, 0.06) 50%, transparent 80%)',
          filter: 'blur(50px)',
          pointerEvents: 'none',
          zIndex: 0
        }} />

        <div style={{ position: 'relative', zIndex: 1 }}>
          {/* Top Google OAuth Badge */}
          <div style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
            background: 'rgba(59, 130, 246, 0.1)',
            border: '1px solid rgba(59, 130, 246, 0.25)',
            borderRadius: 30,
            padding: '5px 16px',
            color: '#38bdf8',
            fontSize: 12,
            fontWeight: 600,
            marginBottom: 20
          }}>
            <ShieldCheck size={15} />
            <span>Built with Google Business Profile APIs & Secure OAuth 2.0</span>
          </div>

          {/* H1 - App Name */}
          <h1 style={{
            fontFamily: "'Syne', sans-serif",
            fontSize: 'calc(2.2rem + 1.2vw)',
            fontWeight: 800,
            lineHeight: 1.1,
            color: '#f8fafc',
            letterSpacing: '-0.02em',
            marginBottom: 10
          }}>
            Lead OS
          </h1>

          {/* H2 - Platform Focus */}
          <h2 style={{
            fontFamily: "'Syne', sans-serif",
            fontSize: 'calc(1.2rem + 0.8vw)',
            fontWeight: 700,
            lineHeight: 1.25,
            color: '#f97316',
            marginBottom: 20
          }}>
            AI-Powered Google Business Profile Management Platform
          </h2>

          {/* Description */}
          <p style={{
            fontSize: 16,
            color: '#94a3b8',
            maxWidth: 800,
            margin: '0 auto 24px auto',
            lineHeight: 1.6
          }}>
            Lead OS is an AI-powered platform that helps businesses and agencies manage Google Business Profiles, Google Reviews, Google Posts, Business Information, Business Insights, Multi-location listings, and Local SEO from one centralized dashboard.
          </p>

          {/* Hero Trust Badges */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 10,
            flexWrap: 'wrap',
            maxWidth: 820,
            margin: '0 auto 30px auto'
          }}>
            {[
              'Google Business Profile',
              'Google Reviews',
              'Google Posts',
              'Business Insights',
              'Multi-location Management',
              'Local SEO'
            ].map((badge, i) => (
              <span key={i} style={{
                background: 'rgba(15, 23, 42, 0.75)',
                border: '1px solid #1e293b',
                borderRadius: 20,
                padding: '5px 14px',
                fontSize: 12,
                color: '#cbd5e1',
                fontWeight: 600,
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6
              }}>
                <CheckCircle2 size={13} style={{ color: '#10b981' }} />
                <span>{badge}</span>
              </span>
            ))}
          </div>

          {/* Hero CTAs */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 14 }}>
            <button
              onClick={() => navigate('/login')}
              style={{
                background: 'linear-gradient(135deg, #f97316 0%, #ea580c 100%)',
                border: 'none',
                borderRadius: 10,
                padding: '14px 32px',
                color: '#fff',
                fontSize: 15,
                fontWeight: 700,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                boxShadow: '0 6px 24px rgba(249, 115, 22, 0.35)',
                transition: 'transform 0.2s, box-shadow 0.2s'
              }}>
              <span>Get Started</span>
              <ArrowRight size={18} />
            </button>
          </div>
        </div>
      </section>

      {/* ---------------- 2. ABOUT LEAD OS SECTION ---------------- */}
      <section id="about" style={{
        padding: '50px 20px',
        maxWidth: 1050,
        margin: '0 auto',
        borderTop: '1px solid #1a2e4a'
      }}>
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <h2 style={{ fontFamily: "'Syne', sans-serif", fontSize: 28, fontWeight: 800, color: '#f8fafc' }}>
            About Lead OS
          </h2>
          <p style={{ color: '#94a3b8', fontSize: 15, marginTop: 8, maxWidth: 720, margin: '8px auto 0 auto', lineHeight: 1.6 }}>
            Lead OS is a cloud-based platform that enables businesses and agencies to manage their Google Business Profiles efficiently.
          </p>
        </div>

        <div style={{
          background: 'linear-gradient(135deg, #091322 0%, #060c17 100%)',
          border: '1px solid #1a2e4a',
          borderRadius: 18,
          padding: 32,
          boxShadow: '0 10px 30px rgba(0,0,0,0.4)'
        }}>
          <div style={{ fontSize: 14, color: '#e2e8f0', fontWeight: 600, marginBottom: 20 }}>
            The Lead OS platform helps users:
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 16 }}>
            {[
              { title: 'Manage Google Reviews', desc: 'Monitor, auto-reply, and boost 5-star customer ratings with AI.' },
              { title: 'Publish Google Posts', desc: 'Schedule daily updates, offers, and events to Google Business Profiles.' },
              { title: 'Track Business Insights', desc: 'Analyze profile views, phone calls, direction requests, and keyword rankings.' },
              { title: 'Manage Multiple Locations', desc: 'Centralize multi-location listings and sync business information across stores.' },
              { title: 'Improve Local SEO', desc: 'Outrank competitors in Google Map Packs and local search results.' },
              { title: 'Automate Google Business Profile Workflows', desc: 'Set up autonomous posting schedules and automated customer engagement.' }
            ].map((item, i) => (
              <div key={i} style={{
                background: '#0c1525',
                border: '1px solid #1e293b',
                borderRadius: 12,
                padding: 18,
                display: 'flex',
                alignItems: 'flex-start',
                gap: 12
              }}>
                <div style={{ background: 'rgba(249,115,22,0.15)', color: '#f97316', padding: 8, borderRadius: 8, marginTop: 2 }}>
                  <CheckCircle2 size={18} />
                </div>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 14, color: '#f8fafc' }}>{item.title}</div>
                  <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 4, lineHeight: 1.4 }}>{item.desc}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ---------------- 3. HOW IT WORKS SECTION ---------------- */}
      <section id="how-it-works" style={{
        padding: '50px 20px',
        maxWidth: 1050,
        margin: '0 auto',
        borderTop: '1px solid #1a2e4a'
      }}>
        <div style={{ textAlign: 'center', marginBottom: 36 }}>
          <h2 style={{ fontFamily: "'Syne', sans-serif", fontSize: 28, fontWeight: 800, color: '#f8fafc' }}>
            How It Works
          </h2>
          <p style={{ color: '#94a3b8', fontSize: 14, marginTop: 6 }}>
            A simple 4-step workflow to connect and manage your Google Business Profile.
          </p>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 20 }}>
          {[
            { step: '1', title: 'Sign In', desc: 'Access your Lead OS dashboard securely at /login using your credentials.' },
            { step: '2', title: 'Connect Google Business Profile', desc: 'Authorize Lead OS via official Google OAuth 2.0 to access your listings.' },
            { step: '3', title: 'Manage Reviews, Posts & Info', desc: 'Publish Google Posts, respond to Google Reviews, and update store info.' },
            { step: '4', title: 'Track Insights & Grow', desc: 'Monitor Business Insights, search views, call requests, and local rank growth.' }
          ].map((item, index) => (
            <div key={index} style={{
              background: '#091120',
              border: '1px solid #1a2e4a',
              borderRadius: 16,
              padding: 24,
              textAlign: 'center',
              position: 'relative'
            }}>
              <div style={{
                width: 38,
                height: 38,
                borderRadius: '50%',
                background: 'linear-gradient(135deg, #f97316, #ea580c)',
                color: '#fff',
                fontWeight: 800,
                fontSize: 16,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                margin: '0 auto 16px auto',
                boxShadow: '0 4px 14px rgba(249,115,22,0.3)'
              }}>
                {item.step}
              </div>
              <h3 style={{ fontSize: 15, fontWeight: 700, color: '#f8fafc', marginBottom: 8 }}>{item.title}</h3>
              <p style={{ fontSize: 12, color: '#94a3b8', lineHeight: 1.5 }}>{item.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ---------------- 4. GOOGLE OAUTH & SECURITY SECTION ---------------- */}
      <section id="security" style={{
        padding: '50px 20px',
        maxWidth: 1050,
        margin: '0 auto',
        borderTop: '1px solid #1a2e4a'
      }}>
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: '#10b981', fontSize: 12, fontWeight: 700, marginBottom: 8, textTransform: 'uppercase' }}>
            <ShieldCheck size={15} />
            <span>ENTERPRISE COMPLIANCE & PRIVACY</span>
          </div>
          <h2 style={{ fontFamily: "'Syne', sans-serif", fontSize: 28, fontWeight: 800, color: '#f8fafc' }}>
            Secure Google Authentication
          </h2>
          <p style={{ color: '#94a3b8', fontSize: 14, marginTop: 6 }}>
            Lead OS strictly adheres to Google Developer policies and OAuth 2.0 security protocols.
          </p>
        </div>

        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
          gap: 16
        }}>
          {[
            { title: 'Google OAuth 2.0 Authentication', desc: 'Secure protocol verifying user identity directly via Google authorization servers.' },
            { title: 'Official Google Business Profile APIs', desc: 'Direct, compliant API integration following Google Developer Terms of Service.' },
            { title: 'Encrypted Access Tokens', desc: 'OAuth access and refresh tokens are encrypted at rest using AES-256 standards.' },
            { title: 'We Never Store Your Google Password', desc: 'Lead OS never requests, sees, or stores your personal Google account password.' },
            { title: 'Secure Cloud Infrastructure', desc: 'TLS 1.3 end-to-end encryption with ISO-compliant cloud database storage.' }
          ].map((item, i) => (
            <div key={i} style={{
              background: '#091120',
              border: '1px solid #1a2e4a',
              borderRadius: 14,
              padding: 20,
              display: 'flex',
              alignItems: 'flex-start',
              gap: 12
            }}>
              <div style={{ background: 'rgba(16,185,129,0.15)', color: '#10b981', padding: 8, borderRadius: 8, marginTop: 2 }}>
                <Lock size={16} />
              </div>
              <div>
                <div style={{ fontWeight: 700, fontSize: 13, color: '#f8fafc' }}>{item.title}</div>
                <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 4, lineHeight: 1.5 }}>{item.desc}</div>
              </div>
            </div>
          ))}
        </div>

        {/* Security Authorization Note */}
        <div style={{
          marginTop: 24,
          background: 'rgba(16, 185, 129, 0.08)',
          border: '1px solid rgba(16, 185, 129, 0.25)',
          borderRadius: 12,
          padding: '14px 20px',
          textAlign: 'center',
          color: '#cbd5e1',
          fontSize: 13,
          fontWeight: 500,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 10
        }}>
          <ShieldCheck size={18} style={{ color: '#10b981', flexShrink: 0 }} />
          <span>Lead OS securely authenticates users using Google OAuth 2.0 and accesses Google Business Profile data only with user authorization.</span>
        </div>
      </section>

      {/* ---------------- 7. DASHBOARD PREVIEW & MOCKUPS ---------------- */}
      <section id="preview" style={{
        padding: '50px 20px',
        maxWidth: 1050,
        margin: '0 auto',
        borderTop: '1px solid #1a2e4a'
      }}>
        <div style={{ textAlign: 'center', marginBottom: 30 }}>
          <h2 style={{ fontFamily: "'Syne', sans-serif", fontSize: 26, fontWeight: 800, color: '#f8fafc' }}>
            Lead OS Dashboard Preview
          </h2>
          <p style={{ color: '#94a3b8', fontSize: 14, marginTop: 6 }}>
            Explore how Lead OS simplifies Google Business Profile, Reviews, Posts, and Business Insights.
          </p>

          {/* Preview Tabs */}
          <div style={{
            display: 'inline-flex',
            background: '#0c1525',
            border: '1px solid #1a2e4a',
            borderRadius: 12,
            padding: 4,
            marginTop: 18,
            gap: 4,
            flexWrap: 'wrap',
            justifyContent: 'center'
          }}>
            {[
              { id: 'reviews', label: 'Google Reviews', icon: Star },
              { id: 'posts', label: 'Google Posts', icon: FileText },
              { id: 'insights', label: 'Business Insights', icon: BarChart3 },
              { id: 'multiloc', label: 'Multi-location Dashboard', icon: Building2 },
              { id: 'analytics', label: 'Analytics', icon: Globe }
            ].map(tab => {
              const Icon = tab.icon;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  style={{
                    background: activeTab === tab.id ? 'linear-gradient(135deg, #f97316, #ea580c)' : 'transparent',
                    border: 'none',
                    borderRadius: 8,
                    padding: '8px 16px',
                    color: activeTab === tab.id ? '#fff' : '#94a3b8',
                    fontSize: 13,
                    fontWeight: 700,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    transition: 'all 0.2s'
                  }}>
                  <Icon size={14} />
                  <span>{tab.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Dashboard Display Area */}
        <div style={{
          background: '#091120',
          border: '1px solid #1a2e4a',
          borderRadius: 16,
          padding: 24,
          boxShadow: '0 16px 40px rgba(0,0,0,0.5)'
        }}>
          {activeTab === 'reviews' && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 20 }}>
              <div style={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: 12, padding: 16 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#f97316', marginBottom: 12 }}>GOOGLE REVIEWS AUTO-RESPONDER</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {[
                    { author: 'Sarah Jenkins', rating: '5 Stars ★★★★★', comment: 'Excellent local service and prompt assistance!', status: 'Auto-Replied with Local Keyword' },
                    { author: 'Michael Chang', rating: '5 Stars ★★★★★', comment: 'Best agency experience in town.', status: 'Auto-Replied & Synced' }
                  ].map((r, i) => (
                    <div key={i} style={{ background: '#060c17', padding: 12, borderRadius: 8, border: '1px solid #1e293b' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, fontWeight: 700, color: '#f8fafc' }}>
                        <span>{r.author}</span>
                        <span style={{ color: '#f59e0b' }}>{r.rating}</span>
                      </div>
                      <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 4 }}>"{r.comment}"</div>
                      <div style={{ fontSize: 10, color: '#10b981', marginTop: 6, fontWeight: 600 }}>Status: {r.status}</div>
                    </div>
                  ))}
                </div>
              </div>
              <div style={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: 12, padding: 16 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#38bdf8', marginBottom: 12 }}>REVIEW SENTIMENT & OVERVIEW</div>
                <div style={{ background: '#060c17', padding: 16, borderRadius: 8, textAlign: 'center' }}>
                  <div style={{ fontSize: 32, fontWeight: 800, color: '#f8fafc', fontFamily: "'Syne', sans-serif" }}>4.9 ★</div>
                  <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 4 }}>Based on 248 verified Google Reviews</div>
                  <div style={{ fontSize: 11, color: '#10b981', marginTop: 8, fontWeight: 600 }}>100% Google Business Profile API Compliant</div>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'posts' && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 20 }}>
              <div style={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: 12, padding: 16 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#3b82f6', marginBottom: 12 }}>GOOGLE POSTS PUBLISHER & SCHEDULER</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {[
                    { title: 'Special Weekend Discount Offer', type: 'Offer Post', time: 'Published Today' },
                    { title: 'New Store Location Announcement', type: 'Update Post', time: 'Scheduled for Tomorrow' }
                  ].map((p, i) => (
                    <div key={i} style={{ background: '#060c17', padding: 12, borderRadius: 8, border: '1px solid #1e293b' }}>
                      <div style={{ fontSize: 12, fontWeight: 600, color: '#f8fafc' }}>{p.title}</div>
                      <div style={{ fontSize: 10, color: '#38bdf8', marginTop: 4 }}>Type: {p.type} • {p.time}</div>
                    </div>
                  ))}
                </div>
              </div>
              <div style={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: 12, padding: 16 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#a855f7', marginBottom: 12 }}>CALL-TO-ACTION BUTTON INJECTION</div>
                <div style={{ fontSize: 12, color: '#94a3b8', lineHeight: 1.5 }}>
                  Automatically attaches official Google CTA buttons ("Book Now", "Call Now", "Learn More") with tracking parameters to increase website traffic.
                </div>
              </div>
            </div>
          )}

          {activeTab === 'insights' && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 20 }}>
              <div style={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: 12, padding: 16 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#10b981', marginBottom: 12 }}>BUSINESS INSIGHTS & METRICS</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <div style={{ background: '#060c17', padding: 10, borderRadius: 6, display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                    <span>Google Search Views</span>
                    <span style={{ color: '#10b981', fontWeight: 700 }}>24,850 impressions</span>
                  </div>
                  <div style={{ background: '#060c17', padding: 10, borderRadius: 6, display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                    <span>Customer Phone Calls</span>
                    <span style={{ color: '#38bdf8', fontWeight: 700 }}>342 calls</span>
                  </div>
                  <div style={{ background: '#060c17', padding: 10, borderRadius: 6, display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                    <span>Driving Direction Clicks</span>
                    <span style={{ color: '#f97316', fontWeight: 700 }}>580 requests</span>
                  </div>
                </div>
              </div>
              <div style={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: 12, padding: 16 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#f59e0b', marginBottom: 12 }}>LOCAL SEARCH MAP PACK DOMINANCE</div>
                <div style={{ fontSize: 12, color: '#94a3b8', lineHeight: 1.5 }}>
                  Real-time Google Maps rank monitoring across 5km, 10km, and 20km geographic grid areas.
                </div>
              </div>
            </div>
          )}

          {activeTab === 'multiloc' && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 20 }}>
              <div style={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: 12, padding: 16 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#a855f7', marginBottom: 12 }}>MULTI-LOCATION MANAGEMENT</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {['Location #1 - Downtown HQ', 'Location #2 - Westside Branch', 'Location #3 - Northside Outpost'].map((loc, i) => (
                    <div key={i} style={{ background: '#060c17', padding: 10, borderRadius: 6, display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                      <span>{loc}</span>
                      <span style={{ color: '#10b981', fontWeight: 700 }}>Synced</span>
                    </div>
                  ))}
                </div>
              </div>
              <div style={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: 12, padding: 16 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#f97316', marginBottom: 12 }}>NAP CONSISTENCY & DIRECTORY SYNC</div>
                <div style={{ fontSize: 12, color: '#94a3b8', lineHeight: 1.5 }}>
                  Ensures Name, Address, and Phone Number (NAP) details are identical across all Google Business Profiles and local directories.
                </div>
              </div>
            </div>
          )}

          {activeTab === 'analytics' && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 20 }}>
              <div style={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: 12, padding: 16 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#38bdf8', marginBottom: 12 }}>PERFORMANCE ANALYTICS</div>
                <div style={{ fontSize: 12, color: '#94a3b8', lineHeight: 1.5 }}>
                  Detailed weekly and monthly analytical reports tracking engagement trends, customer interaction rates, and local SEO rank improvements.
                </div>
              </div>
              <div style={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: 12, padding: 16 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#10b981', marginBottom: 12 }}>AUTOMATED REPORT EXPORT</div>
                <div style={{ fontSize: 12, color: '#94a3b8', lineHeight: 1.5 }}>
                  Generate white-label PDF reports for business owners, agency managers, and client stakeholders in one click.
                </div>
              </div>
            </div>
          )}
        </div>
      </section>

      {/* ---------------- FAQ SECTION ---------------- */}
      <section id="faq" style={{
        padding: '50px 20px',
        maxWidth: 800,
        margin: '0 auto',
        borderTop: '1px solid #1a2e4a'
      }}>
        <div style={{ textAlign: 'center', marginBottom: 30 }}>
          <h2 style={{ fontFamily: "'Syne', sans-serif", fontSize: 24, fontWeight: 800, color: '#f8fafc' }}>
            Frequently Asked Questions
          </h2>
          <p style={{ color: '#94a3b8', fontSize: 13, marginTop: 4 }}>
            Common questions about Lead OS and Google Business Profile management.
          </p>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {[
            {
              q: 'What is Lead OS?',
              a: 'Lead OS is an AI-powered Google Business Profile management platform that allows businesses and agencies to manage Google Reviews, publish Google Posts, track Business Insights, and optimize multi-location Local SEO from a unified dashboard.'
            },
            {
              q: 'How does Lead OS connect to my Google Business Profile?',
              a: 'Lead OS uses Google OAuth 2.0 to securely connect to your official Google account. You grant access to your Google Business Profile without ever sharing your password.'
            },
            {
              q: 'Is my Google account data secure with Lead OS?',
              a: 'Yes. All authentication tokens are encrypted using AES-256 standards and transmitted via TLS 1.3. Lead OS strictly complies with official Google API policies and privacy guidelines.'
            },
            {
              q: 'Can I manage multiple business locations in Lead OS?',
              a: 'Yes! Lead OS includes multi-location management features allowing agencies and multi-store businesses to update info, publish posts, and track insights across all locations simultaneously.'
            }
          ].map((item, index) => (
            <div key={index} style={{
              background: '#091120',
              border: '1px solid #1a2e4a',
              borderRadius: 10,
              overflow: 'hidden'
            }}>
              <button
                onClick={() => toggleFaq(index)}
                style={{
                  width: '100%',
                  padding: '14px 18px',
                  background: 'transparent',
                  border: 'none',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  color: '#f8fafc',
                  fontSize: 14,
                  fontWeight: 600,
                  cursor: 'pointer',
                  textAlign: 'left'
                }}>
                <span>{item.q}</span>
                {openFaqIndex === index ? <ChevronUp size={16} style={{ color: '#f97316' }} /> : <ChevronDown size={16} style={{ color: '#94a3b8' }} />}
              </button>
              {openFaqIndex === index && (
                <div style={{
                  padding: '0 18px 16px 18px',
                  color: '#94a3b8',
                  fontSize: 13,
                  lineHeight: 1.5,
                  borderTop: '1px solid #1a2e4a',
                  paddingTop: 12
                }}>
                  {item.a}
                </div>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* ---------------- 5. GOOGLE DISCLAIMER BANNER ---------------- */}
      <section style={{
        padding: '24px 20px',
        maxWidth: 1050,
        margin: '30px auto 0 auto',
        textAlign: 'center',
        borderTop: '1px solid rgba(30, 41, 59, 0.5)'
      }}>
        <p style={{
          fontSize: 11,
          color: '#64748b',
          lineHeight: 1.6,
          maxWidth: 820,
          margin: '0 auto',
          fontStyle: 'normal'
        }}>
          <strong>Disclaimer:</strong> Lead OS uses Google Business Profile APIs and Google OAuth 2.0 for authentication. Lead OS is an independent application and is not affiliated with, endorsed by, or sponsored by Google LLC.
        </p>
      </section>

      {/* ---------------- 6. FOOTER WITH CONTACT & LEGAL ---------------- */}
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
