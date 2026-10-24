import React, { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { FiSmartphone, FiPlus, FiTrash2, FiRefreshCw, FiLink, FiCheckCircle, FiSearch, FiChevronDown, FiChevronLeft, FiChevronRight, FiTarget, FiX } from 'react-icons/fi';
import { FaWhatsapp } from 'react-icons/fa';
import axiosClient from '../../api/axiosClient';
import PasswordInput from '../security/PasswordInput';
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

// Connection, quality and display-name status of one number.
const StatusBadges = ({ phone, onEditName }) => {
  const connection = String(phone.connection_status || phone.verification_status || '').toUpperCase();
  const quality = String(phone.quality_rating || '').toUpperCase();
  const name = displayNameStatus(phone);
  return (
    <>
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
    </>
  );
};

const StatusCell = (props) => <TableCell><StatusBadges {...props} /></TableCell>;

// Below the lg breakpoint each number is a card instead of a table row.
const PhoneCard = ({ phone, onEditName, highlighted = false, children }) => (
  <div className={cn('flex flex-col gap-3 rounded-lg border p-3', highlighted ? 'border-primary bg-blue-50/70 ring-1 ring-primary' : 'border-border')}>
    <div className="flex min-w-0 items-center gap-3">
      <PhoneAvatar phone={phone} />
      <div className="min-w-0">
        <div className="truncate text-sm font-semibold">{phone.display_phone_number || 'Unknown number'}</div>
        <div className="truncate text-xs text-muted-foreground">{phone.verified_name || 'No display name'}</div>
        <div className="truncate font-mono text-[11px] text-muted-foreground">ID {phone.phone_number_id}</div>
      </div>
    </div>
    <div><StatusBadges phone={phone} onEditName={onEditName} /></div>
    {children}
  </div>
);

// Unassigned and assigned numbers share the first two column widths so the
// number and status columns line up across both tables.
const PhoneSection = ({ title, count, empty, assigned = false, rows, cards }) => (
  <section>
    <div className="mb-2 flex items-center gap-2">
      <h3 className="text-[13px] font-semibold">{title}</h3>
      <Badge variant={assigned ? 'success' : 'warning'} className="tabular-nums">{count}</Badge>
    </div>
    {count === 0 ? (
      <div className="rounded-lg border border-border py-8 text-center text-xs text-muted-foreground">{empty}</div>
    ) : (
      <>
        <div className="hidden overflow-hidden rounded-lg border border-border lg:block">
          <Table className="table-fixed">
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
            <TableBody>{rows}</TableBody>
          </Table>
        </div>
        <div className="grid grid-cols-1 gap-2 md:grid-cols-2 lg:hidden">{cards}</div>
      </>
    )}
  </section>
);

const MetaInventoryCard = ({ inventory, onRefresh, focusTenantId = null, onClearFocus }) => {
  const [selectedWabaId, setSelectedWabaId] = useState('');
  // Account list: scales to many client WABAs (search, filter, pages).
  const [wabaSearch, setWabaSearch] = useState('');
  const [wabaFilter, setWabaFilter] = useState('all'); // all | unassigned | empty
  const [wabaPage, setWabaPage] = useState(1);
  const [wabaPageSize, setWabaPageSize] = useState(10);
  const [showDetails, setShowDetails] = useState(false);
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
  const [unassignPassword, setUnassignPassword] = useState('');
  const [unassigning, setUnassigning] = useState(false);
  const workspaces = inventory.workspaces || [];
  // A workspace uses one number: workspaces that already have one are not offered.
  const availableWorkspaces = workspaces.filter((w) => !w.has_number);

  // Opened from a workspace ("Configure WhatsApp"): preselect it, or show its number.
  const focusWorkspace = focusTenantId ? workspaces.find((w) => w.tenant_id === focusTenantId) || null : null;
  const focusedPhone = focusWorkspace?.phone_number_id
    ? inventory.phone_numbers.find((p) => p.phone_number_id === focusWorkspace.phone_number_id) || null
    : null;
  useEffect(() => {
    if (focusedPhone) {
      setSelectedWabaId(focusedPhone.waba_id);
      setTab('phones');
    }
  }, [focusedPhone?.phone_number_id]); // eslint-disable-line react-hooks/exhaustive-deps
  // Every picker starts empty ("Select workspace"); the admin chooses.
  const selectedWorkspaceFor = (phoneId) => mapping[phoneId] || '';

  const wabaId = inventory.wabas.some((w) => w.waba_id === selectedWabaId) ? selectedWabaId : (inventory.wabas[0]?.waba_id || '');
  const selectedWaba = inventory.wabas.find((w) => w.waba_id === wabaId);
  const wabaPhones = inventory.phone_numbers.filter((p) => p.waba_id === wabaId);
  // Templates are loaded only when the Templates tab is opened, per account.
  const [templatesByWaba, setTemplatesByWaba] = useState({});
  const [templatesLoading, setTemplatesLoading] = useState(false);
  const wabaTemplates = templatesByWaba[wabaId] || [];
  const wabaTemplateTotal = inventory.template_summary.find((t) => t.waba_id === wabaId)?.total || 0;
  useEffect(() => {
    if (tab !== 'templates' || !wabaId || templatesByWaba[wabaId]) return;
    let cancelled = false;
    setTemplatesLoading(true);
    axiosClient.get('/admin/meta/whatsapp/templates', { params: { waba_id: wabaId } })
      .then(({ data }) => { if (!cancelled) setTemplatesByWaba((m) => ({ ...m, [wabaId]: data.templates || [] })); })
      .catch((err) => { if (!cancelled) toast.error(apiError(err, 'Failed to load templates')); })
      .finally(() => { if (!cancelled) setTemplatesLoading(false); });
    return () => { cancelled = true; };
  }, [tab, wabaId]); // eslint-disable-line react-hooks/exhaustive-deps
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
    const clientId = selectedWorkspaceFor(phoneId);
    if (!clientId) return toast.error('Select a workspace first');
    const workspace = workspaces.find((w) => String(w.client_id) === clientId);
    try {
      await axiosClient.post(`/admin/meta/whatsapp/phone-numbers/${encodeURIComponent(phoneId)}/assign`, { client_id: Number(clientId) });
      toast.success(`Number assigned to ${workspace?.tenant_name || 'workspace'}`);
      setMapping((m) => ({ ...m, [phoneId]: undefined }));
      await onRefresh();
    } catch (err) {
      toast.error(apiError(err, 'Failed to assign number'));
    }
  };

  // The platform's own number (admin panel WhatsApp Chat and Templates).
  const [platformBusy, setPlatformBusy] = useState(null);
  const isPlatformPhone = (phone) => phone.phone_number_id === inventory.platform_phone_number_id;
  const setPlatformPhone = async (phone, use) => {
    setPlatformBusy(phone.phone_number_id);
    try {
      const url = `/admin/meta/whatsapp/phone-numbers/${encodeURIComponent(phone.phone_number_id)}/platform`;
      const res = use ? await axiosClient.post(url) : await axiosClient.delete(url);
      toast.success(use
        ? `${phone.display_phone_number} is now the admin WhatsApp number${res.data.webhook_subscribed === false ? ' (webhook subscription failed: check the Meta app)' : ''}`
        : `${phone.display_phone_number} is no longer the admin WhatsApp number`);
      await onRefresh();
    } catch (err) {
      toast.error(apiError(err, 'Could not change the admin WhatsApp number'));
    } finally {
      setPlatformBusy(null);
    }
  };

  const unassign = async () => {
    setUnassigning(true);
    try {
      await axiosClient.post(`/admin/meta/whatsapp/phone-numbers/${encodeURIComponent(unassignPhone.phone_number_id)}/unassign`, { password: unassignPassword });
      toast.success(`${unassignPhone.display_phone_number} unassigned from ${unassignPhone.linked_brand?.tenant_name || 'its workspace'}`);
      setUnassignPhone(null);
      setUnassignPassword('');
      await onRefresh();
    } catch (err) {
      toast.error(apiError(err, 'Failed to unassign number'));
    } finally {
      setUnassigning(false);
    }
  };

  const busy = syncing || deletingCache;
  const wabaTemplateSummary = (id) => inventory.template_summary.find((t) => t.waba_id === id);

  // One row per WABA with what the list shows and searches.
  const wabaRows = useMemo(() => inventory.wabas.map((w) => {
    const phones = inventory.phone_numbers.filter((p) => p.waba_id === w.waba_id);
    const workspaceNames = [...new Set(phones.map((p) => p.linked_brand?.tenant_name).filter(Boolean))];
    return {
      ...w,
      phoneTotal: phones.length,
      unassignedCount: phones.filter((p) => !p.client_id).length,
      workspaceNames,
      templateTotal: wabaTemplateSummary(w.waba_id)?.total || 0,
    };
  }), [inventory]); // eslint-disable-line react-hooks/exhaustive-deps

  const WABA_PAGE_SIZE = wabaPageSize;
  const q = wabaSearch.trim().toLowerCase();
  const filteredWabas = wabaRows.filter((w) => {
    if (wabaFilter === 'unassigned' && !w.unassignedCount) return false;
    if (wabaFilter === 'empty' && w.phoneTotal) return false;
    if (!q) return true;
    return [w.name, w.waba_id, ...w.workspaceNames].some((f) => String(f || '').toLowerCase().includes(q));
  });
  const wabaPageCount = Math.max(1, Math.ceil(filteredWabas.length / WABA_PAGE_SIZE));
  const currentWabaPage = Math.min(wabaPage, wabaPageCount);
  const pagedWabas = filteredWabas.slice((currentWabaPage - 1) * WABA_PAGE_SIZE, currentWabaPage * WABA_PAGE_SIZE);
  const filterCounts = {
    all: wabaRows.length,
    unassigned: wabaRows.filter((w) => w.unassignedCount).length,
    empty: wabaRows.filter((w) => !w.phoneTotal).length,
  };
  const freeNumberCount = inventory.phone_numbers.filter((p) => !p.client_id).length;

  const registerControl = (phone) => {
    const connected = String(phone.connection_status || '').toUpperCase() === 'CONNECTED';
    if (connected) return <Badge variant="success"><FiCheckCircle /> Registered</Badge>;
    if (!(inventory.can_administer && inventory.registration_enabled)) {
      return (
        <span className="text-xs text-muted-foreground" title="Registration needs the Admin (Owner) and META_PHONE_REGISTRATION_ENABLED=true on the server">
          {inventory.can_administer ? 'Registration off' : 'Admin registers'}
        </span>
      );
    }
    return (
      <Button size="sm" variant="outline" className="h-7 border-green-300 text-xs text-green-700 hover:bg-green-50" onClick={() => { setRegistrationPhone(phone); setPin(''); }}>
        Register API
      </Button>
    );
  };

  // Workspace picker + Assign. Workspaces that already use a number are not
  // offered. The admin number is shown as such instead of the picker.
  const assignControl = (phone) => {
    const value = selectedWorkspaceFor(phone.phone_number_id);
    if (isPlatformPhone(phone)) {
      return (
        <div className="flex w-full flex-wrap items-center justify-between gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-green-200 bg-green-50 px-2.5 py-1 text-xs font-semibold text-green-800">
            <FaWhatsapp className="text-[#25D366]" /> Admin WhatsApp
          </span>
          {inventory.can_administer && (
            <Button size="sm" variant="outline" className="h-7 text-xs" disabled={platformBusy === phone.phone_number_id} onClick={() => setPlatformPhone(phone, false)}>
              {platformBusy === phone.phone_number_id && <Spinner />} Stop using
            </Button>
          )}
        </div>
      );
    }
    return (
      <div className="flex w-full flex-col gap-1.5">
      <div className="flex w-full items-center gap-2">
        <Select value={value} onValueChange={(v) => setMapping((m) => ({ ...m, [phone.phone_number_id]: v }))}>
          <SelectTrigger size="sm" className="min-w-0 flex-1"><SelectValue placeholder="Select workspace" /></SelectTrigger>
          <SelectContent>
            {availableWorkspaces.length === 0 && (
              <div className="px-2 py-1.5 text-xs text-muted-foreground">
                {workspaces.length ? 'Every workspace already has a number.' : 'No workspaces yet. Provision one first.'}
              </div>
            )}
            {availableWorkspaces.map((w) => (
              <SelectItem key={w.tenant_id} value={String(w.client_id)}>{w.tenant_name} (#{w.tenant_id})</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button size="sm" className="shrink-0" disabled={!value} onClick={() => assignPhone(phone.phone_number_id)}>
          <FiLink /> Assign
        </Button>
      </div>
      {inventory.can_administer && (
        <button
          type="button"
          disabled={platformBusy === phone.phone_number_id}
          onClick={() => setPlatformPhone(phone, true)}
          className="inline-flex w-fit cursor-pointer items-center gap-1 text-[12px] font-medium text-green-700 hover:underline disabled:opacity-60"
          title="Use this number for the admin panel's WhatsApp Chat and Templates"
        >
          {platformBusy === phone.phone_number_id ? <Spinner className="size-3" /> : <FaWhatsapp />} Use for admin WhatsApp
        </button>
      )}
      </div>
    );
  };

  const workspaceOf = (phone) => (
    <div className="min-w-0">
      <div className="truncate text-[13px] font-semibold">{phone.linked_brand?.tenant_name || phone.linked_brand?.name || 'Unknown workspace'}</div>
      {phone.linked_brand?.tenant_id != null && <div className="text-[11px] text-muted-foreground">Workspace #{phone.linked_brand.tenant_id}</div>}
      {phone.linked_brand && !phone.linked_brand.identity_matches && <div className="text-[11px] font-semibold text-amber-600">Workspace now uses a different number</div>}
    </div>
  );

  const isFocusedPhone = (phone) => focusedPhone && phone.phone_number_id === focusedPhone.phone_number_id;

  return (
    <>
      {focusWorkspace && (
        <div className="mb-5 flex flex-col gap-3 rounded-xl border border-blue-200 bg-blue-50/70 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-white text-primary shadow-sm"><FiTarget /></span>
            <div className="min-w-0 text-sm">
              <div className="font-semibold">
                {focusWorkspace.has_number ? `${focusWorkspace.tenant_name} is connected` : `Connect WhatsApp for ${focusWorkspace.tenant_name}`}
              </div>
              <div className="text-xs text-muted-foreground">
                {focusWorkspace.has_number
                  ? `It uses ${focusedPhone?.display_phone_number || focusWorkspace.whatsapp_number || 'a number'}${focusedPhone ? ', highlighted below' : ''}. A workspace uses one number; unassign it first to change it.`
                  : freeNumberCount
                    ? `Pick a free number below, choose ${focusWorkspace.tenant_name} in its workspace picker, then click Assign.`
                    : 'There is no free number yet. Select a WhatsApp account, click Add phone number, then assign it here.'}
              </div>
            </div>
          </div>
          <Button variant="outline" size="sm" className="shrink-0 bg-white" onClick={onClearFocus}>
            <FiX /> Clear
          </Button>
        </div>
      )}

      <div className="mb-6 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <StatTile label="WhatsApp Accounts" value={inventory.wabas.length} />
        <StatTile label="Phone Numbers" value={inventory.phone_numbers.length} valueClassName="text-blue-600" />
        <StatTile label="Assigned" value={inventory.phone_numbers.length - freeNumberCount} valueClassName="text-green-600" />
        <StatTile label="Unassigned" value={freeNumberCount} valueClassName="text-amber-600" />
      </div>

      <Card className="mb-6 gap-5">
        <CardHeader className="items-start px-4 sm:px-6">
          <div className="min-w-0">
            <CardTitle className="flex items-center gap-2 text-[15px]">
              <FiSmartphone className="text-green-600" /> WhatsApp Business Accounts
            </CardTitle>
            <CardDescription className="mt-1.5 text-xs">
              Select an account to see its numbers and templates. Inventory syncs from Meta automatically every 15 minutes.
            </CardDescription>
          </div>
          <div className="grid w-full grid-cols-1 gap-2 sm:flex sm:w-auto sm:flex-wrap sm:items-center">
            {selectedWaba && (
              <>
                {inventory.can_administer && (
                  <Button variant="outline" size="sm" onClick={() => setConfirmDeleteCache(true)} disabled={busy} className="text-red-600 hover:bg-red-50 hover:text-red-700">
                    {deletingCache ? <Spinner /> : <FiTrash2 />} {deletingCache ? 'Deleting...' : 'Delete cache'}
                  </Button>
                )}
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

        <CardContent className="flex flex-col gap-4 px-4 sm:px-6">
          {inventory.wabas.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border bg-muted/30 px-4 py-10 text-center">
              <FiSmartphone className="mx-auto mb-2 size-7 text-slate-300" />
              <div className="text-sm font-semibold">No WhatsApp Business Accounts loaded yet</div>
              <p className="mx-auto mt-1 max-w-md text-xs text-muted-foreground">
                {inventory.credential_configured === false
                  ? 'The Meta inventory credential is not set. Add a new system-user token as META_INVENTORY_ACCESS_TOKEN in server/.env, restart the server, then click Sync Meta Now.'
                  : inventory.sync_enabled === false
                    ? 'Meta sync is turned off on this server (META_INVENTORY_SYNC=off in server/.env). Turn it on and restart the server, then click Sync Meta Now.'
                    : 'Click Sync Meta Now to load the WABAs, phone numbers and templates from Meta.'}
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div className="-mx-1 overflow-x-auto px-1">
                  <div className="inline-flex rounded-lg border border-border bg-muted/60 p-1">
                    {[['all', 'All accounts'], ['unassigned', 'Has free numbers'], ['empty', 'No numbers yet']].map(([key, text]) => (
                      <button
                        type="button"
                        key={key}
                        onClick={() => { setWabaFilter(key); setWabaPage(1); }}
                        className={cn(
                          'flex cursor-pointer items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold whitespace-nowrap transition-colors',
                          wabaFilter === key ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
                        )}
                      >
                        {text}
                        <span className="rounded-full bg-black/5 px-1.5 text-[11px] tabular-nums">{filterCounts[key]}</span>
                      </button>
                    ))}
                  </div>
                </div>
                <div className="relative w-full lg:w-72">
                  <FiSearch className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    placeholder="Search account, WABA ID or workspace..."
                    value={wabaSearch}
                    onChange={(e) => { setWabaSearch(e.target.value); setWabaPage(1); }}
                    className="h-9 pl-9"
                  />
                </div>
              </div>

              {/* Desktop: table */}
              <div className="hidden overflow-hidden rounded-lg border border-border md:block">
                <Table className="table-fixed">
                  <colgroup>
                    <col className="w-[30%]" />
                    <col className="w-[28%]" />
                    <col className="w-[16%]" />
                    <col className="w-[12%]" />
                    <col className="w-[14%]" />
                  </colgroup>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead>Account</TableHead>
                      <TableHead>Workspace</TableHead>
                      <TableHead>Numbers</TableHead>
                      <TableHead>Templates</TableHead>
                      <TableHead>Ownership</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {pagedWabas.length === 0 ? (
                      <TableRow className="hover:bg-transparent">
                        <TableCell colSpan={5} className="py-8 text-center text-xs text-muted-foreground">No account matches this search or filter.</TableCell>
                      </TableRow>
                    ) : pagedWabas.map((waba) => {
                      const active = wabaId === waba.waba_id;
                      return (
                        <TableRow
                          key={waba.waba_id}
                          onClick={() => setSelectedWabaId(waba.waba_id)}
                          aria-selected={active}
                          className={cn('cursor-pointer', active && 'bg-blue-50/70 hover:bg-blue-50/70')}
                        >
                          <TableCell>
                            <div className="flex min-w-0 items-center gap-2.5">
                              <span className={cn('size-2 shrink-0 rounded-full', active ? 'bg-primary' : 'bg-transparent')} />
                              <div className="min-w-0">
                                <div className={cn('truncate text-[13px] font-semibold', active && 'text-primary')}>{waba.name || 'Unnamed account'}</div>
                                <div className="truncate font-mono text-[11px] text-muted-foreground">{waba.waba_id}</div>
                              </div>
                            </div>
                          </TableCell>
                          <TableCell>
                            {waba.workspaceNames.length ? (
                              <span className="block truncate text-[13px]" title={waba.workspaceNames.join(', ')}>
                                {waba.workspaceNames[0]}{waba.workspaceNames.length > 1 && <span className="text-muted-foreground"> +{waba.workspaceNames.length - 1}</span>}
                              </span>
                            ) : (
                              <span className="text-xs text-muted-foreground">Not assigned</span>
                            )}
                          </TableCell>
                          <TableCell>
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span className="text-[13px] font-semibold tabular-nums">{waba.phoneTotal}</span>
                              {waba.unassignedCount > 0 && <Badge variant="warning" className="tabular-nums">{waba.unassignedCount} free</Badge>}
                            </div>
                          </TableCell>
                          <TableCell className="text-[13px] tabular-nums">{waba.templateTotal}</TableCell>
                          <TableCell>
                            <Badge variant={waba.ownership_type === 'owned' ? 'info' : 'purple'} className="capitalize">{waba.ownership_type}</Badge>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>

              {/* Tablet / phone: one card per account */}
              <div className="flex flex-col gap-2 md:hidden">
                {pagedWabas.length === 0 && (
                  <div className="rounded-lg border border-border py-8 text-center text-xs text-muted-foreground">No account matches this search or filter.</div>
                )}
                {pagedWabas.map((waba) => {
                  const active = wabaId === waba.waba_id;
                  return (
                    <button
                      type="button"
                      key={waba.waba_id}
                      onClick={() => setSelectedWabaId(waba.waba_id)}
                      aria-pressed={active}
                      className={cn(
                        'flex w-full cursor-pointer flex-col gap-2 rounded-lg border p-3 text-left transition-colors',
                        active ? 'border-primary bg-blue-50/70 ring-1 ring-primary' : 'border-border hover:bg-muted/50'
                      )}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className={cn('truncate text-sm font-semibold', active && 'text-primary')}>{waba.name || 'Unnamed account'}</div>
                          <div className="truncate font-mono text-[11px] text-muted-foreground">{waba.waba_id}</div>
                        </div>
                        <Badge variant={waba.ownership_type === 'owned' ? 'info' : 'purple'} className="capitalize">{waba.ownership_type}</Badge>
                      </div>
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                        <span><strong className="text-foreground tabular-nums">{waba.phoneTotal}</strong> numbers</span>
                        {waba.unassignedCount > 0 && <Badge variant="warning" className="tabular-nums">{waba.unassignedCount} free</Badge>}
                        <span><strong className="text-foreground tabular-nums">{waba.templateTotal}</strong> templates</span>
                        <span className="truncate">{waba.workspaceNames.length ? waba.workspaceNames.join(', ') : 'Not assigned'}</span>
                      </div>
                    </button>
                  );
                })}
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground">
                <div className="flex items-center gap-2">
                  <span className="hidden sm:inline">Rows per page</span>
                  <span className="sm:hidden">Per page</span>
                  <Select value={String(wabaPageSize)} onValueChange={(v) => { setWabaPageSize(Number(v)); setWabaPage(1); }}>
                    <SelectTrigger size="sm" className="h-8 w-[72px]"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {[5, 10, 20, 50].map((n) => <SelectItem key={n} value={String(n)}>{n}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="mr-1 hidden tabular-nums sm:inline">
                    {filteredWabas.length === 0
                      ? 'No accounts'
                      : `Showing ${(currentWabaPage - 1) * WABA_PAGE_SIZE + 1}–${Math.min(currentWabaPage * WABA_PAGE_SIZE, filteredWabas.length)} of ${filteredWabas.length}`}
                  </span>
                  <Button variant="outline" size="icon" className="size-8" disabled={currentWabaPage <= 1} onClick={() => setWabaPage(currentWabaPage - 1)} aria-label="Previous page">
                    <FiChevronLeft />
                  </Button>
                  <span className="px-1 tabular-nums sm:hidden">{currentWabaPage} / {wabaPageCount}</span>
                  <div className="hidden items-center gap-1.5 sm:flex">
                    {Array.from({ length: wabaPageCount }, (_, i) => i + 1)
                      .filter((n) => n === 1 || n === wabaPageCount || Math.abs(n - currentWabaPage) <= 1)
                      .map((n, i, arr) => (
                        <React.Fragment key={n}>
                          {i > 0 && n - arr[i - 1] > 1 && <span className="px-1">…</span>}
                          <Button
                            variant={n === currentWabaPage ? 'default' : 'outline'}
                            size="icon"
                            className="size-8 tabular-nums"
                            onClick={() => setWabaPage(n)}
                            aria-label={`Page ${n}`}
                            aria-current={n === currentWabaPage ? 'page' : undefined}
                          >
                            {n}
                          </Button>
                        </React.Fragment>
                      ))}
                  </div>
                  <Button variant="outline" size="icon" className="size-8" disabled={currentWabaPage >= wabaPageCount} onClick={() => setWabaPage(currentWabaPage + 1)} aria-label="Next page">
                    <FiChevronRight />
                  </Button>
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {selectedWaba && (
        <Card className="gap-4">
          <CardHeader className="px-4 sm:px-6">
            <div className="min-w-0">
              <CardTitle className="truncate text-[15px]">{selectedWaba.name}</CardTitle>
              <CardDescription className="mt-1 flex flex-wrap items-center gap-x-2 text-xs">
                <span className="font-mono">{selectedWaba.waba_id}</span>
                <span aria-hidden="true">·</span>
                <button type="button" onClick={() => setShowDetails((v) => !v)} className="inline-flex cursor-pointer items-center gap-1 font-semibold text-primary hover:underline" aria-expanded={showDetails}>
                  Account details <FiChevronDown className={cn('transition-transform', showDetails && 'rotate-180')} />
                </button>
              </CardDescription>
            </div>
            <div className="inline-flex rounded-lg border border-border bg-muted/60 p-1">
              {[['phones', 'Phone Numbers', wabaPhones.length], ['templates', 'Templates', wabaTemplateTotal]].map(([key, text, count]) => (
                <button
                  type="button"
                  key={key}
                  onClick={() => setTab(key)}
                  className={cn(
                    'flex cursor-pointer items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors',
                    tab === key ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
                  )}
                >
                  {text}
                  <span className="rounded-full bg-black/5 px-1.5 text-[11px] tabular-nums">{count}</span>
                </button>
              ))}
            </div>
          </CardHeader>

          <CardContent className="flex flex-col gap-6 px-4 sm:px-6">
            {showDetails && (
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
                ].map(([text, value, mono]) => (
                  <div key={text} className="min-w-0 border-b border-border px-4 py-3 last:border-b-0 sm:[&:nth-last-child(-n+2)]:border-b-0 lg:[&:nth-last-child(-n+4)]:border-b-0">
                    <dt className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">{text}</dt>
                    <dd className={cn('mt-1 truncate text-[13px] font-medium', mono && 'font-mono text-xs', !value && 'text-muted-foreground')} title={value || ''}>
                      {value || 'Not available'}
                    </dd>
                  </div>
                ))}
              </dl>
            )}

            {tab === 'phones' && (
              <>
                <PhoneSection
                  title="Unassigned numbers"
                  count={unassigned.length}
                  empty="Every number under this account is assigned to a workspace."
                  rows={unassigned.map((phone) => (
                    <TableRow key={phone.phone_number_id}>
                      <PhoneCell phone={phone} />
                      <StatusCell phone={phone} onEditName={openDisplayNameEditor} />
                      <TableCell>{registerControl(phone)}</TableCell>
                      <TableCell>{assignControl(phone)}</TableCell>
                    </TableRow>
                  ))}
                  cards={unassigned.map((phone) => (
                    <PhoneCard key={phone.phone_number_id} phone={phone} onEditName={openDisplayNameEditor}>
                      <div className="flex items-center justify-between gap-2 text-xs">
                        <span className="text-muted-foreground">Cloud API</span>
                        {registerControl(phone)}
                      </div>
                      {assignControl(phone)}
                    </PhoneCard>
                  ))}
                />

                <PhoneSection
                  title="Assigned numbers"
                  count={assigned.length}
                  empty="No number under this account is assigned yet."
                  assigned
                  rows={assigned.map((phone) => (
                    <TableRow key={phone.phone_number_id} className={cn(isFocusedPhone(phone) && 'bg-blue-50/70 hover:bg-blue-50/70')}>
                      <PhoneCell phone={phone} />
                      <StatusCell phone={phone} onEditName={openDisplayNameEditor} />
                      <TableCell>{workspaceOf(phone)}</TableCell>
                      <TableCell className="text-right">
                        <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setUnassignPhone(phone)}>Unassign</Button>
                      </TableCell>
                    </TableRow>
                  ))}
                  cards={assigned.map((phone) => (
                    <PhoneCard key={phone.phone_number_id} phone={phone} onEditName={openDisplayNameEditor} highlighted={isFocusedPhone(phone)}>
                      <div className="flex items-center justify-between gap-3">
                        {workspaceOf(phone)}
                        <Button size="sm" variant="outline" className="h-8 shrink-0 text-xs" onClick={() => setUnassignPhone(phone)}>Unassign</Button>
                      </div>
                    </PhoneCard>
                  ))}
                />
              </>
            )}

            {tab === 'templates' && (
              <>
                <div className="hidden overflow-hidden rounded-lg border border-border md:block">
                  <Table className="table-fixed">
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
                      {templatesLoading && !templatesByWaba[wabaId] ? (
                        <TableRow className="hover:bg-transparent">
                          <TableCell colSpan={6} className="py-10 text-center"><Spinner className="mx-auto size-5 text-primary" /></TableCell>
                        </TableRow>
                      ) : wabaTemplates.length === 0 ? (
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
                <div className="flex flex-col gap-2 md:hidden">
                  {templatesLoading && !templatesByWaba[wabaId] && <div className="flex justify-center rounded-lg border border-border py-8"><Spinner className="size-5 text-primary" /></div>}
                  {!templatesLoading && wabaTemplates.length === 0 && <div className="rounded-lg border border-border py-8 text-center text-xs text-muted-foreground">No templates found for this account.</div>}
                  {wabaTemplates.map((t) => (
                    <div key={t.template_id} className="flex flex-col gap-1.5 rounded-lg border border-border p-3">
                      <div className="flex items-start justify-between gap-2">
                        <span className="min-w-0 truncate text-sm font-semibold" title={t.name}>{t.name}</span>
                        <Badge variant={t.status === 'APPROVED' ? 'success' : t.status === 'REJECTED' ? 'danger' : 'warning'}>{t.status}</Badge>
                      </div>
                      <div className="flex flex-wrap gap-x-3 text-xs text-muted-foreground">
                        <span>{t.language}</span>
                        <span className="capitalize">{String(t.category || '').toLowerCase() || '—'}</span>
                        <span className="font-mono">{t.template_id}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </>
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

      <AlertDialog open={Boolean(unassignPhone)} onOpenChange={(open) => { if (!open && !unassigning) { setUnassignPhone(null); setUnassignPassword(''); } }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Unassign {unassignPhone?.display_phone_number}?</AlertDialogTitle>
            <AlertDialogDescription>
              {unassignPhone?.linked_brand?.tenant_name || 'This workspace'} will stop sending and receiving WhatsApp messages through this number until another number is assigned. The number stays in Meta.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <form id="unassign-form" onSubmit={(e) => { e.preventDefault(); if (unassignPassword) unassign(); }} className="flex flex-col gap-1.5">
            <label htmlFor="unassign-password" className="text-[12.5px] font-semibold">Enter your password to confirm</label>
            <PasswordInput id="unassign-password" autoFocus autoComplete="current-password" placeholder="Your password" value={unassignPassword} onChange={(e) => setUnassignPassword(e.target.value)} />
          </form>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={unassigning}>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" disabled={unassigning || !unassignPassword} onClick={(e) => { e.preventDefault(); unassign(); }}>
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
