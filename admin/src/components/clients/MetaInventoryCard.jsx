import React, { useState } from 'react';
import { toast } from 'sonner';
import { FiSmartphone, FiPlus, FiTrash2, FiRefreshCw, FiLink, FiCheckCircle } from 'react-icons/fi';
import axiosClient from '../../api/axiosClient';
import StatTile from '../StatTile';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { cn } from '@/lib/utils';

const apiError = (err, fallback) => err.response?.data?.error || err.message || fallback;

const displayNameStatus = (phone) => {
  const next = String(phone?.raw_data?.new_name_status || '').toUpperCase();
  if (next && next !== 'NONE') return next;
  return String(phone?.raw_data?.name_status || 'UNKNOWN').toUpperCase();
};
const nameRejected = (phone) => ['DECLINED', 'REJECTED'].includes(displayNameStatus(phone));

// Opens Meta Business Manager's phone-number page for a WABA in a centred popup.
function openMetaPopup(waba, phoneId, name) {
  const url = new URL('https://business.facebook.com/wa/manage/phone-numbers/');
  url.searchParams.set('business_id', waba.business_id);
  url.searchParams.set('waba_id', waba.waba_id);
  if (phoneId) url.searchParams.set('phone_number_id', phoneId);
  const width = 900;
  const height = 820;
  const left = Math.max(0, window.screenX + (window.outerWidth - width) / 2);
  const top = Math.max(0, window.screenY + (window.outerHeight - height) / 2);
  return window.open(url.toString(), name, `popup=yes,width=${width},height=${height},left=${Math.round(left)},top=${Math.round(top)},resizable=yes,scrollbars=yes`);
}

const PhoneAvatar = ({ phone, size = 'size-9' }) => (phone.profile_picture_url
  ? <img src={phone.profile_picture_url} alt="" className={cn(size, 'shrink-0 rounded-full border border-border object-cover')} />
  : <div className={cn(size, 'flex shrink-0 items-center justify-center rounded-full bg-orange-50 text-xs font-extrabold text-orange-600')}>{phone.verified_name?.[0] || '?'}</div>);

const CONNECTION_VARIANT = { CONNECTED: 'success', PENDING: 'warning', BANNED: 'danger', FLAGGED: 'danger', RESTRICTED: 'danger', DISCONNECTED: 'danger' };
const QUALITY_VARIANT = { GREEN: 'success', YELLOW: 'warning', RED: 'danger' };
const NAME_VARIANT = { APPROVED: 'success', AVAILABLE_WITHOUT_REVIEW: 'success', PENDING_REVIEW: 'warning', DECLINED: 'danger', REJECTED: 'danger' };
const label = (value) => String(value || 'Unknown').replace(/_/g, ' ').toLowerCase();

const PhoneCell = ({ phone }) => (
  <TableCell>
    <div className="flex min-w-0 items-center gap-3">
      <PhoneAvatar phone={phone} />
      <div className="min-w-0">
        <div className="truncate text-[13px] font-semibold">{phone.display_phone_number || 'Unknown number'}</div>
        <div className="truncate text-xs text-muted-foreground" title={phone.verified_name || ''}>{phone.verified_name || 'No display name'}</div>
        <div className="truncate font-mono text-[11px] text-muted-foreground">ID {phone.phone_number_id}</div>
      </div>
    </div>
  </TableCell>
);

const StatusCell = ({ phone, onEditName }) => {
  const connection = String(phone.connection_status || phone.verification_status || '').toUpperCase();
  const quality = String(phone.quality_rating || '').toUpperCase();
  const name = displayNameStatus(phone);
  return (
    <TableCell>
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge variant={CONNECTION_VARIANT[connection] || 'muted'} className="capitalize">{label(connection)}</Badge>
        <Badge variant={QUALITY_VARIANT[quality] || 'muted'} className="capitalize">Quality: {label(quality)}</Badge>
        <Badge variant={NAME_VARIANT[name] || 'muted'} className="capitalize">Name: {label(name)}</Badge>
      </div>
      <div className="mt-1.5 flex items-center gap-2 text-[11px] text-muted-foreground">
        <span>{phone.platform_type || 'Unknown platform'}</span>
        {nameRejected(phone) && onEditName && (
          <button type="button" onClick={() => onEditName(phone)} className="cursor-pointer font-semibold text-red-600 hover:underline">
            Edit display name
          </button>
        )}
      </div>
    </TableCell>
  );
};

