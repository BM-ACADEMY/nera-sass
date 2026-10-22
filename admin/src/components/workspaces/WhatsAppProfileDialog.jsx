import React, { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { FiUpload, FiExternalLink, FiAlertTriangle, FiCheckCircle } from 'react-icons/fi';
import { FaWhatsapp } from 'react-icons/fa';
import axiosClient from '../../api/axiosClient';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

const apiError = (err, fallback) => err.response?.data?.error || fallback;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const URL_RE = /^https?:\/\/[^\s/$.?#].[^\s]*$/i;

const NAME_STATUS = {
  APPROVED: ['success', 'Approved'],
  AVAILABLE_WITHOUT_REVIEW: ['success', 'Approved'],
  PENDING_REVIEW: ['warning', 'In review'],
  DECLINED: ['danger', 'Rejected'],
  REJECTED: ['danger', 'Rejected'],
};

// One block of the form, laid out like Meta's own profile page.
const Block = ({ title, hint, children }) => (
  <div className="flex flex-col gap-2 border-b border-border py-4 last:border-b-0">
    <div>
      <div className="text-sm font-semibold">{title}</div>
      {hint && <div className="text-xs text-muted-foreground">{hint}</div>}
    </div>
    {children}
  </div>
);

// A text input with Meta's "x/limit" counter on the right.
const Counted = ({ id, value, onChange, limit, placeholder, multiline = false, error, disabled }) => {
  const Comp = multiline ? Textarea : Input;
  return (
    <div className="flex flex-col gap-1">
      <div className="relative">
        <Comp
          id={id}
          value={value}
          onChange={onChange}
          maxLength={limit}
          placeholder={placeholder}
          disabled={disabled}
          rows={multiline ? 3 : undefined}
          className={cn(multiline ? 'pr-16' : 'h-10 pr-16', error && 'border-red-400')}
        />
        <span className="pointer-events-none absolute top-2.5 right-3 text-[11px] text-muted-foreground tabular-nums">{value.length}/{limit}</span>
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
};

// The WhatsApp Business profile customers see, read from and saved to Meta.
const WhatsAppProfileDialog = ({ open, onOpenChange, tenantId, onSaved }) => {
  const [data, setData] = useState(null);
  const [values, setValues] = useState(null);
  const [errors, setErrors] = useState({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef(null);

  const load = async () => {
    setLoading(true);
    try {
      const res = await axiosClient.get(`/admin/tenants/${tenantId}/whatsapp-profile`);
      setData(res.data);
      setValues({ ...res.data.profile, websites: [...res.data.profile.websites] });
      setErrors({});
    } catch (err) {
      toast.error(apiError(err, 'Failed to load the WhatsApp profile'));
      onOpenChange(false);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open) load();
    else { setData(null); setValues(null); }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = (key) => (e) => {
    const value = typeof e === 'string' ? e : e.target.value;
    setValues((v) => ({ ...v, [key]: value }));
    setErrors((er) => ({ ...er, [key]: undefined }));
  };
  const setWebsite = (i) => (e) => {
    const next = [...values.websites];
    next[i] = e.target.value;
    setValues((v) => ({ ...v, websites: next }));
    setErrors((er) => ({ ...er, [`website${i}`]: undefined }));
  };

  const save = async () => {
    const next = {};
    if (values.email.trim() && !EMAIL_RE.test(values.email.trim())) next.email = 'Enter a valid email address';
    values.websites.forEach((w, i) => {
      if (w.trim() && !URL_RE.test(w.trim())) next[`website${i}`] = 'Start with https://, for example https://www.example.com';
    });
    setErrors(next);
    if (Object.keys(next).length) return;
    setSaving(true);
    try {
      const { data: result } = await axiosClient.put(`/admin/tenants/${tenantId}/whatsapp-profile`, {
        vertical: values.vertical,
        description: values.description,
        address: values.address,
        email: values.email,
        websites: values.websites,
      });
      if (result.saved_to_meta) toast.success('Profile saved and updated on WhatsApp');
      else toast.success('Profile saved in Getnera. It goes to WhatsApp once the number is connected.');
      onSaved?.();
      await load();
    } catch (err) {
      toast.error(apiError(err, 'Failed to update the WhatsApp profile'));
    } finally {
      setSaving(false);
    }
  };

  const uploadPhoto = async (file) => {
    if (!file) return;
    if (!['image/jpeg', 'image/png'].includes(file.type)) return toast.error('Choose a JPEG or PNG image');
    if (file.size > 5 * 1024 * 1024) return toast.error('The image must be 5 MB or smaller');
    const form = new FormData();
    form.append('photo', file);
    setUploading(true);
    try {
      const res = await axiosClient.post(`/admin/tenants/${tenantId}/whatsapp-profile/photo`, form, { headers: { 'Content-Type': 'multipart/form-data' } });
      setValues((v) => ({ ...v, profile_picture_url: res.data.profile_picture_url || v.profile_picture_url }));
      toast.success('Profile picture updated on WhatsApp');
      onSaved?.();
    } catch (err) {
      toast.error(apiError(err, 'Failed to upload the picture'));
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const editable = Boolean(data?.can_sync);
  const disabled = saving;
  const managerLink = (text) => (
    <a href={data?.manager_url} target="_blank" rel="noreferrer" className="inline-flex w-fit items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-semibold hover:bg-muted">
      {text} <FiExternalLink />
    </a>
  );
  const [nameVariant, nameText] = NAME_STATUS[data?.number?.name_status] || ['muted', data?.number?.name_status ? data.number.name_status.toLowerCase() : 'Unknown'];

  return (
    <Dialog open={open} onOpenChange={(o) => !saving && !uploading && onOpenChange(o)}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><FaWhatsapp className="text-[#25D366]" /> WhatsApp business profile</DialogTitle>
          <DialogDescription>
            What customers see when they open this workspace's WhatsApp chat. Saving updates it on Meta.
          </DialogDescription>
        </DialogHeader>

        {loading || !values ? (
          <div className="flex flex-col gap-4 py-2">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : (
          <>
            {!editable && (
              <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
                <FiAlertTriangle className="mt-0.5 shrink-0" />
                <span>{data.blocked_reason} You can still edit and save; it is sent to WhatsApp once this is fixed. The picture needs a connected number.</span>
              </div>
            )}
            {editable && data.source === 'meta' && (
              <div className="flex items-center gap-2 text-xs text-green-700">
                <FiCheckCircle /> Loaded live from Meta for {data.number?.display_phone_number}
              </div>
            )}
            {editable && data.meta_error && (
              <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
                <FiAlertTriangle className="mt-0.5 shrink-0" />
                <span>Meta did not return the current profile ({data.meta_error}). Showing the last saved values; saving still sends them to Meta.</span>
              </div>
            )}

            <div className="flex flex-col">
              <Block title="Profile picture" hint="This will be visible on your business profile. JPEG or PNG, at least 192 x 192, up to 5 MB.">
                <div className="flex items-center gap-4">
                  {values.profile_picture_url
                    ? <img src={values.profile_picture_url} alt="" className="size-16 rounded-full border border-border object-cover" />
                    : <span className="flex size-16 items-center justify-center rounded-full bg-muted text-muted-foreground"><FaWhatsapp size={26} /></span>}
                  <input ref={fileRef} type="file" accept="image/jpeg,image/png" className="hidden" onChange={(e) => uploadPhoto(e.target.files?.[0])} />
                  <Button type="button" variant="outline" size="sm" disabled={!editable || uploading} onClick={() => fileRef.current?.click()}>
                    {uploading ? <Spinner /> : <FiUpload />} {uploading ? 'Uploading...' : 'Choose file'}
                  </Button>
                </div>
              </Block>

              <Block title="Display name" hint="The business name shown in WhatsApp. Changing it needs Meta's review, so it is done in WhatsApp Manager.">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium">{data.number?.verified_name || 'Not set'}</span>
                  {data.number && <Badge variant={nameVariant}>{nameText}</Badge>}
                </div>
                {managerLink('Edit in WhatsApp Manager')}
              </Block>

              <Block title="Username and official business account" hint="Usernames and the blue checkmark are requested in WhatsApp Manager; Meta does not allow them through the API.">
                {managerLink('Open WhatsApp Manager')}
              </Block>

              <Block title="Business information" hint="Add some details about your business.">
                <div className="flex flex-col gap-4">
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="wp-cat" className="text-xs">Category</Label>
                    <Select value={values.vertical} onValueChange={set('vertical')} disabled={disabled}>
                      <SelectTrigger id="wp-cat" className="h-10"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {data.categories.map((c) => <SelectItem key={c.code} value={c.code}>{c.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="wp-desc" className="text-xs">Description · Optional</Label>
                    <Counted id="wp-desc" multiline value={values.description} onChange={set('description')} limit={data.limits.description} disabled={disabled} />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="wp-addr" className="text-xs">Address · Optional</Label>
                    <Counted id="wp-addr" value={values.address} onChange={set('address')} limit={data.limits.address} disabled={disabled} />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="wp-email" className="text-xs">Email · Optional</Label>
                    <Counted id="wp-email" value={values.email} onChange={set('email')} limit={data.limits.email} error={errors.email} disabled={disabled} />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="wp-web0" className="text-xs">Website · Optional</Label>
                    {[0, 1].map((i) => (
                      <Counted key={i} id={`wp-web${i}`} value={values.websites[i] || ''} onChange={setWebsite(i)} limit={data.limits.website} placeholder="https://www.example.com" error={errors[`website${i}`]} disabled={disabled} />
                    ))}
                  </div>
                </div>
              </Block>

              <Block title="Social accounts" hint="Facebook Page and Instagram are connected in WhatsApp Manager.">
                {managerLink('Connect in WhatsApp Manager')}
              </Block>
            </div>

            <div className="sticky bottom-0 -mx-6 -mb-6 flex justify-end gap-2 border-t border-border bg-background px-6 py-4">
              <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving || uploading}>Close</Button>
              <Button onClick={save} disabled={disabled}>{saving && <Spinner />} {editable ? 'Save to WhatsApp' : 'Save'}</Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default WhatsAppProfileDialog;
