import React, { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { FiKey, FiHash, FiShield, FiPhone, FiLock } from 'react-icons/fi';
import axiosClient from '../../api/axiosClient';
import { useLiveEvent } from '../../api/realtime';
import { FormField, IconInput } from '../FormField';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Spinner } from '@/components/ui/spinner';
import { cn } from '@/lib/utils';
import { EMPTY_CONNECTION, connectionBadge, saveOutcome, validateConnection } from './connectForm';

const TONES = {
  ok: 'border-green-200 bg-green-50 text-green-700',
  warn: 'border-amber-200 bg-amber-50 text-amber-700',
  bad: 'border-red-200 bg-red-50 text-red-700',
  muted: 'border-slate-200 bg-slate-50 text-slate-500',
};

const Badge = ({ row }) => {
  const { label, tone } = connectionBadge(row);
  return <span className={cn('inline-flex rounded-full border px-2.5 py-0.5 text-[11.5px] font-semibold', TONES[tone])}>{label}</span>;
};

// The write-only form: it never shows a saved token, not even its last
// characters. To change a token, all four details are entered again.
const ConnectForm = ({ row, onSaved, onClose }) => {
  const [values, setValues] = useState({ ...EMPTY_CONNECTION });
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setValues({ ...EMPTY_CONNECTION });
    setErrors({});
    axiosClient.get(`/admin/tenants/${row.tenant_id}/onboarding/whatsapp`)
      .then((res) => { if (!cancelled) setSaved(res.data); })
      .catch(() => { if (!cancelled) setSaved(null); });
    return () => { cancelled = true; };
  }, [row.tenant_id]);

  const set = (key, value) => {
    setValues((current) => ({ ...current, [key]: value }));
    setErrors((current) => ({ ...current, [key]: undefined }));
  };

  const submit = async (event) => {
    event.preventDefault();
    const check = validateConnection(values);
    setErrors(check.errors);
    if (!check.ok) return;
    setSaving(true);
    try {
      const res = await axiosClient.put(`/admin/tenants/${row.tenant_id}/onboarding/whatsapp`, values);
      const outcome = saveOutcome(res.data);
      toast[outcome.kind](outcome.text);
      // Forget the token the moment it is saved.
      setValues({ ...EMPTY_CONNECTION });
      setSaved(res.data);
      onSaved();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Could not save the WhatsApp details');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{row.tenant_name}</CardTitle>
        <CardDescription>
          Enter the customer's WhatsApp Business account details. The token is encrypted when saved and is never shown again.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {saved?.configured && (
          <div className="mb-4 flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-[12.5px] text-slate-600">
            <FiLock /> Details are saved for {saved.whatsapp_number ? `+${saved.whatsapp_number}` : 'this workspace'} (token hidden). Enter all four again to replace them.
          </div>
        )}
        <form onSubmit={submit} noValidate autoComplete="off" className="flex max-w-lg flex-col gap-4">
          <FormField label="WhatsApp number" htmlFor="ob-number" error={errors.whatsapp_number}>
            <IconInput id="ob-number" icon={FiPhone} placeholder="+91 98765 43210" value={values.whatsapp_number} onChange={(e) => set('whatsapp_number', e.target.value)} />
          </FormField>
          <FormField label="Meta Phone Number ID" htmlFor="ob-phone-id" error={errors.phone_number_id}>
            <IconInput id="ob-phone-id" icon={FiHash} value={values.phone_number_id} onChange={(e) => set('phone_number_id', e.target.value)} />
          </FormField>
          <FormField label="WhatsApp Business Account ID" htmlFor="ob-waba" error={errors.wa_business_id}>
            <IconInput id="ob-waba" icon={FiShield} value={values.wa_business_id} onChange={(e) => set('wa_business_id', e.target.value)} />
          </FormField>
          <FormField label="Access token" htmlFor="ob-token" error={errors.wa_access_token} hint="Paste the customer's system user token. It is hidden once saved.">
            <IconInput id="ob-token" type="password" autoComplete="new-password" icon={FiKey} placeholder="EAAG…" value={values.wa_access_token} onChange={(e) => set('wa_access_token', e.target.value)} />
          </FormField>
          <div className="flex justify-end gap-2.5">
            <Button type="button" variant="outline" onClick={onClose}>Close</Button>
            <Button type="submit" disabled={saving} className="bg-[#25D366] text-white hover:bg-[#1fb857]">
              {saving && <Spinner />} Save and verify
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
};

// Staff-only: customers whose WhatsApp is not connected yet, those who asked
// first, and the form to connect one.
const OnboardingQueue = () => {
  const [rows, setRows] = useState(null);
  const [selected, setSelected] = useState(null);

  const load = useCallback(async () => {
    try {
      const res = await axiosClient.get('/admin/onboarding/whatsapp-queue');
      setRows(res.data.queue || []);
    } catch (err) {
      setRows([]);
      toast.error(err.response?.data?.error || 'Could not load the onboarding queue');
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  useLiveEvent('onboarding_whatsapp_requested', () => load());

  if (rows === null) return <div className="flex justify-center py-12"><Spinner className="size-7 text-primary" /></div>;
  const current = selected && rows.find((row) => row.tenant_id === selected);

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Waiting for WhatsApp</CardTitle>
          <CardDescription>Customers who asked for our team to connect their number come first.</CardDescription>
        </CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nobody is waiting. Every workspace has WhatsApp connected.</p>
          ) : (
            <ul className="divide-y divide-border">
              {rows.map((row) => (
                <li key={row.tenant_id}>
                  <button
                    type="button"
                    onClick={() => setSelected(row.tenant_id)}
                    className={cn('flex w-full items-center justify-between gap-3 px-2 py-3 text-left hover:bg-muted/50', selected === row.tenant_id && 'bg-muted/60')}
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-semibold">{row.tenant_name}</span>
                      <span className="block text-xs text-muted-foreground">
                        {row.requested_at ? `Asked ${new Date(row.requested_at).toLocaleString()}` : 'Has not asked yet'}
                      </span>
                    </span>
                    <Badge row={row} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
      {current ? (
        <ConnectForm key={current.tenant_id} row={current} onSaved={load} onClose={() => setSelected(null)} />
      ) : (
        <p className="self-center text-sm text-muted-foreground">Choose a customer to enter their WhatsApp details.</p>
      )}
    </div>
  );
};

export default OnboardingQueue;
