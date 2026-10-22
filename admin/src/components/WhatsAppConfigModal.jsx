import React, { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { FiPhone, FiKey, FiHash, FiShield, FiCheckCircle, FiClock, FiXCircle, FiMinusCircle } from 'react-icons/fi';
import { FaWhatsapp } from 'react-icons/fa';
import axiosClient from '../api/axiosClient';
import { FormField, IconInput } from './FormField';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { cn } from '@/lib/utils';

const STATUS_META = {
  verified: { label: 'Verified · service enabled', className: 'border-green-200 bg-green-50 text-green-700', icon: <FiCheckCircle /> },
  verification_pending: { label: 'Verification pending', className: 'border-amber-200 bg-amber-50 text-amber-700', icon: <FiClock /> },
  verification_failed: { label: 'Verification failed', className: 'border-red-200 bg-red-50 text-red-700', icon: <FiXCircle /> },
  not_configured: { label: 'Not configured', className: 'border-slate-200 bg-slate-50 text-slate-500', icon: <FiMinusCircle /> },
};

const REQUIRED = {
  whatsapp_number: 'WhatsApp number is required',
  phone_number_id: 'Meta Phone Number ID is required',
  wa_business_id: 'WABA ID is required',
};

// Workspaces own their WhatsApp credentials through the same `clients` row
// (and the same /api/clients endpoints) the main LeadOS app already uses for
// its verified Meta WhatsApp flow, so this reuses that flow instead of a
// separate config store per tenant.
const WhatsAppConfigModal = ({ tenantId, tenantName, onClose }) => {
  const [values, setValues] = useState({ whatsapp_number: '', phone_number_id: '', wa_access_token: '', wa_business_id: '' });
  const [errors, setErrors] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [activeClient, setActiveClient] = useState(null);

  const loadClient = async () => {
    setLoading(true);
    try {
      const res = await axiosClient.get(`/admin/tenants/${tenantId}`);
      const brand = res.data.brand || null;
      setActiveClient(brand);
      setValues({
        whatsapp_number: brand?.whatsapp_number || '',
        phone_number_id: brand?.phone_number_id || '',
        wa_access_token: '',
        wa_business_id: brand?.wa_business_id || '',
      });
    } catch (err) {
      toast.error('Failed to load workspace WhatsApp config');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (tenantId) loadClient();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId]);

  const set = (key, value) => {
    setValues((v) => ({ ...v, [key]: value }));
    setErrors((e) => ({ ...e, [key]: undefined }));
  };

  const handleSave = async (e) => {
    e.preventDefault();
    const nextErrors = {};
    Object.entries(REQUIRED).forEach(([key, msg]) => {
      if (!String(values[key] || '').trim()) nextErrors[key] = msg;
    });
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) return;

    setSaving(true);
    try {
      const payload = {
        whatsapp_number: values.whatsapp_number,
        phone_number_id: values.phone_number_id,
        wa_business_id: values.wa_business_id,
      };
      if (values.wa_access_token) {
        payload.wa_access_token = values.wa_access_token;
      }
      const res = await axiosClient.put(`/admin/tenants/${tenantId}/whatsapp`, payload);
      setActiveClient(res.data.brand);
      set('wa_access_token', '');
      toast.success('WhatsApp credentials updated and encrypted for this workspace');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to save WhatsApp config');
    } finally {
      setSaving(false);
    }
  };

  const handleVerify = async () => {
    setVerifying(true);
    try {
      const res = await axiosClient.post(`/admin/tenants/${tenantId}/whatsapp/verify`);
      setActiveClient(res.data.brand);
      toast.success('WhatsApp verified and enabled for this workspace');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Meta verification failed');
    } finally {
      setVerifying(false);
    }
  };

  if (loading) {
    return <div className="flex justify-center py-12"><Spinner className="size-7 text-primary" /></div>;
  }

  const status = STATUS_META[activeClient?.whatsapp_status] || STATUS_META.not_configured;

  return (
    <div>
      <div className="mb-5 flex items-center gap-2.5 border-b border-border pb-4 pr-6">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-green-50">
          <FaWhatsapp size={19} color="#25D366" />
        </div>
        <div>
          <div className="text-[13px] font-semibold">{tenantName}</div>
          <div className="text-[11.5px] text-slate-400">Own credentials for this workspace — never the shared platform .env</div>
        </div>
      </div>

      <div className={cn('mb-5 flex items-center gap-2 rounded-lg border px-3.5 py-2 text-[12.5px] font-semibold', status.className)}>
        {status.icon}
        {status.label}
      </div>

      <form onSubmit={handleSave} noValidate className="flex flex-col gap-4">
        <FormField label="WhatsApp Number" htmlFor="wa-number" error={errors.whatsapp_number}>
          <IconInput id="wa-number" icon={FiPhone} placeholder="+91 98765 43210" value={values.whatsapp_number} onChange={(e) => set('whatsapp_number', e.target.value)} />
        </FormField>
        <FormField label="Meta Phone Number ID" htmlFor="wa-phone-id" error={errors.phone_number_id}>
          <IconInput id="wa-phone-id" icon={FiHash} placeholder="15-digit ID from Meta" value={values.phone_number_id} onChange={(e) => set('phone_number_id', e.target.value)} />
        </FormField>
        <FormField
          label="Meta Access Token"
          htmlFor="wa-token"
          hint={activeClient?.wa_token_configured ? `Token is saved and encrypted (ends in ${activeClient.wa_token_last4 || '••••'}). Leave blank to keep current token.` : 'Enter system user access token'}
        >
          <IconInput
            id="wa-token"
            type="password"
            autoComplete="off"
            icon={FiKey}
            placeholder={activeClient?.wa_token_configured ? '••••••••••••••••' : 'EAAG...'}
            value={values.wa_access_token}
            onChange={(e) => set('wa_access_token', e.target.value)}
          />
        </FormField>
        <FormField label="WABA ID" htmlFor="wa-waba" error={errors.wa_business_id}>
          <IconInput id="wa-waba" icon={FiShield} placeholder="WhatsApp Business Account ID" value={values.wa_business_id} onChange={(e) => set('wa_business_id', e.target.value)} />
        </FormField>

        <div className="mt-1 flex flex-wrap justify-end gap-2.5">
          <Button type="button" variant="outline" onClick={onClose}>Close</Button>
          {activeClient?.phone_number_id && activeClient?.whatsapp_number && (
            <Button type="button" variant="outline" onClick={handleVerify} disabled={verifying}>
              {verifying && <Spinner />}
              {activeClient.whatsapp_status === 'verified' ? 'Re-verify with Meta' : 'Verify & Enable'}
            </Button>
          )}
          <Button type="submit" disabled={saving} className="bg-[#25D366] text-white hover:bg-[#1fb857]">
            {saving && <Spinner />} Save Config
          </Button>
        </div>
      </form>
    </div>
  );
};

export default WhatsAppConfigModal;