// Unassigned and assigned numbers share the first two column widths so the
// number and status columns line up across both tables.
const PhoneSection = ({ title, count, empty, assigned = false, children }) => (
  <section>
    <div className="mb-2 flex items-center gap-2">
      <h3 className="text-[13px] font-semibold">{title}</h3>
      <Badge variant={assigned ? 'success' : 'warning'} className="tabular-nums">{count}</Badge>
    </div>
    <div className="overflow-hidden rounded-lg border border-border">
      <Table className="min-w-[820px] table-fixed">
        <colgroup>
          <col className="w-[30%]" />
          <col className="w-[30%]" />
          <col className={assigned ? 'w-[26%]' : 'w-[13%]'} />
          <col className={assigned ? 'w-[14%]' : 'w-[27%]'} />
        </colgroup>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead>Phone Number</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>{assigned ? 'Workspace' : 'Cloud API'}</TableHead>
            <TableHead className={assigned ? 'text-right' : undefined}>{assigned ? 'Action' : 'Assign to Workspace'}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {count === 0 ? (
            <TableRow className="hover:bg-transparent">
              <TableCell colSpan={4} className="py-8 text-center text-xs text-muted-foreground">{empty}</TableCell>
            </TableRow>
          ) : children}
        </TableBody>
      </Table>
    </div>
  </section>
);

