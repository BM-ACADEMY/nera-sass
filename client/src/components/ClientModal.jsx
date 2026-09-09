import { useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Save, Building, Smartphone, AlertCircle, Trash2 } from 'lucide-react';
import { C } from '../constants/theme.js';
import { api } from '../services/api.js';
import toast from 'react-hot-toast';
import { getCountries, getCountryCallingCode, parsePhoneNumberFromString } from 'libphonenumber-js';
import { launchMetaEmbeddedSignup } from '../utils/metaEmbeddedSignup.js';

const countryNames = new Intl.DisplayNames(['en'], { type: 'region' });
const phoneCountries = getCountries().map(code => ({
  code,
  name: countryNames.of(code) || code,
  callingCode: getCountryCallingCode(code),
})).sort((a, b) => a.name.localeCompare(b.name));

const validateWhatsAppNumber = value => {
  const raw = String(value || '').trim();
  if (!raw) return { normalized: '', error: '' };
  if (!/^\+?[\d\s().-]+$/.test(raw)) {
    return { normalized: '', error: 'Use only digits with an optional leading +.' };
  }
  const parsed = parsePhoneNumberFromString(raw.startsWith('+') ? raw : `+${raw}`);
  if (!parsed?.isValid()) {
    return { normalized: '', error: 'Enter a valid country code followed by the phone number.' };
  }
  return { normalized: parsed.number.slice(1), error: '' };
};

