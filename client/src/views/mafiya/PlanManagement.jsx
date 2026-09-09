import React, { useState, useEffect } from 'react';
import { C } from '../../constants/theme.js';
import { Loader2, Plus, Edit2, Trash2, CheckCircle2, X, Award, Shield, Layers, HelpCircle } from 'lucide-react';
import axios from 'axios';
import toast from 'react-hot-toast';

const API_URL = import.meta.env.VITE_API_URL || '';

const MAFIYA_FEATURE_DEFS = [
  { key: 'mafiya_profiles', name: 'GMB Profiles Limit', type: 'numeric', defaultVal: 5 },
  { key: 'mafiya_keywords', name: 'Turf Keywords Limit', type: 'numeric', defaultVal: 50 },
  { key: 'mafiya_ai_replies', name: 'AI Review Replies Limit', type: 'numeric', defaultVal: 150 },
  { key: 'mafiya_ai_suggestions', name: 'AI Post Suggestions Limit', type: 'numeric', defaultVal: 50 },
  { key: 'mafiya_brain_ai', name: 'GMB Brain AI Limit', type: 'numeric', defaultVal: 50 },
  { key: 'mafiya_geogrid_scans', name: 'Rivals Map Scans Limit', type: 'numeric', defaultVal: 15 },
  { key: 'mafiya_citations_scans', name: 'Citations Audits Limit', type: 'numeric', defaultVal: 10 }
];

