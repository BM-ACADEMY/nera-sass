import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, CheckCircle, MessageCircle } from 'lucide-react';
import { C } from '../constants/theme.js';
import { api } from '../services/api.js';

const ago = (value) => {
  const minutes = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 60000));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  return hours < 48 ? `${hours} h ago` : `${Math.round(hours / 24)} days ago`;
};
const KIND = { message: 'customer message', status: 'delivery receipt' };

/**
 * Dashboard line for the workspace's WhatsApp number: when Meta last sent us a
 * customer message or a delivery receipt, and a warning when nothing has
 * arrived for a day. Shows nothing when no number is connected.
 */
export const WhatsAppInboundStrip = () => {
  const navigate = useNavigate();
  const [data, setData] = useState(null);

  useEffect(() => {
    let alive = true;
    const load = () => api.get('/whatsapp/overview').then((res) => { if (alive) setData(res); }).catch(() => {});
    load();
    const timer = setInterval(load, 60000);
    return () => { alive = false; clearInterval(timer); };
  }, []);

  if (!data?.connected || !data.inbound) return null;
  const { inbound, number } = data;
  const last = inbound.last_inbound_event_at;
  const tone = inbound.silent ? '#d97706' : C.green; // amber: the theme has no warning colour
  const Icon = inbound.silent ? AlertTriangle : last ? CheckCircle : MessageCircle;
  return (
    <button
      type="button"
      onClick={() => navigate('/whatsapp')}
      style={{
        display: 'flex', alignItems: 'center', gap: 10, width: '100%', textAlign: 'left', cursor: 'pointer',
        background: C.card, border: `1px solid ${inbound.silent ? tone : C.border}`, borderRadius: 12, padding: '10px 14px', marginBottom: 18,
      }}
    >
      <Icon size={16} color={tone} style={{ flexShrink: 0 }} />
      <span style={{ fontSize: 13, color: C.text, fontWeight: 600 }}>
        WhatsApp {number?.display_phone_number || ''}
      </span>
      <span style={{ fontSize: 12.5, color: C.muted }}>
        {last
          ? `Last inbound event ${ago(last)} (${KIND[inbound.last_inbound_event_kind] || 'event'})`
          : 'No inbound event received yet'}
        {inbound.silent ? ` · nothing for ${inbound.silent_after_hours}+ hours` : ''}
      </span>
    </button>
  );
};

export default WhatsAppInboundStrip;
