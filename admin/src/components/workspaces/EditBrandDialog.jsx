import React, { useEffect, useState } from 'react';
import { toast } from 'sonner';
import axiosClient from '../../api/axiosClient';
import { FormField } from '../FormField';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { Textarea } from '@/components/ui/textarea';

// WhatsApp Business profile categories (the values Meta accepts).
const CATEGORIES = [
  ['OTHER', 'Other'],
  ['Matrimonial service', 'Matrimonial service'],
  ['Finance and banking', 'Finance and banking'],
  ['Food and groceries', 'Food and groceries'],
  ['Hotel and lodging', 'Hotel and lodging'],
  ['Medical and health', 'Medical and health'],
  ['Professional services', 'Professional services'],
  ['Shopping and retail', 'Shopping and retail'],
  ['Travel and transportation', 'Travel and transportation'],
  ['Restaurant', 'Restaurant'],
  ['Government', 'Government'],
  ['Charity', 'Charity'],
];

const FIELDS = ['name', 'wa_category', 'wa_description', 'wa_email', 'wa_website', 'wa_address', 'city', 'phone', 'contact_person', 'industry'];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const toForm = (brand) => Object.fromEntries(FIELDS.map((f) => [f, brand?.[f] ?? (f === 'wa_category' ? 'OTHER' : '')]));

// Staff edit a workspace's brand profile (what customers see on WhatsApp and
// in the app). Only changed fields are sent; the change is audited.
const EditBrandDialog = ({ open, onOpenChange, tenantId, brand, onSaved }) => {
  const [values, setValues] = useState(toForm(brand));
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setValues(toForm(brand));
      setErrors({});
    }
  }, [open, brand]);

  const set = (key) => (e) => {
    const value = typeof e === 'string' ? e : e.target.value;
    setValues((v) => ({ ...v, [key]: value }));
    setErrors((er) => ({ ...er, [key]: undefined }));
  };

  const submit = async (e) => {
    e.preventDefault();
    const next = {};
    if (!values.name.trim()) next.name = 'Brand name is required';
    if (values.wa_email.trim() && !EMAIL_RE.test(values.wa_email.trim())) next.wa_email = 'Enter a valid email';
    if (values.wa_website.trim() && !/^https?:\/\/\S+\.\S+/i.test(values.wa_website.trim())) next.wa_website = 'Start with https://, for example https://example.com';
    if (values.wa_description.length > 512) next.wa_description = 'At most 512 characters';
    setErrors(next);
    if (Object.keys(next).length) return;

    const original = toForm(brand);
    const changes = Object.fromEntries(FIELDS
      .map((f) => [f, typeof values[f] === 'string' ? values[f].trim() : values[f]])
      .filter(([f, v]) => String(v ?? '') !== String(original[f] ?? '')));
    if (!Object.keys(changes).length) {
      onOpenChange(false);
      return;
    }

    setSaving(true);
    try {
      await axiosClient.patch(`/admin/tenants/${tenantId}/brand`, changes);
      toast.success('Brand profile updated');
      onOpenChange(false);
      onSaved?.();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to update the brand profile');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !saving && onOpenChange(o)}>
      <DialogContent className="sm:max-w-2xl">
        <form onSubmit={submit} noValidate className="flex flex-col gap-5">
          <DialogHeader>
            <DialogTitle>Edit brand profile</DialogTitle>
            <DialogDescription>
              The business details of this workspace. Saved here and recorded in the activity log.
            </DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FormField label="Brand / business name" htmlFor="b-name" error={errors.name}>
              <Input id="b-name" value={values.name} onChange={set('name')} />
            </FormField>
            <FormField label="WhatsApp category" htmlFor="b-cat">
              <Select value={values.wa_category || 'OTHER'} onValueChange={set('wa_category')}>
                <SelectTrigger id="b-cat" className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CATEGORIES.map(([value, text]) => <SelectItem key={value} value={value}>{text}</SelectItem>)}
                </SelectContent>
              </Select>
            </FormField>
            <div className="sm:col-span-2">
              <FormField label="Description" htmlFor="b-desc" error={errors.wa_description} hint={`${values.wa_description.length}/512 · shown on the WhatsApp business profile`}>
                <Textarea id="b-desc" rows={3} maxLength={512} value={values.wa_description} onChange={set('wa_description')} />
              </FormField>
            </div>
            <FormField label="Business email" htmlFor="b-email" error={errors.wa_email}>
              <Input id="b-email" type="email" value={values.wa_email} onChange={set('wa_email')} placeholder="contact@business.com" />
            </FormField>
            <FormField label="Website" htmlFor="b-web" error={errors.wa_website} hint="Must show the business name and contact details, or Meta may reject the display name.">
              <Input id="b-web" value={values.wa_website} onChange={set('wa_website')} placeholder="https://business.com" />
            </FormField>
            <div className="sm:col-span-2">
              <FormField label="Address" htmlFor="b-addr">
                <Input id="b-addr" value={values.wa_address} onChange={set('wa_address')} maxLength={256} />
              </FormField>
            </div>
            <FormField label="City" htmlFor="b-city">
              <Input id="b-city" value={values.city} onChange={set('city')} />
            </FormField>
            <FormField label="Industry" htmlFor="b-ind">
              <Input id="b-ind" value={values.industry} onChange={set('industry')} placeholder="e.g. Real estate" />
            </FormField>
            <FormField label="Contact person" htmlFor="b-contact">
              <Input id="b-contact" value={values.contact_person} onChange={set('contact_person')} />
            </FormField>
            <FormField label="Contact phone" htmlFor="b-phone">
              <Input id="b-phone" type="tel" value={values.phone} onChange={set('phone')} placeholder="+91 98765 43210" />
            </FormField>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
            <Button type="submit" disabled={saving}>{saving && <Spinner />} Save changes</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

export default EditBrandDialog;