export default function PlanManagement() {
  const [plans, setPlans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingPlan, setEditingPlan] = useState(null);
  const [savingPlan, setSavingPlan] = useState(false);

  const [formData, setFormData] = useState({
    name: '',
    price: 0,
    currency: 'INR',
    billing_cycle: 'Monthly',
    features: MAFIYA_FEATURE_DEFS.map(f => ({
      feature_key: f.key,
      feature_name: f.name,
      limit_value: f.defaultVal
    }))
  });

  const fetchPlans = async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem('leados_token');
      const res = await axios.get(`${API_URL}/api/mafiya/plans`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setPlans(res.data || []);
    } catch (err) {
      console.error('[Mafiya Plans] Fetch error:', err);
      toast.error('Failed to load plans');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPlans();
  }, []);

  const handleInputChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const handleFeatureLimitChange = (key, value) => {
    const updatedFeatures = formData.features.map(f => {
      if (f.feature_key === key) {
        const numVal = value === '' ? '' : (!isNaN(parseInt(value)) ? parseInt(value) : 0);
        let autoDaily = -1;
        if (numVal !== '' && numVal > 0) autoDaily = Math.ceil(numVal / 30);
        else if (numVal === 0) autoDaily = 0;
        return { ...f, limit_value: numVal, daily_limit: autoDaily };
      }
      return f;
    });
    setFormData({ ...formData, features: updatedFeatures });
  };

  const handleFeatureDailyLimitChange = (key, value) => {
    const updatedFeatures = formData.features.map(f => {
      if (f.feature_key === key) {
        return { ...f, daily_limit: value === '' ? '' : (!isNaN(parseInt(value)) ? parseInt(value) : 0) };
      }
      return f;
    });
    setFormData({ ...formData, features: updatedFeatures });
  };

  const openModal = (plan = null) => {
    if (plan) {
      setEditingPlan(plan);
      // Map current plan features or merge with defaults if missing
      const mappedFeatures = MAFIYA_FEATURE_DEFS.map(def => {
        const existing = plan.features?.find(f => f.feature_key === def.key);
        return {
          feature_key: def.key,
          feature_name: def.name,
          limit_value: existing !== undefined ? existing.limit_value : def.defaultVal,
          daily_limit: existing !== undefined ? (existing.daily_limit !== undefined ? existing.daily_limit : Math.ceil(existing.limit_value / 30)) : Math.ceil(def.defaultVal / 30)
        };
      });

      setFormData({
        name: plan.name || '',
        price: plan.price || 0,
        currency: plan.currency || 'INR',
        billing_cycle: plan.billing_cycle || 'Monthly',
        features: mappedFeatures
      });
    } else {
      setEditingPlan(null);
      setFormData({
        name: '',
        price: 0,
        currency: 'INR',
        billing_cycle: 'Monthly',
        features: MAFIYA_FEATURE_DEFS.map(f => ({
          feature_key: f.key,
          feature_name: f.name,
          limit_value: f.defaultVal,
          daily_limit: Math.ceil(f.defaultVal / 30)
        }))
      });
    }
    setModalOpen(true);
  };

  const handleSave = async () => {
    if (!formData.name.trim()) {
      toast.error('Plan name is required');
      return;
    }

    setSavingPlan(true);
    try {
      const token = localStorage.getItem('leados_token');
      const headers = { Authorization: `Bearer ${token}` };

      const payload = {
        ...formData,
        features: formData.features.map(f => ({
          ...f,
          limit_value: f.limit_value === '' ? 0 : parseInt(f.limit_value),
          daily_limit: f.daily_limit === '' ? -1 : parseInt(f.daily_limit)
        }))
      };

      if (editingPlan) {
        await axios.put(`${API_URL}/api/mafiya/plans/${editingPlan.id}`, payload, { headers });
        toast.success('Plan updated successfully');
      } else {
        await axios.post(`${API_URL}/api/mafiya/plans`, payload, { headers });
        toast.success('Plan created successfully');
      }
      setModalOpen(false);
      fetchPlans();
    } catch (err) {
      console.error('[Mafiya Plans] Save error:', err);
      toast.error(err.response?.data?.error || 'Failed to save plan');
    } finally {
      setSavingPlan(false);
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Are you sure you want to delete this plan?')) return;

    try {
      const token = localStorage.getItem('leados_token');
      const headers = { Authorization: `Bearer ${token}` };
      await axios.delete(`${API_URL}/api/mafiya/plans/${id}`, { headers });
      toast.success('Plan deleted successfully');
      fetchPlans();
    } catch (err) {
      console.error('[Mafiya Plans] Delete error:', err);
      toast.error(err.response?.data?.error || 'Failed to delete plan');
    }
  };

  return (
    <div style={{ padding: 28, color: C.text, height: '100%', overflowY: 'auto', background: 'rgba(0,0,0,0.15)' }}>
      {/* ═══ Header Section ═══ */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 38, height: 38, background: 'linear-gradient(135deg, #ea580c, #f97316)', borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Layers size={20} color="#fff" />
            </div>
            <div>
              <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800, color: '#fff', fontFamily: "'Syne', sans-serif" }}>
                Mafiya GBP OS Plans
              </h1>
              <p style={{ margin: 0, color: C.muted, fontSize: 12, marginTop: 2 }}>
                Configure plans and API consumption limits dynamically for paid GMB clients
              </p>
            </div>
          </div>
        </div>

        <button
          onClick={() => openModal(null)}
          style={{ background: 'linear-gradient(135deg, #ea580c, #f97316)', border: 'none', padding: '10px 18px', borderRadius: 10, color: '#fff', fontSize: 12, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, boxShadow: '0 4px 12px rgba(234, 88, 12, 0.25)' }}
        >
          <Plus size={16} /> Create Plan
        </button>
      </div>

      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: 200 }}>
          <Loader2 size={32} className="animate-spin" color="#ea580c" />
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 20 }}>
          {plans.map(plan => (
            <div
              key={plan.id}
              style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 16, padding: 20, display: 'flex', flexDirection: 'column', position: 'relative' }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
                <div>
                  <h3 style={{ margin: 0, fontSize: 18, color: '#fff', fontWeight: 800 }}>{plan.name}</h3>
                  <div style={{ fontSize: 24, fontWeight: 800, color: '#ea580c', marginTop: 8 }}>
                    ₹{parseFloat(plan.price).toLocaleString()}
                    <span style={{ fontSize: 12, color: C.muted, fontWeight: 500 }}> / {plan.billing_cycle}</span>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    onClick={() => openModal(plan)}
                    style={{ background: 'rgba(255,255,255,0.06)', border: `1px solid ${C.border}`, width: 32, height: 32, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: '#fff' }}
                  >
                    <Edit2 size={14} />
                  </button>
                  <button
                    onClick={() => handleDelete(plan.id)}
                    style={{ background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.2)', width: 32, height: 32, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: '#ef4444' }}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>

              <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: 16, flexGrow: 1 }}>
                <span style={{ fontSize: 11, textTransform: 'uppercase', color: C.muted, fontWeight: 700, letterSpacing: 0.5 }}>Features & Limits</span>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 12 }}>
                  {plan.features?.map(feat => (
                    <div key={feat.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                      <span style={{ color: C.muted }}>{feat.feature_name}</span>
                      <span style={{ color: '#fff', fontWeight: 600 }}>
                        {feat.limit_value === -1 ? 'Unlimited' : feat.limit_value}
                        {feat.limit_value !== -1 && feat.daily_limit !== undefined && feat.daily_limit !== -1 ? <span style={{ color: C.muted, fontSize: 10, marginLeft: 4 }}>({feat.daily_limit}/day)</span> : null}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ═══ Create/Edit Modal ═══ */}
      {modalOpen && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1000 }}>
          <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 20, width: '100%', maxWidth: 500, padding: 24, boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.5)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <h2 style={{ margin: 0, fontSize: 18, color: '#fff', fontWeight: 800 }}>
                {editingPlan ? 'Edit Mafiya Plan' : 'Create Mafiya Plan'}
              </h2>
              <button onClick={() => setModalOpen(false)} style={{ background: 'none', border: 'none', color: C.muted, cursor: 'pointer' }}>
                <X size={20} />
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div>
                <label style={{ display: 'block', fontSize: 11, textTransform: 'uppercase', color: C.muted, fontWeight: 700, marginBottom: 6 }}>Plan Name</label>
                <input
                  type="text"
                  name="name"
                  value={formData.name}
                  onChange={handleInputChange}
                  placeholder="e.g. Starter, Growth"
                  style={{ width: '100%', padding: '10px 14px', borderRadius: 10, background: 'rgba(255,255,255,0.05)', border: `1px solid ${C.border}`, color: '#fff', fontSize: 13 }}
                />
              </div>

              <div style={{ display: 'flex', gap: 12 }}>
                <div style={{ flex: 1 }}>
                  <label style={{ display: 'block', fontSize: 11, textTransform: 'uppercase', color: C.muted, fontWeight: 700, marginBottom: 6 }}>Price (INR)</label>
                  <input
                    type="number"
                    name="price"
                    value={formData.price}
                    onChange={handleInputChange}
                    style={{ width: '100%', padding: '10px 14px', borderRadius: 10, background: 'rgba(255,255,255,0.05)', border: `1px solid ${C.border}`, color: '#fff', fontSize: 13 }}
                  />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={{ display: 'block', fontSize: 11, textTransform: 'uppercase', color: C.muted, fontWeight: 700, marginBottom: 6 }}>Billing Cycle</label>
                  <select
                    name="billing_cycle"
                    value={formData.billing_cycle}
                    onChange={handleInputChange}
                    style={{ width: '100%', padding: '10px 14px', borderRadius: 10, background: 'rgba(255,255,255,0.05)', border: `1px solid ${C.border}`, color: '#fff', fontSize: 13 }}
                  >
                    <option value="Monthly">Monthly</option>
                    <option value="Yearly">Yearly</option>
                  </select>
                </div>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: 11, textTransform: 'uppercase', color: C.muted, fontWeight: 700, marginBottom: 12 }}>Configure Limits</label>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12, maxHeight: 220, overflowY: 'auto', paddingRight: 6 }}>
                  {formData.features.map(feat => (
                    <div key={feat.feature_key} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: 12, color: C.muted, flex: 1 }}>{feat.feature_name}</span>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                          <span style={{ fontSize: 9, color: C.muted, marginBottom: 2 }}>Monthly</span>
                          <input
                            type="number"
                            value={feat.limit_value}
                            onChange={(e) => handleFeatureLimitChange(feat.feature_key, e.target.value)}
                            placeholder="-1"
                            style={{ width: 70, padding: '6px 10px', borderRadius: 8, background: 'rgba(255,255,255,0.05)', border: `1px solid ${C.border}`, color: '#fff', fontSize: 12, textAlign: 'center' }}
                          />
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                          <span style={{ fontSize: 9, color: C.muted, marginBottom: 2 }}>Daily</span>
                          <input
                            type="number"
                            value={feat.daily_limit}
                            onChange={(e) => handleFeatureDailyLimitChange(feat.feature_key, e.target.value)}
                            placeholder="-1"
                            style={{ width: 70, padding: '6px 10px', borderRadius: 8, background: 'rgba(255,255,255,0.05)', border: `1px solid ${C.border}`, color: '#fff', fontSize: 12, textAlign: 'center' }}
                          />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'end', gap: 12, marginTop: 24 }}>
              <button
                onClick={() => setModalOpen(false)}
                style={{ background: 'none', border: `1px solid ${C.border}`, padding: '10px 16px', borderRadius: 10, color: '#fff', fontSize: 12, cursor: 'pointer' }}
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={savingPlan}
                style={{ background: 'linear-gradient(135deg, #ea580c, #f97316)', border: 'none', padding: '10px 20px', borderRadius: 10, color: '#fff', fontSize: 12, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}
              >
                {savingPlan && <Loader2 size={14} className="animate-spin" />}
                {editingPlan ? 'Save Changes' : 'Create Plan'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
