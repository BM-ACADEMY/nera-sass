import { useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { FiFileText, FiMapPin, FiMail, FiGlobe, FiInfo, FiEdit2, FiLock, FiCamera } from 'react-icons/fi';
import { api } from '../../services/api.js';
import { PROFILE_LIMITS, profileChanges } from '../settings/settingsPolicy.js';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Spinner } from '@/components/ui/spinner';
import { cn } from '@/lib/utils';

const title = (s) => String(s || '').toLowerCase().replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());

const InfoRow = ({ icon: Icon, label, value, href, locked }) => (
  <div className="flex items-start gap-3 py-2.5">
    <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground"><Icon className="size-4" /></span>
    <div className="min-w-0 flex-1">
      <div className="flex items-center gap-1.5 text-[12px] text-muted-foreground">{label}{locked && <FiLock className="size-3" aria-label="Set by the Getnera team" />}</div>
      {value
        ? (href ? <a href={href} target="_blank" rel="noreferrer" className="block truncate text-sm font-medium text-blue-700 hover:underline">{value}</a> : <div className="text-sm font-medium break-words whitespace-pre-wrap">{value}</div>)
        : <div className="text-sm text-muted-foreground">Not added</div>}
    </div>
  </div>
);

const Counter = ({ value, max }) => (
  <span className={cn('text-[11px] tabular-nums', value.length > max ? 'font-semibold text-red-600' : 'text-muted-foreground')}>{value.length} / {max}</span>
);

const EditRow = ({ id, label, value, max, onChange, multiline, ...props }) => (
  <div className="flex flex-col gap-1.5">
    <div className="flex items-center justify-between">
      <Label htmlFor={id} className="text-[13px] font-semibold text-slate-700">{label}</Label>
      <Counter value={value} max={max} />
    </div>
    {multiline
      ? <Textarea id={id} value={value} rows={4} onChange={(e) => onChange(e.target.value)} {...props} />
      : <Input id={id} value={value} onChange={(e) => onChange(e.target.value)} {...props} />}
  </div>
);

const fromProfile = (profile) => ({
  about: profile?.about || '', description: profile?.description || '', address: profile?.address || '', email: profile?.email || '',
});

/**
 * "What customers see when they open your profile in WhatsApp". Owners and
 * Admins edit About, Description, Address, Email and the photo here
 * (PUT /api/whatsapp/profile; Meta is called on the server). The website and
 * category are set by the Getnera team.
 */
export default function BusinessProfileCard({ profile, editable, photoEditable, canManage, onSaved }) {
  const [editing, setEditing] = useState(false);
  const [values, setValues] = useState(() => fromProfile(profile));
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef(null);
  const set = (key) => (value) => setValues((v) => ({ ...v, [key]: value }));
  const website = profile?.websites?.[0];

  const startEdit = () => { setValues(fromProfile(profile)); setEditing(true); };

  const save = async (event) => {
    event.preventDefault();
    const check = profileChanges(values, fromProfile(profile));
    if (!check.ok) return toast.error(check.error);
    setSaving(true);
    try {
      await api.put('/whatsapp/profile', check.changes);
      toast.success('Saved. Customers will see the new profile in WhatsApp shortly.');
      setEditing(false);
      onSaved?.();
    } catch (error) {
      toast.error(error.message || 'Could not save your WhatsApp profile. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const uploadPhoto = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!['image/jpeg', 'image/png'].includes(file.type)) return toast.error('Choose a JPEG or PNG image.');
    if (file.size > 5 * 1024 * 1024) return toast.error('The photo must be 5 MB or smaller.');
    const form = new FormData();
    form.append('photo', file);
    setUploading(true);
    try {
      await api.upload('/whatsapp/profile/photo', form);
      toast.success('Profile photo changed.');
      onSaved?.();
    } catch (error) {
      toast.error(error.message || 'Could not change your profile photo. Please try again.');
    } finally {
      setUploading(false);
    }
  };

  return (
    <Card className="gap-1 px-5 py-5">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-[15px] font-bold">WhatsApp business profile</div>
          <p className="text-[12.5px] text-muted-foreground">What customers see when they open your profile in WhatsApp.</p>
        </div>
        <div className="flex items-center gap-2">
          {profile?.vertical && <Badge variant="outline">{title(profile.vertical)}</Badge>}
          {photoEditable && (
            <>
              <input ref={fileRef} type="file" accept="image/jpeg,image/png" className="hidden" onChange={uploadPhoto} />
              <Button size="sm" variant="outline" disabled={uploading} onClick={() => fileRef.current?.click()}>{uploading ? <Spinner /> : <FiCamera />} Photo</Button>
            </>
          )}
          {editable && !editing && <Button size="sm" variant="outline" onClick={startEdit}><FiEdit2 /> Edit</Button>}
        </div>
      </div>

      {editing ? (
        <form onSubmit={save} className="mt-2 flex flex-col gap-4">
          <EditRow id="wa-about" label="About" value={values.about} max={PROFILE_LIMITS.about} onChange={set('about')} placeholder="A short line, for example: Open 9 am to 6 pm" />
          <EditRow id="wa-description" label="Description" value={values.description} max={PROFILE_LIMITS.description} onChange={set('description')} multiline placeholder="What your business does" />
          <EditRow id="wa-address" label="Address" value={values.address} max={PROFILE_LIMITS.address} onChange={set('address')} />
          <EditRow id="wa-email" label="Email" value={values.email} max={PROFILE_LIMITS.email} onChange={set('email')} inputMode="email" autoComplete="email" placeholder="hello@yourbusiness.com" />
          <div className="flex flex-col gap-1.5">
            <Label className="text-[13px] font-semibold text-slate-700">Website</Label>
            <div className="relative">
              <Input value={website || 'Not added'} readOnly disabled className="pr-9" />
              <FiLock className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-muted-foreground" />
            </div>
            <p className="text-xs text-muted-foreground">The website is set by the Getnera team. Contact support to change it.</p>
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" disabled={saving} onClick={() => setEditing(false)}>Cancel</Button>
            <Button type="submit" disabled={saving}>{saving && <Spinner />} Save profile</Button>
          </div>
        </form>
      ) : (
        <>
          <div className="divide-y divide-border">
            <InfoRow icon={FiInfo} label="About" value={profile?.about} />
            <InfoRow icon={FiFileText} label="Description" value={profile?.description} />
            <InfoRow icon={FiMapPin} label="Address" value={profile?.address} />
            <InfoRow icon={FiMail} label="Email" value={profile?.email} href={profile?.email ? `mailto:${profile.email}` : undefined} />
            <InfoRow icon={FiGlobe} label="Website" value={website} href={website} locked />
          </div>
          <p className="mt-2 text-[12px] text-muted-foreground">
            {editable
              ? 'The website and category are set by the Getnera team. Contact support to change them.'
              : canManage
                ? 'Your profile cannot be changed from here yet. Please ask the Getnera team to update it.'
                : 'Only the workspace Owner or an Admin can change this profile.'}
          </p>
        </>
      )}
    </Card>
  );
}
