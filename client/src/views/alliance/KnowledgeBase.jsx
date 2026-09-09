import React, { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { api } from '../../services/api.js';
import { DatePicker } from './DatePicker.jsx';
import './alliance.css';

const digitsOnly = (value, maxLen) => String(value || '').replace(/\D/g, '').slice(0, maxLen);
const isValidPhone = (value) => !String(value || '').trim() || /^\d{10}$/.test(String(value).trim());
const normalizeBusinessHours = (value) => {
  const hours = String(value || '').trim();
  if (!hours) return '';
  const match = hours.replace(/[–—]/g, '-').replace(/\b(?:to|until|till)\b/gi, '-').match(/^\s*(\d{1,2})(?:[:.]?(\d{2}))?\s*(am|pm)?\s*-\s*(\d{1,2})(?:[:.]?(\d{2}))?\s*(am|pm)?\s*$/i);
  if (!match) return null;
  const start = { hour: Number(match[1]), minute: Number(match[2] || 0), period: match[3]?.toUpperCase() || '' };
  const end = { hour: Number(match[4]), minute: Number(match[5] || 0), period: match[6]?.toUpperCase() || '' };
  if (start.minute > 59 || end.minute > 59) return null;
  const normalizePart = (part, fallbackPeriod) => {
    if (!part.period && (part.hour > 12 || part.hour === 0)) return part.hour <= 23 ? { hour: ((part.hour + 11) % 12) + 1, minute: part.minute, period: part.hour >= 12 ? 'PM' : 'AM' } : null;
    return part.hour >= 1 && part.hour <= 12 ? { ...part, period: part.period || fallbackPeriod } : null;
  };
  const normalizedStart = normalizePart(start, 'AM');
  const normalizedEnd = normalizePart(end, 'PM');
  if (!normalizedStart || !normalizedEnd) return null;
  const format = (part) => `${part.hour}:${String(part.minute).padStart(2, '0')} ${part.period}`;
  return `${format(normalizedStart)} - ${format(normalizedEnd)}`;
};
const isValidBusinessHours = (value) => normalizeBusinessHours(value) !== null;
const isValidWebsite = (value) => !value.trim() || /^(https?:\/\/)?([\w-]+\.)+[a-z]{2,}(:\d+)?(\/\S*)?$/i.test(value.trim());
const isValidEmail = (value) => {
  const email = String(value || '').trim();
  if (!email) return true;
  if (email.length > 254) return false;
  const parts = email.split('@');
  if (parts.length !== 2) return false;
  const [local, domain] = parts;
  if (!local || local.length > 64 || local.startsWith('.') || local.endsWith('.') || local.includes('..')) return false;
  if (!/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+$/i.test(local)) return false;
  const labels = domain.split('.');
  return labels.length >= 2
    && /^[a-z]{2,}$/i.test(labels.at(-1))
    && labels.every((label) => label.length > 0 && label.length <= 63 && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(label));
};

const EMPTY_BRAND = {
  code: '', audience: '', name: '', description: '', phone: '', whatsapp: '', email: '', website: '',
  address: '', business_hours: '', languages: '', target_customers: '', primary_contact: '',
  escalation_contact: '', escalation_phone: '', verified_by: '', last_verified_date: '',
};

const POLICY_TEMPLATE = [
  'General EMI Policy', 'General Certification Policy', 'General Attendance Policy',
  'General Placement Policy', 'General Enrollment Refund Policy', 'Complaint Escalation Process',
];

const BRAND_PASTE_EXAMPLE = `Brand Name: BM Academy
Brand Description: BM Academy is a leading IT and digital skills training institute offering expert-led digital marketing training in Pondicherry and a full stack development course in Kottakuppam.

Primary Phone: 9944940051
WhatsApp Number: 9944940051
Email: bmacademypondy@gmail.com
Website: thebmacademy.com
Address: 252, 2nd floor, MG Road, Kottakuppam, Vanur, Puducherry, 605104
Business Hours: 10:00 AM - 8:00 PM
Supported Languages: English

Target Customers: Students, job seekers, business owners

Primary Contact Person: Kamar
Escalation Contact Person: Babila
Escalation Phone: 9944940051

General EMI Policy: 40% upfront, 30% second payment, 30% final payment
General Placement Policy: 100% placement support with resume and interview prep

Information Verified By: Kamar
Last Verified Date: 2026-08-14`;

const EMPTY_OFFERING = {
  offering_code: '', offering_type: 'course', name: '', category: '', tier: '', status: 'active',
  short_description: '', fee: '', duration: '', verified_by: '', last_verified_date: '',
};

const COURSE_DETAIL_TEMPLATE = [
  'Parent Course', 'Alternative Names', 'Suitable For', 'Eligibility', 'Total Training Hours', 'Mode',
  'Training Location', 'Class Schedule', 'Next Batch Date', 'Registration Fee', 'GST Included', 'EMI Available',
  'EMI Details', 'Current Offer', 'Offer Expiry Date', 'Curriculum', 'Projects', 'Tools and Software',
  'Certification Available', 'Certificate Details', 'Certificate Conditions', 'Career Opportunities',
  'Career Assistance', 'Resume Support', 'Portfolio Support', 'Placement Support', 'Placement Guarantee',
  'Mock Interviews', 'Priority Placement Drives', 'Placement Refund Available', 'Placement Refund Amount',
  'Placement Refund Waiting Period', 'Placement Refund Conditions', 'Enrollment Refund Policy',
  'Batch Change Policy', 'Cancellation Policy', 'Syllabus URL', 'Brochure URL', 'Landing Page URL',
  'Booking URL', 'Recommended Next Question', 'Escalation Conditions',
];

const SERVICE_DETAIL_TEMPLATE = [
  'Parent Service', 'Alternative Names', 'Suitable For', 'Main Customer Problem Solved', 'Key Benefits',
  'Unique Selling Points', 'Expected Business Outcome', 'Setup Fee', 'Monthly Fee', 'One-Time Fee',
  'GST Included', 'Minimum Contract', 'Advance Required', 'Payment Schedule', 'Current Offer',
  'Offer Expiry Date', 'Services Included', 'Services Not Included', 'Monthly Deliverables',
  'Platforms Covered', 'Keywords Included', 'Landing Page URL', 'Booking URL',
  'Recommended Next Question', 'Escalation Conditions',
];

const rowsFromObject = (obj) => Object.entries(obj || {}).map(([key, value]) => ({ key, value: String(value ?? '') }));
const rowsToObject = (rows) => Object.fromEntries(
  rows.filter((row) => row.key.trim()).map((row) => [row.key.trim(), row.value])
);

const KeyValueEditor = ({ rows, setRows, onLoadTemplate, templateLabel }) => (
  <div>
    {rows.map((row, index) => (
      <div className="al-kv-row" key={index}>
        <input
          value={row.key}
          placeholder="Field name"
          onChange={(e) => setRows(rows.map((r, i) => (i === index ? { ...r, key: e.target.value } : r)))}
        />
        <textarea
          value={row.value}
          placeholder="Value"
          onChange={(e) => setRows(rows.map((r, i) => (i === index ? { ...r, value: e.target.value } : r)))}
        />
        <button type="button" className="al-kv-remove" onClick={() => setRows(rows.filter((_, i) => i !== index))}>×</button>
      </div>
    ))}
    <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
      <button type="button" className="al-btn ghost sm" onClick={() => setRows([...rows, { key: '', value: '' }])}>+ Add field</button>
      {onLoadTemplate && (
        <button type="button" className="al-btn ghost sm" onClick={onLoadTemplate}>+ Load {templateLabel} field list</button>
      )}
    </div>
  </div>
);

const LanguageTagInput = ({ value, onChange }) => {
  const [draft, setDraft] = useState('');
  const languages = String(value || '').split(',').map((item) => item.trim()).filter(Boolean);

  const addLanguage = () => {
    const language = draft.trim();
    if (!language) return;
    if (!languages.some((item) => item.toLowerCase() === language.toLowerCase())) {
      onChange([...languages, language].join(', '));
    }
    setDraft('');
  };

  const removeLanguage = (index) => onChange(languages.filter((_, itemIndex) => itemIndex !== index).join(', '));

  return (
    <div className="al-tag-input" onClick={(event) => event.currentTarget.querySelector('input')?.focus()}>
      {languages.map((language, index) => (
        <span className="al-tag" key={`${language}-${index}`}>
          {language}
          <button type="button" onClick={() => removeLanguage(index)} aria-label={`Remove ${language}`}>×</button>
        </span>
      ))}
      <input
        value={draft}
        placeholder={languages.length ? 'Add another…' : 'Type a language and press Enter'}
        onChange={(event) => setDraft(event.target.value.replace(/,/g, ''))}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            addLanguage();
          } else if (event.key === 'Backspace' && !draft && languages.length) {
            removeLanguage(languages.length - 1);
          }
        }}
        onBlur={addLanguage}
      />
    </div>
  );
};

