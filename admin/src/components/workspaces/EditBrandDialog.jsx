import React, { useEffect, useState } from 'react';
import { toast } from 'sonner';
import axiosClient from '../../api/axiosClient';
import { FormField } from '../FormField';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';

const FIELDS = ['name', 'city', 'phone', 'contact_person', 'industry'];

const toForm = (brand) => Object.fromEntries(FIELDS.map((f) => [f, brand?.[f] ?? '']));

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
            <DialogTitle>Edit business details</DialogTitle>
            <DialogDescription>
              Internal details of this workspace. The WhatsApp profile customers see is edited with Edit WhatsApp profile.
            </DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FormField label="Brand / business name" htmlFor="b-name" error={errors.name}>
              <Input id="b-name" value={values.name} onChange={set('name')} />
            </FormField>
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
