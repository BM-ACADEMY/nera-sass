import { useState, useEffect } from 'react';
import { api } from '../services/api.js';
import { Share2, RefreshCw, Plus, X, Edit2, Trash2 } from 'lucide-react';
import { C } from '../constants/theme.js';

export const IntegrationsView = () => {
  const [accounts, setAccounts] = useState([]);
  const [clients, setClients] = useState([]);
  const [selectedBrandName, setSelectedBrandName] = useState('');
  const [loading, setLoading] = useState(true);

  // Modal State
  const [showModal, setShowModal] = useState(false);
  const [formData, setFormData] = useState({
    id: null,
    platform: 'facebook',
    account_name: '',
    page_id: '',
    access_token: ''
  });

  useEffect(() => {
    fetchAccounts();
    fetchClients();
  }, []);

  const fetchAccounts = async () => {
    try {
      setLoading(true);
      const res = await api.getSocialAccounts();
      setAccounts(res || []);
    } catch (err) {
      console.error('Error fetching accounts', err);
    } finally {
      setLoading(false);
    }
  };

  const fetchClients = async () => {
    try {
      const res = await api.getClients();
      const activeClients = res.clients || [];
      setClients(activeClients);
      if (activeClients.length > 0) {
        setSelectedBrandName(activeClients[0].name || activeClients[0].business_name || activeClients[0].client_name);
      }
    } catch (err) {
      console.error('Error fetching clients', err);
    }
  };

  const handleSubscribeWebhook = async (pageId) => {
    try {
      const res = await api.post(`/api/meta/pages/${pageId}/subscribe`);
      if (res.success) {
        alert('Successfully subscribed to Meta Leads Webhooks for this page!');
      } else {
        alert('Failed to subscribe: ' + (res.error || 'Unknown error'));
      }
    } catch (err) {
      alert('Subscription failed: ' + err.message);
    }
  };

  const openAddModal = () => {
    if (!selectedBrandName) {
      alert('Please select a brand first.');
      return;
    }
    setFormData({ id: null, platform: 'facebook', account_name: '', page_id: '', access_token: '' });
    setShowModal(true);
  };

  const openEditModal = (acc) => {
    const isInsta = acc.platform === 'instagram';
    setFormData({
      id: acc.id,
      platform: acc.platform,
      account_name: acc.account_name,
      page_id: isInsta ? acc.instagram_business_id : acc.facebook_page_id,
      access_token: '' // Don't pre-fill token for security, let them overwrite if needed
    });
    setSelectedBrandName(acc.brand_name);
    setShowModal(true);
  };

  const handleDelete = async (id, name) => {
    if (!window.confirm(`Are you sure you want to delete ${name}?`)) return;
    try {
      await api.delete(`/api/integrations/meta/account/${id}`);
      fetchAccounts();
    } catch (err) {
      alert('Failed to delete: ' + err.message);
    }
  };

  const handleSaveAccount = async () => {
    if (!formData.account_name || !formData.page_id || !formData.access_token) {
      alert('Please fill in all fields (Account Name, Page ID, Access Token).');
      return;
    }
    try {
      const isInsta = formData.platform === 'instagram';
      const payload = {
        brand_name: selectedBrandName,
        platform: formData.platform,
        account_name: formData.account_name,
        account_id: formData.page_id, // we use page_id as the primary account identifier
        facebook_page_id: isInsta ? null : formData.page_id,
        instagram_business_id: isInsta ? formData.page_id : null,
        access_token: formData.access_token
      };

      const res = await api.post('/api/integrations/meta/link-account', payload);
      if (res.success) {
        setShowModal(false);
        fetchAccounts();
      } else {
        alert('Failed to save account: ' + res.error);
      }
    } catch (err) {
      alert('Error saving account: ' + err.message);
    }
  };

  const metaAccounts = accounts.filter(acc => (acc.platform === 'facebook' || acc.platform === 'instagram') && acc.access_token);

  const groupedAccounts = {};
  metaAccounts.forEach(acc => {
    if (!groupedAccounts[acc.brand_name]) {
      groupedAccounts[acc.brand_name] = { facebook: [], instagram: [] };
    }
    if (acc.platform === 'facebook') groupedAccounts[acc.brand_name].facebook.push(acc);
    if (acc.platform === 'instagram') groupedAccounts[acc.brand_name].instagram.push(acc);
  });

  const renderAccountCard = (acc) => {
    const isInsta = acc.platform === 'instagram';
    const iconColor = isInsta ? '#E1306C' : '#1877F2';
    const iconChar = isInsta ? 'i' : 'f';
    const pageId = isInsta ? acc.instagram_business_id : acc.facebook_page_id;
    
    return (
      <div key={acc.id} style={{ display: 'flex', flexDirection: 'column', background: C.surface, border: '1px solid ' + C.border, borderRadius: 10, padding: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ width: 40, height: 40, borderRadius: 8, background: `${iconColor}22`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: iconColor, fontWeight: 'bold', fontSize: 20, fontFamily: 'serif' }}>
              {iconChar}
            </div>
            <div>
              <div style={{ fontSize: 15, fontWeight: 700, color: C.text, display: 'flex', alignItems: 'center', gap: 8 }}>
                {acc.account_name}
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: C.green, boxShadow: `0 0 6px ${C.green}` }} />
              </div>
              <div style={{ fontSize: 12, color: C.muted, marginTop: 4 }}>
                Brand: <span style={{ color: C.accent, fontWeight: 600 }}>{acc.brand_name}</span> &bull; {isInsta ? 'IG Biz ID' : 'Page ID'}: <span style={{ fontFamily: 'monospace' }}>{pageId}</span>
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <button onClick={() => openEditModal(acc)} style={{ background: 'transparent', border: 'none', color: C.muted, cursor: 'pointer', padding: 4 }} title="Edit"><Edit2 size={16} /></button>
              <button onClick={() => handleDelete(acc.id, acc.account_name)} style={{ background: 'transparent', border: 'none', color: C.red, cursor: 'pointer', padding: 4 }} title="Delete"><Trash2 size={16} /></button>
            </div>
            {!isInsta && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-end' }}>
                <button 
                  onClick={() => handleSubscribeWebhook(acc.facebook_page_id)}
                  style={{ background: C.border, color: C.text, border: 'none', padding: '6px 12px', borderRadius: 6, fontSize: 11, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}
                >
                  <RefreshCw size={12} />
                  Sync Webhook
                </button>
                <button 
                  onClick={async () => {
                    try {
                      const res = await api.post('/api/integrations/meta/sync-leads', { account_id: acc.id });
                      if (res.success) {
                        alert(`Successfully synced ${res.synced} historical leads! Check your Leads page.`);
                      } else {
                        alert('Sync failed: ' + res.error);
                      }
                    } catch (err) {
                      alert('Sync error: ' + err.message);
                    }
                  }}
                  style={{ background: C.accent, color: '#fff', border: 'none', padding: '6px 12px', borderRadius: 6, fontSize: 11, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}
                >
                  <RefreshCw size={12} />
                  Sync Old Leads
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="p-mobile" style={{ padding: 26, overflowY: 'auto', height: '100%', position: 'relative' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 22 }}>
        <div style={{ width: 42, height: 42, borderRadius: 12, background: C.accent + '20', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Share2 size={20} color={C.accent} />
        </div>
        <div>
          <h1 style={{ fontFamily: "'Syne',sans-serif", fontSize: 21, fontWeight: 800, color: C.text, margin: 0 }}>Meta Integrations</h1>
          <p style={{ color: C.muted, fontSize: 12, marginTop: 4 }}>Manage Meta Leads Webhooks and Page connections</p>
        </div>
      </div>

      <div style={{ background: C.card, border: '1px solid ' + C.border, borderRadius: 13, padding: 22, width: '100%' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <h3 style={{ fontFamily: "'Syne',sans-serif", fontSize: 16, fontWeight: 700, color: C.text }}>Connected Meta Pages</h3>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <select 
              value={selectedBrandName} 
              onChange={e => setSelectedBrandName(e.target.value)}
              style={{ background: C.surface, border: '1px solid ' + C.border, color: C.text, padding: '8px 12px', borderRadius: 8, fontSize: 13, outline: 'none' }}
            >
              {clients.map(c => {
                const name = c.name || c.business_name || c.client_name;
                return <option key={c.id} value={name}>{name}</option>;
              })}
            </select>
            <button onClick={openAddModal} style={{ background: '#1877F2', color: '#fff', border: 'none', padding: '8px 16px', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}>
              <Plus size={16} /> Connect Meta
            </button>
          </div>
        </div>

        {loading ? (
          <div style={{ padding: 40, textAlign: 'center', color: C.muted }}>Loading accounts...</div>
        ) : metaAccounts.length === 0 ? (
          <div style={{ padding: 40, textAlign: 'center', background: C.surface, borderRadius: 8, border: '1px dashed ' + C.border }}>
            <Share2 size={32} color={C.muted} style={{ margin: '0 auto 12px' }} />
            <p style={{ color: C.muted, fontSize: 14 }}>No Meta Pages connected yet.</p>
            <p style={{ color: C.dim, fontSize: 12, marginTop: 8 }}>Add a Facebook Page or Instagram Account to sync leads directly into LeadOS.</p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 32 }}>
            {Object.entries(groupedAccounts).map(([brand, platforms]) => (
              <div key={brand}>
                <h4 style={{ fontFamily: "'Syne',sans-serif", color: C.text, fontSize: 18, marginBottom: 16, borderBottom: '1px solid ' + C.border, paddingBottom: 8 }}>{brand}</h4>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                    <div style={{ fontSize: 12, color: C.muted, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1 }}>Facebook Pages</div>
                    {platforms.facebook.length > 0 ? platforms.facebook.map(renderAccountCard) : <div style={{ color: C.dim, fontSize: 13 }}>No Facebook pages linked.</div>}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                    <div style={{ fontSize: 12, color: C.muted, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1 }}>Instagram Accounts</div>
                    {platforms.instagram.length > 0 ? platforms.instagram.map(renderAccountCard) : <div style={{ color: C.dim, fontSize: 13 }}>No Instagram accounts linked.</div>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {showModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}>
          <div style={{ background: C.surface, border: '1px solid ' + C.border, borderRadius: 16, width: 400, padding: 24 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <h3 style={{ margin: 0, fontSize: 18, color: C.text, fontFamily: "'Syne', sans-serif", fontWeight: 700 }}>
                {formData.id ? 'Edit Meta Account' : 'Add Meta Account'}
              </h3>
              <button onClick={() => setShowModal(false)} style={{ background: 'transparent', border: 'none', color: C.muted, cursor: 'pointer' }}><X size={20} /></button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div>
                <label style={{ display: 'block', fontSize: 13, color: C.muted, marginBottom: 6 }}>Platform</label>
                <select 
                  value={formData.platform} 
                  onChange={e => setFormData({...formData, platform: e.target.value})}
                  style={{ width: '100%', background: C.bg, border: '1px solid ' + C.border, color: C.text, padding: '10px 12px', borderRadius: 8, outline: 'none' }}
                  disabled={!!formData.id} // prevent changing platform on edit
                >
                  <option value="facebook">Facebook Page</option>
                  <option value="instagram">Instagram Account</option>
                </select>
              </div>
              
              <div>
                <label style={{ display: 'block', fontSize: 13, color: C.muted, marginBottom: 6 }}>Account Name (Internal)</label>
                <input 
                  type="text"
                  value={formData.account_name}
                  onChange={e => setFormData({...formData, account_name: e.target.value})}
                  placeholder="e.g. BM Academy Main Page"
                  style={{ width: '100%', background: C.bg, border: '1px solid ' + C.border, color: C.text, padding: '10px 12px', borderRadius: 8, outline: 'none' }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: 13, color: C.muted, marginBottom: 6 }}>{formData.platform === 'instagram' ? 'IG Business ID' : 'Facebook Page ID'}</label>
                <input 
                  type="text"
                  value={formData.page_id}
                  onChange={e => setFormData({...formData, page_id: e.target.value})}
                  placeholder="e.g. 1234567890"
                  style={{ width: '100%', background: C.bg, border: '1px solid ' + C.border, color: C.text, padding: '10px 12px', borderRadius: 8, outline: 'none', fontFamily: 'monospace' }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: 13, color: C.muted, marginBottom: 6 }}>System User Access Token</label>
                <input 
                  type="password"
                  value={formData.access_token}
                  onChange={e => setFormData({...formData, access_token: e.target.value})}
                  placeholder="EAAG..."
                  style={{ width: '100%', background: C.bg, border: '1px solid ' + C.border, color: C.text, padding: '10px 12px', borderRadius: 8, outline: 'none', fontFamily: 'monospace' }}
                />
              </div>

              <button 
                onClick={handleSaveAccount}
                style={{ width: '100%', background: C.accent, color: '#fff', border: 'none', padding: '12px', borderRadius: 8, fontWeight: 700, cursor: 'pointer', marginTop: 8 }}
              >
                Save Account
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
