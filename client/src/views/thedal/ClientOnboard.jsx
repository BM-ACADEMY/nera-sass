import React, { useState, useEffect } from 'react';
import SopModal from '../../components/common/SopModal.jsx';
import { C } from '../../constants/theme.js';
import { User, Loader2, Plus, Edit2, Trash2, CheckCircle2, Building, Phone, Mail, Globe, MapPin, Tag, AlertTriangle, X } from 'lucide-react';
import { api } from '../../services/api.js';
import toast from 'react-hot-toast';
import { useClient } from '../../contexts/ClientContext.jsx';

export default function ClientOnboard() {
  const [clients, setClients] = useState([]);
  const [plans, setPlans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingClient, setEditingClient] = useState(null);
  const [clientToDelete, setClientToDelete] = useState(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [viewingPlanClient, setViewingPlanClient] = useState(null);
  
  // Pagination State
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;
  
  const { refreshGlobalData } = useClient();
  
  // Form State
  const [isCustomCategory, setIsCustomCategory] = useState(false);
  const [hasDraft, setHasDraft] = useState(false);
  const [errors, setErrors] = useState({});
  const [formData, setFormData] = useState({
    client_name: '',
    phone: '',
    email: '',
    business_name: '',
    domain: '',
    business_category: '',
    plan: '',
    subscription_duration: ''
  });

  const fetchClientsAndPlans = async () => {
    setLoading(true);
    try {
      const [clientsData, plansData] = await Promise.all([
        api.get('/thedal/clients'),
        api.get('/thedal/plans')
      ]);
      if (clientsData) setClients(clientsData);
      if (plansData) setPlans(plansData);
    } catch (err) {
      console.error('Failed to load data', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchClientsAndPlans();
  }, []);

  // Helper to normalize domain by stripping protocol, www, and path/slashes
  const normalizeDomain = (url) => {
    if (!url) return '';
    let clean = url.trim().toLowerCase();
    clean = clean.replace(/^(https?:\/\/)?(www\.)?/, '');
    clean = clean.split('/')[0];
    return clean;
  };

  // Save Draft automatically when typing new client
  useEffect(() => {
    if (modalOpen && !editingClient) {
      localStorage.setItem('clientOnboardDraft', JSON.stringify({ formData, isCustomCategory, timestamp: Date.now() }));
      if (!hasDraft) setHasDraft(true);
    }
  }, [formData, isCustomCategory, modalOpen, editingClient]);

  const handleInputChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const openModal = (client = null) => {
    const defaultCategories = ['Healthcare', 'Real Estate', 'E-commerce', 'SaaS', 'Local Services', 'Agency'];
    if (client) {
      setEditingClient(client);
      setIsCustomCategory(client.business_category && !defaultCategories.includes(client.business_category));
      setFormData({
        client_name: client.client_name || '',
        phone: client.phone || '',
        email: client.email || '',
        business_name: client.business_name || '',
        domain: client.domain || '',
        business_category: client.business_category || '',
        plan: client.plan || '',
        subscription_duration: client.subscription_duration || ''
      });
      setHasDraft(false);
    } else {
      setEditingClient(null);
      const draft = localStorage.getItem('clientOnboardDraft');
      if (draft) {
        try {
          const parsed = JSON.parse(draft);
          const oneDay = 24 * 60 * 60 * 1000;
          if (parsed.timestamp && Date.now() - parsed.timestamp > oneDay) {
            localStorage.removeItem('clientOnboardDraft');
            setIsCustomCategory(false);
            setFormData({ client_name: '', phone: '', email: '', business_name: '', domain: '', business_category: '', plan: '', subscription_duration: '' });
            setHasDraft(false);
          } else {
            setFormData(parsed.formData);
            setIsCustomCategory(parsed.isCustomCategory || false);
            setHasDraft(true);
          }
        } catch (e) {
          setIsCustomCategory(false);
          setFormData({ client_name: '', phone: '', email: '', business_name: '', domain: '', business_category: '', plan: '', subscription_duration: '' });
          setHasDraft(false);
        }
      } else {
        setIsCustomCategory(false);
        setFormData({ client_name: '', phone: '', email: '', business_name: '', domain: '', business_category: '', plan: '', subscription_duration: '' });
        setHasDraft(false);
      }
    }
    setModalOpen(true);
  };

  const handleDiscardDraft = () => {
    localStorage.removeItem('clientOnboardDraft');
    setFormData({ client_name: '', phone: '', email: '', business_name: '', domain: '', business_category: '', plan: '', subscription_duration: '' });
    setIsCustomCategory(false);
    setErrors({});
    setHasDraft(false);
    toast('Draft discarded', { icon: '🗑️', style: { background: '#334155', color: '#fff' } });
  };

  const closeModal = () => {
    setModalOpen(false);
  };

  const handleSave = async () => {
    const normalizedDomain = normalizeDomain(formData.domain);
    const finalFormData = { ...formData, domain: normalizedDomain };
    const newErrors = {};

    // Phone validation (10 digits only)
    const phoneRegex = /^\d{10}$/;
    if (finalFormData.phone && !phoneRegex.test(finalFormData.phone)) {
      newErrors.phone = 'Requires exactly a 10-digit number.';
    }

    // Email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (finalFormData.email && !emailRegex.test(finalFormData.email)) {
      newErrors.email = 'Requires a valid email address.';
    }

    // Domain validation
    const urlRegex = /^(https?:\/\/)?([a-zA-Z0-9-]+\.)+[a-zA-Z]{2,}(\/.*)?$/;
    if (finalFormData.domain && !urlRegex.test(finalFormData.domain)) {
      newErrors.domain = 'Requires a valid domain (e.g., google.com).';
    }

    // Required fields
    if (!finalFormData.business_category || finalFormData.business_category.trim() === '') {
      newErrors.business_category = 'Business category is required.';
    }
    if (!finalFormData.business_name) {
      newErrors.business_name = 'Business name is required.';
    }
    if (!finalFormData.domain) {
      newErrors.domain = 'Website domain is required.';
    }

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return toast.error('Please fix the errors in the form.');
    }

    setErrors({});
    setIsSaving(true);
    try {
      if (editingClient) {
        await api.put(`/thedal/clients/${editingClient.id}`, finalFormData);
      } else {
        await api.post('/thedal/clients', finalFormData);
      }
      localStorage.removeItem('clientOnboardDraft');
      setHasDraft(false);
      closeModal();
      fetchClientsAndPlans();
      refreshGlobalData();
      toast.success(editingClient ? 'Client updated successfully!' : 'Client onboarded successfully!');
    } catch (err) {
      console.error('Error saving client', err);
      toast.error('Failed to save client.');
    } finally {
      setIsSaving(false);
    }
  };



  const handleDeleteClick = (client) => {
    setClientToDelete(client);
  };

  const confirmDelete = async () => {
    if (!clientToDelete) return;
    setIsDeleting(true);
    try {
      await api.delete(`/thedal/clients/${clientToDelete.id}`);
      fetchClientsAndPlans();
      refreshGlobalData();
      toast.success('Client deleted successfully!');
    } catch (err) {
      console.error('Error deleting client', err);
      toast.error('Failed to delete client.');
    } finally {
      setIsDeleting(false);
      setClientToDelete(null);
    }
  };

  if (loading && clients.length === 0) {
    return (
      <div style={{ display: 'flex', height: '100%', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.2)' }}>
        <Loader2 size={32} color={C.accent} className="spin" />
      </div>
    );
  }

  const totalPages = Math.ceil(clients.length / itemsPerPage);
  const paginatedClients = clients.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

  return (
    <div style={{ padding: 30, color: C.text, height: '100%', overflowY: 'auto', background: 'rgba(0,0,0,0.2)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}><h1 style={{ fontSize: 28, fontWeight: 800, color: '#e2e8f0', margin: 0, fontFamily: "'Syne', sans-serif" }}>Client Onboarding</h1><SopModal /></div>
          <p style={{ color: C.muted, fontSize: 14, marginTop: 4 }}>Manage Thedal OS clients and subscription plans.</p>
        </div>
        <button 
          onClick={() => openModal()}
          style={{ background: C.accent, border: 'none', padding: '10px 20px', borderRadius: 8, color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}
        >
          <Plus size={16} /> Add New Client
        </button>
      </div>

      <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: 20 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
          <thead>
            <tr style={{ borderBottom: `1px solid ${C.border}` }}>
              <th style={{ padding: '12px 0', color: C.muted, fontSize: 12, fontWeight: 600 }}>CLIENT / BUSINESS</th>
              <th style={{ padding: '12px 0', color: C.muted, fontSize: 12, fontWeight: 600 }}>DOMAIN</th>
              <th style={{ padding: '12px 0', color: C.muted, fontSize: 12, fontWeight: 600 }}>CONTACT</th>
              <th style={{ padding: '12px 0', color: C.muted, fontSize: 12, fontWeight: 600 }}>PLAN</th>
              <th style={{ padding: '12px 0', color: C.muted, fontSize: 12, fontWeight: 600, textAlign: 'right' }}>ACTIONS</th>
            </tr>
          </thead>
          <tbody>
            {paginatedClients.length > 0 ? paginatedClients.map((client) => (
              <tr key={client.id} style={{ borderBottom: `1px solid ${C.border}55` }}>
                <td style={{ padding: '16px 0' }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: '#e2e8f0' }}>{client.business_name || 'N/A'}</div>
                  <div style={{ fontSize: 12, color: C.muted }}>{client.client_name || 'No name provided'}</div>
                </td>
                <td style={{ padding: '16px 0', fontSize: 13, color: C.accent }}>{client.domain}</td>
                <td style={{ padding: '16px 0' }}>
                  <div style={{ fontSize: 12, color: '#e2e8f0', display: 'flex', alignItems: 'center', gap: 4 }}><Mail size={12}/> {client.email || '-'}</div>
                  <div style={{ fontSize: 12, color: C.muted, display: 'flex', alignItems: 'center', gap: 4, marginTop: 4 }}><Phone size={12}/> {client.phone || '-'}</div>
                </td>
                <td style={{ padding: '16px 0' }}>
                  <span style={{ 
                    padding: '4px 10px', borderRadius: 20, fontSize: 11, fontWeight: 700,
                    background: client.plan === 'Pro' ? 'rgba(168,85,247,0.15)' : client.plan === 'Standard' ? 'rgba(59,130,246,0.15)' : client.plan === 'Basic' ? 'rgba(34,197,94,0.15)' : 'rgba(100,116,139,0.15)',
                    color: client.plan === 'Pro' ? '#a855f7' : client.plan === 'Standard' ? '#3b82f6' : client.plan === 'Basic' ? '#22c55e' : '#94a3b8'
                  }}>
                    {client.plan}
                  </span>
                  <div style={{ fontSize: 11, color: C.muted, marginTop: 6, fontWeight: 600 }}>{client.subscription_duration}</div>
                </td>
                <td style={{ padding: '16px 0', textAlign: 'right' }}>
                  <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                    <button onClick={() => setViewingPlanClient(client)} style={{ background: 'transparent', border: `1px solid ${C.border}`, color: C.accent, padding: '6px', borderRadius: 6, cursor: 'pointer', display: 'flex', alignItems: 'center' }} title="View Plan Detail">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>
                    </button>
                    <button onClick={() => openModal(client)} style={{ background: 'transparent', border: `1px solid ${C.border}`, color: C.text, padding: '6px', borderRadius: 6, cursor: 'pointer', display: 'flex', alignItems: 'center' }} title="Edit Client">
                      <Edit2 size={14} />
                    </button>
                    <button onClick={() => handleDeleteClick(client)} style={{ background: 'transparent', border: `1px solid ${C.border}`, color: '#ef4444', padding: '6px', borderRadius: 6, cursor: 'pointer', display: 'flex', alignItems: 'center' }}>
                      <Trash2 size={14} />
                    </button>
                  </div>
                </td>
              </tr>
            )) : (
              <tr><td colSpan={5} style={{ padding: '40px 0', textAlign: 'center', color: C.muted }}>No clients onboarded yet.</td></tr>
            )}
          </tbody>
        </table>
        
        {totalPages > 1 && (
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 20, padding: '0 8px' }}>
            <button 
              onClick={() => setCurrentPage(p => Math.max(1, p - 1))} 
              disabled={currentPage === 1}
              style={{ background: 'transparent', border: `1px solid ${C.border}`, color: C.text, padding: '8px 16px', borderRadius: 8, cursor: currentPage === 1 ? 'not-allowed' : 'pointer', fontSize: 13, fontWeight: 600, opacity: currentPage === 1 ? 0.5 : 1 }}
            >
              Previous
            </button>
            <div style={{ fontSize: 13, color: C.muted, fontWeight: 500 }}>
              Showing {((currentPage - 1) * itemsPerPage) + 1} to {Math.min(currentPage * itemsPerPage, clients.length)} of {clients.length} clients
            </div>
            <button 
              onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))} 
              disabled={currentPage === totalPages}
              style={{ background: 'transparent', border: `1px solid ${C.border}`, color: C.text, padding: '8px 16px', borderRadius: 8, cursor: currentPage === totalPages ? 'not-allowed' : 'pointer', fontSize: 13, fontWeight: 600, opacity: currentPage === totalPages ? 0.5 : 1 }}
            >
              Next
            </button>
          </div>
        )}
      </div>

      {/* Onboarding Modal */}
      {modalOpen && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}>
          <div style={{ background: C.surface, width: 600, borderRadius: 16, border: `1px solid ${C.border}`, overflow: 'hidden', display: 'flex', flexDirection: 'column', maxHeight: '90vh' }}>
            <div style={{ padding: '20px 24px', borderBottom: `1px solid ${C.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: '#fff' }}>{editingClient ? 'Edit Client' : 'Onboard New Client'}</h2>
                {hasDraft && <span style={{ background: 'rgba(245,158,11,0.15)', color: '#f59e0b', fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 20 }}>Draft Auto-Saved</span>}
              </div>
              <button onClick={closeModal} style={{ background: 'transparent', border: 'none', color: C.muted, cursor: 'pointer', fontSize: 24 }}>&times;</button>
            </div>

            <div style={{ padding: '24px', flex: 1, overflowY: 'auto' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                  
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                    <div>
                      <label style={{ display: 'block', fontSize: 12, color: C.muted, marginBottom: 6, fontWeight: 600 }}>CLIENT NAME</label>
                      <div style={{ display: 'flex', alignItems: 'center', background: 'rgba(0,0,0,0.2)', border: `1px solid ${C.border}`, borderRadius: 8, padding: '0 12px' }}>
                        <User size={16} color={C.muted} />
                        <input name="client_name" value={formData.client_name} onChange={handleInputChange} placeholder="John Doe" style={{ background: 'transparent', border: 'none', color: '#fff', padding: '10px', width: '100%', outline: 'none', fontSize: 14 }} />
                      </div>
                    </div>
                    <div>
                      <label style={{ display: 'block', fontSize: 12, color: C.muted, marginBottom: 6, fontWeight: 600 }}>PHONE NUMBER</label>
                      <div style={{ display: 'flex', alignItems: 'center', background: 'rgba(0,0,0,0.2)', border: `1px solid ${errors.phone ? C.red : C.border}`, borderRadius: 8, padding: '0 12px' }}>
                        <Phone size={16} color={C.muted} />
                        <input 
                          name="phone" 
                          value={formData.phone} 
                          onChange={(e) => {
                            const val = e.target.value.replace(/\D/g, '').slice(0, 10);
                            setFormData({ ...formData, phone: val });
                            if (errors.phone) setErrors({ ...errors, phone: null });
                          }} 
                          placeholder="9876543210" 
                          maxLength="10"
                          style={{ background: 'transparent', border: 'none', color: '#fff', padding: '10px', width: '100%', outline: 'none', fontSize: 14 }} 
                        />
                      </div>
                      {errors.phone && <span style={{ color: C.red, fontSize: 12, marginTop: 6, display: 'block' }}>{errors.phone}</span>}
                    </div>
                  </div>

                  <div>
                    <label style={{ display: 'block', fontSize: 12, color: C.muted, marginBottom: 6, fontWeight: 600 }}>EMAIL ADDRESS</label>
                    <div style={{ display: 'flex', alignItems: 'center', background: 'rgba(0,0,0,0.2)', border: `1px solid ${errors.email ? C.red : C.border}`, borderRadius: 8, padding: '0 12px' }}>
                      <Mail size={16} color={C.muted} />
                      <input name="email" value={formData.email} onChange={(e) => { handleInputChange(e); if (errors.email) setErrors({ ...errors, email: null }); }} placeholder="john@company.com" style={{ background: 'transparent', border: 'none', color: '#fff', padding: '10px', width: '100%', outline: 'none', fontSize: 14 }} />
                    </div>
                    {errors.email && <span style={{ color: C.red, fontSize: 12, marginTop: 6, display: 'block' }}>{errors.email}</span>}
                  </div>

                  <h3 style={{ fontSize: 15, fontWeight: 600, color: C.accent, marginTop: 16, marginBottom: 8 }}>Business Details</h3>

                  <div>
                    <label style={{ display: 'block', fontSize: 12, color: C.muted, marginBottom: 6, fontWeight: 600 }}>BUSINESS NAME</label>
                    <div style={{ display: 'flex', alignItems: 'center', background: 'rgba(0,0,0,0.2)', border: `1px solid ${errors.business_name ? C.red : C.border}`, borderRadius: 8, padding: '0 12px' }}>
                      <Building size={16} color={C.muted} />
                      <input name="business_name" value={formData.business_name} onChange={(e) => { handleInputChange(e); if (errors.business_name) setErrors({ ...errors, business_name: null }); }} placeholder="Raahath Dental Care" style={{ background: 'transparent', border: 'none', color: '#fff', padding: '10px', width: '100%', outline: 'none', fontSize: 14 }} />
                    </div>
                    {errors.business_name && <span style={{ color: C.red, fontSize: 12, marginTop: 6, display: 'block' }}>{errors.business_name}</span>}
                  </div>

                  <div>
                    <label style={{ display: 'block', fontSize: 12, color: C.muted, marginBottom: 6, fontWeight: 600 }}>BUSINESS WEBSITE / DOMAIN</label>
                    <div style={{ display: 'flex', alignItems: 'center', background: 'rgba(0,0,0,0.2)', border: `1px solid ${errors.domain ? C.red : C.border}`, borderRadius: 8, padding: '0 12px' }}>
                      <Globe size={16} color={C.muted} />
                      <input name="domain" value={formData.domain} onChange={(e) => { handleInputChange(e); if (errors.domain) setErrors({ ...errors, domain: null }); }} placeholder="raahathdentalcare.in" style={{ background: 'transparent', border: 'none', color: '#fff', padding: '10px', width: '100%', outline: 'none', fontSize: 14 }} />
                    </div>
                    {errors.domain && <span style={{ color: C.red, fontSize: 12, marginTop: 6, display: 'block' }}>{errors.domain}</span>}
                  </div>

                  <div>
                    <label style={{ display: 'block', fontSize: 12, color: C.muted, marginBottom: 6, fontWeight: 600 }}>BUSINESS CATEGORY</label>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <select 
                        value={isCustomCategory ? 'custom' : formData.business_category} 
                        onChange={(e) => {
                          if (e.target.value === 'custom') {
                            setIsCustomCategory(true);
                            setFormData({ ...formData, business_category: '' });
                          } else {
                            setIsCustomCategory(false);
                            setFormData({ ...formData, business_category: e.target.value });
                          }
                        }}
                        style={{ background: 'rgba(0,0,0,0.2)', border: `1px solid ${C.border}`, color: '#fff', padding: '10px 12px', borderRadius: 8, flex: isCustomCategory ? '0 0 auto' : 1, outline: 'none', fontSize: 14 }}
                      >
                        <option value="" disabled style={{ background: '#0f172a', color: '#94a3b8' }}>Select Category...</option>
                        {['Healthcare', 'Real Estate', 'E-commerce', 'SaaS', 'Local Services', 'Agency'].map(cat => (
                          <option key={cat} value={cat} style={{ background: '#0f172a', color: '#fff', padding: '8px' }}>{cat}</option>
                        ))}
                        <option value="custom" style={{ background: '#0f172a', color: '#f59e0b', fontWeight: 'bold' }}>✨ Custom Category</option>
                      </select>

                      {isCustomCategory && (
                        <div style={{ display: 'flex', alignItems: 'center', background: 'rgba(0,0,0,0.2)', border: `1px solid ${C.border}`, borderRadius: 8, padding: '0 12px', flex: 1 }}>
                          <Tag size={16} color={C.muted} />
                          <input 
                            name="business_category" 
                            value={formData.business_category} 
                            onChange={handleInputChange} 
                            placeholder="e.g. Fintech" 
                            style={{ background: 'transparent', border: 'none', color: '#fff', padding: '10px', width: '100%', outline: 'none', fontSize: 14 }} 
                          />
                        </div>
                      )}
                    </div>
                  </div>
                </div>
            </div>

            <div style={{ padding: '16px 24px', borderTop: `1px solid ${C.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(0,0,0,0.2)' }}>
              <div style={{ display: 'flex', gap: 12 }}>
                {hasDraft && (
                  <button onClick={handleDiscardDraft} style={{ background: 'transparent', border: `1px solid ${C.red}`, padding: '10px 20px', borderRadius: 8, color: C.red, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>Discard Draft</button>
                )}
              </div>
              <div style={{ display: 'flex', gap: 12 }}>
                <button onClick={closeModal} style={{ background: 'transparent', border: `1px solid ${C.border}`, padding: '10px 20px', borderRadius: 8, color: C.text, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>Cancel</button>
                <button 
                  onClick={handleSave} 
                  disabled={isSaving}
                  style={{ background: C.accent, border: 'none', padding: '10px 20px', borderRadius: 8, color: '#fff', fontSize: 13, fontWeight: 600, cursor: isSaving ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', gap: 8, opacity: isSaving ? 0.7 : 1 }}
                >
                  {isSaving ? <Loader2 size={16} className="spin" /> : <CheckCircle2 size={16} />} 
                  {isSaving ? 'Saving...' : 'Save Client'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* View Plan Modal */}
      {viewingPlanClient && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div style={{ background: C.surface, width: 500, borderRadius: 16, overflow: 'hidden', boxShadow: '0 25px 50px -12px rgba(0,0,0,0.5)', border: `1px solid ${C.border}`, display: 'flex', flexDirection: 'column', maxHeight: '90vh' }}>
            <div style={{ padding: 24, borderBottom: `1px solid ${C.border}` }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h2 style={{ fontSize: 18, fontWeight: 700, color: '#fff', margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={C.accent} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg> 
                  Active Plan Details
                </h2>
                <button onClick={() => setViewingPlanClient(null)} style={{ background: 'transparent', border: 'none', color: C.muted, cursor: 'pointer', padding: 0 }}><X size={20} /></button>
              </div>
            </div>
            
            <div style={{ padding: 24, overflowY: 'auto' }}>
              <div style={{ marginBottom: 20 }}>
                <div style={{ fontSize: 13, color: C.muted }}>CLIENT</div>
                <div style={{ fontSize: 16, fontWeight: 600, color: '#fff' }}>{viewingPlanClient.business_name || viewingPlanClient.client_name}</div>
              </div>

              {viewingPlanClient.plan ? (() => {
                const p = plans.find(plan => plan.name === viewingPlanClient.plan);
                if (!p) return <div style={{ color: C.muted, fontStyle: 'italic' }}>Plan data not found.</div>;
                
                return (
                  <div style={{ background: 'rgba(255,255,255,0.03)', borderRadius: 12, padding: 20, border: `1px solid ${C.border}` }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
                      <div>
                        <div style={{ fontSize: 12, fontWeight: 700, color: C.accent, textTransform: 'uppercase', letterSpacing: 1 }}>{p.name} Plan</div>
                        <div style={{ fontSize: 24, fontWeight: 800, color: '#fff', marginTop: 4 }}>
                          {p.price > 0 ? `${p.currency} ${p.price}` : 'Free'}
                        </div>
                        <div style={{ fontSize: 13, color: C.muted, marginTop: 4 }}>
                          Duration: <span style={{ color: '#e2e8f0', fontWeight: 600 }}>{viewingPlanClient.subscription_duration}</span>
                        </div>
                      </div>
                      <span style={{ background: 'rgba(34, 197, 94, 0.1)', color: '#22c55e', padding: '4px 10px', borderRadius: 20, fontSize: 12, fontWeight: 700 }}>
                        Active
                      </span>
                    </div>

                    <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: 16 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: '#fff', marginBottom: 12 }}>Included Features:</div>
                      <div style={{ display: 'grid', gap: 10 }}>
                        {p.features && p.features.length > 0 ? (
                          p.features.map((f, i) => (
                            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#cbd5e1' }}>
                              <CheckCircle2 size={14} color={C.accent} /> {f.feature_name}
                            </div>
                          ))
                        ) : (
                          <div style={{ color: C.muted, fontSize: 13, fontStyle: 'italic' }}>No specific features listed.</div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })() : (
                <div style={{ textAlign: 'center', padding: '30px 0', color: C.muted, background: 'rgba(0,0,0,0.2)', borderRadius: 12, border: `1px dashed ${C.border}` }}>
                  <AlertTriangle size={32} style={{ margin: '0 auto 12px', opacity: 0.5 }} />
                  <div>This client does not currently have an active subscription plan.</div>
                </div>
              )}
            </div>
            
            <div style={{ padding: '16px 24px', borderTop: `1px solid ${C.border}`, display: 'flex', justifyContent: 'flex-end', background: 'rgba(0,0,0,0.2)' }}>
              <button onClick={() => setViewingPlanClient(null)} style={{ background: C.surface, border: `1px solid ${C.border}`, padding: '8px 16px', borderRadius: 8, color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>Close</button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {clientToDelete && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div style={{ background: C.surface, width: 400, borderRadius: 16, overflow: 'hidden', boxShadow: '0 25px 50px -12px rgba(0,0,0,0.5)', border: `1px solid ${C.border}` }}>
            <div style={{ padding: 24, borderBottom: `1px solid ${C.border}` }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h2 style={{ fontSize: 18, fontWeight: 700, color: '#fff', margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <AlertTriangle size={20} color="#ef4444" /> Delete Client
                </h2>
                <button onClick={() => setClientToDelete(null)} style={{ background: 'transparent', border: 'none', color: C.muted, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0 }}><X size={20} /></button>
              </div>
            </div>
            <div style={{ padding: 24 }}>
              <p style={{ color: C.text, fontSize: 14, margin: 0, lineHeight: 1.6 }}>
                Are you sure you want to delete <strong style={{ color: '#fff' }}>{clientToDelete.client_name || clientToDelete.business_name}</strong>? This action cannot be undone and will remove all their associated data.
              </p>
            </div>
            <div style={{ padding: '16px 24px', background: 'rgba(0,0,0,0.2)', borderTop: `1px solid ${C.border}`, display: 'flex', justifyContent: 'flex-end', gap: 12 }}>
              <button onClick={() => setClientToDelete(null)} disabled={isDeleting} style={{ background: 'transparent', border: `1px solid ${C.border}`, padding: '8px 16px', borderRadius: 8, color: '#fff', fontSize: 13, fontWeight: 600, cursor: isDeleting ? 'not-allowed' : 'pointer', opacity: isDeleting ? 0.5 : 1 }}>Cancel</button>
              <button onClick={confirmDelete} disabled={isDeleting} style={{ background: '#ef4444', border: 'none', padding: '8px 16px', borderRadius: 8, color: '#fff', fontSize: 13, fontWeight: 600, cursor: isDeleting ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', gap: 8, opacity: isDeleting ? 0.7 : 1 }}>
                {isDeleting ? <Loader2 size={16} className="spin" /> : null}
                {isDeleting ? 'Deleting...' : 'Delete Client'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
