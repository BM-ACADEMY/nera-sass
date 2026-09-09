import React, { useState, useEffect } from 'react';
import SopModal from '../../components/common/SopModal.jsx';
import { C } from '../../constants/theme.js';
import { Loader2, Search, CheckCircle2, AlertTriangle, Building, Tag, Users } from 'lucide-react';
import { api } from '../../services/api.js';
import toast from 'react-hot-toast';
import { useClient } from '../../contexts/ClientContext.jsx';

export default function PlanSubscription() {
  const [clients, setClients] = useState([]);
  const [plans, setPlans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedClient, setSelectedClient] = useState(null);
  
  // Pagination State
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 5;
  
  const [selectedNewPlan, setSelectedNewPlan] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  
  const { refreshGlobalData } = useClient();

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

  const filteredClients = clients.filter(c => {
    const term = searchTerm.toLowerCase();
    return (
      (c.phone && c.phone.toLowerCase().includes(term)) ||
      (c.email && c.email.toLowerCase().includes(term)) ||
      (c.client_name && c.client_name.toLowerCase().includes(term)) ||
      (c.business_name && c.business_name.toLowerCase().includes(term))
    );
  });

  const totalPages = Math.ceil(filteredClients.length / itemsPerPage);
  const paginatedClients = filteredClients.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

  // Reset to page 1 when searching
  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm]);

  const handleClientSelect = (client) => {
    setSelectedClient(client);
    setSelectedNewPlan(''); // reset new plan selection
  };

  const calculateProration = () => {
    if (!selectedClient || !currentPlanObj || !newPlanObj) return null;
    
    const pOld = currentPlanObj.price || 0;
    const pNew = newPlanObj.price || 0;
    
    const oldCycleDays = currentPlanObj.billing_cycle === -1 ? 36500 : Number(currentPlanObj.billing_cycle) || 30;
    const newCycleDays = newPlanObj.billing_cycle === -1 ? 36500 : Number(newPlanObj.billing_cycle) || 30;

    const startDate = new Date(selectedClient.updated_at || selectedClient.created_at || Date.now());
    const daysElapsed = Math.floor((Date.now() - startDate.getTime()) / (24 * 60 * 60 * 1000));
    const daysRemaining = Math.max(0, oldCycleDays - daysElapsed);
    
    const dailyRateOld = oldCycleDays > 0 ? (pOld / oldCycleDays) : 0;
    const unusedCredit = Math.max(0, parseFloat((dailyRateOld * daysRemaining).toFixed(2)));
    
    const netDue = Math.max(0, parseFloat((pNew - unusedCredit).toFixed(2)));
    
    const dailyRateNew = newCycleDays > 0 ? (pNew / newCycleDays) : 0;
    let adjustedDays = newCycleDays;
    let extraDays = 0;
    if (pNew > 0 && dailyRateNew > 0 && unusedCredit > 0) {
      extraDays = Math.round(unusedCredit / dailyRateNew);
      adjustedDays = newCycleDays + extraDays;
    }
    
    return {
      unusedCredit,
      netDue,
      daysRemaining,
      extraDays,
      adjustedDays,
      currency: newPlanObj.currency || 'INR'
    };
  };

  const handleSave = () => {
    if (!selectedClient) return toast.error('Please select a client first');
    if (!selectedNewPlan) return toast.error('Please select a new plan to assign');
    
    if (selectedClient.plan && selectedClient.plan !== selectedNewPlan) {
      setShowConfirmModal(true);
    } else {
      executeSave();
    }
  };

  const executeSave = async () => {
    setIsSaving(true);
    try {
      const planObj = plans.find(p => p.name === selectedNewPlan);
      
      const proration = calculateProration();
      let subscriptionDuration = String(planObj.billing_cycle) === '-1' ? 'Lifetime' : `${planObj.billing_cycle} Days`;
      
      if (proration && proration.extraDays > 0) {
        subscriptionDuration = `${proration.adjustedDays} Days (${planObj.billing_cycle} + ${proration.extraDays} credit days)`;
      }
      
      const payload = {
        ...selectedClient,
        plan: planObj.name,
        subscription_duration: subscriptionDuration
      };

      await api.put(`/thedal/clients/${selectedClient.id}`, payload);
      
      fetchClientsAndPlans();
      refreshGlobalData();
      toast.success('Subscription plan successfully updated!');
      
      setSelectedClient(payload);
      setSelectedNewPlan('');
      setShowConfirmModal(false);
    } catch (err) {
      console.error('Error saving plan', err);
      toast.error('Failed to assign new plan.');
    } finally {
      setIsSaving(false);
    }
  };

  if (loading && clients.length === 0) {
    return (
      <div style={{ display: 'flex', height: '100%', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.2)' }}>
        <Loader2 size={32} color={C.accent} className="spin" />
      </div>
    );
  }

  const currentPlanObj = selectedClient?.plan ? plans.find(p => p.name === selectedClient.plan) : null;
  const newPlanObj = selectedNewPlan ? plans.find(p => p.name === selectedNewPlan) : null;

  return (
    <div style={{ padding: 30, color: C.text, height: '100%', overflowY: 'auto', background: 'rgba(0,0,0,0.2)' }}>
      <div style={{ marginBottom: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}><h1 style={{ fontSize: 28, fontWeight: 800, color: '#e2e8f0', margin: 0, fontFamily: "'Syne', sans-serif" }}>Plan Subscription</h1><SopModal /></div>
        <p style={{ color: C.muted, fontSize: 14, marginTop: 4 }}>Manage and assign subscription plans to existing clients.</p>
      </div>

      <div style={{ display: 'flex', gap: 24, flexDirection: 'column', maxWidth: 1000 }}>
        
        {/* Step 1: Select Client */}
        <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: 24 }}>
          <h3 style={{ fontSize: 16, fontWeight: 700, color: '#fff', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
            <Users size={18} color={C.accent} /> 1. Select Client
          </h3>
          
          <div style={{ marginBottom: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', background: 'rgba(0,0,0,0.2)', border: `1px solid ${C.border}`, borderRadius: 8, padding: '0 12px', width: '100%', maxWidth: 400 }}>
              <Search size={16} color={C.muted} />
              <input 
                value={searchTerm} 
                onChange={(e) => setSearchTerm(e.target.value)} 
                placeholder="Search by name, email, or phone..." 
                style={{ background: 'transparent', border: 'none', color: '#fff', padding: '12px', width: '100%', outline: 'none', fontSize: 14 }} 
              />
            </div>
          </div>

          <div style={{ maxHeight: 350, overflowY: 'auto', border: `1px solid ${C.border}`, borderRadius: 8, background: 'rgba(0,0,0,0.2)' }}>
            {paginatedClients.length > 0 ? paginatedClients.map((client) => (
              <div 
                key={client.id} 
                onClick={() => handleClientSelect(client)}
                style={{ 
                  padding: '12px 16px', 
                  borderBottom: `1px solid ${C.border}55`, 
                  cursor: 'pointer',
                  background: selectedClient?.id === client.id ? `${C.accent}22` : 'transparent',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  transition: 'background 0.2s'
                }}
                onMouseOver={(e) => { if(selectedClient?.id !== client.id) e.currentTarget.style.background = 'rgba(255,255,255,0.02)' }}
                onMouseOut={(e) => { if(selectedClient?.id !== client.id) e.currentTarget.style.background = 'transparent' }}
              >
                <div>
                  <div style={{ fontSize: 14, fontWeight: 600, color: '#fff' }}>{client.business_name || client.client_name}</div>
                  <div style={{ fontSize: 12, color: C.muted, marginTop: 4 }}>
                    {client.email} {client.phone ? `• ${client.phone}` : ''}
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  {client.is_expired_auto_downgraded && (
                    <span style={{ fontSize: 10, fontWeight: 700, color: '#ef4444', background: 'rgba(239, 68, 68, 0.15)', border: '1px solid rgba(239,68,68,0.3)', padding: '2px 8px', borderRadius: 10 }}>
                      Expired & Downgraded
                    </span>
                  )}
                  <div style={{ fontSize: 12, fontWeight: 600, color: C.accent, background: 'rgba(0,0,0,0.3)', padding: '4px 10px', borderRadius: 20 }}>
                    {client.plan || 'No Plan'}
                  </div>
                </div>
              </div>
            )) : (
              <div style={{ padding: 20, textAlign: 'center', color: C.muted, fontSize: 14 }}>No clients found.</div>
            )}
          </div>
          
          {totalPages > 1 && (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 16 }}>
              <button 
                onClick={() => setCurrentPage(p => Math.max(1, p - 1))} 
                disabled={currentPage === 1}
                style={{ background: 'transparent', border: `1px solid ${C.border}`, color: C.text, padding: '6px 12px', borderRadius: 6, cursor: currentPage === 1 ? 'not-allowed' : 'pointer', fontSize: 12, opacity: currentPage === 1 ? 0.5 : 1 }}
              >
                Previous
              </button>
              <div style={{ fontSize: 12, color: C.muted }}>Page {currentPage} of {totalPages}</div>
              <button 
                onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))} 
                disabled={currentPage === totalPages}
                style={{ background: 'transparent', border: `1px solid ${C.border}`, color: C.text, padding: '6px 12px', borderRadius: 6, cursor: currentPage === totalPages ? 'not-allowed' : 'pointer', fontSize: 12, opacity: currentPage === totalPages ? 0.5 : 1 }}
              >
                Next
              </button>
            </div>
          )}
        </div>

        {/* Step 2: Plan Details (Only if client selected) */}
        {selectedClient && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
            
            {/* Current Plan Details */}
            <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: 24, display: 'flex', flexDirection: 'column' }}>
              <h3 style={{ fontSize: 16, fontWeight: 700, color: '#fff', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
                <Building size={18} color={C.muted} /> Current Plan
              </h3>
              
              {currentPlanObj ? (
                <div style={{ flex: 1 }}>
                  <div style={{ background: 'rgba(255,255,255,0.03)', borderRadius: 8, padding: 16, marginBottom: 16 }}>
                    <div style={{ fontSize: 13, color: C.muted, marginBottom: 4 }}>ACTIVE PLAN</div>
                    <div style={{ fontSize: 20, fontWeight: 800, color: '#fff' }}>{currentPlanObj.name}</div>
                    <div style={{ fontSize: 14, color: C.accent, fontWeight: 600, marginTop: 4 }}>
                      {currentPlanObj.price > 0 ? `${currentPlanObj.currency} ${currentPlanObj.price}` : 'Free'}
                      <span style={{ color: C.muted, fontWeight: 400 }}> / {selectedClient.subscription_duration}</span>
                    </div>
                  </div>

                  <div style={{ fontSize: 13, fontWeight: 600, color: '#fff', marginBottom: 8 }}>Included Features:</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {currentPlanObj.features?.map((f, i) => (
                      <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: C.muted }}>
                        <CheckCircle2 size={14} color={C.accent} /> {f.feature_name}
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: C.muted }}>
                  <AlertTriangle size={32} style={{ marginBottom: 12, opacity: 0.5 }} />
                  <div style={{ fontSize: 14 }}>No active plan</div>
                </div>
              )}
            </div>

            {/* Assign New Plan */}
            <div style={{ background: C.surface, border: `1px solid ${C.accent}55`, borderRadius: 12, padding: 24, display: 'flex', flexDirection: 'column' }}>
              <h3 style={{ fontSize: 16, fontWeight: 700, color: '#fff', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
                <Tag size={18} color={C.accent} /> Assign New Plan
              </h3>
              
              <div style={{ marginBottom: 20 }}>
                <label style={{ display: 'block', fontSize: 13, color: C.muted, marginBottom: 8, fontWeight: 600 }}>Select a Plan to Upgrade/Downgrade</label>
                <select 
                  value={selectedNewPlan} 
                  onChange={(e) => setSelectedNewPlan(e.target.value)}
                  style={{ background: 'rgba(0,0,0,0.2)', border: `1px solid ${C.border}`, color: '#fff', padding: '12px 16px', borderRadius: 8, width: '100%', outline: 'none', fontSize: 15 }}
                >
                  <option value="" disabled style={{ background: '#1e293b', color: '#fff' }}>Select a Subscription Plan...</option>
                  {plans.map(p => (
                    <option key={p.id} value={p.name} style={{ background: '#1e293b', color: '#fff' }}>{p.name} - {p.price > 0 ? `${p.currency} ${p.price}` : 'Free'}</option>
                  ))}
                </select>
              </div>

              {newPlanObj && (
                <div style={{ 
                  background: `${C.accent}11`, 
                  border: `1px solid ${C.accent}44`, 
                  borderRadius: 8, padding: 16,
                  marginBottom: 20, flex: 1
                }}>
                  <div style={{ fontSize: 16, fontWeight: 800, color: '#fff' }}>{newPlanObj.name} Plan</div>
                  <div style={{ fontSize: 18, fontWeight: 800, color: C.accent, marginTop: 4 }}>
                    {newPlanObj.price > 0 ? `${newPlanObj.currency} ${newPlanObj.price}` : 'Free'} 
                    <span style={{ fontSize: 13, color: C.muted, fontWeight: 500 }}> / {String(newPlanObj.billing_cycle) === '-1' ? 'Lifetime' : `${newPlanObj.billing_cycle} Days`}</span>
                  </div>
                  
                  <div style={{ fontSize: 12, color: '#e2e8f0', marginTop: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {newPlanObj.features?.slice(0, 5).map((f, i) => (
                      <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <CheckCircle2 size={12} color={C.accent} /> {f.feature_name}
                      </div>
                    ))}
                    {newPlanObj.features?.length > 5 && (
                      <div style={{ color: C.muted, fontSize: 11, fontStyle: 'italic' }}>+ {newPlanObj.features.length - 5} more features</div>
                    )}
                  </div>
                </div>
              )}

              <button 
                onClick={handleSave} 
                disabled={isSaving || !selectedNewPlan}
                style={{ 
                  background: C.accent, border: 'none', padding: '12px 20px', borderRadius: 8, color: '#fff', fontSize: 14, fontWeight: 600, 
                  cursor: (isSaving || !selectedNewPlan) ? 'not-allowed' : 'pointer', 
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, 
                  opacity: (isSaving || !selectedNewPlan) ? 0.5 : 1, width: '100%',
                  marginTop: 'auto'
                }}
              >
                {isSaving ? <Loader2 size={16} className="spin" /> : <CheckCircle2 size={16} />} 
                {isSaving ? 'Processing...' : 'Confirm Subscription'}
              </button>
            </div>
            
          </div>
        )}
      </div>

      {showConfirmModal && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div style={{ background: C.surface, width: 480, borderRadius: 16, border: `1px solid ${C.border}`, overflow: 'hidden', boxShadow: '0 25px 50px rgba(0,0,0,0.5)' }}>
            <div style={{ padding: '20px 24px', borderBottom: `1px solid ${C.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: '#fff', display: 'flex', alignItems: 'center', gap: 8 }}>
                <AlertTriangle size={18} color="#f59e0b" /> Subscription Proration Details
              </h3>
              <button onClick={() => setShowConfirmModal(false)} style={{ background: 'transparent', border: 'none', color: C.muted, cursor: 'pointer', fontSize: 20 }}>&times;</button>
            </div>
            
            {(() => {
              const details = calculateProration();
              if (!details) return null;
              
              return (
                <div style={{ padding: 24 }}>
                  <p style={{ color: '#cbd5e1', fontSize: 14, lineHeight: 1.6, margin: '0 0 20px 0' }}>
                    You are changing the subscription for <strong style={{ color: '#fff' }}>{selectedClient.business_name || selectedClient.client_name}</strong> from <strong style={{ color: C.accent }}>{selectedClient.plan}</strong> to <strong style={{ color: C.accent }}>{selectedNewPlan}</strong>.
                  </p>
                  
                  <div style={{ background: 'rgba(0,0,0,0.2)', borderRadius: 10, padding: 16, border: `1px solid ${C.border}`, display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 20 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                      <span style={{ color: C.muted }}>Current Cycle Remaining</span>
                      <span style={{ color: '#fff', fontWeight: 600 }}>{details.daysRemaining} Days</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                      <span style={{ color: C.muted }}>Unused Credit Value</span>
                      <span style={{ color: '#22c55e', fontWeight: 600 }}>{details.currency} {details.unusedCredit}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, borderBottom: `1px dashed ${C.border}`, paddingBottom: 10 }}>
                      <span style={{ color: C.muted }}>New Plan Standard Cost</span>
                      <span style={{ color: '#fff', fontWeight: 600 }}>{details.currency} {newPlanObj?.price}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, fontWeight: 700, paddingTop: 4 }}>
                      <span style={{ color: '#fff' }}>Adjusted Net Due Today</span>
                      <span style={{ color: C.accent }}>{details.currency} {details.netDue}</span>
                    </div>
                  </div>

                  <div style={{ background: 'rgba(59, 130, 246, 0.1)', border: '1px solid rgba(59, 130, 246, 0.2)', borderRadius: 8, padding: 14, fontSize: 13, lineHeight: 1.5, color: '#cbd5e1' }}>
                    <strong style={{ color: '#60a5fa', display: 'block', marginBottom: 4 }}>Duration Adjustment:</strong>
                    Unused credit worth <strong>{details.currency} {details.unusedCredit}</strong> has been rolled over. The client's new billing cycle will be extended by <strong>{details.extraDays} days</strong>, for a total of <strong>{details.adjustedDays} days</strong> of active service.
                  </div>
                </div>
              );
            })()}
            
            <div style={{ padding: '16px 24px', borderTop: `1px solid ${C.border}`, display: 'flex', justifyContent: 'flex-end', gap: 12, background: 'rgba(0,0,0,0.1)' }}>
              <button onClick={() => setShowConfirmModal(false)} style={{ background: 'transparent', border: `1px solid ${C.border}`, color: '#fff', padding: '8px 16px', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
                Cancel
              </button>
              <button 
                onClick={executeSave} 
                disabled={isSaving}
                style={{ background: C.accent, color: '#fff', border: 'none', padding: '8px 20px', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: isSaving ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}
              >
                {isSaving ? <Loader2 size={14} className="spin" /> : <CheckCircle2 size={14} />}
                Confirm & Update
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