export const ClientModal = ({ client, onClose, onUpdate }) => {
  const isEditing = !!client;
  
  const [formData, setFormData] = useState({
    name: client?.name || '',
    whatsapp_number: client?.whatsapp_number || '',
    phone_number_id: client?.phone_number_id || '',
    wa_category: client?.wa_category || 'OTHER',
    wa_description: client?.wa_description || '',
    wa_address: client?.wa_address || '',
    wa_email: client?.wa_email || '',
    wa_website: client?.wa_website || '',
    status: client?.status || 'active'
  });
  
  const [loading, setLoading] = useState(false);
  const [phoneError, setPhoneError] = useState('');
  const [logoFile, setLogoFile] = useState(null);
  const [logoPreview, setLogoPreview] = useState(client?.meta_profile_picture_url || '');
  const [metaOnboardingStep, setMetaOnboardingStep] = useState(0);
  const [metaOnboardingLoading, setMetaOnboardingLoading] = useState(false);
  const [onboardingCountry, setOnboardingCountry] = useState('IN');
  const [onboardingNationalNumber, setOnboardingNationalNumber] = useState('');
  const [onboardingPhoneError, setOnboardingPhoneError] = useState('');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!formData.name) return toast.error('Client name is required');
    const phone = validateWhatsAppNumber(formData.whatsapp_number);
    if (phone.error) {
      setPhoneError(phone.error);
      return toast.error(phone.error);
    }
    const payload = { ...formData, whatsapp_number: phone.normalized };
    
    setLoading(true);
    try {
      if (isEditing) {
        const result = await api.updateClient(client.id, payload);
        if (logoFile) await api.uploadClientMetaLogo(client.id, logoFile);
        toast.success(result.meta_profile_synced || logoFile
          ? 'Client and Meta profile updated successfully'
          : result.meta_profile_pending
            ? 'Draft saved. Add the real Meta Phone Number ID to sync the profile.'
            : 'Client updated successfully');
      } else {
        await api.createClient(payload);
        toast.success('Client onboarded successfully');
      }
      await onUpdate();
      onClose();
    } catch (err) {
      toast.error(err.message || 'Failed to save client');
    } finally {
      setLoading(false);
    }
  };

  const handleSetupWhatsApp = async () => {
    if (!client?.id) return;
    const phone = validateWhatsAppNumber(formData.whatsapp_number);
    if (phone.error) {
      setPhoneError(phone.error);
      return toast.error(phone.error);
    }
    const tId = toast.loading('Saving details and verifying with Meta...');
    try {
      await api.updateClient(client.id, { ...formData, whatsapp_number: phone.normalized });
      await api.setupClientWhatsApp(client.id);
      toast.success('WhatsApp verified and enabled', { id: tId });
      await onUpdate();
      onClose();
    } catch (err) {
      toast.error(err.message || 'Setup Failed', { id: tId });
    }
  };

  const handleMetaEmbeddedSignup = async () => {
    const callingCode = getCountryCallingCode(onboardingCountry);
    const phone = validateWhatsAppNumber(`+${callingCode}${onboardingNationalNumber}`);
    if (phone.error) {
      setOnboardingPhoneError(phone.error);
      return;
    }
    setFormData(current => ({ ...current, whatsapp_number: phone.normalized }));
    setMetaOnboardingLoading(true);
    const toastId = toast.loading('Opening secure Meta phone verification…');
    try {
      const config = await api.getMetaEmbeddedSignupConfig();
      if (!config.enabled) throw new Error('META_APP_ID and META_EMBEDDED_SIGNUP_CONFIG_ID must be configured on the server');
      const result = await launchMetaEmbeddedSignup(config);
      const completed = await api.completeMetaEmbeddedSignup(client.id, {
        waba_id: result.waba_id,
        phone_number_id: result.phone_number_id,
        expected_whatsapp_number: phone.normalized,
        name: formData.name,
        wa_category: formData.wa_category,
        wa_description: formData.wa_description,
      });
      setFormData(current => ({ ...current,
        whatsapp_number: completed.client.whatsapp_number || '',
        phone_number_id: completed.client.phone_number_id || ''
      }));
      setMetaOnboardingStep(0);
      await onUpdate();
      toast.success('Meta phone added and mapped to this brand', { id: toastId });
      onClose();
    } catch (error) {
      toast.error(error.message || 'Meta phone onboarding failed', { id: toastId });
    } finally {
      setMetaOnboardingLoading(false);
    }
  };

  const handleDeleteClick = () => {
    setShowDeleteConfirm(true);
    setDeleteConfirmText('');
  };

  const confirmDelete = async () => {
    if (deleteConfirmText !== 'delete-account') return;
    setLoading(true);
    try {
      await api.deleteClient(client.id);
      toast.success('Client deleted successfully');
      onUpdate();
      onClose();
    } catch (err) {
      toast.error(err.message || 'Failed to delete client');
      setLoading(false);
    }
  };

  const inputStyle = {
    width: '100%',
    background: C.bg,
    border: '1px solid ' + C.border,
    borderRadius: 9,
    padding: '11px 14px',
    color: C.text,
    fontSize: 13,
    outline: 'none',
    fontFamily: "'DM Sans', sans-serif"
  };

  const labelStyle = {
    display: 'block',
    fontSize: 9,
    color: C.muted,
    marginBottom: 6,
    fontWeight: 700,
    letterSpacing: 1,
    textTransform: 'uppercase'
  };

  return createPortal(
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '40px 20px', backdropFilter: 'blur(4px)' }}>
      <div style={{ background: C.card, border: '1px solid ' + C.border, borderRadius: 16, width: '100%', maxWidth: 800, maxHeight: 'calc(100vh - 80px)', display: 'flex', flexDirection: 'column', boxShadow: '0 20px 60px rgba(0,0,0,0.5)', position: 'relative' }}>
        
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '20px 24px', borderBottom: '1px solid ' + C.border, background: C.surface, borderRadius: '16px 16px 0 0', flexShrink: 0 }}>
          <div>
            <h2 style={{ fontFamily: "'Syne', sans-serif", fontSize: 18, fontWeight: 800, color: C.text }}>
              {isEditing ? 'Manage Client' : 'Onboard New Client'}
            </h2>
            <p style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>{isEditing ? client.name : 'Create the brand now; WhatsApp can be configured later'}</p>
          </div>
          <button onClick={onClose} style={{ background: C.bg, border: '1px solid ' + C.border, borderRadius: 8, width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.muted, cursor: 'pointer' }}>
            <X size={16} />
          </button>
        </div>

        <div style={{ overflowY: 'auto', padding: 24 }}>
          <form onSubmit={handleSubmit}>
          
          <div style={{ display: 'grid', gridTemplateColumns: isEditing ? '1fr 1fr' : '1fr', gap: 32 }} className="grid-responsive">
            
            {/* Left Column: General Info */}
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16, color: C.accent }}>
                <Building size={16} />
                <h3 style={{ fontSize: 13, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1 }}>Business Details</h3>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <div>
                  <label style={labelStyle}>Business Name <span style={{color: C.red}}>*</span></label>
                  <input value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} style={inputStyle} placeholder="e.g. MetaCorp Inc." required />
                </div>
                {isEditing && (
                  <div>
                    <label style={labelStyle}>Status</label>
                    <select value={formData.status} onChange={e => setFormData({...formData, status: e.target.value})} style={inputStyle}>
                      <option value="active">Active</option>
                      <option value="inactive">Inactive</option>
                    </select>
                  </div>
                )}
              </div>
            </div>

            {/* WhatsApp configuration is deliberately a second-stage action. */}
            {isEditing && <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16, color: C.green }}>
                <Smartphone size={16} />
                <h3 style={{ fontSize: 13, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1 }}>WhatsApp API</h3>
              </div>
              
              <div style={{ background: C.bg, border: '1px solid ' + C.border, borderRadius: 12, padding: 16, marginBottom: 16 }}>
                <div style={{ display: 'flex', gap: 12, color: C.muted, fontSize: 11, lineHeight: 1.5 }}>
                  <AlertCircle size={18} color={C.blue} style={{ flexShrink: 0 }} />
                  <div>
                    <p>Meta Developer Portal &gt; WhatsApp &gt; API Setup.</p>
                    <p style={{ marginTop: 6, color: client?.whatsapp_status === 'verified' ? C.green : C.muted }}>
                      Status: {client?.whatsapp_status === 'verified' ? 'Verified · Service Enabled' : client?.whatsapp_status === 'verification_pending' ? 'Verification Pending · Service Disabled' : client?.whatsapp_status === 'verification_failed' ? 'Verification Failed · Service Disabled' : 'Not Configured · Service Disabled'}
                    </p>
                  </div>
                </div>
                <button type="button" onClick={() => { onClose(); toast('Select the target WABA, then click Add phone to selected WABA.'); }} style={{ marginTop: 12, background: `${C.blue}18`, border: `1px solid ${C.blue}55`, color: C.blue, padding: '9px 12px', borderRadius: 8, fontSize: 11, fontWeight: 700, cursor: 'pointer', width: '100%' }}>
                  Add Phone via Selected WABA
                </button>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <div>
                  <label style={labelStyle}>WhatsApp Number</label>
                  <input
                    type="tel"
                    inputMode="tel"
                    autoComplete="tel"
                    value={formData.whatsapp_number}
                    onChange={e => {
                      setFormData({...formData, whatsapp_number: e.target.value});
                      if (phoneError) setPhoneError('');
                    }}
                    onBlur={() => {
                      const phone = validateWhatsAppNumber(formData.whatsapp_number);
                      setPhoneError(phone.error);
                      if (!phone.error && phone.normalized) {
                        setFormData(current => ({ ...current, whatsapp_number: phone.normalized }));
                      }
                    }}
                    aria-invalid={!!phoneError}
                    aria-describedby="whatsapp-number-help"
                    style={{ ...inputStyle, borderColor: phoneError ? C.red : C.border }}
                    placeholder="+91 98765 43210"
                  />
                  <div id="whatsapp-number-help" style={{ fontSize: 10, color: phoneError ? C.red : C.muted, marginTop: 6 }}>
                    {phoneError || 'Include the country calling code, for example +91 98765 43210.'}
                  </div>
                </div>
                <div>
                  <label style={labelStyle}>Phone Number ID</label>
                  <input value={formData.phone_number_id} onChange={e => setFormData({...formData, phone_number_id: e.target.value})} style={inputStyle} placeholder="15-digit ID from Meta" />
                </div>
                <div>
                  <label style={labelStyle}>Business Logo</label>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <div style={{ width: 58, height: 58, borderRadius: 12, overflow: 'hidden', background: C.bg, border: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.muted, fontSize: 9 }}>
                      {logoPreview ? <img src={logoPreview} alt="Business logo preview" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : 'No logo'}
                    </div>
                    <div style={{ flex: 1 }}>
                      <input type="file" accept="image/jpeg,image/png" disabled={!formData.phone_number_id} onChange={event => {
                        const file = event.target.files?.[0] || null;
                        setLogoFile(file);
                        if (file) setLogoPreview(URL.createObjectURL(file));
                      }} style={{ ...inputStyle, padding: 9, opacity: formData.phone_number_id ? 1 : .5 }} />
                      <div style={{ color: C.muted, fontSize: 9, marginTop: 5 }}>{formData.phone_number_id ? 'JPEG or PNG, maximum 5 MB. Uploaded to Meta as a square logo.' : 'Add this brand’s real Meta Phone Number ID before uploading its logo.'}</div>
                    </div>
                  </div>
                </div>
                <div>
                  <label style={labelStyle}>Category</label>
                  <select value={formData.wa_category} onChange={e => setFormData({...formData, wa_category: e.target.value})} style={inputStyle}>
                    {[
                      ['Matrimonial service', 'Matrimonial service'],
                      ['Finance and banking', 'Finance and banking'],
                      ['Food and groceries', 'Food and groceries'],
                      ['Alcoholic drinks', 'Alcoholic drinks'],
                      ['Government', 'Government'],
                      ['Hotel and lodging', 'Hotel and lodging'],
                      ['Medical and health', 'Medical and health'],
                      ['Over-the-counter medicine', 'Over-the-counter medicine'],
                      ['Charity', 'Charity'],
                      ['Professional services', 'Professional services'],
                      ['Shopping and retail', 'Shopping and retail'],
                      ['Travel and transportation', 'Travel and transportation'],
                      ['Restaurant', 'Restaurant'],
                      ['Other', 'OTHER'],
                    ].map(([label, value]) => <option key={value} value={value}>{label}</option>)}
                  </select>
                </div>
                <div>
                  <label style={labelStyle}>Description (Optional)</label>
                  <textarea value={formData.wa_description} onChange={e => setFormData({...formData, wa_description: e.target.value})} style={{...inputStyle, minHeight: 60}} maxLength={512} />
                </div>
                <div>
                  <label style={labelStyle}>Address (Optional)</label>
                  <input value={formData.wa_address} onChange={e => setFormData({...formData, wa_address: e.target.value})} style={inputStyle} maxLength={256} />
                </div>
                <div>
                  <label style={labelStyle}>Email (Optional)</label>
                  <input value={formData.wa_email} onChange={e => setFormData({...formData, wa_email: e.target.value})} style={inputStyle} maxLength={128} />
                </div>
                <div>
                  <label style={labelStyle}>Website (Optional)</label>
                  <input value={formData.wa_website} onChange={e => setFormData({...formData, wa_website: e.target.value})} style={inputStyle} maxLength={256} />
                </div>
              </div>
            </div>}
          </div>

          {/* Actions */}
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 32 }}>
            <div>
              {isEditing && formData.whatsapp_number && formData.phone_number_id && (
                <button type="button" onClick={handleSetupWhatsApp} style={{ background: '#25D36620', border: '1px solid #25D36640', color: '#25D366', padding: '10px 20px', borderRadius: 9, fontSize: 13, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Smartphone size={16} />
                  {client?.whatsapp_status === 'verified' ? 'Re-verify WhatsApp' : 'Verify & Enable WhatsApp'}
                </button>
              )}
            </div>
            <div style={{ display: 'flex', gap: 12 }}>
              {isEditing && (
                <button type="button" onClick={handleDeleteClick} disabled={loading} style={{ background: '#ff444420', border: '1px solid #ff4444', color: '#ff4444', padding: '10px 20px', borderRadius: 9, fontSize: 13, fontWeight: 700, cursor: loading ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Trash2 size={16} />
                  Delete
                </button>
              )}
              <button type="button" onClick={onClose} style={{ background: 'transparent', border: '1px solid ' + C.border, color: C.muted, padding: '10px 20px', borderRadius: 9, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>Cancel</button>
              <button type="submit" disabled={loading} style={{ background: C.accent, border: 'none', color: '#fff', padding: '10px 24px', borderRadius: 9, fontSize: 13, fontWeight: 700, cursor: loading ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', gap: 8, opacity: loading ? 0.7 : 1 }}>
                <Save size={16} />
                {loading ? 'Saving...' : (isEditing ? 'Save Changes' : 'Onboard Client')}
              </button>
            </div>
          </div>

        </form>
        </div>

        {metaOnboardingStep > 0 && (
          <div style={{ position: 'absolute', inset: 0, zIndex: 30, background: 'rgba(0,0,0,.82)', borderRadius: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
            <div style={{ width: '100%', maxWidth: 650, background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, overflow: 'hidden' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '180px 1fr', minHeight: 390 }}>
                <div style={{ background: C.surface, padding: 22, borderRight: `1px solid ${C.border}` }}>
                  <h3 style={{ color: C.text, fontSize: 15, marginBottom: 22 }}>Add phone number</h3>
                  <div style={{ color: metaOnboardingStep === 1 ? C.blue : C.green, fontSize: 12, fontWeight: 700, marginBottom: 18 }}>① Business profile</div>
                  <div style={{ color: metaOnboardingStep === 2 ? C.blue : C.muted, fontSize: 12, fontWeight: 700 }}>② Add and verify number</div>
                </div>
                <div style={{ padding: 24, position: 'relative' }}>
                  <button type="button" onClick={() => setMetaOnboardingStep(0)} style={{ position: 'absolute', right: 18, top: 16, border: 0, background: 'transparent', color: C.muted, cursor: 'pointer' }}><X size={18} /></button>
                  {metaOnboardingStep === 1 ? <>
                    <h3 style={{ color: C.text, fontSize: 17, marginBottom: 5 }}>Create a WhatsApp business profile</h3>
                    <p style={{ color: C.muted, fontSize: 11, marginBottom: 22 }}>This information will appear to customers on WhatsApp.</p>
                    <label style={labelStyle}>WhatsApp business display name</label>
                    <input value={formData.name} onChange={event => setFormData(current => ({ ...current, name: event.target.value }))} style={{ ...inputStyle, marginBottom: 15 }} />
                    <label style={labelStyle}>Category</label>
                    <select value={formData.wa_category} onChange={event => setFormData(current => ({ ...current, wa_category: event.target.value }))} style={{ ...inputStyle, marginBottom: 15 }}>
                      {['Matrimonial service','Finance and banking','Food and groceries','Alcoholic drinks','Government','Hotel and lodging','Medical and health','Over-the-counter medicine','Charity','Professional services','Shopping and retail','Travel and transportation','Restaurant','OTHER'].map(value => <option key={value} value={value}>{value === 'OTHER' ? 'Other' : value}</option>)}
                    </select>
                    <label style={labelStyle}>Business description · Optional</label>
                    <textarea value={formData.wa_description} onChange={event => setFormData(current => ({ ...current, wa_description: event.target.value }))} maxLength={512} style={{ ...inputStyle, minHeight: 90 }} />
                  </> : <>
                    <h3 style={{ color: C.text, fontSize: 17, marginBottom: 5 }}>Add your WhatsApp phone number</h3>
                    <p style={{ color: C.muted, fontSize: 11, lineHeight: 1.6, marginBottom: 20 }}>Choose the country code and enter the real number that can receive Meta’s SMS or voice OTP.</p>
                    <label style={labelStyle}>Phone number</label>
                    <div style={{ display: 'grid', gridTemplateColumns: '190px 1fr', gap: 8 }}>
                      <select value={onboardingCountry} onChange={event => { setOnboardingCountry(event.target.value); setOnboardingPhoneError(''); }} style={inputStyle}>
                        {phoneCountries.map(country => <option key={country.code} value={country.code}>{country.code} +{country.callingCode} · {country.name}</option>)}
                      </select>
                      <input type="tel" inputMode="tel" value={onboardingNationalNumber} onChange={event => { setOnboardingNationalNumber(event.target.value.replace(/[^\d\s().-]/g, '')); setOnboardingPhoneError(''); }} placeholder="Phone number" style={{ ...inputStyle, borderColor: onboardingPhoneError ? C.red : C.border }} />
                    </div>
                    <div style={{ color: onboardingPhoneError ? C.red : C.muted, fontSize: 9, marginTop: 7 }}>{onboardingPhoneError || `Full number: +${getCountryCallingCode(onboardingCountry)} ${onboardingNationalNumber}`}</div>
                    <div style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: 10, padding: 15, color: C.text, fontSize: 11, lineHeight: 1.6, marginTop: 18 }}>Next, Meta will open securely to add this number under WABA 953749850406150 and complete OTP verification. Meta will then return the new Phone Number ID automatically.</div>
                  </>}
                  <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 24 }}>
                    <button type="button" onClick={() => metaOnboardingStep === 1 ? setMetaOnboardingStep(0) : setMetaOnboardingStep(1)} style={{ background: 'transparent', border: `1px solid ${C.border}`, color: C.text, padding: '9px 18px', borderRadius: 8, cursor: 'pointer' }}>{metaOnboardingStep === 1 ? 'Cancel' : 'Back'}</button>
                    <button type="button" disabled={metaOnboardingLoading || !formData.name || !formData.wa_category || (metaOnboardingStep === 2 && !onboardingNationalNumber.trim())} onClick={() => metaOnboardingStep === 1 ? setMetaOnboardingStep(2) : handleMetaEmbeddedSignup()} style={{ background: C.blue, border: 0, color: '#fff', padding: '9px 18px', borderRadius: 8, cursor: 'pointer', opacity: metaOnboardingLoading || (metaOnboardingStep === 2 && !onboardingNationalNumber.trim()) ? .6 : 1 }}>{metaOnboardingStep === 1 ? 'Next' : metaOnboardingLoading ? 'Opening Meta…' : 'Next · Verify with Meta'}</button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {showDeleteConfirm && (
          <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.85)', zIndex: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 16 }}>
            <div style={{ background: C.card, border: '1px solid ' + C.border, borderRadius: 12, padding: 24, width: '100%', maxWidth: 400, textAlign: 'center' }}>
              <AlertCircle size={48} color={C.red} style={{ margin: '0 auto 16px' }} />
              <h3 style={{ fontFamily: "'Syne', sans-serif", fontSize: 18, fontWeight: 800, color: C.text, marginBottom: 8 }}>Delete Client?</h3>
              <p style={{ fontSize: 13, color: C.muted, marginBottom: 16 }}>
                This action cannot be undone. Please type <strong style={{ color: C.text }}>delete-account</strong> to confirm.
              </p>
              <input
                value={deleteConfirmText}
                onChange={e => setDeleteConfirmText(e.target.value)}
                style={{ ...inputStyle, textAlign: 'center', marginBottom: 16, border: '1px solid ' + C.red }}
                placeholder="delete-account"
              />
              <div style={{ display: 'flex', gap: 12 }}>
                <button type="button" onClick={() => setShowDeleteConfirm(false)} style={{ flex: 1, background: 'transparent', border: '1px solid ' + C.border, color: C.muted, padding: '10px', borderRadius: 9, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>Cancel</button>
                <button type="button" onClick={confirmDelete} disabled={deleteConfirmText !== 'delete-account' || loading} style={{ flex: 1, background: C.red, border: 'none', color: '#fff', padding: '10px', borderRadius: 9, fontSize: 13, fontWeight: 700, cursor: deleteConfirmText !== 'delete-account' || loading ? 'not-allowed' : 'pointer', opacity: deleteConfirmText !== 'delete-account' || loading ? 0.5 : 1 }}>
                  {loading ? 'Deleting...' : 'Confirm Delete'}
                </button>
              </div>
            </div>
          </div>
        )}

      </div>
    </div>,
    document.body
  );
};
