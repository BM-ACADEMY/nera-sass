import React, { useState, useEffect, useRef } from 'react';
import { C } from '../../constants/theme.js';
import { User, Loader2, CheckCircle2, Building, Phone, Mail, Globe, Shield, Link2, Plus, Trash2, Search, X, Users, Send, MoreVertical, MapPin } from 'lucide-react';
import toast from 'react-hot-toast';
import { io as socketIO } from 'socket.io-client';

const API_URL = import.meta.env.VITE_API_URL || '';

const CATEGORIES = [
  'Healthcare & Medical',
  'Real Estate & Property',
  'Local Services (Plumbing, AC, etc.)',
  'Restaurants & Food',
  'Retail & Shopping',
  'Automotive & Repair',
  'Education & Training',
  'Professional Services (Legal, Consulting)',
  'Beauty & Wellness',
  'Other'
];

const INITIAL_FORM = {
  business_name: '',
  display_name: '',
  business_category: '',
  custom_category: '',
  phone_number: '',
  business_address: '',
  contact_person: '',
  website_url: '',
  gmb_url: '',
  gmb_email: '',
  ga4_property_id: '',
  client_type: 'internal',
  plan_id: '',
};

export default function AddClient() {
  const [clients, setClients] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [errors, setErrors] = useState({});
  const [showOtherCategory, setShowOtherCategory] = useState(false);
  const [formData, setFormData] = useState({ ...INITIAL_FORM });
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState('all'); // 'all', 'internal', 'paid'
  const [deletingId, setDeletingId] = useState(null);
  const [resendingId, setResendingId] = useState(null);
  const [disconnectingId, setDisconnectingId] = useState(null);
  const [activeDropdownId, setActiveDropdownId] = useState(null);
  const [editingClient, setEditingClient] = useState(null);
  const [plans, setPlans] = useState([]);
  const modalRef = useRef(null);

  const handleEditClick = (client) => {
    setEditingClient(client);
    const categoryExists = CATEGORIES.includes(client.business_category);
    setFormData({
      business_name: client.business_name || '',
      display_name: client.display_name || '',
      business_category: categoryExists ? client.business_category : 'Other',
      custom_category: !categoryExists ? client.business_category : '',
      phone_number: client.phone_number || '',
      business_address: client.business_address || '',
      contact_person: client.contact_person || '',
      website_url: client.website_url || '',
      gmb_url: client.gmb_url || '',
      gmb_email: client.gmb_email || '',
      ga4_property_id: client.ga4_property_id || '',
      client_type: client.client_type || 'internal',
      plan_id: client.plan_id || '',
    });
    setShowOtherCategory(!categoryExists && client.business_category !== '');
    setErrors({});
    setShowModal(true);
  };

  const handleResendEmail = async (id, email) => {
    setResendingId(id);
    try {
      const token = localStorage.getItem('leados_token');
      const res = await fetch(`${API_URL}/api/mafiya/clients/${id}/resend-email`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('Resend failed');
      toast.success(`Verification link sent to ${email}`, { icon: '📧' });
    } catch (err) {
      console.error(err);
      toast.error('Failed to send verification link');
    } finally {
      setResendingId(null);
    }
  };

  const handleDisconnectGmb = async (id) => {
    if (!confirm('Are you sure you want to disconnect this Google Business Profile?')) return;
    setDisconnectingId(id);
    try {
      const token = localStorage.getItem('leados_token');
      const res = await fetch(`${API_URL}/api/mafiya/clients/${id}/disconnect-gmb`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('Disconnect failed');
      setClients(prevClients =>
        prevClients.map(client =>
          client.id === id ? { ...client, gmb_verified: false } : client
        )
      );
      toast.success('Google Business Profile disconnected successfully');
    } catch (err) {
      console.error(err);
      toast.error('Failed to disconnect GMB');
    } finally {
      setDisconnectingId(null);
    }
  };

  // ── Fetch clients ──
  const fetchClients = async () => {
    try {
      const token = localStorage.getItem('leados_token');
      const res = await fetch(`${API_URL}/api/mafiya/clients`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('Failed to fetch');
      const data = await res.json();
      setClients(data);
    } catch (err) {
      console.error('Fetch clients error:', err);
      toast.error('Failed to load clients');
    } finally {
      setIsLoading(false);
    }
  };

  const fetchPlans = async () => {
    try {
      const token = localStorage.getItem('leados_token');
      const res = await fetch(`${API_URL}/api/mafiya/plans`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setPlans(data);
      }
    } catch (err) {
      console.error('Fetch plans error:', err);
    }
  };

  useEffect(() => { 
    fetchClients(); 
    fetchPlans();
  }, []);

  useEffect(() => {
    const closeDropdown = () => setActiveDropdownId(null);
    document.addEventListener('click', closeDropdown);
    return () => document.removeEventListener('click', closeDropdown);
  }, []);

  // ── Listen to real-time GMB connection updates ──
  useEffect(() => {
    const isLocalDev = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
    const SOCKET_URL = isLocalDev ? window.location.origin : (import.meta.env.VITE_API_URL || 'https://leados-api.abmgroups.org');
    
    const socket = socketIO(SOCKET_URL, {
      transports: ['polling', 'websocket'],
    });

    socket.on('connect', () => {
      console.log('[Socket.io] Mafiya GMB listener connected:', socket.id);
    });

    socket.on('mafiya_gmb_connected', ({ clientId, gmb_verified }) => {
      console.log('[Socket.io] Client GMB connected in real-time:', clientId);
      setClients((prevClients) =>
        prevClients.map((client) =>
          client.id === clientId ? { ...client, gmb_verified } : client
        )
      );
      toast.success('GMB Profile connected successfully!', { icon: '🟢', duration: 5000 });
    });

    return () => {
      socket.disconnect();
    };
  }, []);

  // ── Close modal on outside click ──
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (modalRef.current && !modalRef.current.contains(e.target)) {
        setShowModal(false);
      }
    };
    if (showModal) document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showModal]);

  // ── Close modal on Escape ──
  useEffect(() => {
    const handleEsc = (e) => { if (e.key === 'Escape') setShowModal(false); };
    if (showModal) document.addEventListener('keydown', handleEsc);
    return () => document.removeEventListener('keydown', handleEsc);
  }, [showModal]);

  // ── Form handlers ──
  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData({ ...formData, [name]: value });
    if (errors[name]) setErrors({ ...errors, [name]: null });
    if (name === 'business_category') setShowOtherCategory(value === 'Other');
  };

  const handleSave = async (e) => {
    e.preventDefault();
    const newErrors = {};
    if (!formData.business_name) newErrors.business_name = 'Business name is required';
    if (!formData.phone_number) newErrors.phone_number = 'Phone number is required';
    if (!formData.contact_person) newErrors.contact_person = 'Contact person is required';
    if (!formData.business_address) newErrors.business_address = 'Business address is required';
    if (showOtherCategory && !formData.custom_category) {
      newErrors.custom_category = 'Please specify your business category';
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (formData.gmb_email && !emailRegex.test(formData.gmb_email)) {
      newErrors.gmb_email = 'Requires a valid GMB email address';
    }
    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return toast.error('Please fill in all required fields.');
    }

    setIsSaving(true);
    try {
      const token = localStorage.getItem('leados_token');
      const body = {
        ...formData,
        business_category: showOtherCategory ? formData.custom_category : formData.business_category,
        client_type: formData.client_type || 'internal',
        plan_id: formData.client_type === 'paid' && formData.plan_id ? parseInt(formData.plan_id) : null
      };
      
      if (editingClient) {
        const res = await fetch(`${API_URL}/api/mafiya/clients/${editingClient.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify(body),
        });
        if (!res.ok) throw new Error('Failed to update');
        const updated = await res.json();
        setClients(clients.map(c => c.id === editingClient.id ? { ...c, ...updated } : c));
        toast.success('Client updated successfully!');
      } else {
        const res = await fetch(`${API_URL}/api/mafiya/clients`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify(body),
        });
        if (!res.ok) throw new Error('Failed to save');
        const saved = await res.json();
        setClients([saved, ...clients]);
        toast.success('Client onboarded successfully!');
        if (saved.email_sent) {
          setTimeout(() => toast.success(`GMB authorization email sent to ${formData.gmb_email}`, { icon: '📧', duration: 5000 }), 600);
        }
      }
      setFormData({ ...INITIAL_FORM });
      setEditingClient(null);
      setShowOtherCategory(false);
      setErrors({});
      setShowModal(false);
    } catch (err) {
      console.error('Save error:', err);
      toast.error(editingClient ? 'Failed to update client' : 'Failed to save client');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (id) => {
    if (!confirm('Delete this client?')) return;
    setDeletingId(id);
    try {
      const token = localStorage.getItem('leados_token');
      const res = await fetch(`${API_URL}/api/mafiya/clients/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('Failed to delete');
      setClients(clients.filter(c => c.id !== id));
      toast.success('Client removed');
    } catch (err) {
      toast.error('Failed to delete client');
    } finally {
      setDeletingId(null);
    }
  };

  const filteredClients = clients.filter(c =>
    c.business_name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    c.display_name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    c.contact_person?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    c.gmb_email?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // ── Shared styles ──
  const inputStyle = { background: 'rgba(0,0,0,0.2)', border: `1px solid ${C.border}`, borderRadius: 8, color: '#fff', padding: '12px 14px', outline: 'none', fontSize: 13, width: '100%' };
  const inputWrapStyle = { display: 'flex', alignItems: 'center', background: 'rgba(0,0,0,0.2)', borderRadius: 8, padding: '0 12px' };
  const labelStyle = { display: 'block', fontSize: 11, fontWeight: 700, color: C.muted, marginBottom: 6, textTransform: 'uppercase' };

  if (isLoading) {
    return (
      <div style={{ minHeight: '100vh', background: C.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.text }}>
        <div style={{ textAlign: 'center' }}>
          <Users size={42} className="animate-pulse" style={{ color: C.accent, marginBottom: 12 }} />
          <p style={{ fontSize: 14 }}>Loading GMB Clients...</p>
        </div>
      </div>
    );
  }

  const totalClientsCount = clients.length;
  const totalInternalCount = clients.filter(c => c.client_type === 'internal').length;
  const totalPaidCount = clients.filter(c => c.client_type === 'paid').length;

  const totalMonthlyRecurring = clients
    .filter(c => c.client_type === 'paid')
    .reduce((sum, client) => {
      const plan = plans.find(p => p.id === client.plan_id);
      return sum + (plan ? parseFloat(plan.price) : 4999);
    }, 0);

  const avgHealthScore = Math.round(
    clients.reduce((sum, client) => sum + (client.gmb_verified ? 90 : 45), 0) / (clients.length || 1)
  );

  const attentionNeededCount = clients.filter(c => !c.gmb_verified).length;

  const internalClients = filteredClients.filter(c => c.client_type === 'internal');
  const paidClients = filteredClients.filter(c => c.client_type === 'paid');

  const renderClientCard = (client) => (
    <div key={client.id} style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 14, padding: 20, position: 'relative', transition: 'border-color 0.2s, box-shadow 0.2s' }}
      onMouseEnter={e => { e.currentTarget.style.borderColor = 'rgba(249,115,22,0.3)'; e.currentTarget.style.boxShadow = '0 8px 24px rgba(0,0,0,0.3)'; }}
      onMouseLeave={e => { e.currentTarget.style.borderColor = C.border; e.currentTarget.style.boxShadow = 'none'; }}
    >
      {/* Card Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 36, height: 36, background: 'linear-gradient(135deg, rgba(249,115,22,0.15), rgba(234,88,12,0.08))', borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid rgba(249,115,22,0.2)' }}>
            <Building size={16} color="#f97316" />
          </div>
          <div>
            <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: '#fff' }}>{client.display_name || client.business_name}</h3>
            {client.display_name && (
              <div style={{ fontSize: 10, color: C.muted, marginTop: 1 }} title="Official Google Business Name">GBP: {client.business_name}</div>
            )}
            <span style={{ fontSize: 11, color: C.muted }}>{client.business_category || client.custom_category || '—'}</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
              <span style={{ fontSize: 9, fontWeight: 700, color: client.client_type === 'paid' ? '#ea580c' : '#3b82f6', background: client.client_type === 'paid' ? 'rgba(234,88,12,0.1)' : 'rgba(59,130,246,0.1)', padding: '2px 6px', borderRadius: 4, textTransform: 'uppercase', letterSpacing: 0.5, border: `1px solid ${client.client_type === 'paid' ? 'rgba(234,88,12,0.2)' : 'rgba(59,130,246,0.2)'}` }}>
                {client.client_type === 'paid' ? (plans.find(p => p.id === client.plan_id)?.name || 'Paid Client') : 'Internal'}
              </span>
            </div>
          </div>
        </div>
        <div style={{ position: 'relative' }}>
          <button
            onClick={(e) => {
              e.stopPropagation();
              setActiveDropdownId(activeDropdownId === client.id ? null : client.id);
            }}
            style={{ background: 'rgba(255,255,255,0.05)', border: `1px solid ${C.border}`, borderRadius: 8, padding: 6, cursor: 'pointer', transition: 'background 0.15s' }}
            onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.1)'}
            onMouseLeave={e => e.currentTarget.style.background = 'rgba(255,255,255,0.05)'}
          >
            <MoreVertical size={16} color={C.muted} />
          </button>
          
          {activeDropdownId === client.id && (
            <div style={{
              position: 'absolute',
              right: 0,
              top: '100%',
              marginTop: 4,
              background: '#0a0f1d',
              border: `1px solid ${C.border}`,
              borderRadius: 8,
              boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.5)',
              zIndex: 50,
              minWidth: 140,
              overflow: 'hidden'
            }}>
              <button
                onClick={() => handleEditClick(client)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  width: '100%',
                  padding: '10px 12px',
                  background: 'transparent',
                  border: 'none',
                  color: '#e2e8f0',
                  fontSize: 12,
                  fontWeight: 600,
                  textAlign: 'left',
                  cursor: 'pointer',
                  transition: 'background 0.15s'
                }}
                onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.05)'}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
              >
                <Building size={13} color="#f97316" />
                Edit Client
              </button>
              {client.gmb_verified && (
                <button
                  onClick={() => handleDisconnectGmb(client.id)}
                  disabled={disconnectingId === client.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    width: '100%',
                    padding: '10px 12px',
                    background: 'transparent',
                    border: 'none',
                    color: '#e2e8f0',
                    fontSize: 12,
                    fontWeight: 600,
                    textAlign: 'left',
                    cursor: 'pointer',
                    transition: 'background 0.15s',
                    borderTop: `1px solid ${C.border}50`
                  }}
                  onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.05)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                >
                  {disconnectingId === client.id ? <Loader2 size={13} className="spin" /> : <X size={13} color="#ef4444" />}
                  Disconnect GMB
                </button>
              )}
              <button
                onClick={() => handleDelete(client.id)}
                disabled={deletingId === client.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  width: '100%',
                  padding: '10px 12px',
                  background: 'transparent',
                  border: 'none',
                  color: '#f87171',
                  fontSize: 12,
                  fontWeight: 600,
                  textAlign: 'left',
                  cursor: 'pointer',
                  transition: 'background 0.15s',
                  borderTop: `1px solid ${C.border}50`
                }}
                onMouseEnter={e => e.currentTarget.style.background = 'rgba(239,68,68,0.08)'}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
              >
                {deletingId === client.id ? <Loader2 size={13} className="spin" color="#ef4444" /> : <Trash2 size={13} color="#ef4444" />}
                Delete Client
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Card Details */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: C.muted }}>
          <User size={13} /> <span style={{ color: '#fff' }}>{client.contact_person}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: C.muted }}>
          <Phone size={13} /> <span style={{ color: '#fff' }}>{client.phone_number}</span>
        </div>
        {client.business_address && (
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 12, color: C.muted }}>
            <MapPin size={13} style={{ marginTop: 2, flexShrink: 0 }} /> <span style={{ color: '#fff', whiteSpace: 'pre-line' }}>{client.business_address}</span>
          </div>
        )}
        {client.gmb_email && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: C.muted }}>
            <Mail size={13} /> <span style={{ color: '#fff' }}>{client.gmb_email}</span>
          </div>
        )}
        {client.website_url && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: C.muted }}>
            <Globe size={13} /> <span style={{ color: '#6ee7b7' }}>{client.website_url}</span>
          </div>
        )}
        {client.gmb_url && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: C.muted }}>
            <Link2 size={13} /> <a href={client.gmb_url} target="_blank" rel="noreferrer" style={{ color: '#93c5fd', textDecoration: 'none', fontSize: 12 }}>View GMB Profile ↗</a>
          </div>
        )}
      </div>

      {/* Card Footer */}
      <div style={{ marginTop: 14, paddingTop: 12, borderTop: `1px solid ${C.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
        <span style={{ fontSize: 10, color: C.muted }}>
          Added {new Date(client.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
        </span>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          {client.gmb_email && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 10, fontWeight: 700, color: client.gmb_verified ? '#10b981' : '#f59e0b', background: client.gmb_verified ? 'rgba(16,185,129,0.1)' : 'rgba(245,158,11,0.1)', padding: '3px 10px', borderRadius: 20, textTransform: 'uppercase', letterSpacing: 0.5, border: `1px solid ${client.gmb_verified ? 'rgba(16,185,129,0.2)' : 'rgba(245,158,11,0.2)'}` }}>
                {client.gmb_verified ? '🟢 GMB Connected' : '🟡 GMB Pending'}
              </span>
              {!client.gmb_verified && (
                <button
                  onClick={() => handleResendEmail(client.id, client.gmb_email)}
                  disabled={resendingId === client.id}
                  title="Resend verification email"
                  style={{
                    background: 'rgba(245, 158, 11, 0.08)',
                    border: '1px solid rgba(245, 158, 11, 0.15)',
                    borderRadius: 20,
                    padding: '3px 8px',
                    cursor: 'pointer',
                    color: '#f59e0b',
                    fontSize: 9,
                    fontWeight: 700,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 4,
                    transition: 'all 0.15s'
                  }}
                  onMouseEnter={e => e.currentTarget.style.background = 'rgba(245, 158, 11, 0.18)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'rgba(245, 158, 11, 0.08)'}
                >
                  {resendingId === client.id ? <Loader2 size={9} className="spin" /> : <Send size={9} />}
                  <span>Send Link</span>
                </button>
              )}
            </div>
          )}
          <span style={{ fontSize: 10, fontWeight: 700, color: client.status === 'active' ? '#10b981' : C.muted, background: client.status === 'active' ? 'rgba(16,185,129,0.1)' : 'rgba(255,255,255,0.04)', padding: '3px 10px', borderRadius: 20, textTransform: 'uppercase', letterSpacing: 0.5 }}>
            {client.status || 'active'}
          </span>
        </div>
      </div>
    </div>
  );

  return (
    <div style={{ padding: 30, color: C.text, height: '100%', overflowY: 'auto', background: 'rgba(0,0,0,0.1)' }}>

      {/* ═══ Page Header ═══ */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24, flexWrap: 'wrap', gap: 16 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <h1 style={{ fontFamily: "'Syne', sans-serif", fontSize: 24, fontWeight: 800, color: '#fff', margin: 0 }}>
              Clients
            </h1>
            <span style={{ fontSize: 11, fontWeight: 700, background: 'rgba(249,115,22,0.12)', color: C.accent, padding: '3px 8px', borderRadius: 20 }}>
              {totalClientsCount} Total
            </span>
          </div>
          <p style={{ color: C.muted, fontSize: 12.5, marginTop: 6, margin: 0 }}>
            {totalInternalCount} internal ABM brands • {totalPaidCount} paying BM TechX clients • ₹{totalMonthlyRecurring.toLocaleString('en-IN')}/month recurring
          </p>
        </div>
        <button
          onClick={() => { setFormData({ ...INITIAL_FORM }); setErrors({}); setShowOtherCategory(false); setShowModal(true); }}
          style={{ background: 'linear-gradient(135deg, #f97316, #ea580c)', border: 'none', padding: '12px 22px', borderRadius: 10, color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, boxShadow: '0 4px 14px rgba(249,115,22,0.3)', transition: 'transform 0.15s' }}
          onMouseEnter={e => e.currentTarget.style.transform = 'scale(1.04)'}
          onMouseLeave={e => e.currentTarget.style.transform = 'scale(1)'}
        >
          <Plus size={16} /> Add New Client
        </button>
      </div>

      {/* ═══ Tab Bar Filter ═══ */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 26, borderBottom: `1px solid ${C.border}50` }}>
        {[
          { id: 'all', label: `All Clients (${totalClientsCount})` },
          { id: 'internal', label: `Internal ABM (${totalInternalCount})` },
          { id: 'paid', label: `Paying Clients (${totalPaidCount})` }
        ].map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            style={{
              background: 'transparent',
              border: 'none',
              borderBottom: activeTab === tab.id ? `3px solid ${C.accent}` : '3px solid transparent',
              color: activeTab === tab.id ? '#fff' : C.muted,
              padding: '10px 18px',
              fontSize: 13,
              fontWeight: 700,
              cursor: 'pointer',
              transition: 'all 0.15s',
              marginBottom: -1
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* ═══ Metric Summary Cards ═══ */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 16, marginBottom: 28 }}>
        {/* Card 1: Total Clients */}
        <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 14, padding: 20 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>Total Clients</div>
          <div style={{ fontSize: 28, fontWeight: 800, color: '#fff', fontFamily: "'Syne', sans-serif" }}>{totalClientsCount}</div>
          <div style={{ fontSize: 12, color: C.muted, marginTop: 4 }}>{totalInternalCount} internal • {totalPaidCount} paying</div>
        </div>
        {/* Card 2: Monthly Recurring */}
        <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 14, padding: 20 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>Monthly Recurring</div>
          <div style={{ fontSize: 28, fontWeight: 800, color: '#10b981', fontFamily: "'Syne', sans-serif" }}>₹{totalMonthlyRecurring.toLocaleString('en-IN')}</div>
          <div style={{ fontSize: 12, color: '#10b981', marginTop: 4 }}>↑ ₹9,999 this month</div>
        </div>
        {/* Card 3: Average Health Score */}
        <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 14, padding: 20 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>Avg Health Score</div>
          <div style={{ fontSize: 28, fontWeight: 800, color: '#f59e0b', fontFamily: "'Syne', sans-serif" }}>{avgHealthScore}</div>
          <div style={{ fontSize: 12, color: C.muted, marginTop: 4 }}>{attentionNeededCount} brand{attentionNeededCount !== 1 ? 's' : ''} need attention</div>
        </div>
      </div>

      {/* ═══ Search Bar ═══ */}
      {clients.length > 0 && (
        <div style={{ marginBottom: 26 }}>
          <div style={{ display: 'flex', alignItems: 'center', background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: '0 14px', maxWidth: 380 }}>
            <Search size={15} color={C.muted} />
            <input
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Search clients..."
              style={{ background: 'transparent', border: 'none', color: '#fff', padding: '12px 10px', width: '100%', outline: 'none', fontSize: 13 }}
            />
          </div>
        </div>
      )}

      {/* ═══ Client Listing Sections ═══ */}
      {filteredClients.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '80px 20px' }}>
          <Users size={48} color={C.border} style={{ marginBottom: 16 }} />
          <p style={{ color: C.muted, fontSize: 14, margin: 0 }}>
            {searchQuery ? 'No clients match your search' : 'No clients onboarded yet. Click "+ Add Client" to get started.'}
          </p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 32 }}>
          
          {/* Section 1: Internal ABM Brands */}
          {(activeTab === 'all' || activeTab === 'internal') && (
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
                <Building size={18} color="#3b82f6" />
                <h2 style={{ fontSize: 16, fontWeight: 800, color: '#fff', margin: 0 }}>Internal ABM Brands</h2>
              </div>
              {internalClients.length === 0 ? (
                <div style={{ padding: 20, background: 'rgba(255,255,255,0.01)', border: `1px dashed ${C.border}`, borderRadius: 12, color: C.muted, fontSize: 13 }}>
                  No internal clients found.
                </div>
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 16 }}>
                  {internalClients.map(renderClientCard)}
                </div>
              )}
            </div>
          )}

          {/* Section 2: Paying BM TechX Clients */}
          {(activeTab === 'all' || activeTab === 'paid') && (
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16, marginTop: activeTab === 'all' ? 12 : 0 }}>
                <Users size={18} color="#ea580c" />
                <h2 style={{ fontSize: 16, fontWeight: 800, color: '#fff', margin: 0 }}>Paying BM TechX Clients</h2>
              </div>
              {paidClients.length === 0 ? (
                <div style={{ padding: 20, background: 'rgba(255,255,255,0.01)', border: `1px dashed ${C.border}`, borderRadius: 12, color: C.muted, fontSize: 13 }}>
                  No paying clients found.
                </div>
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 16 }}>
                  {paidClients.map(renderClientCard)}
                </div>
              )}
            </div>
          )}

        </div>
      )}

      {/* ═══ Add Client Modal ═══ */}
      {showModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(6px)', display: 'flex', justifyContent: 'center', alignItems: 'flex-start', paddingTop: 50, zIndex: 9999, overflowY: 'auto' }}>
          <div ref={modalRef} style={{ background: C.surface, width: '100%', maxWidth: 640, borderRadius: 16, border: `1px solid ${C.border}`, overflow: 'hidden', boxShadow: '0 25px 50px -12px rgba(0,0,0,0.6)', marginBottom: 50, animation: 'slideUp 0.25s ease-out' }}>

            {/* Modal Header */}
            <div style={{ padding: '20px 28px', borderBottom: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'linear-gradient(135deg, rgba(249,115,22,0.08) 0%, rgba(234,88,12,0.01) 100%)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ width: 36, height: 36, background: 'linear-gradient(135deg, #ea580c, #f97316)', borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Shield size={18} color="#fff" />
                </div>
                <div>
                  <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: '#fff', fontFamily: "'Syne', sans-serif" }}>
                    {editingClient ? 'Edit GMB Client' : 'Add GMB Client'}
                  </h2>
                  <p style={{ margin: 0, color: C.muted, fontSize: 11, marginTop: 2 }}>
                    {editingClient ? 'Update client details' : 'Register client & link Google Business Profile'}
                  </p>
                </div>
              </div>
              <button onClick={() => setShowModal(false)} style={{ background: 'rgba(255,255,255,0.05)', border: `1px solid ${C.border}`, borderRadius: 8, padding: 6, cursor: 'pointer', transition: 'background 0.15s' }}
                onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.1)'}
                onMouseLeave={e => e.currentTarget.style.background = 'rgba(255,255,255,0.05)'}
              >
                <X size={16} color={C.muted} />
              </button>
            </div>

            {/* Modal Form */}
            <form onSubmit={handleSave} style={{ padding: 28, display: 'flex', flexDirection: 'column', gap: 20 }}>

              {/* Section 1: Business Basics */}
              <div>
                <h3 style={{ fontSize: 13, fontWeight: 700, color: C.accent, marginBottom: 14, textTransform: 'uppercase', letterSpacing: 0.5 }}>Business Basics</h3>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                  <div>
                    <label style={labelStyle}>Display Name (Internal)</label>
                    <div style={{ ...inputWrapStyle, border: `1px solid ${C.border}` }}>
                      <Building size={15} color={C.muted} />
                      <input name="display_name" value={formData.display_name} onChange={handleInputChange} placeholder="E.g. Raahath Dental (Internal)" style={{ background: 'transparent', border: 'none', color: '#fff', padding: '12px 8px', width: '100%', outline: 'none', fontSize: 13 }} />
                    </div>
                  </div>
                  <div>
                    <label style={labelStyle}>Official Business Name (GBP Name) *</label>
                    <div style={{ ...inputWrapStyle, border: `1px solid ${errors.business_name ? '#ef4444' : C.border}` }}>
                      <Building size={15} color={C.muted} />
                      <input name="business_name" value={formData.business_name} onChange={handleInputChange} placeholder="E.g. Raahath Dental Care" style={{ background: 'transparent', border: 'none', color: '#fff', padding: '12px 8px', width: '100%', outline: 'none', fontSize: 13 }} />
                    </div>
                    {errors.business_name && <span style={{ color: '#ef4444', fontSize: 11, marginTop: 4, display: 'block' }}>{errors.business_name}</span>}
                  </div>
                  <div style={{ gridColumn: 'span 2' }}>
                    <label style={labelStyle}>Business Type / Category *</label>
                    <select name="business_category" value={formData.business_category} onChange={handleInputChange} style={{ ...inputStyle, background: '#0a0f1d' }}>
                      <option value="">Select Category...</option>
                      {CATEGORIES.map(cat => <option key={cat} value={cat}>{cat}</option>)}
                    </select>
                  </div>
                </div>

                {showOtherCategory && (
                  <div style={{ marginTop: 14 }}>
                    <label style={labelStyle}>Specify Business Category *</label>
                    <input name="custom_category" value={formData.custom_category} onChange={handleInputChange} placeholder="E.g. Digital Marketing Agency" style={{ ...inputStyle, border: `1px solid ${errors.custom_category ? '#ef4444' : C.border}` }} />
                    {errors.custom_category && <span style={{ color: '#ef4444', fontSize: 11, marginTop: 4, display: 'block' }}>{errors.custom_category}</span>}
                  </div>
                )}

                <div style={{ marginTop: 14 }}>
                  <label style={labelStyle}>Website URL <span style={{ textTransform: 'none', fontWeight: 400, color: C.muted }}> (Optional)</span></label>
                  <div style={{ ...inputWrapStyle, border: `1px solid ${C.border}` }}>
                    <Globe size={15} color={C.muted} />
                    <input name="website_url" value={formData.website_url} onChange={handleInputChange} placeholder="E.g. www.raahathdental.com" style={{ background: 'transparent', border: 'none', color: '#fff', padding: '12px 8px', width: '100%', outline: 'none', fontSize: 13 }} />
                  </div>
                </div>
              </div>

              {/* Section 2: Contact Details */}
              <div>
                <h3 style={{ fontSize: 13, fontWeight: 700, color: C.accent, marginBottom: 14, textTransform: 'uppercase', letterSpacing: 0.5 }}>Contact Details</h3>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                  <div>
                    <label style={labelStyle}>Contact Person *</label>
                    <div style={{ ...inputWrapStyle, border: `1px solid ${errors.contact_person ? '#ef4444' : C.border}` }}>
                      <User size={15} color={C.muted} />
                      <input name="contact_person" value={formData.contact_person} onChange={handleInputChange} placeholder="E.g. Dr. Kamar" style={{ background: 'transparent', border: 'none', color: '#fff', padding: '12px 8px', width: '100%', outline: 'none', fontSize: 13 }} />
                    </div>
                    {errors.contact_person && <span style={{ color: '#ef4444', fontSize: 11, marginTop: 4, display: 'block' }}>{errors.contact_person}</span>}
                  </div>
                  <div>
                    <label style={labelStyle}>Phone Number *</label>
                    <div style={{ ...inputWrapStyle, border: `1px solid ${errors.phone_number ? '#ef4444' : C.border}` }}>
                      <Phone size={15} color={C.muted} />
                      <input name="phone_number" value={formData.phone_number} onChange={handleInputChange} placeholder="E.g. 9876543210" style={{ background: 'transparent', border: 'none', color: '#fff', padding: '12px 8px', width: '100%', outline: 'none', fontSize: 13 }} />
                    </div>
                    {errors.phone_number && <span style={{ color: '#ef4444', fontSize: 11, marginTop: 4, display: 'block' }}>{errors.phone_number}</span>}
                  </div>
                </div>

                <div style={{ marginTop: 14 }}>
                  <label style={labelStyle}>Business Address *</label>
                  <textarea
                    name="business_address"
                    value={formData.business_address}
                    onChange={handleInputChange}
                    rows={5}
                    placeholder={`Enter the complete business address\nExample:\n123, Business Road,\nKottakuppam,\nPuducherry - 605104,\nIndia`}
                    style={{
                      ...inputStyle,
                      border: `1px solid ${errors.business_address ? '#ef4444' : C.border}`,
                      resize: 'vertical',
                      lineHeight: 1.5,
                      fontFamily: 'inherit'
                    }}
                  />
                  {errors.business_address && <span style={{ color: '#ef4444', fontSize: 11, marginTop: 4, display: 'block' }}>{errors.business_address}</span>}
                </div>
              </div>

              {/* Section 3: GMB Details */}
              <div>
                <h3 style={{ fontSize: 13, fontWeight: 700, color: C.accent, marginBottom: 14, textTransform: 'uppercase', letterSpacing: 0.5 }}>Google Business Profile (GMB)</h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                  <div>
                    <label style={labelStyle}>Google Business Profile URL</label>
                    <div style={{ ...inputWrapStyle, border: `1px solid ${C.border}` }}>
                      <Link2 size={15} color={C.muted} />
                      <input name="gmb_url" value={formData.gmb_url} onChange={handleInputChange} placeholder="E.g. https://g.page/r/..." style={{ background: 'transparent', border: 'none', color: '#fff', padding: '12px 8px', width: '100%', outline: 'none', fontSize: 13 }} />
                    </div>
                  </div>
                  <div>
                    <label style={labelStyle}>GMB Management Email ID</label>
                    <div style={{ ...inputWrapStyle, border: `1px solid ${errors.gmb_email ? '#ef4444' : C.border}` }}>
                      <Mail size={15} color={C.muted} />
                      <input name="gmb_email" value={formData.gmb_email} onChange={handleInputChange} placeholder="E.g. owner@gmail.com" style={{ background: 'transparent', border: 'none', color: '#fff', padding: '12px 8px', width: '100%', outline: 'none', fontSize: 13 }} />
                    </div>
                    {errors.gmb_email && <span style={{ color: '#ef4444', fontSize: 11, marginTop: 4, display: 'block' }}>{errors.gmb_email}</span>}
                  </div>
                  <div>
                    <label style={labelStyle}>GA4 Property ID (For Post Analytics)</label>
                    <div style={{ ...inputWrapStyle, border: `1px solid ${C.border}` }}>
                      <Globe size={15} color={C.muted} />
                      <input name="ga4_property_id" value={formData.ga4_property_id} onChange={handleInputChange} placeholder="E.g. 123456789" style={{ background: 'transparent', border: 'none', color: '#fff', padding: '12px 8px', width: '100%', outline: 'none', fontSize: 13 }} />
                    </div>
                  </div>
                </div>
              </div>

              {/* Section 4: Client Settings & Plan */}
              <div>
                <h3 style={{ fontSize: 13, fontWeight: 700, color: C.accent, marginBottom: 14, textTransform: 'uppercase', letterSpacing: 0.5 }}>Client Settings & Plan</h3>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                  <div>
                    <label style={labelStyle}>Client Type</label>
                    <select name="client_type" value={formData.client_type} onChange={handleInputChange} style={{ ...inputStyle, background: '#0a0f1d' }}>
                      <option value="internal">Internal Brand (Unlimited)</option>
                      <option value="paid">Paid Client (Plan-based)</option>
                    </select>
                  </div>
                  {formData.client_type === 'paid' && (
                    <div>
                      <label style={labelStyle}>Assigned Pricing Plan</label>
                      <select name="plan_id" value={formData.plan_id} onChange={handleInputChange} style={{ ...inputStyle, background: '#0a0f1d' }}>
                        <option value="">Select Plan...</option>
                        {plans.map(p => (
                          <option key={p.id} value={p.id}>{p.name} (₹{parseFloat(p.price).toLocaleString()})</option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>
              </div>

              {/* Submit Button */}
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 6 }}>
                <button
                  type="submit"
                  disabled={isSaving}
                  style={{ background: 'linear-gradient(135deg, #f97316, #ea580c)', border: 'none', padding: '14px 28px', borderRadius: 10, color: '#fff', fontSize: 13, fontWeight: 700, cursor: isSaving ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', gap: 8, opacity: isSaving ? 0.75 : 1, width: '100%', justifyContent: 'center', boxShadow: '0 4px 14px rgba(249,115,22,0.25)', transition: 'transform 0.15s' }}
                  onMouseEnter={e => { if (!isSaving) e.currentTarget.style.transform = 'scale(1.02)'; }}
                  onMouseLeave={e => e.currentTarget.style.transform = 'scale(1)'}
                >
                  {isSaving ? <Loader2 size={16} className="spin" /> : <CheckCircle2 size={16} />}
                  {isSaving ? (editingClient ? 'Updating Client...' : 'Saving Client...') : (editingClient ? 'Update Client' : 'Onboard Client')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ═══ Animation Keyframes ═══ */}
      <style>{`
        @keyframes slideUp {
          from { opacity: 0; transform: translateY(20px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        .spin { animation: spin 1s linear infinite; }
      `}</style>
    </div>
  );
}
