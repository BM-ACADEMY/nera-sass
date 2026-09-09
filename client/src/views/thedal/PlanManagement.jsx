import React, { useState, useEffect } from 'react';
import SopModal from '../../components/common/SopModal.jsx';
import { C } from '../../constants/theme.js';
import { Loader2, Plus, Edit2, Trash2, CheckCircle2, X } from 'lucide-react';
import { api } from '../../services/api.js';
import toast from 'react-hot-toast';

export default function PlanManagement() {
  const [plans, setPlans] = useState([]);
  const [availableFeatures, setAvailableFeatures] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingPlan, setEditingPlan] = useState(null);

  // Master Features Modal State
  const [masterModalOpen, setMasterModalOpen] = useState(false);
  const [newFeatureData, setNewFeatureData] = useState({ id: null, key: '', name: '', type: 'boolean' });
  const [confirmDialog, setConfirmDialog] = useState({ isOpen: false, message: '', isLoading: false, onConfirm: null });
  const [savingFeature, setSavingFeature] = useState(false);
  const [savingPlan, setSavingPlan] = useState(false);
  
  const [formData, setFormData] = useState({
    name: '',
    price: 0,
    currency: 'INR',
    billing_cycle: 'Monthly',
    features: [{ feature_key: '', feature_name: '', limit_value: -1, text_value: '' }]
  });

  const fetchData = async () => {
    setLoading(true);
    try {
      const [plansRes, featuresRes] = await Promise.all([
        api.get('/thedal/plans'),
        api.get('/thedal/plans/features/list')
      ]);
      if (plansRes) setPlans(plansRes.data || plansRes);
      if (featuresRes) setAvailableFeatures(featuresRes.data || featuresRes);
    } catch (err) {
      console.error('Failed to load data', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleInputChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const handleFeatureChange = (index, field, value) => {
    const newFeatures = [...formData.features];
    newFeatures[index][field] = value;
    
    // Auto-fill feature_name when key is selected
    if (field === 'feature_key') {
      if (value === 'custom_dynamic') {
        newFeatures[index].feature_name = '';
        newFeatures[index].limit_value = -1;
      } else {
        const selectedDef = availableFeatures.find(f => f.key === value);
        if (selectedDef) {
          newFeatures[index].feature_name = selectedDef.name;
          // Reset limit/text if switching types
          if (selectedDef.type === 'boolean') {
            newFeatures[index].limit_value = -1; // -1 means boolean true (access granted)
            newFeatures[index].text_value = '';
          } else if (selectedDef.type === 'text') {
            newFeatures[index].limit_value = -1;
            newFeatures[index].text_value = '';
          } else if (newFeatures[index].limit_value === -1) {
            newFeatures[index].limit_value = 0; // default for numeric
            newFeatures[index].text_value = '';
          }
        }
      }
    }
    
    setFormData({ ...formData, features: newFeatures });
  };

  const addFeature = () => {
    setFormData({ ...formData, features: [...formData.features, { feature_key: '', feature_name: '', limit_value: -1, text_value: '' }] });
  };

  const removeFeature = (index) => {
    const newFeatures = formData.features.filter((_, i) => i !== index);
    setFormData({ ...formData, features: newFeatures });
  };

  const openModal = (plan = null) => {
    if (plan) {
      setEditingPlan(plan);
      setFormData({
        name: plan.name || '',
        price: plan.price || 0,
        currency: plan.currency || 'INR',
        billing_cycle: plan.billing_cycle || 'Monthly',
        features: plan.features?.length > 0 ? plan.features.map(f => ({
          feature_key: f.feature_key || '',
          feature_name: f.feature_name || '',
          limit_value: f.limit_value !== undefined ? f.limit_value : -1,
          text_value: f.text_value || ''
        })) : [{ feature_key: '', feature_name: '', limit_value: -1, text_value: '' }]
      });
    } else {
      setEditingPlan(null);
      setFormData({
        name: '',
        price: 0,
        currency: 'INR',
        billing_cycle: '30',
        features: [{ feature_key: '', feature_name: '', limit_value: -1, text_value: '' }]
      });
    }
    setModalOpen(true);
  };

  const closeModal = () => {
    setModalOpen(false);
  };

  const handleSave = async () => {
    setSavingPlan(true);
    try {
      // Filter out empty features
      const payload = {
        ...formData,
        features: formData.features.filter(f => f.feature_key.trim() !== '')
      };

      if (editingPlan) {
        await api.put(`/thedal/plans/${editingPlan.id}`, payload);
      } else {
        await api.post('/thedal/plans', payload);
      }
      closeModal();
      await fetchData();
      toast.success(editingPlan ? 'Plan updated successfully' : 'Plan created successfully');
    } catch (err) {
      console.error('Error saving plan', err);
      toast.error('Failed to save plan.');
    } finally {
      setSavingPlan(false);
    }
  };

  const handleDelete = (id) => {
    const targetPlan = plans.find(p => p.id === id);
    setConfirmDialog({
      isOpen: true,
      isLoading: false,
      message: `Are you sure you want to delete the plan "${targetPlan?.name || ''}"?`,
      onConfirm: async () => {
        setConfirmDialog(prev => ({ ...prev, isLoading: true }));
        try {
          // Check active client subscription counts before allowing deletion
          const clientsRes = await api.get('/thedal/clients');
          const clientsList = Array.isArray(clientsRes) ? clientsRes : (clientsRes?.clients || []);
          const activeCount = clientsList.filter(c => c.plan === targetPlan?.name).length;
          
          if (activeCount > 0) {
            setConfirmDialog({ isOpen: false, message: '', isLoading: false, onConfirm: null });
            toast.error(`Cannot delete plan: ${activeCount} active client(s) are currently subscribed to it.`);
            return;
          }

          await api.delete(`/thedal/plans/${id}`);
          await fetchData();
          toast.success('Plan deleted successfully');
        } catch (err) {
          console.error('Error deleting plan', err);
          toast.error('Failed to delete plan.');
        }
        setConfirmDialog({ isOpen: false, message: '', isLoading: false, onConfirm: null });
      }
    });
  };

  const handleAddMasterFeature = async () => {
    if (!newFeatureData.key || !newFeatureData.name) return toast.error('Key and Name are required');
    
    // Validate uniqueness constraints on newly defined feature keys
    const keyExists = availableFeatures.some(f => 
      f.key.toLowerCase().trim() === newFeatureData.key.toLowerCase().trim() && 
      f.id !== newFeatureData.id
    );
    if (keyExists) {
      return toast.error('Failed to save feature. Key must be unique.');
    }

    setSavingFeature(true);
    try {
      if (newFeatureData.id) {
        // Edit existing
        await api.put(`/thedal/plans/features/list/${newFeatureData.id}`, newFeatureData);
      } else {
        // Add new
        await api.post('/thedal/plans/features/list', newFeatureData);
      }
      setNewFeatureData({ id: null, key: '', name: '', type: 'boolean' });
      await fetchData(); // refresh master features
      toast.success(newFeatureData.id ? 'Feature updated successfully' : 'Feature added successfully');
    } catch (err) {
      console.error(err);
      toast.error('Failed to save feature. Key must be unique.');
    } finally {
      setSavingFeature(false);
    }
  };

  const handleEditMasterFeature = (feat) => {
    setNewFeatureData({
      id: feat.id,
      key: feat.key,
      name: feat.name,
      type: feat.type || 'boolean'
    });
  };

  const handleDeleteMasterFeature = (id) => {
    setConfirmDialog({
      isOpen: true,
      isLoading: false,
      message: 'Delete this master feature? This will not affect existing plans, but they will lose the feature definition mapping.',
      onConfirm: async () => {
        setConfirmDialog(prev => ({ ...prev, isLoading: true }));
        try {
          await api.delete(`/thedal/plans/features/list/${id}`);
          await fetchData();
          toast.success('Feature deleted');
        } catch (err) {
          console.error(err);
          toast.error('Failed to delete feature');
        }
        setConfirmDialog({ isOpen: false, message: '', isLoading: false, onConfirm: null });
      }
    });
  };

  const renderLimit = (feat) => {
    if (feat.text_value) return feat.text_value;
    if (feat.limit_value === -1) return 'Included';
    if (feat.limit_value === 0) return 'None';
    return feat.limit_value;
  };

  if (loading && plans.length === 0) {
    return (
      <div style={{ display: 'flex', height: '100%', alignItems: 'center', justifyContent: 'center', background: C.background }}>
        <Loader2 size={32} color={C.accent} className="spin" />
      </div>
    );
  }

  return (
    <div style={{ padding: 30, color: C.text, height: '100%', overflowY: 'auto', background: C.background }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}><h1 style={{ fontSize: 28, fontWeight: 800, color: '#e2e8f0', margin: 0, fontFamily: "'Syne', sans-serif" }}>Plans & Pricing</h1><SopModal /></div>
          <p style={{ color: C.muted, fontSize: 14, marginTop: 4 }}>Manage dynamic subscription plans and their feature limits.</p>
        </div>
        <div style={{ display: 'flex', gap: 12 }}>
          <button 
            onClick={() => setMasterModalOpen(true)}
            style={{ background: 'rgba(255,255,255,0.05)', border: `1px solid ${C.border}`, padding: '10px 20px', borderRadius: 8, color: '#e2e8f0', fontSize: 13, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}
          >
            ⚙️ Manage Master Features
          </button>
          <button 
            onClick={() => openModal()}
            style={{ background: C.accent, border: 'none', padding: '10px 20px', borderRadius: 8, color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}
          >
            <Plus size={16} /> Create New Plan
          </button>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 20 }}>
        {plans.map((plan) => (
          <div key={plan.id} style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: 24, display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
              <div>
                <h2 style={{ fontSize: 20, fontWeight: 800, color: '#e2e8f0', margin: 0 }}>{plan.name}</h2>
                <div style={{ color: C.muted, fontSize: 13, marginTop: 4 }}>{String(plan.billing_cycle) === '-1' ? 'Lifetime Plan' : `${plan.billing_cycle} Days`}</div>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={() => openModal(plan)} style={{ background: 'transparent', border: 'none', color: C.text, cursor: 'pointer' }}><Edit2 size={16} /></button>
                <button onClick={() => handleDelete(plan.id)} style={{ background: 'transparent', border: 'none', color: '#ef4444', cursor: 'pointer' }}><Trash2 size={16} /></button>
              </div>
            </div>
            
            <div style={{ fontSize: 32, fontWeight: 800, color: C.accent, marginBottom: 24 }}>
              {plan.price > 0 ? `${plan.currency} ${plan.price}` : 'Free'}
            </div>

            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 12 }}>
              {plan.features?.map(feat => (
                <div key={feat.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 13, color: '#e2e8f0' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <CheckCircle2 size={16} color={C.accent} style={{ flexShrink: 0 }} />
                    <span>{feat.feature_name}</span>
                  </div>
                  <span style={{ fontWeight: 700, color: feat.limit_value === -1 ? C.accent : '#fff', background: 'rgba(255,255,255,0.05)', padding: '2px 8px', borderRadius: 4 }}>
                    {renderLimit(feat)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Plan Modal */}
      {modalOpen && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}>
          <div style={{ background: C.surface, width: 700, borderRadius: 16, border: `1px solid ${C.border}`, overflow: 'hidden', display: 'flex', flexDirection: 'column', maxHeight: '90vh' }}>
            <div style={{ padding: '20px 24px', borderBottom: `1px solid ${C.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: '#fff' }}>{editingPlan ? 'Edit Plan' : 'Create New Plan'}</h2>
              <button onClick={closeModal} style={{ background: 'transparent', border: 'none', color: C.muted, cursor: 'pointer', fontSize: 24 }}>&times;</button>
            </div>

            <div style={{ padding: '24px', flex: 1, overflowY: 'auto' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16, marginBottom: 24 }}>
                <div>
                  <label style={{ display: 'block', fontSize: 12, color: C.muted, marginBottom: 6, fontWeight: 600 }}>PLAN NAME</label>
                  <input name="name" value={formData.name} onChange={handleInputChange} placeholder="e.g. Enterprise" style={{ background: 'rgba(0,0,0,0.2)', border: `1px solid ${C.border}`, color: '#fff', padding: '10px 12px', borderRadius: 8, width: '100%', outline: 'none', fontSize: 14 }} />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: 12, color: C.muted, marginBottom: 6, fontWeight: 600 }}>PRICE ({formData.currency})</label>
                  <input type="number" name="price" value={formData.price} onChange={handleInputChange} style={{ background: 'rgba(0,0,0,0.2)', border: `1px solid ${C.border}`, color: '#fff', padding: '10px 12px', borderRadius: 8, width: '100%', outline: 'none', fontSize: 14 }} />
                </div>
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                    <label style={{ display: 'block', fontSize: 12, color: C.muted, fontWeight: 600, margin: 0 }}>DURATION (DAYS)</label>
                    <span style={{ fontSize: 10, color: C.muted }}>-1 for Lifetime</span>
                  </div>
                  <input type="number" name="billing_cycle" value={formData.billing_cycle} onChange={handleInputChange} placeholder="e.g. 30" style={{ background: 'rgba(0,0,0,0.2)', border: `1px solid ${C.border}`, color: '#fff', padding: '10px 12px', borderRadius: 8, width: '100%', outline: 'none', fontSize: 14 }} />
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <h3 style={{ fontSize: 15, fontWeight: 600, color: C.accent, margin: 0 }}>Plan Rules & Limits</h3>
                <span style={{ fontSize: 12, color: C.muted }}>Set Limit to -1 for Unlimited</span>
              </div>
              
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {formData.features.map((feat, index) => {
                  const isCustom = feat.feature_key === 'custom_dynamic';
                  const selectedDef = isCustom ? null : availableFeatures.find(f => f.key === feat.feature_key);
                  const isNumeric = isCustom ? false : selectedDef?.type === 'numeric';
                  const isText = isCustom ? false : selectedDef?.type === 'text';

                  return (
                    <div key={index} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <select 
                        value={isCustom ? 'custom_dynamic' : feat.feature_key} 
                        onChange={(e) => handleFeatureChange(index, 'feature_key', e.target.value)}
                        style={{ background: 'rgba(0,0,0,0.2)', border: `1px solid ${C.border}`, color: '#fff', padding: '10px 12px', borderRadius: 8, width: 200, outline: 'none', fontSize: 14 }}
                      >
                        <option value="" disabled style={{ background: '#0f172a', color: '#94a3b8' }}>Select a Feature...</option>
                        {availableFeatures.map(af => {
                          const isAlreadySelected = formData.features.some((f, i) => i !== index && f.feature_key === af.key);
                          return (
                            <option 
                              key={af.key} 
                              value={af.key} 
                              disabled={isAlreadySelected}
                              style={{ background: '#0f172a', color: isAlreadySelected ? '#475569' : '#fff', padding: '8px' }}
                            >
                              {af.name} {isAlreadySelected ? '(Added)' : ''}
                            </option>
                          );
                        })}
                        <option value="custom_dynamic" style={{ background: '#0f172a', color: '#f59e0b', fontWeight: 'bold' }}>✨ Custom Feature</option>
                      </select>

                      {isCustom && (
                        <input 
                          value={feat.feature_name}
                          onChange={(e) => handleFeatureChange(index, 'feature_name', e.target.value)}
                          placeholder="Type custom feature..."
                          style={{ background: 'rgba(0,0,0,0.2)', border: `1px solid ${C.border}`, color: '#fff', padding: '10px 12px', borderRadius: 8, flex: 1, outline: 'none', fontSize: 14 }}
                        />
                      )}

                      {!isCustom && isNumeric && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <input 
                            type="number" 
                            value={feat.limit_value} 
                            onChange={(e) => handleFeatureChange(index, 'limit_value', parseInt(e.target.value))} 
                            placeholder="Limit" 
                            style={{ background: 'rgba(0,0,0,0.2)', border: `1px solid ${C.border}`, color: '#fff', padding: '10px 12px', borderRadius: 8, width: 100, outline: 'none', fontSize: 14 }} 
                          />
                        </div>
                      )}

                      {!isCustom && isText && (
                        <input 
                          value={feat.text_value}
                          onChange={(e) => handleFeatureChange(index, 'text_value', e.target.value)}
                          placeholder="e.g. Basic Profile"
                          style={{ background: 'rgba(0,0,0,0.2)', border: `1px solid ${C.border}`, color: '#fff', padding: '10px 12px', borderRadius: 8, flex: 1, outline: 'none', fontSize: 14 }}
                        />
                      )}
                      
                      {!isCustom && !isNumeric && !isText && selectedDef && (
                        <div style={{ padding: '10px 12px', background: `${C.accent}22`, border: `1px solid ${C.accent}55`, color: C.accent, borderRadius: 8, fontSize: 13, fontWeight: 600, width: 100, textAlign: 'center' }}>
                          Toggle
                        </div>
                      )}

                      <button onClick={() => removeFeature(index)} style={{ background: 'transparent', border: 'none', color: '#ef4444', cursor: 'pointer', padding: 8 }}>
                        <X size={16} />
                      </button>
                    </div>
                  );
                })}
                <button onClick={addFeature} style={{ background: 'transparent', border: `1px dashed ${C.border}`, color: C.text, padding: '10px', borderRadius: 8, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 8 }}>
                  <Plus size={14} /> Add Rule
                </button>
              </div>
            </div>

            <div style={{ padding: '16px 24px', borderTop: `1px solid ${C.border}`, display: 'flex', justifyContent: 'flex-end', gap: 12, background: 'rgba(0,0,0,0.2)' }}>
              <button disabled={savingPlan} onClick={closeModal} style={{ background: 'transparent', border: `1px solid ${C.border}`, padding: '10px 20px', borderRadius: 8, color: C.text, fontSize: 13, fontWeight: 600, cursor: savingPlan ? 'not-allowed' : 'pointer' }}>Cancel</button>
              <button 
                onClick={handleSave} 
                disabled={!formData.name || savingPlan}
                style={{ background: C.accent, border: 'none', padding: '10px 20px', borderRadius: 8, color: '#fff', fontSize: 13, fontWeight: 600, cursor: (!formData.name || savingPlan) ? 'not-allowed' : 'pointer', opacity: !formData.name ? 0.5 : 1, display: 'flex', alignItems: 'center', gap: 8 }}
              >
                {savingPlan && <Loader2 size={16} className="spin" />}
                {savingPlan ? 'Saving...' : 'Save Plan'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Master Features Modal */}
      {masterModalOpen && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}>
          <div style={{ background: C.surface, width: 900, borderRadius: 16, border: `1px solid ${C.border}`, overflow: 'hidden', display: 'flex', flexDirection: 'column', maxHeight: '90vh' }}>
            <div style={{ padding: '20px 24px', borderBottom: `1px solid ${C.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: '#fff' }}>Master Feature Definitions</h2>
              <button onClick={() => {
                setMasterModalOpen(false);
                setNewFeatureData({ id: null, key: '', name: '', type: 'boolean' });
              }} style={{ background: 'transparent', border: 'none', color: C.muted, cursor: 'pointer', fontSize: 24 }}>&times;</button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', height: '100%', minHeight: 500 }}>
              
              {/* Left Column: List */}
              <div style={{ padding: '24px', borderRight: `1px solid ${C.border}`, overflowY: 'auto' }}>
                <p style={{ color: C.muted, fontSize: 13, marginBottom: 20 }}>All globally available features.</p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {availableFeatures.map(feat => (
                    <div key={feat.id || feat.key} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: 12, border: `1px solid ${newFeatureData.id === feat.id ? C.accent : C.border}`, background: newFeatureData.id === feat.id ? 'rgba(255,255,255,0.05)' : 'transparent', borderRadius: 8 }}>
                      <div>
                        <div style={{ fontWeight: 600, fontSize: 14, color: '#fff' }}>{feat.name}</div>
                        <div style={{ fontSize: 12, color: C.muted, marginTop: 4 }}>Key: <span style={{ color: C.accent }}>{feat.key}</span> • Type: {feat.type}</div>
                      </div>
                      <div style={{ display: 'flex', gap: 4 }}>
                        <button onClick={() => handleEditMasterFeature(feat)} style={{ background: 'transparent', border: 'none', color: C.text, cursor: 'pointer', padding: 8 }}>
                          <Edit2 size={14} />
                        </button>
                        {feat.id && (
                          <button onClick={() => handleDeleteMasterFeature(feat.id)} style={{ background: 'transparent', border: 'none', color: '#ef4444', cursor: 'pointer', padding: 8 }}>
                            <Trash2 size={14} />
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Right Column: Add/Edit Form */}
              <div style={{ padding: '24px', background: 'rgba(0,0,0,0.2)', overflowY: 'auto' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
                  <h3 style={{ fontSize: 15, fontWeight: 700, color: '#fff', margin: 0 }}>
                    {newFeatureData.id ? 'Edit Feature' : 'Add New Dynamic Feature'}
                  </h3>
                  {newFeatureData.id && (
                    <button onClick={() => setNewFeatureData({ id: null, key: '', name: '', type: 'boolean' })} style={{ background: 'transparent', border: `1px solid ${C.border}`, color: C.text, padding: '4px 8px', borderRadius: 6, fontSize: 11, cursor: 'pointer' }}>Cancel Edit</button>
                  )}
                </div>
                
                <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
                  <div>
                    <label style={{ display: 'block', fontSize: 12, color: C.muted, marginBottom: 6, fontWeight: 600 }}>FEATURE KEY (INTERNAL ID)</label>
                    <input 
                      placeholder="e.g. daily_reports"
                      value={newFeatureData.key}
                      onChange={e => setNewFeatureData({ ...newFeatureData, key: e.target.value })}
                      style={{ background: 'rgba(0,0,0,0.2)', border: `1px solid ${C.border}`, color: '#fff', padding: '10px 12px', borderRadius: 8, width: '100%', outline: 'none', fontSize: 14 }}
                    />
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: 12, color: C.muted, marginBottom: 6, fontWeight: 600 }}>DISPLAY NAME (CLIENT SEES)</label>
                    <input 
                      placeholder="e.g. Daily SEO Reports"
                      value={newFeatureData.name}
                      onChange={e => setNewFeatureData({ ...newFeatureData, name: e.target.value })}
                      style={{ background: 'rgba(0,0,0,0.2)', border: `1px solid ${C.border}`, color: '#fff', padding: '10px 12px', borderRadius: 8, width: '100%', outline: 'none', fontSize: 14 }}
                    />
                  </div>

                  <div>
                    <label style={{ display: 'block', fontSize: 12, color: C.muted, marginBottom: 6, fontWeight: 600 }}>FEATURE TYPE (HOW LIMITS ARE TRACKED)</label>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 12 }}>
                      <div 
                        onClick={() => setNewFeatureData({ ...newFeatureData, type: 'boolean' })}
                        style={{ padding: 12, borderRadius: 8, border: `1px solid ${newFeatureData.type === 'boolean' ? C.accent : C.border}`, background: newFeatureData.type === 'boolean' ? `${C.accent}15` : 'transparent', cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 4 }}
                      >
                        <div style={{ fontWeight: 600, fontSize: 14, color: newFeatureData.type === 'boolean' ? C.accent : '#fff' }}>🟢 Toggle (Yes / No)</div>
                        <div style={{ fontSize: 12, color: C.muted }}>Simple access permissions</div>
                      </div>
                      <div 
                        onClick={() => setNewFeatureData({ ...newFeatureData, type: 'numeric' })}
                        style={{ padding: 12, borderRadius: 8, border: `1px solid ${newFeatureData.type === 'numeric' ? '#3b82f6' : C.border}`, background: newFeatureData.type === 'numeric' ? `rgba(59,130,246,0.15)` : 'transparent', cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 4 }}
                      >
                        <div style={{ fontWeight: 600, fontSize: 14, color: newFeatureData.type === 'numeric' ? '#3b82f6' : '#fff' }}>🔢 Number Limit</div>
                        <div style={{ fontSize: 12, color: C.muted }}>Usage limits (e.g. 25 Keywords)</div>
                      </div>
                      <div 
                        onClick={() => setNewFeatureData({ ...newFeatureData, type: 'text' })}
                        style={{ padding: 12, borderRadius: 8, border: `1px solid ${newFeatureData.type === 'text' ? '#f59e0b' : C.border}`, background: newFeatureData.type === 'text' ? `rgba(245,158,11,0.15)` : 'transparent', cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 4 }}
                      >
                        <div style={{ fontWeight: 600, fontSize: 14, color: newFeatureData.type === 'text' ? '#f59e0b' : '#fff' }}>📝 Text Value</div>
                        <div style={{ fontSize: 12, color: C.muted }}>Specific text level (e.g. "Full Profile")</div>
                      </div>
                    </div>
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
                    <button 
                      disabled={savingFeature}
                      onClick={handleAddMasterFeature}
                      style={{ background: C.accent, border: 'none', padding: '12px 24px', borderRadius: 8, color: '#fff', fontSize: 14, fontWeight: 700, cursor: savingFeature ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}
                    >
                      {savingFeature && <Loader2 size={16} className="spin" />}
                      {newFeatureData.id ? (savingFeature ? 'Updating...' : 'Update Feature') : (savingFeature ? 'Adding...' : 'Add Feature')}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Custom Confirm Modal */}
      {confirmDialog.isOpen && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999 }}>
          <div style={{ background: C.surface, width: 400, borderRadius: 12, border: `1px solid ${C.border}`, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
            <div style={{ padding: '20px 24px' }}>
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: '#fff', marginBottom: 12 }}>Confirm Action</h3>
              <p style={{ color: C.muted, fontSize: 14, margin: 0, lineHeight: 1.5 }}>{confirmDialog.message}</p>
            </div>
            <div style={{ padding: '16px 24px', borderTop: `1px solid ${C.border}`, display: 'flex', justifyContent: 'flex-end', gap: 12, background: 'rgba(0,0,0,0.2)' }}>
              <button disabled={confirmDialog.isLoading} onClick={() => setConfirmDialog({ isOpen: false, message: '', isLoading: false, onConfirm: null })} style={{ background: 'transparent', border: `1px solid ${C.border}`, padding: '8px 16px', borderRadius: 8, color: C.text, fontSize: 13, fontWeight: 600, cursor: confirmDialog.isLoading ? 'not-allowed' : 'pointer' }}>Cancel</button>
              <button disabled={confirmDialog.isLoading} onClick={confirmDialog.onConfirm} style={{ background: '#ef4444', border: 'none', padding: '8px 16px', borderRadius: 8, color: '#fff', fontSize: 13, fontWeight: 600, cursor: confirmDialog.isLoading ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>
                {confirmDialog.isLoading && <Loader2 size={14} className="spin" />}
                {confirmDialog.isLoading ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