const MetaInventoryCard = ({ inventory, onRefresh }) => {
  const [selectedWabaId, setSelectedWabaId] = useState('');
  const [tab, setTab] = useState('phones');
  const [syncing, setSyncing] = useState(false);
  const [deletingCache, setDeletingCache] = useState(false);
  const [confirmDeleteCache, setConfirmDeleteCache] = useState(false);
  const [onboardingPhone, setOnboardingPhone] = useState(false);
  const [mapping, setMapping] = useState({});
  const [registrationPhone, setRegistrationPhone] = useState(null);
  const [pin, setPin] = useState('');
  const [registering, setRegistering] = useState(false);
  const [unassignPhone, setUnassignPhone] = useState(null);
  const [unassigning, setUnassigning] = useState(false);
  const workspaces = inventory.workspaces || [];

  const wabaId = inventory.wabas.some((w) => w.waba_id === selectedWabaId) ? selectedWabaId : (inventory.wabas[0]?.waba_id || '');
  const selectedWaba = inventory.wabas.find((w) => w.waba_id === wabaId);
  const wabaPhones = inventory.phone_numbers.filter((p) => p.waba_id === wabaId);
  const wabaTemplates = (inventory.templates || []).filter((t) => t.waba_id === wabaId);
  const unassigned = wabaPhones.filter((p) => !p.client_id);
  const assigned = wabaPhones.filter((p) => p.client_id);

  const sync = async () => {
    setSyncing(true);
    try {
      const { data } = await axiosClient.post('/admin/meta/whatsapp/sync');
      toast.success(`Synced ${data.wabas} WABAs, ${data.phone_numbers} numbers and ${data.templates} templates`);
      await onRefresh();
    } catch (err) {
      toast.error(apiError(err, 'Meta sync failed'));
    } finally {
      setSyncing(false);
    }
  };

  const deleteCache = async () => {
    if (!selectedWaba) return;
    setDeletingCache(true);
    try {
      await axiosClient.delete(`/admin/meta/whatsapp/cache/wabas/${encodeURIComponent(selectedWaba.waba_id)}`);
      toast.success(`Deleted cached inventory for ${selectedWaba.name}`);
      await onRefresh();
    } catch (err) {
      toast.error(apiError(err, 'Failed to delete cache'));
    } finally {
      setDeletingCache(false);
      setConfirmDeleteCache(false);
    }
  };

  // Meta handles number creation and OTP in its own popup; once it closes we
  // sync and offer Cloud API registration for any number that appeared.
  const addPhoneToWaba = () => {
    if (!selectedWaba) return toast.error('Select a WABA first');
    if (!selectedWaba.business_id) return toast.error('This WABA has no Business Portfolio ID. Run a full Meta sync first.');
    const popup = openMetaPopup(selectedWaba, null, 'nera-meta-add-phone');
    if (!popup) return toast.error('Allow popups for this site, then try again');
    popup.focus();
    setOnboardingPhone(true);
    const targetWabaId = selectedWaba.waba_id;
    const existing = new Set(wabaPhones.map((p) => String(p.phone_number_id)));
    const toastId = toast.loading(`Complete the phone setup and OTP under ${selectedWaba.name}. We will sync when Meta closes.`);
    const openedAt = Date.now();
    const watcher = window.setInterval(async () => {
      if (!popup.closed && Date.now() - openedAt < 30 * 60 * 1000) return;
      window.clearInterval(watcher);
      setOnboardingPhone(false);
      if (!popup.closed) {
        toast.error('Meta setup monitoring expired. Close the popup and use Sync Meta Now.', { id: toastId });
        return;
      }
      setSyncing(true);
      try {
        await axiosClient.post('/admin/meta/whatsapp/sync');
        const { data } = await axiosClient.get('/admin/meta/whatsapp/inventory');
        const added = data.phone_numbers.filter((p) => p.waba_id === targetWabaId && !existing.has(String(p.phone_number_id)));
        if (added.length) {
          setSelectedWabaId(targetWabaId);
          setTab('phones');
          setRegistrationPhone(added[0]);
          setPin('');
          toast.success('Phone verified in Meta. Complete Cloud API registration.', { id: toastId });
        } else {
          toast.info('Meta closed, but no new phone was found. Complete OTP before closing, or retry.', { id: toastId });
        }
        await onRefresh();
      } catch (err) {
        toast.error(apiError(err, 'Meta sync failed after phone setup'), { id: toastId });
      } finally {
        setSyncing(false);
      }
    }, 1000);
  };

  const openDisplayNameEditor = (phone) => {
    const waba = inventory.wabas.find((w) => w.waba_id === phone.waba_id);
    if (!waba?.business_id) return toast.error('Run a full Meta sync before editing the display name');
    const popup = openMetaPopup(waba, phone.phone_number_id, 'nera-meta-display-name');
    if (!popup) return toast.error('Allow popups for this site, then try again');
    popup.focus();
    toast.info('Select the phone in Meta, click its rejected display name, submit the corrected name, then close the popup and sync.');
  };

  const register = async () => {
    if (!/^\d{6}$/.test(pin)) return toast.error('Enter a valid 6-digit PIN');
    setRegistering(true);
    const toastId = toast.loading('Registering phone with WhatsApp Cloud API...');
    try {
      await axiosClient.post(`/admin/meta/whatsapp/phone-numbers/${encodeURIComponent(registrationPhone.phone_number_id)}/register`, { pin });
      setPin('');
      setRegistrationPhone(null);
      toast.success('Phone registered and app subscribed to WABA events', { id: toastId });
      await onRefresh();
    } catch (err) {
      toast.error(apiError(err, 'Phone registration failed'), { id: toastId });
    } finally {
      setRegistering(false);
    }
  };

  const assignPhone = async (phoneId) => {
    const clientId = mapping[phoneId];
    if (!clientId) return toast.error('Select a workspace first');
    const workspace = workspaces.find((w) => String(w.client_id) === clientId);
    try {
      await axiosClient.patch(`/admin/meta/whatsapp/phone-numbers/${phoneId}/map`, { client_id: Number(clientId) });
      toast.success(`Number assigned to ${workspace?.tenant_name || 'workspace'}`);
      setMapping((m) => ({ ...m, [phoneId]: undefined }));
      await onRefresh();
    } catch (err) {
      toast.error(apiError(err, 'Failed to assign number'));
    }
  };

  const unassign = async () => {
    setUnassigning(true);
    try {
      await axiosClient.patch(`/admin/meta/whatsapp/phone-numbers/${unassignPhone.phone_number_id}/map`, { client_id: null });
      toast.success(`${unassignPhone.display_phone_number} unassigned from ${unassignPhone.tenant_name || 'its workspace'}`);
      setUnassignPhone(null);
      await onRefresh();
    } catch (err) {
      toast.error(apiError(err, 'Failed to unassign number'));
    } finally {
      setUnassigning(false);
    }
  };

  const busy = syncing || deletingCache;
  const wabaTemplateSummary = (id) => inventory.template_summary.find((t) => t.waba_id === id);

  return (
    <>
      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatTile label="WhatsApp Accounts" value={inventory.wabas.length} />
        <StatTile label="Phone Numbers" value={inventory.phone_numbers.length} valueClassName="text-blue-600" />
        <StatTile label="Assigned" value={inventory.phone_numbers.filter((p) => p.client_id).length} valueClassName="text-green-600" />
        <StatTile label="Unassigned" value={inventory.phone_numbers.filter((p) => !p.client_id).length} valueClassName="text-amber-600" />
      </div>

      <Card className="mb-6 gap-5">
        <CardHeader className="items-start">
          <div className="min-w-0">
            <CardTitle className="flex items-center gap-2 text-[15px]">
              <FiSmartphone className="text-green-600" /> WhatsApp Business Accounts
            </CardTitle>
            <CardDescription className="mt-1.5 text-xs">
              Select an account to see its numbers and templates. Inventory syncs from Meta automatically every 15 minutes.
            </CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {selectedWaba && (
              <>
                <Button variant="outline" size="sm" onClick={() => setConfirmDeleteCache(true)} disabled={busy} className="text-red-600 hover:bg-red-50 hover:text-red-700">
                  {deletingCache ? <Spinner /> : <FiTrash2 />} {deletingCache ? 'Deleting...' : 'Delete cache'}
                </Button>
                <Button variant="outline" size="sm" onClick={addPhoneToWaba} disabled={busy || onboardingPhone} className="border-green-300 text-green-700 hover:bg-green-50 hover:text-green-800">
                  {onboardingPhone ? <Spinner /> : <FiPlus />} {onboardingPhone ? 'Waiting for Meta...' : 'Add phone number'}
                </Button>
              </>
            )}
            <Button size="sm" onClick={sync} disabled={busy}>
              <FiRefreshCw className={cn(syncing && 'animate-spin')} /> {syncing ? 'Syncing...' : 'Sync Meta Now'}
            </Button>
          </div>
        </CardHeader>

        <CardContent className="flex flex-col gap-4">
          {inventory.wabas.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border bg-muted/30 px-4 py-10 text-center">
              <FiSmartphone className="mx-auto mb-2 size-7 text-slate-300" />
              <div className="text-sm font-semibold">No WhatsApp Business Accounts loaded yet</div>
              <p className="mx-auto mt-1 max-w-md text-xs text-muted-foreground">
                {inventory.sync_enabled === false
                  ? 'Meta sync is turned off on this server (META_INVENTORY_SYNC=off in server/.env). Turn it on and restart the server, then click Sync Meta Now.'
                  : 'Click Sync Meta Now to load the WABAs, phone numbers and templates from Meta.'}
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {inventory.wabas.map((waba) => {
                const active = wabaId === waba.waba_id;
                return (
                  <button
                    type="button"
                    key={waba.waba_id}
                    onClick={() => setSelectedWabaId(waba.waba_id)}
                    className={cn(
                      'flex cursor-pointer flex-col gap-2 rounded-lg border p-3.5 text-left transition-colors',
                      active ? 'border-primary bg-blue-50/60 ring-1 ring-primary' : 'border-border hover:bg-muted/50'
                    )}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span className={cn('truncate text-sm font-semibold', active && 'text-primary')}>{waba.name || 'Unnamed account'}</span>
                      <Badge variant={waba.ownership_type === 'owned' ? 'info' : 'purple'} className="capitalize">{waba.ownership_type}</Badge>
                    </div>
                    <span className="font-mono text-[11px] text-muted-foreground">{waba.waba_id}</span>
                    <div className="flex gap-4 text-xs text-muted-foreground">
                      <span><strong className="text-foreground tabular-nums">{waba.phone_count}</strong> numbers</span>
                      <span><strong className="text-foreground tabular-nums">{wabaTemplateSummary(waba.waba_id)?.total || 0}</strong> templates</span>
                    </div>
                  </button>
                );
              })}
            </div>
          )}

          {selectedWaba && (
            <dl className="grid grid-cols-1 overflow-hidden rounded-lg border border-border sm:grid-cols-2 lg:grid-cols-4">
              {[
                ['WABA Name', selectedWaba.name],
                ['WABA ID', selectedWaba.waba_id, true],
                ['Ownership', selectedWaba.ownership_type],
                ['Currency', selectedWaba.currency],
                ['Timezone ID', selectedWaba.timezone_id],
                ['Template Namespace', selectedWaba.template_namespace, true],
                ['Business Portfolio ID', selectedWaba.business_id, true],
                ['Last Synced', selectedWaba.last_synced_at ? new Date(selectedWaba.last_synced_at).toLocaleString() : 'Never'],
              ].map(([label, value, mono]) => (
                <div key={label} className="min-w-0 border-b border-border px-4 py-3 last:border-b-0 sm:[&:nth-last-child(-n+2)]:border-b-0 lg:[&:nth-last-child(-n+4)]:border-b-0">
                  <dt className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">{label}</dt>
                  <dd className={cn('mt-1 truncate text-[13px] font-medium', mono && 'font-mono text-xs', !value && 'text-muted-foreground')} title={value || ''}>
                    {value || 'Not available'}
                  </dd>
                </div>
              ))}
            </dl>
          )}
        </CardContent>
      </Card>

      {selectedWaba && (
        <Card className="gap-4">
          <CardHeader>
            <div>
              <CardTitle className="text-[15px]">{selectedWaba.name}</CardTitle>
              <CardDescription className="mt-1 text-xs">Numbers and message templates under this account.</CardDescription>
            </div>
            <div className="inline-flex rounded-lg border border-border bg-muted/60 p-1">
              {[['phones', 'Phone Numbers', wabaPhones.length], ['templates', 'Templates', wabaTemplates.length]].map(([key, label, count]) => (
                <button
                  type="button"
                  key={key}
                  onClick={() => setTab(key)}
                  className={cn(
                    'flex cursor-pointer items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors',
                    tab === key ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
                  )}
                >
                  {label}
                  <span className="rounded-full bg-black/5 px-1.5 text-[11px] tabular-nums">{count}</span>
                </button>
              ))}
            </div>
          </CardHeader>

          <CardContent className="flex flex-col gap-6">
            {tab === 'phones' && (
              <>
                <PhoneSection title="Unassigned numbers" count={unassigned.length} empty="Every number under this account is assigned to a workspace.">
                  {unassigned.map((phone) => {
                    const connected = String(phone.connection_status || '').toUpperCase() === 'CONNECTED';
                    return (
                      <TableRow key={phone.phone_number_id}>
                        <PhoneCell phone={phone} />
                        <StatusCell phone={phone} onEditName={openDisplayNameEditor} />
                        <TableCell>
                          {connected ? (
                            <Badge variant="success"><FiCheckCircle /> Registered</Badge>
                          ) : (
                            <Button size="sm" variant="outline" className="h-7 border-green-300 text-xs text-green-700 hover:bg-green-50" onClick={() => { setRegistrationPhone(phone); setPin(''); }}>
                              Register API
                            </Button>
                          )}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <Select value={mapping[phone.phone_number_id] || ''} onValueChange={(v) => setMapping((m) => ({ ...m, [phone.phone_number_id]: v }))}>
                              <SelectTrigger size="sm" className="min-w-0 flex-1"><SelectValue placeholder="Select workspace" /></SelectTrigger>
                              <SelectContent>
                                {workspaces.length === 0 && <div className="px-2 py-1.5 text-xs text-muted-foreground">No workspaces yet. Provision one first.</div>}
                                {workspaces.map((w) => (
                                  <SelectItem key={w.tenant_id} value={String(w.client_id)}>{w.tenant_name} (#{w.tenant_id})</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <Button size="sm" className="shrink-0" disabled={!mapping[phone.phone_number_id]} onClick={() => assignPhone(phone.phone_number_id)}>
                              <FiLink /> Assign
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </PhoneSection>

                <PhoneSection title="Assigned numbers" count={assigned.length} empty="No number under this account is assigned yet." assigned>
                  {assigned.map((phone) => (
                    <TableRow key={phone.phone_number_id}>
                      <PhoneCell phone={phone} />
                      <StatusCell phone={phone} onEditName={openDisplayNameEditor} />
                      <TableCell>
                        <div className="truncate text-[13px] font-semibold">{phone.tenant_name || phone.client_name || 'Unknown workspace'}</div>
                        {phone.tenant_id != null && <div className="text-[11px] text-muted-foreground">Workspace #{phone.tenant_id}</div>}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setUnassignPhone(phone)}>
                          Unassign
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </PhoneSection>
              </>
            )}

            {tab === 'templates' && (
              <div className="overflow-hidden rounded-lg border border-border">
                <Table className="min-w-[760px] table-fixed">
                  <colgroup>
                    <col className="w-[28%]" />
                    <col className="w-[10%]" />
                    <col className="w-[14%]" />
                    <col className="w-[13%]" />
                    <col className="w-[17%]" />
                    <col className="w-[18%]" />
                  </colgroup>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      {['Template Name', 'Language', 'Category', 'Status', 'Template ID', 'Last Synced'].map((h) => <TableHead key={h}>{h}</TableHead>)}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {wabaTemplates.length === 0 ? (
                      <TableRow className="hover:bg-transparent">
                        <TableCell colSpan={6} className="py-10 text-center text-xs text-muted-foreground">No templates found for this account.</TableCell>
                      </TableRow>
                    ) : wabaTemplates.map((t) => (
                      <TableRow key={t.template_id}>
                        <TableCell className="truncate font-semibold" title={t.name}>{t.name}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{t.language}</TableCell>
                        <TableCell className="text-xs text-muted-foreground capitalize">{String(t.category || '').toLowerCase() || '—'}</TableCell>
                        <TableCell>
                          <Badge variant={t.status === 'APPROVED' ? 'success' : t.status === 'REJECTED' ? 'danger' : 'warning'}>{t.status}</Badge>
                        </TableCell>
                        <TableCell className="truncate font-mono text-[11px] text-muted-foreground" title={t.template_id}>{t.template_id}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{t.last_synced_at ? new Date(t.last_synced_at).toLocaleString() : '—'}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <AlertDialog open={confirmDeleteCache} onOpenChange={setConfirmDeleteCache}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete cached inventory?</AlertDialogTitle>
            <AlertDialogDescription>
              Deletes only the cached inventory for {selectedWaba?.name} ({selectedWaba?.waba_id}). Nothing is deleted from Meta. If the WABA still exists in Meta, it returns on the next sync.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deletingCache}>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={(e) => { e.preventDefault(); deleteCache(); }} disabled={deletingCache}>
              {deletingCache && <Spinner />} Delete cache
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={Boolean(unassignPhone)} onOpenChange={(open) => !open && !unassigning && setUnassignPhone(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Unassign {unassignPhone?.display_phone_number}?</AlertDialogTitle>
            <AlertDialogDescription>
              {unassignPhone?.tenant_name || 'This workspace'} will stop sending and receiving WhatsApp messages through this number until another number is assigned. The number stays in Meta.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={unassigning}>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" disabled={unassigning} onClick={(e) => { e.preventDefault(); unassign(); }}>
              {unassigning && <Spinner />} Unassign
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={Boolean(registrationPhone)} onOpenChange={(open) => { if (!open && !registering) { setRegistrationPhone(null); setPin(''); } }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Register phone with Cloud API</DialogTitle>
            <DialogDescription className="leading-relaxed">
              Meta verified <strong className="text-foreground">{registrationPhone?.display_phone_number || registrationPhone?.phone_number_id}</strong>.
              For a first registration, choose a new 6-digit PIN. If Meta already configured two-step verification for this number, enter its existing PIN.
              The PIN is sent directly to Meta and never stored.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            <label htmlFor="register-pin" className="text-[11px] font-bold tracking-wide text-muted-foreground uppercase">6-digit PIN</label>
            <Input
              id="register-pin"
              type="password"
              inputMode="numeric"
              autoComplete="new-password"
              maxLength={6}
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
              placeholder="••••••"
              className="h-12 text-center text-lg tracking-[0.5em]"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" disabled={registering} onClick={() => { setRegistrationPhone(null); setPin(''); }}>Later</Button>
            <Button disabled={registering || pin.length !== 6} onClick={register} className="bg-green-600 hover:bg-green-700">
              {registering && <Spinner />} {registering ? 'Registering...' : 'Register phone'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};

export default MetaInventoryCard;