export const KnowledgeBase = () => {
  const [brands, setBrands] = useState([]);
  const [audiences, setAudiences] = useState([]);
  const [activeBrandId, setActiveBrandId] = useState(null);
  const [loadingBrands, setLoadingBrands] = useState(true);
  const [offerings, setOfferings] = useState([]);
  const [loadingOfferings, setLoadingOfferings] = useState(false);
  const [newBrandName, setNewBrandName] = useState('');
  const [creatingQuickBrand, setCreatingQuickBrand] = useState(false);

  const [editingBrand, setEditingBrand] = useState(null); // 'new' | brand object | null
  const [brandForm, setBrandForm] = useState(EMPTY_BRAND);
  const [brandPolicyRows, setBrandPolicyRows] = useState([]);
  const [savingBrand, setSavingBrand] = useState(false);
  const [brandEmailTouched, setBrandEmailTouched] = useState(false);
  const [brandPhoneTouched, setBrandPhoneTouched] = useState({ phone: false, whatsapp: false, escalation_phone: false });
  const [businessHoursTouched, setBusinessHoursTouched] = useState(false);
  const [deletingBrand, setDeletingBrand] = useState(null);
  const [showBrandPaste, setShowBrandPaste] = useState(false);
  const [brandPasteText, setBrandPasteText] = useState('');
  const [extractingBrand, setExtractingBrand] = useState(false);

  const [editingOffering, setEditingOffering] = useState(null); // 'new' | offering object | null
  const [viewingOffering, setViewingOffering] = useState(null);
  const [viewingFaqs, setViewingFaqs] = useState([]);
  const [loadingViewingFaqs, setLoadingViewingFaqs] = useState(false);
  const [offeringForm, setOfferingForm] = useState(EMPTY_OFFERING);
  const [offeringDetailRows, setOfferingDetailRows] = useState([]);
  const [savingOffering, setSavingOffering] = useState(false);
  const [deletingOffering, setDeletingOffering] = useState(null);

  const [showBulkImport, setShowBulkImport] = useState(false);
  const [bulkImportText, setBulkImportText] = useState('');
  const [bulkImporting, setBulkImporting] = useState(false);
  const [bulkImportResult, setBulkImportResult] = useState(null);

  const [faqs, setFaqs] = useState([]);
  const [newFaq, setNewFaq] = useState({ question: '', answer: '' });
  const [savingFaq, setSavingFaq] = useState(false);
  const [deletingFaq, setDeletingFaq] = useState(null);

  const loadBrands = async () => {
    setLoadingBrands(true);
    try {
      const data = await api.getAllianceBrainBrands();
      setBrands(data.brands || []);
      if (!activeBrandId && data.brands?.length) setActiveBrandId(data.brands[0].id);
    } catch (error) { toast.error(error.message || 'Failed to load brands'); }
    finally { setLoadingBrands(false); }
  };

  const loadOfferings = async (brandId) => {
    if (!brandId) { setOfferings([]); return; }
    setLoadingOfferings(true);
    try {
      const data = await api.getAllianceBrainOfferings(brandId);
      setOfferings(data.offerings || []);
    } catch (error) { toast.error(error.message || 'Failed to load courses/services'); }
    finally { setLoadingOfferings(false); }
  };

  useEffect(() => { loadBrands(); api.getAllianceAudiences().then((data) => setAudiences(data.audiences || [])).catch(() => { }); }, []);
  useEffect(() => { loadOfferings(activeBrandId); }, [activeBrandId]);

  const activeBrand = brands.find((b) => b.id === activeBrandId);

  const openEditBrand = (brand, { openPaste = false } = {}) => {
    setBrandForm({
      code: brand.code, audience: brand.audience || '', name: brand.name || '', description: brand.description || '',
      phone: brand.phone || '', whatsapp: brand.whatsapp || '', email: brand.email || '', website: brand.website || '',
      address: brand.address || '', business_hours: brand.business_hours || '', languages: brand.languages || '',
      target_customers: brand.target_customers || '', primary_contact: brand.primary_contact || '',
      escalation_contact: brand.escalation_contact || '', escalation_phone: brand.escalation_phone || '',
      verified_by: brand.verified_by || '', last_verified_date: brand.last_verified_date ? String(brand.last_verified_date).slice(0, 10) : '',
    });
    setBrandPolicyRows(rowsFromObject(brand.policies));
    setBrandEmailTouched(false);
    setBrandPhoneTouched({ phone: false, whatsapp: false, escalation_phone: false });
    setBusinessHoursTouched(false);
    setEditingBrand(brand);
    setShowBrandPaste(openPaste); setBrandPasteText('');
  };

  // Slug like "bmacademy" from a free-typed brand name, matching the backend's
  // code format (lowercase letters/numbers/underscores, starting with a letter).
  const slugifyBrandName = (name) => {
    let slug = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
    if (!/^[a-z]/.test(slug)) slug = `brand_${slug}`;
    return slug || 'brand';
  };

  const quickCreateBrand = async (event) => {
    event.preventDefault();
    const name = newBrandName.trim();
    if (!name) { toast.error('Enter a brand name first.'); return; }
    setCreatingQuickBrand(true);
    try {
      const result = await api.createAllianceBrainBrand({ code: slugifyBrandName(name), name });
      toast.success(`${name} added — now paste its info or fill in details.`);
      setNewBrandName('');
      await loadBrands();
      setActiveBrandId(result.brand.id);
      openEditBrand(result.brand, { openPaste: true });
    } catch (error) {
      toast.error(error.message || 'Failed to create brand');
    } finally {
      setCreatingQuickBrand(false);
    }
  };

  const extractBrandFromText = async () => {
    if (!brandPasteText.trim()) { toast.error('Paste some brand info text first.'); return; }
    setExtractingBrand(true);
    try {
      const { extracted } = await api.extractAllianceBrainBrand(brandPasteText);
      const { extra, ...knownFields } = extracted || {};
      setBrandForm((current) => ({
        ...current,
        ...Object.fromEntries(Object.entries(knownFields).filter(([, value]) => String(value || '').trim())),
      }));
      if (extra && typeof extra === 'object') {
        setBrandPolicyRows((current) => {
          const next = [...current];
          for (const [key, value] of Object.entries(extra)) {
            if (!key || !String(value || '').trim()) continue;
            const index = next.findIndex((row) => row.key.trim().toLowerCase() === key.trim().toLowerCase());
            if (index >= 0) next[index] = { ...next[index], value: String(value) };
            else next.push({ key, value: String(value) });
          }
          return next;
        });
      }
      const filledCount = Object.values(knownFields).filter((value) => String(value || '').trim()).length;
      const extraCount = extra ? Object.keys(extra).length : 0;
      toast.success(`Filled ${filledCount} field${filledCount === 1 ? '' : 's'}${extraCount ? ` + ${extraCount} extra field${extraCount === 1 ? '' : 's'}` : ''} from the pasted text. Review before saving.`);
      setShowBrandPaste(false);
    } catch (error) {
      toast.error(error.message || 'Failed to extract brand info');
    } finally {
      setExtractingBrand(false);
    }
  };

  const saveBrand = async (event) => {
    event.preventDefault();
    if (!brandForm.name.trim()) { toast.error('Brand name is required.'); return; }
    const invalidPhoneFields = ['phone', 'whatsapp', 'escalation_phone'].filter((field) => !isValidPhone(brandForm[field]));
    if (invalidPhoneFields.length) {
      setBrandPhoneTouched({ phone: true, whatsapp: true, escalation_phone: true });
      toast.error('Phone numbers must contain exactly 10 digits.');
      return;
    }
    const normalizedBusinessHours = normalizeBusinessHours(brandForm.business_hours);
    if (normalizedBusinessHours === null) {
      setBusinessHoursTouched(true);
      toast.error('Enter business hours as a range, such as 10am-8pm or 09:00-20:00.');
      return;
    }
    if (!isValidEmail(brandForm.email)) {
      setBrandEmailTouched(true);
      toast.error('Enter a valid email address (e.g. name@example.com).');
      return;
    }
    if (!isValidWebsite(brandForm.website)) { toast.error('Enter a valid website URL (e.g. example.com or https://example.com).'); return; }
    setSavingBrand(true);
    try {
      const payload = { ...brandForm, business_hours: normalizedBusinessHours, policies: rowsToObject(brandPolicyRows) };
      await api.updateAllianceBrainBrand(editingBrand.id, payload);
      toast.success('Brand updated');
      setEditingBrand(null);
      await loadBrands();
    } catch (error) { toast.error(error.message || 'Failed to save brand'); }
    finally { setSavingBrand(false); }
  };

  const confirmDeleteBrand = async () => {
    if (!deletingBrand) return;
    try {
      await api.deleteAllianceBrainBrand(deletingBrand.id);
      toast.success('Brand deleted');
      setDeletingBrand(null);
      if (activeBrandId === deletingBrand.id) setActiveBrandId(null);
      await loadBrands();
    } catch (error) { toast.error(error.message || 'Failed to delete brand'); }
  };

  const openNewOffering = () => {
    setOfferingForm(EMPTY_OFFERING);
    setOfferingDetailRows([]);
    setFaqs([]);
    setNewFaq({ question: '', answer: '' });
    setEditingOffering('new');
  };

  const openViewOffering = async (offering) => {
    setViewingOffering(offering);
    setViewingFaqs([]);
    setLoadingViewingFaqs(true);
    try {
      const data = await api.getAllianceBrainFaqs(offering.id);
      setViewingFaqs(data.faqs || []);
    } catch (error) {
      toast.error(error.message || 'Failed to load FAQs');
    } finally {
      setLoadingViewingFaqs(false);
    }
  };

  const openBulkImport = () => { setBulkImportText(''); setBulkImportResult(null); setShowBulkImport(true); };

  const runBulkImport = async (event) => {
    event.preventDefault();
    if (!bulkImportText.trim()) { toast.error('Paste your course/service text first.'); return; }
    setBulkImporting(true);
    setBulkImportResult(null);
    try {
      const result = await api.importAllianceBrainOfferingsBulk({ brand_id: activeBrandId, text: bulkImportText });
      setBulkImportResult(result);
      if (result.created?.length) toast.success(`Imported ${result.created.length} of ${result.total_blocks} record${result.total_blocks === 1 ? '' : 's'}.`);
      if (result.failed?.length) toast.error(`${result.failed.length} record${result.failed.length === 1 ? '' : 's'} failed — see details below.`);
      await loadOfferings(activeBrandId);
    } catch (error) {
      toast.error(error.message || 'Bulk import failed');
    } finally {
      setBulkImporting(false);
    }
  };
  const openEditOffering = async (offering) => {
    setOfferingForm({
      offering_code: offering.offering_code || '', offering_type: offering.offering_type || 'course',
      name: offering.name || '', category: offering.category || '', tier: offering.tier || '',
      status: offering.status || 'active', short_description: offering.short_description || '',
      fee: offering.fee || '', duration: offering.duration || '', verified_by: offering.verified_by || '',
      last_verified_date: offering.last_verified_date ? String(offering.last_verified_date).slice(0, 10) : '',
    });
    setOfferingDetailRows(rowsFromObject(offering.details));
    setEditingOffering(offering);
    setNewFaq({ question: '', answer: '' });
    try {
      const data = await api.getAllianceBrainFaqs(offering.id);
      setFaqs(data.faqs || []);
    } catch (error) { toast.error(error.message || 'Failed to load FAQs'); }
  };

  const loadOfferingTemplate = () => {
    const template = offeringForm.offering_type === 'service' ? SERVICE_DETAIL_TEMPLATE : COURSE_DETAIL_TEMPLATE;
    const existingKeys = new Set(offeringDetailRows.map((row) => row.key));
    const additions = template.filter((key) => !existingKeys.has(key)).map((key) => ({ key, value: '' }));
    setOfferingDetailRows([...offeringDetailRows, ...additions]);
  };

  const saveOffering = async (event) => {
    event.preventDefault();
    if (!offeringForm.name.trim()) { toast.error('Offering name is required.'); return; }
    setSavingOffering(true);
    try {
      const payload = { ...offeringForm, details: rowsToObject(offeringDetailRows) };
      if (editingOffering === 'new') {
        const result = await api.createAllianceBrainOffering({ ...payload, brand_id: activeBrandId });
        toast.success('Course/service added. You can now add FAQs below.');
        setEditingOffering(result.offering);
        setFaqs([]);
        await loadOfferings(activeBrandId);
      } else {
        await api.updateAllianceBrainOffering(editingOffering.id, payload);
        toast.success('Course/service updated');
        await loadOfferings(activeBrandId);
      }
    } catch (error) { toast.error(error.message || 'Failed to save course/service'); }
    finally { setSavingOffering(false); }
  };

  const confirmDeleteOffering = async () => {
    if (!deletingOffering) return;
    try {
      await api.deleteAllianceBrainOffering(deletingOffering.id);
      toast.success('Deleted');
      setDeletingOffering(null);
      if (editingOffering && editingOffering !== 'new' && editingOffering.id === deletingOffering.id) setEditingOffering(null);
      await loadOfferings(activeBrandId);
    } catch (error) { toast.error(error.message || 'Failed to delete'); }
  };

  const addFaq = async (event) => {
    event.preventDefault();
    if (!newFaq.question.trim() || !newFaq.answer.trim()) { toast.error('Both question and answer are required.'); return; }
    setSavingFaq(true);
    try {
      const result = await api.createAllianceBrainFaq(editingOffering.id, newFaq);
      setFaqs([...faqs, result.faq]);
      setNewFaq({ question: '', answer: '' });
      await loadOfferings(activeBrandId);
    } catch (error) { toast.error(error.message || 'Failed to add FAQ'); }
    finally { setSavingFaq(false); }
  };

  const confirmDeleteFaq = async () => {
    if (!deletingFaq) return;
    try {
      await api.deleteAllianceBrainFaq(deletingFaq.id);
      setFaqs(faqs.filter((f) => f.id !== deletingFaq.id));
      setDeletingFaq(null);
      await loadOfferings(activeBrandId);
    } catch (error) { toast.error(error.message || 'Failed to delete FAQ'); }
  };

  return (
    <div className="al-wrap">
      <div className="al-eyebrow">AllianceOS · Screen 5 · The Brain</div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
        <div className="al-page-title">AI Brain</div>
        <form onSubmit={quickCreateBrand} style={{ display: 'flex', gap: 8 }}>
          <input
            value={newBrandName}
            onChange={(e) => setNewBrandName(e.target.value)}
            placeholder="New brand name (e.g. BM Academy)"
            style={{ background: 'var(--al-panel)', border: '1px solid var(--al-line)', borderRadius: 8, padding: '9px 12px', color: 'var(--al-ink)', fontSize: 13, minWidth: 220 }}
          />
          <button className="al-btn" type="submit" disabled={creatingQuickBrand}>{creatingQuickBrand ? 'Adding…' : '+ Add brand'}</button>
        </form>
      </div>
      <p className="al-page-desc">
        The brand info, courses/services, pricing, and FAQs the AI is allowed to use when answering leads on email and WhatsApp.
        Create a brand by name, then paste or fill in its own details below — every reply suggestion pulls from this data.
      </p>

      {loadingBrands ? (
        <p style={{ color: 'var(--al-muted)' }}>Loading brands…</p>
      ) : !brands.length ? (
        <div className="al-brain-empty">No brands yet. Add your first brand to start training the AI on real facts.</div>
      ) : (
        <>
          <div className="al-kbtabs">
            {brands.map((brand) => (
              <span key={brand.id} className={activeBrandId === brand.id ? 'on' : ''} onClick={() => setActiveBrandId(brand.id)}>
                {brand.name} ({brand.offering_count})
              </span>
            ))}
          </div>

          {activeBrand && (
            <>
              <div className="al-brain-brandcard">
                <div className="al-brain-brandcard-head">
                  <div>
                    <h2>{activeBrand.name}</h2>
                    <p>{activeBrand.description || 'No description yet.'}</p>
                  </div>
                  <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                    <button className="al-btn ghost sm" type="button" onClick={() => openEditBrand(activeBrand)}>Edit brand</button>
                    <button className="al-btn ghost sm" type="button" style={{ color: '#ff8f8f' }} onClick={() => setDeletingBrand(activeBrand)}>Delete</button>
                  </div>
                </div>
                <div className="al-brain-meta">
                  <div><span>Audience</span><b>{audiences.find((a) => a.code === activeBrand.audience)?.label || activeBrand.audience || '—'}</b></div>
                  <div><span>Phone</span><b>{activeBrand.phone || '—'}</b></div>
                  <div><span>WhatsApp</span><b>{activeBrand.whatsapp || '—'}</b></div>
                  <div><span>Email</span><b>{activeBrand.email || '—'}</b></div>
                  <div><span>Website</span><b>{activeBrand.website || '—'}</b></div>
                  <div><span>Business hours</span><b>{activeBrand.business_hours || '—'}</b></div>
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
                <div className="al-page-title" style={{ fontSize: 17, marginBottom: 0 }}>Courses &amp; services</div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="al-btn ghost sm" type="button" onClick={openBulkImport}>Bulk import from text</button>
                  <button className="al-btn ghost sm" type="button" onClick={openNewOffering}>+ Add course/service</button>
                </div>
              </div>

              <div style={{ background: 'var(--al-panel2)', border: '1px solid var(--al-line)', borderRadius: 12, overflowX: 'auto', marginBottom: 24 }}>
                {loadingOfferings ? <p style={{ padding: 24, color: 'var(--al-muted)' }}>Loading…</p> : (
                  <table className="al-table">
                    <thead><tr><th>Code</th><th>Name</th><th>Type</th><th>Category</th><th>Tier</th><th>Fee</th><th>Duration</th><th>Status</th><th>FAQs</th><th>Actions</th></tr></thead>
                    <tbody>
                      {offerings.map((offering) => (
                        <tr key={offering.id}>
                          <td>{offering.offering_code || '—'}</td>
                          <td>{offering.name}</td>
                          <td style={{ textTransform: 'capitalize' }}>{offering.offering_type}</td>
                          <td>{offering.category || '—'}</td>
                          <td>{offering.tier || '—'}</td>
                          <td>{offering.fee ? `₹${offering.fee}` : '—'}</td>
                          <td>{offering.duration || '—'}</td>
                          <td><span className={`al-st ${offering.status === 'active' ? 'int' : 'new'}`}><span className="d" />{offering.status}</span></td>
                          <td>{offering.faq_count}</td>
                          <td><div style={{ display: 'flex', gap: 6 }}>
                            <button className="al-btn ghost sm" onClick={() => openViewOffering(offering)}>View</button>
                            <button className="al-btn ghost sm" onClick={() => openEditOffering(offering)}>Edit</button>
                            <button className="al-btn ghost sm" style={{ color: '#ff8f8f' }} onClick={() => setDeletingOffering(offering)}>Delete</button>
                          </div></td>
                        </tr>
                      ))}
                      {!offerings.length && <tr><td colSpan={10} style={{ textAlign: 'center', padding: 28, color: 'var(--al-muted)' }}>No courses or services yet for this brand.</td></tr>}
                    </tbody>
                  </table>
                )}
              </div>
            </>
          )}
        </>
      )}

      {editingBrand && (
        <div className="al-wa-modal-backdrop" role="presentation" onMouseDown={() => !savingBrand && setEditingBrand(null)}>
          <form className="al-brain-modal" onSubmit={saveBrand} onMouseDown={(e) => e.stopPropagation()}>
            <header><b>Edit {editingBrand.name}</b>
              <button type="button" className="al-wa-detail-close" style={{ fontSize: 22, lineHeight: 1 }} onClick={() => setEditingBrand(null)} aria-label="Close">×</button>
            </header>
            <div className="al-brain-modal-body">
              <div className="al-brain-section">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: showBrandPaste ? 10 : 0 }}>
                  <b style={{ margin: 0 }}>Paste from text</b>
                  <button type="button" className="al-btn ghost sm" onClick={() => setShowBrandPaste((v) => !v)}>{showBrandPaste ? 'Hide' : 'Paste brand info text'}</button>
                </div>
                {showBrandPaste && (
                  <div>
                    <div className="al-field">
                      <textarea
                        style={{ minHeight: 220 }}
                        value={brandPasteText}
                        placeholder={`Paste the brand's key: value text here, for example:\n\n${BRAND_PASTE_EXAMPLE}`}
                        onChange={(e) => setBrandPasteText(e.target.value)}
                      />
                    </div>
                    <p style={{ color: 'var(--al-muted)', fontSize: 11.5, margin: '8px 0 10px' }}>
                      Any field name works — known fields (name, phone, website, hours, contacts, etc.) fill the form below; anything else becomes a new "General policies" row automatically.
                      If a pasted field already has a value here, extracting again updates it instead of duplicating it.
                    </p>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button type="button" className="al-btn ghost sm" onClick={() => setBrandPasteText(BRAND_PASTE_EXAMPLE)}>Use example</button>
                      <button type="button" className="al-btn sm" disabled={extractingBrand} onClick={extractBrandFromText}>{extractingBrand ? 'Extracting…' : 'Extract with AI'}</button>
                    </div>
                  </div>
                )}
              </div>
              <div className="al-brain-section">
                <b>Brand information</b>
                <div className="al-fields">
                  <div className="al-field"><label>Brand code</label><input disabled value={brandForm.code} /></div>
                  <div className="al-field"><label>Brand name *</label><input required value={brandForm.name} onChange={(e) => setBrandForm({ ...brandForm, name: e.target.value })} /></div>
                  <div className="al-field"><label>Audience</label><select value={brandForm.audience} onChange={(e) => setBrandForm({ ...brandForm, audience: e.target.value })}><option value="">Not linked</option>{audiences.map((a) => <option key={a.code} value={a.code}>{a.label}</option>)}</select></div>
                </div>
                <div className="al-field"><label>Description</label><textarea style={{ minHeight: 90 }} value={brandForm.description} onChange={(e) => setBrandForm({ ...brandForm, description: e.target.value })} /></div>
                <div className="al-fields">
                  <div className="al-field"><label>Primary phone</label><input value={brandForm.phone} type="text" inputMode="numeric" pattern="[0-9]{10}" maxLength={10} placeholder="10-digit number" className={brandPhoneTouched.phone && !isValidPhone(brandForm.phone) ? 'al-input-invalid' : ''} aria-invalid={brandPhoneTouched.phone && !isValidPhone(brandForm.phone)} onBlur={() => setBrandPhoneTouched({ ...brandPhoneTouched, phone: true })} onChange={(e) => { setBrandForm({ ...brandForm, phone: digitsOnly(e.target.value, 10) }); setBrandPhoneTouched({ ...brandPhoneTouched, phone: true }); }} />{brandPhoneTouched.phone && !isValidPhone(brandForm.phone) && <span className="al-field-error" role="alert">Enter exactly 10 digits.</span>}</div>
                  <div className="al-field"><label>WhatsApp number</label><input value={brandForm.whatsapp} type="text" inputMode="numeric" pattern="[0-9]{10}" maxLength={10} placeholder="10-digit number" className={brandPhoneTouched.whatsapp && !isValidPhone(brandForm.whatsapp) ? 'al-input-invalid' : ''} aria-invalid={brandPhoneTouched.whatsapp && !isValidPhone(brandForm.whatsapp)} onBlur={() => setBrandPhoneTouched({ ...brandPhoneTouched, whatsapp: true })} onChange={(e) => { setBrandForm({ ...brandForm, whatsapp: digitsOnly(e.target.value, 10) }); setBrandPhoneTouched({ ...brandPhoneTouched, whatsapp: true }); }} />{brandPhoneTouched.whatsapp && !isValidPhone(brandForm.whatsapp) && <span className="al-field-error" role="alert">Enter exactly 10 digits.</span>}</div>
                  <div className="al-field">
                    <label htmlFor="alliance-brand-email">Email</label>
                    <input
                      id="alliance-brand-email"
                      type="email"
                      value={brandForm.email}
                      placeholder="name@example.com"
                      className={brandEmailTouched && !isValidEmail(brandForm.email) ? 'al-input-invalid' : ''}
                      aria-invalid={brandEmailTouched && !isValidEmail(brandForm.email)}
                      aria-describedby="alliance-brand-email-error"
                      onBlur={() => setBrandEmailTouched(true)}
                      onChange={(e) => {
                        setBrandForm({ ...brandForm, email: e.target.value });
                        if (e.target.value) setBrandEmailTouched(true);
                      }}
                    />
                    {brandEmailTouched && !isValidEmail(brandForm.email) && (
                      <span id="alliance-brand-email-error" className="al-field-error" role="alert">
                        Enter a complete email address, such as name@example.com.
                      </span>
                    )}
                  </div>
                </div>
                <div className="al-fields">
                  <div className="al-field"><label>Website</label><input value={brandForm.website} placeholder="example.com" onChange={(e) => setBrandForm({ ...brandForm, website: e.target.value })} /></div>
                  <div className="al-field">
                    <label htmlFor="alliance-business-hours">Business hours</label>
                    <input
                      id="alliance-business-hours"
                      value={brandForm.business_hours}
                      placeholder="10:00 AM - 8:00 PM"
                      className={businessHoursTouched && !isValidBusinessHours(brandForm.business_hours) ? 'al-input-invalid' : ''}
                      aria-invalid={businessHoursTouched && !isValidBusinessHours(brandForm.business_hours)}
                      aria-describedby="alliance-business-hours-error"
                      onBlur={() => {
                        setBusinessHoursTouched(true);
                        const normalized = normalizeBusinessHours(brandForm.business_hours);
                        if (normalized !== null) setBrandForm((current) => ({ ...current, business_hours: normalized }));
                      }}
                      onChange={(e) => {
                        setBrandForm({ ...brandForm, business_hours: e.target.value });
                        setBusinessHoursTouched(true);
                      }}
                    />
                    {businessHoursTouched && !isValidBusinessHours(brandForm.business_hours) && (
                      <span id="alliance-business-hours-error" className="al-field-error" role="alert">
                        Enter a range such as 10am-8pm, 10 AM to 8 PM, or 09:00-20:00.
                      </span>
                    )}
                  </div>
                  <div className="al-field"><label>Supported languages</label><LanguageTagInput value={brandForm.languages} onChange={(languages) => setBrandForm({ ...brandForm, languages })} /></div>
                </div>
                <div className="al-field"><label>Address</label><input value={brandForm.address} onChange={(e) => setBrandForm({ ...brandForm, address: e.target.value })} /></div>
                <div className="al-field"><label>Target customers</label><input value={brandForm.target_customers} placeholder="Students, job seekers, business owners" onChange={(e) => setBrandForm({ ...brandForm, target_customers: e.target.value })} /></div>
                <div className="al-fields">
                  <div className="al-field"><label>Primary contact person</label><input value={brandForm.primary_contact} onChange={(e) => setBrandForm({ ...brandForm, primary_contact: e.target.value })} /></div>
                  <div className="al-field"><label>Escalation contact person</label><input value={brandForm.escalation_contact} onChange={(e) => setBrandForm({ ...brandForm, escalation_contact: e.target.value })} /></div>
                  <div className="al-field"><label>Escalation phone</label><input value={brandForm.escalation_phone} type="text" inputMode="numeric" pattern="[0-9]{10}" maxLength={10} placeholder="10-digit number" className={brandPhoneTouched.escalation_phone && !isValidPhone(brandForm.escalation_phone) ? 'al-input-invalid' : ''} aria-invalid={brandPhoneTouched.escalation_phone && !isValidPhone(brandForm.escalation_phone)} onBlur={() => setBrandPhoneTouched({ ...brandPhoneTouched, escalation_phone: true })} onChange={(e) => { setBrandForm({ ...brandForm, escalation_phone: digitsOnly(e.target.value, 10) }); setBrandPhoneTouched({ ...brandPhoneTouched, escalation_phone: true }); }} />{brandPhoneTouched.escalation_phone && !isValidPhone(brandForm.escalation_phone) && <span className="al-field-error" role="alert">Enter exactly 10 digits.</span>}</div>
                </div>
                <div className="al-fields">
                  <div className="al-field"><label>Information verified by</label><input value={brandForm.verified_by} onChange={(e) => setBrandForm({ ...brandForm, verified_by: e.target.value })} /></div>
                  <div className="al-field"><label>Last verified date</label><DatePicker value={brandForm.last_verified_date} onChange={(value) => setBrandForm({ ...brandForm, last_verified_date: value })} /></div>
                </div>
              </div>
              <div className="al-brain-section">
                <b>General policies</b>
                <KeyValueEditor rows={brandPolicyRows} setRows={setBrandPolicyRows} templateLabel="policy" onLoadTemplate={() => {
                  const existing = new Set(brandPolicyRows.map((r) => r.key));
                  setBrandPolicyRows([...brandPolicyRows, ...POLICY_TEMPLATE.filter((k) => !existing.has(k)).map((k) => ({ key: k, value: '' }))]);
                }} />
              </div>
            </div>
            <footer>
              <button type="button" className="al-btn ghost" disabled={savingBrand} onClick={() => setEditingBrand(null)}>Cancel</button>
              <button type="submit" className="al-btn" disabled={savingBrand}>{savingBrand ? 'Saving…' : 'Save brand'}</button>
            </footer>
          </form>
        </div>
      )}

      {editingOffering && (
        <div className="al-wa-modal-backdrop" role="presentation" onMouseDown={() => !savingOffering && setEditingOffering(null)}>
          <form className="al-brain-modal" onSubmit={saveOffering} onMouseDown={(e) => e.stopPropagation()}>
            <header><b>{editingOffering === 'new' ? 'Add course/service' : `Edit ${editingOffering.name}`}</b>
              <button type="button" className="al-wa-detail-close" style={{ fontSize: 22, lineHeight: 1 }} onClick={() => setEditingOffering(null)} aria-label="Close">×</button>
            </header>
            <div className="al-brain-modal-body">
              <div className="al-brain-section">
                <b>Core details</b>
                <div className="al-fields">
                  <div className="al-field"><label>Offering code</label><input value={offeringForm.offering_code} placeholder="BMA-BC-001" onChange={(e) => setOfferingForm({ ...offeringForm, offering_code: e.target.value })} /></div>
                  <div className="al-field"><label>Type</label><select value={offeringForm.offering_type} onChange={(e) => setOfferingForm({ ...offeringForm, offering_type: e.target.value })}><option value="course">Course</option><option value="service">Service</option></select></div>
                  <div className="al-field"><label>Status</label><select value={offeringForm.status} onChange={(e) => setOfferingForm({ ...offeringForm, status: e.target.value })}><option value="active">Active</option><option value="inactive">Inactive</option></select></div>
                </div>
                <div className="al-field"><label>Name *</label><input required value={offeringForm.name} onChange={(e) => setOfferingForm({ ...offeringForm, name: e.target.value })} /></div>
                <div className="al-fields">
                  <div className="al-field"><label>Category</label><input value={offeringForm.category} onChange={(e) => setOfferingForm({ ...offeringForm, category: e.target.value })} /></div>
                  <div className="al-field"><label>Tier</label><input value={offeringForm.tier} onChange={(e) => setOfferingForm({ ...offeringForm, tier: e.target.value })} /></div>
                  <div className="al-field"><label>Duration</label><input value={offeringForm.duration} placeholder="10 days" onChange={(e) => setOfferingForm({ ...offeringForm, duration: e.target.value })} /></div>
                </div>
                <div className="al-field"><label>Fee (₹)</label><input value={offeringForm.fee} placeholder="3999" onChange={(e) => setOfferingForm({ ...offeringForm, fee: e.target.value })} /></div>
                <div className="al-field"><label>Short description</label><textarea style={{ minHeight: 80 }} value={offeringForm.short_description} onChange={(e) => setOfferingForm({ ...offeringForm, short_description: e.target.value })} /></div>
                <div className="al-fields">
                  <div className="al-field"><label>Information verified by</label><input value={offeringForm.verified_by} onChange={(e) => setOfferingForm({ ...offeringForm, verified_by: e.target.value })} /></div>
                  <div className="al-field"><label>Last verified date</label><DatePicker value={offeringForm.last_verified_date} onChange={(value) => setOfferingForm({ ...offeringForm, last_verified_date: value })} /></div>
                </div>
              </div>

              <div className="al-brain-section">
                <b>Additional details</b>
                <p style={{ color: 'var(--al-muted)', fontSize: 11.5, margin: '-4px 0 12px' }}>Eligibility, curriculum, refund policy, URLs, and anything else from your data sheet. Leave a value blank or write "needs_confirmation" for anything not finalized — the AI will tell leads to check with the team instead of guessing.</p>
                <KeyValueEditor
                  rows={offeringDetailRows}
                  setRows={setOfferingDetailRows}
                  templateLabel={offeringForm.offering_type === 'service' ? 'service' : 'course'}
                  onLoadTemplate={loadOfferingTemplate}
                />
              </div>

              <div className="al-brain-section">
                <b>Frequently asked questions</b>
                {editingOffering === 'new' ? (
                  <p style={{ color: 'var(--al-muted)', fontSize: 12 }}>Save this course/service first, then add its FAQs here.</p>
                ) : (
                  <>
                    {faqs.map((faq) => (
                      <div className="al-obj" key={faq.id}>
                        <div className="al-obj-q"><span className="qm">"</span>{faq.question}</div>
                        <div className="al-obj-a">{faq.answer}</div>
                        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
                          <button type="button" className="al-btn ghost sm" style={{ color: '#ff8f8f' }} onClick={() => setDeletingFaq(faq)}>Delete</button>
                        </div>
                      </div>
                    ))}
                    <div className="al-fields" style={{ marginTop: 4 }}>
                      <div className="al-field"><label>New question</label><input value={newFaq.question} onChange={(e) => setNewFaq({ ...newFaq, question: e.target.value })} /></div>
                    </div>
                    <div className="al-field"><label>Answer</label><textarea style={{ minHeight: 70 }} value={newFaq.answer} onChange={(e) => setNewFaq({ ...newFaq, answer: e.target.value })} /></div>
                    <button type="button" className="al-btn ghost sm" disabled={savingFaq} onClick={addFaq}>{savingFaq ? 'Adding…' : '+ Add FAQ'}</button>
                  </>
                )}
              </div>
            </div>
            <footer>
              <button type="button" className="al-btn ghost" disabled={savingOffering} onClick={() => setEditingOffering(null)}>Close</button>
              <button type="submit" className="al-btn" disabled={savingOffering}>{savingOffering ? 'Saving…' : editingOffering === 'new' ? 'Save course/service' : 'Save changes'}</button>
            </footer>
          </form>
        </div>
      )}

      {viewingOffering && (
        <div className="al-wa-modal-backdrop" role="presentation" onMouseDown={() => setViewingOffering(null)}>
          <div className="al-brain-modal al-brain-view-modal" role="dialog" aria-modal="true" aria-labelledby="offering-view-title" onMouseDown={(e) => e.stopPropagation()}>
            <header>
              <div>
                <b id="offering-view-title">{viewingOffering.name}</b>
                <small>{viewingOffering.offering_code || 'No code'} · {viewingOffering.offering_type || 'Course'}</small>
              </div>
              <button type="button" className="al-wa-detail-close" onClick={() => setViewingOffering(null)} aria-label="Close">×</button>
            </header>
            <div className="al-brain-modal-body">
              <section className="al-brain-section">
                <b>Course/service summary</b>
                <div className="al-brain-view-grid">
                  <div><span>Code</span><strong>{viewingOffering.offering_code || 'Not provided'}</strong></div>
                  <div><span>Type</span><strong>{viewingOffering.offering_type || 'Not provided'}</strong></div>
                  <div><span>Category</span><strong>{viewingOffering.category || 'Not provided'}</strong></div>
                  <div><span>Tier</span><strong>{viewingOffering.tier || 'Not provided'}</strong></div>
                  <div><span>Fee</span><strong>{viewingOffering.fee ? `₹${viewingOffering.fee}` : 'Not provided'}</strong></div>
                  <div><span>Duration</span><strong>{viewingOffering.duration || 'Not provided'}</strong></div>
                  <div><span>Status</span><strong className={`al-brain-view-status ${viewingOffering.status === 'active' ? 'active' : ''}`}>{viewingOffering.status || 'Not provided'}</strong></div>
                </div>
                <div className="al-brain-view-description">
                  <span>Short description</span>
                  <p>{viewingOffering.short_description || 'Not provided'}</p>
                </div>
              </section>

              <section className="al-brain-section">
                <b>Full details</b>
                {Object.entries(viewingOffering.details || {}).length ? (
                  <dl className="al-brain-detail-list">
                    {Object.entries(viewingOffering.details || {}).map(([key, value]) => {
                      const displayValue = String(value || '').trim();
                      const isUrl = /^https?:\/\/\S+$/i.test(displayValue);
                      return (
                        <div key={key}>
                          <dt>{key}</dt>
                          <dd>{isUrl ? <a href={displayValue} target="_blank" rel="noreferrer">{displayValue}</a> : (displayValue || 'Not provided')}</dd>
                        </div>
                      );
                    })}
                  </dl>
                ) : <div className="al-brain-view-empty">No additional details have been added.</div>}
              </section>

              <section className="al-brain-section">
                <b>Frequently asked questions ({viewingOffering.faq_count || viewingFaqs.length})</b>
                {loadingViewingFaqs ? <div className="al-brain-view-empty">Loading FAQs...</div> : viewingFaqs.length ? viewingFaqs.map((faq) => (
                  <div className="al-obj" key={faq.id}>
                    <div className="al-obj-q">{faq.question}</div>
                    <div className="al-obj-a">{faq.answer}</div>
                  </div>
                )) : <div className="al-brain-view-empty">No FAQs have been added.</div>}
              </section>

              <section className="al-brain-section">
                <b>Verification</b>
                <div className="al-brain-view-grid">
                  <div><span>Verified by</span><strong>{viewingOffering.verified_by || 'Not provided'}</strong></div>
                  <div><span>Last verified</span><strong>{viewingOffering.last_verified_date ? String(viewingOffering.last_verified_date).slice(0, 10) : 'Not provided'}</strong></div>
                </div>
              </section>
            </div>
            <footer>
              <button type="button" className="al-btn ghost" onClick={() => setViewingOffering(null)}>Close</button>
              <button type="button" className="al-btn" onClick={() => { const offering = viewingOffering; setViewingOffering(null); openEditOffering(offering); }}>Edit course/service</button>
            </footer>
          </div>
        </div>
      )}

      {showBulkImport && (
        <div className="al-wa-modal-backdrop" role="presentation" onMouseDown={() => !bulkImporting && setShowBulkImport(false)}>
          <form className="al-brain-modal" onSubmit={runBulkImport} onMouseDown={(e) => e.stopPropagation()}>
            <header><b>Bulk import for {activeBrand?.name}</b>
              <button type="button" className="al-wa-detail-close" style={{ fontSize: 22, lineHeight: 1 }} onClick={() => setShowBulkImport(false)} aria-label="Close">×</button>
            </header>
            <div className="al-brain-modal-body">
              <div className="al-brain-section">
                <p style={{ color: 'var(--al-muted)', fontSize: 12, margin: '0 0 12px', lineHeight: 1.6 }}>
                  Paste the full document with many courses or services at once (e.g. your whole "Part 3" section). Each record is detected by its own "Course ID:" or "SERVICE DETAILS" marker and sent to the AI separately, so accuracy per record stays high even for large pastes. Core fields (name, code, category, fee, duration) fill the table; everything else becomes "Additional details" on each offering, and any FAQ section gets imported too.
                </p>
                <div className="al-field">
                  <textarea
                    style={{ minHeight: 260 }}
                    value={bulkImportText}
                    placeholder="Paste multiple course/service records here…"
                    onChange={(e) => setBulkImportText(e.target.value)}
                  />
                </div>
                <button type="submit" className="al-btn sm" disabled={bulkImporting} style={{ marginTop: 10 }}>
                  {bulkImporting ? 'Importing… this can take a minute for many records' : 'Import with AI'}
                </button>
              </div>

              {bulkImportResult && (
                <div className="al-brain-section">
                  <b>Results ({bulkImportResult.created.length} of {bulkImportResult.total_blocks} imported)</b>
                  {bulkImportResult.created.map((item) => (
                    <div key={item.id} className="al-obj" style={{ borderLeft: '3px solid var(--al-green)' }}>
                      <div className="al-obj-q" style={{ color: 'var(--al-ink)' }}>{item.name}</div>
                      <div className="al-obj-meta">{item.faq_count} FAQ{item.faq_count === 1 ? '' : 's'} imported</div>
                    </div>
                  ))}
                  {bulkImportResult.failed.map((item, index) => (
                    <div key={index} className="al-obj" style={{ borderLeft: '3px solid #ef7b7b' }}>
                      <div className="al-obj-q" style={{ color: '#ff8f8f' }}>Failed: {item.error}</div>
                      <div className="al-obj-a">{item.preview}…</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <footer>
              <button type="button" className="al-btn ghost" disabled={bulkImporting} onClick={() => setShowBulkImport(false)}>{bulkImportResult ? 'Done' : 'Cancel'}</button>
            </footer>
          </form>
        </div>
      )}

      {deletingBrand && (
        <div className="al-wa-modal-backdrop" role="presentation" onMouseDown={() => setDeletingBrand(null)}>
          <div className="al-wa-modal" role="dialog" aria-modal="true" onMouseDown={(e) => e.stopPropagation()}>
            <div className="al-wa-modal-icon" style={{ fontSize: 20, fontWeight: 700 }}>!</div>
            <h2>Delete {deletingBrand.name}?</h2>
            <p>All of its courses/services and FAQs will be removed too. This cannot be undone.</p>
            <footer>
              <button className="al-btn ghost" type="button" onClick={() => setDeletingBrand(null)}>Cancel</button>
              <button className="al-btn al-wa-confirm-delete" type="button" onClick={confirmDeleteBrand}>Delete brand</button>
            </footer>
          </div>
        </div>
      )}

      {deletingOffering && (
        <div className="al-wa-modal-backdrop" role="presentation" onMouseDown={() => setDeletingOffering(null)}>
          <div className="al-wa-modal" role="dialog" aria-modal="true" onMouseDown={(e) => e.stopPropagation()}>
            <div className="al-wa-modal-icon" style={{ fontSize: 20, fontWeight: 700 }}>!</div>
            <h2>Delete {deletingOffering.name}?</h2>
            <p>Its FAQs will be removed too. This cannot be undone.</p>
            <footer>
              <button className="al-btn ghost" type="button" onClick={() => setDeletingOffering(null)}>Cancel</button>
              <button className="al-btn al-wa-confirm-delete" type="button" onClick={confirmDeleteOffering}>Delete</button>
            </footer>
          </div>
        </div>
      )}

      {deletingFaq && (
        <div className="al-wa-modal-backdrop" role="presentation" onMouseDown={() => setDeletingFaq(null)}>
          <div className="al-wa-modal" role="dialog" aria-modal="true" onMouseDown={(e) => e.stopPropagation()}>
            <div className="al-wa-modal-icon" style={{ fontSize: 20, fontWeight: 700 }}>!</div>
            <h2>Delete this FAQ?</h2>
            <p>This cannot be undone.</p>
            <footer>
              <button className="al-btn ghost" type="button" onClick={() => setDeletingFaq(null)}>Cancel</button>
              <button className="al-btn al-wa-confirm-delete" type="button" onClick={confirmDeleteFaq}>Delete</button>
            </footer>
          </div>
        </div>
      )}
    </div>
  );
};
