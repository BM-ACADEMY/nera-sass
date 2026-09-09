import { createPortal } from 'react-dom';
import { X, Building, Smartphone, Globe, Mail, MapPin, Layers, Award, Flame, Users } from 'lucide-react';
import { C } from '../constants/theme.js';

export const ClientDashboardModal = ({ client, onClose }) => {
  if (!client) return null;

  const leads = parseInt(client.lead_count ?? client.leads ?? 0);
  const converted = parseInt(client.converted_count ?? client.conv ?? 0);
  const convRate = leads > 0 ? Math.round((converted / leads) * 100) + '%' : '0%';
  const joinedDate = client.joined_at || client.created_at ? new Date(client.joined_at || client.created_at).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  }) : 'Unknown';

  const detailItemStyle = {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 12,
    padding: '12px 14px',
    background: C.surface,
    border: `1px solid ${C.border}`,
    borderRadius: 10,
  };

  return createPortal(
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(6,12,23,0.85)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, backdropFilter: 'blur(6px)' }}>
      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 18, width: '100%', maxWidth: 700, maxHeight: 'calc(100vh - 60px)', display: 'flex', flexDirection: 'column', boxShadow: '0 25px 50px -12px rgba(0,0,0,0.5)', overflow: 'hidden' }}>
        
        {/* Header Banner */}
        <div style={{ padding: '24px 28px', borderBottom: `1px solid ${C.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: `linear-gradient(135deg, ${C.surface}, ${C.bg})` }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <div style={{ width: 50, height: 50, borderRadius: 12, background: `${C.accent}15`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, fontWeight: 800, color: C.accent, border: `1px solid ${C.accent}30` }}>
              {client.name[0]}
            </div>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <h2 style={{ fontFamily: "'Syne', sans-serif", fontSize: 20, fontWeight: 800, color: C.text }}>{client.name}</h2>
                <span style={{ background: client.status === 'active' ? '#0a2018' : '#221414', color: client.status === 'active' ? C.green : C.red, padding: '3px 10px', borderRadius: 12, fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                  {client.status === 'active' ? 'Active' : 'Inactive'}
                </span>
              </div>
              <p style={{ fontSize: 11, color: C.muted, marginTop: 4 }}>
                Joined on {joinedDate}
              </p>
            </div>
          </div>
          <button onClick={onClose} style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: 8, width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.muted, cursor: 'pointer', transition: 'all 0.2s' }}>
            <X size={16} />
          </button>
        </div>

        {/* Scrollable Content */}
        <div style={{ overflowY: 'auto', padding: 28, display: 'flex', flexDirection: 'column', gap: 24 }}>
          
          {/* Key Metrics Section */}
          <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: '14px 18px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <div style={{ color: C.text, fontSize: 13, fontWeight: 700 }}>WhatsApp Service</div>
              <div style={{ color: C.muted, fontSize: 11, marginTop: 3 }}>{client.whatsapp_status === 'verified' ? `Verified ${client.whatsapp_verified_at ? `on ${new Date(client.whatsapp_verified_at).toLocaleDateString()}` : ''}` : 'Messaging remains disabled until Meta verification succeeds.'}</div>
            </div>
            <span style={{ color: client.whatsapp_status === 'verified' ? C.green : client.whatsapp_status === 'verification_failed' ? C.red : C.muted, fontSize: 11, fontWeight: 800 }}>
              {client.whatsapp_status === 'verified' ? 'ENABLED' : client.whatsapp_status === 'verification_pending' ? 'PENDING' : client.whatsapp_status === 'verification_failed' ? 'FAILED' : 'NOT CONFIGURED'}
            </span>
          </div>

          <div>
            <h3 style={{ fontSize: 12, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: 12 }}>Conversion Statistics</h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14 }}>
              {[
                { label: 'Total Leads', val: leads, color: C.blue, icon: <Users size={16} color={C.blue} /> },
                { label: 'Converted Leads', val: converted, color: C.green, icon: <Award size={16} color={C.green} /> },
                { label: 'Conversion Rate', val: convRate, color: C.purple, icon: <Flame size={16} color={C.purple} /> }
              ].map(stat => (
                <div key={stat.label} style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: '16px 18px', textAlign: 'center', position: 'relative' }}>
                  <div style={{ position: 'absolute', top: 12, right: 12 }}>{stat.icon}</div>
                  <h4 style={{ fontSize: 24, fontWeight: 800, color: stat.color, fontFamily: "'Syne', sans-serif" }}>{stat.val}</h4>
                  <p style={{ fontSize: 10, color: C.muted, marginTop: 4, fontWeight: 500 }}>{stat.label}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Config Details */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }} className="grid-responsive">
            
            {/* WhatsApp Integration details */}
            <div>
              <h3 style={{ fontSize: 12, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: 12 }}>WhatsApp API Settings</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={detailItemStyle}>
                  <Smartphone size={16} color={C.accent} style={{ marginTop: 2, flexShrink: 0 }} />
                  <div>
                    <span style={{ fontSize: 9, color: C.muted, textTransform: 'uppercase', display: 'block', fontWeight: 600 }}>WhatsApp Number</span>
                    <span style={{ fontSize: 12, color: C.text, fontWeight: 500 }}>{client.whatsapp_number ? `+${client.whatsapp_number}` : 'Not Configured'}</span>
                  </div>
                </div>

                <div style={detailItemStyle}>
                  <Layers size={16} color={C.blue} style={{ marginTop: 2, flexShrink: 0 }} />
                  <div>
                    <span style={{ fontSize: 9, color: C.muted, textTransform: 'uppercase', display: 'block', fontWeight: 600 }}>Phone Number ID</span>
                    <span style={{ fontSize: 12, color: C.text, fontFamily: 'monospace' }}>{client.phone_number_id || 'Not Configured'}</span>
                  </div>
                </div>

                <div style={detailItemStyle}>
                  <Building size={16} color={C.purple} style={{ marginTop: 2, flexShrink: 0 }} />
                  <div>
                    <span style={{ fontSize: 9, color: C.muted, textTransform: 'uppercase', display: 'block', fontWeight: 600 }}>Business Account ID</span>
                    <span style={{ fontSize: 12, color: C.text, fontFamily: 'monospace' }}>{client.wa_business_id || 'Not Configured'}</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Profile Info */}
            <div>
              <h3 style={{ fontSize: 12, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: 12 }}>WhatsApp Business Profile</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={detailItemStyle}>
                  <Globe size={16} color={C.green} style={{ marginTop: 2, flexShrink: 0 }} />
                  <div>
                    <span style={{ fontSize: 9, color: C.muted, textTransform: 'uppercase', display: 'block', fontWeight: 600 }}>Website URL</span>
                    {client.wa_website ? (
                      <a href={client.wa_website.startsWith('http') ? client.wa_website : `https://${client.wa_website}`} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: C.blue, textDecoration: 'underline', fontWeight: 500 }}>
                        {client.wa_website}
                      </a>
                    ) : (
                      <span style={{ fontSize: 12, color: C.text, fontWeight: 500 }}>None</span>
                    )}
                  </div>
                </div>

                <div style={detailItemStyle}>
                  <Mail size={16} color={C.pink} style={{ marginTop: 2, flexShrink: 0 }} />
                  <div>
                    <span style={{ fontSize: 9, color: C.muted, textTransform: 'uppercase', display: 'block', fontWeight: 600 }}>Support Email</span>
                    <span style={{ fontSize: 12, color: C.text, fontWeight: 500 }}>{client.wa_email || 'None'}</span>
                  </div>
                </div>

                <div style={detailItemStyle}>
                  <MapPin size={16} color={C.red} style={{ marginTop: 2, flexShrink: 0 }} />
                  <div>
                    <span style={{ fontSize: 9, color: C.muted, textTransform: 'uppercase', display: 'block', fontWeight: 600 }}>Physical Address</span>
                    <span style={{ fontSize: 12, color: C.text, fontWeight: 500 }}>{client.wa_address || 'None'}</span>
                  </div>
                </div>
              </div>
            </div>

          </div>

          {/* Description Block */}
          {client.wa_description && (
            <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: 18 }}>
              <span style={{ fontSize: 9, color: C.muted, textTransform: 'uppercase', display: 'block', fontWeight: 700, letterSpacing: '0.8px', marginBottom: 6 }}>Business Description</span>
              <p style={{ fontSize: 12, color: C.text, lineHeight: 1.6 }}>{client.wa_description}</p>
            </div>
          )}

        </div>

        {/* Footer */}
        <div style={{ padding: '16px 28px', borderTop: `1px solid ${C.border}`, background: C.surface, display: 'flex', justifyContent: 'flex-end', flexShrink: 0 }}>
          <button onClick={onClose} style={{ background: C.accent, border: 'none', color: '#fff', padding: '10px 24px', borderRadius: 9, fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
            Close Dashboard
          </button>
        </div>

      </div>
    </div>,
    document.body
  );
};
