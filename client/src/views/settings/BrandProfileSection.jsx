import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { FiBriefcase, FiInfo, FiSmartphone } from 'react-icons/fi';
import { api } from '../../services/api.js';
import { canEditBrand, profileSaveMessage } from './settingsPolicy.js';
import { SettingsPageHeader, FormRow, Callout } from './SettingsKit.jsx';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';

const CATEGORIES = ['Matrimonial service', 'Finance and banking', 'Food and groceries', 'Alcoholic drinks', 'Government', 'Hotel and lodging',
  'Medical and health', 'Over-the-counter medicine', 'Charity', 'Professional services', 'Shopping and retail',
  'Travel and transportation', 'Restaurant', 'OTHER'];

const FIELDS = ['name', 'wa_category', 'status'];
const initial = (brand) => ({ name: brand?.name ?? '', wa_category: brand?.wa_category || 'OTHER', status: brand?.status || 'active' });

// Brand profile: the workspace's one brand (GET /api/clients, sanitised);
// PATCH /api/clients/:id with these fields only (owner/admin). The WhatsApp
// business profile (About, Description, Address, Email, photo) is edited on
// the WhatsApp Number page; WhatsApp credentials are never edited here.
export const BrandProfileSection = ({ brand, tenantInfo, onSaved }) => {
  const navigate = useNavigate();
  const editable = canEditBrand(tenantInfo?.permissions);
  const [values, setValues] = useState(() => initial(brand));
  const [saving, setSaving] = useState(false);
  const start = initial(brand);
  const dirty = FIELDS.some((key) => String(values[key] ?? '') !== String(start[key] ?? ''));

  const save = async (event) => {
    event.preventDefault();
    if (!String(values.name || '').trim()) return toast.error('Enter your business name.');
    const changes = Object.fromEntries(FIELDS.filter((key) => String(values[key] ?? '') !== String(start[key] ?? '')).map((key) => [key, values[key]]));
    if (!Object.keys(changes).length) return toast('Nothing has changed yet.');
    setSaving(true);
    try {
      const result = await api.updateClient(brand.id, changes);
      toast.success(profileSaveMessage(result), { duration: 6000 });
      onSaved?.();
    } catch (error) {
      toast.error(error.message || 'Could not save the brand profile. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-3xl">
      <SettingsPageHeader section="brand" />
      {!brand ? (
        <Callout>Your workspace has no brand profile yet. Contact support to set it up.</Callout>
      ) : (
        <div className="flex flex-col gap-5">
          <Card>
            <CardContent>
              <form onSubmit={save} className="flex flex-col gap-4">
                {!editable && <Callout><FiInfo className="mr-1 inline" /> Only the workspace Owner or an Admin can change the brand profile.</Callout>}
                <FormRow label="Business name" htmlFor="brand-name">
                  <div className="relative">
                    <FiBriefcase className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground" />
                    <Input id="brand-name" className="pl-9" value={values.name} maxLength={120} readOnly={!editable} onChange={(e) => setValues((v) => ({ ...v, name: e.target.value }))} />
                  </div>
                </FormRow>
                <FormRow label="Category" htmlFor="brand-category">
                  <Select value={values.wa_category} onValueChange={(value) => setValues((v) => ({ ...v, wa_category: value }))} disabled={!editable}>
                    <SelectTrigger id="brand-category"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {[...CATEGORIES, ...(CATEGORIES.includes(start.wa_category) ? [] : [start.wa_category])].map((value) => (
                        <SelectItem key={value} value={value}>{value === 'OTHER' ? 'Other' : value}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </FormRow>
                <FormRow label="Automated replies" htmlFor="brand-status">
                  <Select value={values.status} onValueChange={(value) => setValues((v) => ({ ...v, status: value }))} disabled={!editable}>
                    <SelectTrigger id="brand-status"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="active">Active: incoming WhatsApp messages go to the AI Brain</SelectItem>
                      <SelectItem value="inactive">Paused: AI auto-replies are off</SelectItem>
                    </SelectContent>
                  </Select>
                </FormRow>
                {editable && (
                  <div className="flex justify-end gap-2 pt-1">
                    <Button type="button" variant="outline" disabled={!dirty || saving} onClick={() => setValues(initial(brand))}>Cancel</Button>
                    <Button type="submit" disabled={!dirty || saving}>{saving && <Spinner />} Save changes</Button>
                  </div>
                )}
              </form>
            </CardContent>
          </Card>

          <Card className="flex-row items-center gap-4 px-6 py-5">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-green-50 text-green-600"><FiSmartphone size={18} /></span>
            <div className="min-w-0 flex-1">
              <div className="font-semibold">WhatsApp business profile</div>
              <p className="text-[13px] text-muted-foreground">About, description, address, email and profile photo are edited on the WhatsApp Number page.</p>
            </div>
            <Button variant="outline" onClick={() => navigate('/whatsapp')}>Open</Button>
          </Card>
        </div>
      )}
    </div>
  );
};
