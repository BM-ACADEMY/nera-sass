import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import {
  FiArrowLeft, FiBriefcase, FiUser, FiShield, FiLogOut, FiKey, FiSlash, FiCheckCircle, FiRefreshCw,
  FiActivity, FiGlobe, FiMail, FiMapPin, FiTag, FiAlertTriangle,
} from 'react-icons/fi';
import { FaWhatsapp } from 'react-icons/fa';
import axiosClient from '../../api/axiosClient';
import ConfirmDialog from '../ConfirmDialog';
import EditBrandDialog from './EditBrandDialog';
import WhatsAppProfileDialog from './WhatsAppProfileDialog';
import BusinessProfileCard from './BusinessProfileCard';
import { Spinner } from '@/components/ui/spinner';
import UserAvatar from '../UserAvatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { relativeTime, shortDate, fullDateTime } from '../../utils/time';

const apiError = (err, fallback) => err.response?.data?.error || fallback;

// "META_PHONE_LINKED" -> "Meta phone linked"
const eventLabel = (event) => {
  const text = String(event || '').toLowerCase().replace(/_/g, ' ');
  return text.charAt(0).toUpperCase() + text.slice(1);
};

const Field = ({ label, children, mono = false }) => (
  <div className="min-w-0">
    <dt className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">{label}</dt>
    <dd className={cn('mt-1 text-[13.5px] font-medium break-words', mono && 'font-mono text-xs')}>
      {children ?? <span className="text-muted-foreground">Not set</span>}
    </dd>
  </div>
);

const Section = ({ icon: Icon, title, description, action, children }) => (
  <Card className="gap-4">
    <CardHeader className="px-4 sm:px-6">
      <div className="min-w-0">
        <CardTitle className="flex items-center gap-2 text-[15px]"><Icon className="text-primary" /> {title}</CardTitle>
        {description && <CardDescription className="mt-1 text-xs">{description}</CardDescription>}
      </div>
      {action}
    </CardHeader>
    <CardContent className="px-4 sm:px-6">{children}</CardContent>
  </Card>
);

const DetailSkeleton = () => (
  <div className="flex flex-col gap-6" aria-busy="true" aria-label="Loading workspace">
    <Skeleton className="h-8 w-64" />
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
      {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-20" />)}
    </div>
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
      {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-48" />)}
    </div>
  </div>
);

// Everything about one workspace: who owns it, its login, WhatsApp number,
// brand profile, usage and the audit trail of what staff did to it.
const WorkspaceDetail = ({ tenantId, onSuspend, onReinstate, refreshKey = 0 }) => {
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [confirm, setConfirm] = useState(null);
  const [editBrandOpen, setEditBrandOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [verifying, setVerifying] = useState(false);

  const load = async () => {
    try {
      const res = await axiosClient.get(`/admin/tenants/${tenantId}`);
      setData(res.data);
      setError('');
    } catch (err) {
      setError(apiError(err, 'Failed to load the workspace'));
    }
  };

  useEffect(() => {
    setData(null);
    load();
  }, [tenantId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Suspend/reinstate from this page, or a live change, reloads in place.
  useEffect(() => {
    if (refreshKey) load();
  }, [refreshKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const back = () => navigate('/dashboard/workspaces');

  if (error && !data) {
    return (
      <Card className="items-center gap-3 px-6 py-12 text-center">
        <span className="flex size-11 items-center justify-center rounded-full bg-amber-50 text-amber-600"><FiAlertTriangle size={20} /></span>
        <div className="text-sm font-semibold">Could not load this workspace</div>
        <p className="max-w-md text-xs text-muted-foreground">{error}</p>
        <div className="flex gap-2">
          <Button variant="outline" onClick={back}><FiArrowLeft /> All workspaces</Button>
          <Button onClick={load}><FiRefreshCw /> Try again</Button>
        </div>
      </Card>
    );
  }
  if (!data) return <DetailSkeleton />;

  const { tenant, summary, brand, whatsapp, usage = {}, users = [], invitations = [], audit = [] } = data;
  const owner = users.find((u) => u.role === 'owner') || users[0] || null;
  const suspended = tenant.status === 'suspended';
  const connected = Boolean(brand?.phone_number_id);
  const verified = brand?.whatsapp_status === 'verified';
  // Meta's live state wins over the stored verification flag.
  const metaState = String(whatsapp?.connection_status || '').toUpperCase();
  const waBadge = ['BANNED', 'RESTRICTED', 'FLAGGED', 'DISCONNECTED'].includes(metaState)
    ? { variant: 'danger', label: metaState === 'BANNED' ? 'Banned by Meta' : `${metaState.charAt(0)}${metaState.slice(1).toLowerCase()} by Meta` }
    : metaState === 'CONNECTED' || verified
      ? { variant: 'success', label: 'Connected' }
      : { variant: 'warning', label: 'Not registered yet' };
  const profileName = whatsapp?.verified_name || brand?.name || '?';

  // Asks Meta again whether the number is ready and updates the status.
  const reverify = async () => {
    setVerifying(true);
    try {
      await axiosClient.post(`/admin/tenants/${tenant.id}/whatsapp/verify`);
      toast.success('WhatsApp verified with Meta');
    } catch (err) {
      toast.error(apiError(err, 'Meta could not verify this number'));
    } finally {
      setVerifying(false);
      await load();
    }
  };

  const act = (request, success, failure) => async () => {
    try {
      await request();
      toast.success(success);
      await load();
    } catch (err) {
      toast.error(apiError(err, failure));
      throw err;
    }
  };

  const ownerName = owner?.name || owner?.email;

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <Button variant="outline" size="icon" className="mt-0.5 shrink-0" onClick={back} aria-label="Back to all workspaces">
            <FiArrowLeft />
          </Button>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="truncate text-xl font-extrabold">{tenant.name}</h2>
              <Badge variant={suspended ? 'danger' : 'success'}>{suspended ? 'Suspended' : 'Active'}</Badge>
            </div>
            <div className="mt-1 text-xs text-muted-foreground">
              Workspace #{tenant.id} · Created {shortDate(tenant.created_at)}{tenant.created_by_name ? ` by ${tenant.created_by_name}` : ''}
            </div>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <Button variant="outline" onClick={() => navigate(`/dashboard/whatsapp-numbers?workspace=${tenant.id}`)}>
            <FaWhatsapp className="text-[#25D366]" /> {connected ? 'Manage WhatsApp' : 'Connect WhatsApp'}
          </Button>
          {suspended ? (
            <Button variant="outline" onClick={() => onReinstate?.(tenant)}><FiCheckCircle /> Reinstate</Button>
          ) : (
            <Button variant="outline" className="text-red-600 hover:bg-red-50 hover:text-red-700" onClick={() => onSuspend?.(tenant)}>
              <FiSlash /> Suspend
            </Button>
          )}
        </div>
      </div>

      {suspended && (
        <div className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          <FiAlertTriangle className="mt-0.5 shrink-0" />
          <div>
            <div className="font-semibold">Suspended{tenant.suspended_at ? ` ${relativeTime(tenant.suspended_at)}` : ''}{tenant.suspended_by_name ? ` by ${tenant.suspended_by_name}` : ''}</div>
            <div className="text-xs">Reason: {tenant.suspended_reason || 'Not recorded'}. Nobody from this workspace can sign in; data is kept.</div>
          </div>
        </div>
      )}

      {/* Usage */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        {[
          ['Leads', usage.leads],
          ['Conversations', usage.conversations],
          ['Messages', usage.messages],
          ['Campaigns', usage.campaigns],
        ].map(([text, value]) => (
          <Card key={text} className="gap-1 px-5 py-4">
            <div className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{text}</div>
            <div className="text-2xl font-extrabold tabular-nums">{value == null ? '—' : value.toLocaleString('en-IN')}</div>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        {/* Owner login */}
        <Section icon={FiUser} title="Owner login" description="The workspace's single login. Share changes with the owner yourself.">
          {owner ? (
            <div className="flex flex-col gap-4">
              <div className="flex min-w-0 items-center gap-3">
                <UserAvatar name={owner.name} role="customer" size={44} />
                <div className="min-w-0">
                  <div className="truncate font-semibold">{owner.name || 'Unnamed'}</div>
                  <div className="truncate text-xs text-muted-foreground">{owner.email}</div>
                </div>
              </div>
              <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
                <Field label="Status"><Badge variant={owner.is_active ? 'success' : 'danger'}>{owner.is_active ? 'Active' : 'Deactivated'}</Badge></Field>
                <Field label="2-step"><Badge variant={owner.mfa_enabled ? 'success' : 'muted'}><FiShield /> {owner.mfa_enabled ? 'On' : 'Off'}</Badge></Field>
                <Field label="Last active"><span title={fullDateTime(owner.last_login)}>{relativeTime(owner.last_login) || 'Never signed in'}</span></Field>
                <Field label="Phone">{owner.phone || null}</Field>
                <Field label="Created">{shortDate(owner.created_at)}</Field>
              </dl>
              <div className="flex flex-wrap gap-2 border-t border-border pt-4">
                <Button size="sm" variant="outline" onClick={() => setConfirm({
                  title: `Sign ${ownerName} out everywhere?`,
                  description: 'Every signed-in session ends now. They can sign in again with their password.',
                  actionLabel: 'Sign out everywhere',
                  run: act(() => axiosClient.post(`/admin/users/${owner.id}/revoke-sessions`), 'Signed out everywhere', 'Failed to sign out'),
                })}><FiLogOut /> Sign out everywhere</Button>
                <Button size="sm" variant="outline" disabled={!owner.mfa_enabled} onClick={() => setConfirm({
                  title: `Reset 2-step verification for ${ownerName}?`,
                  description: 'They set it up again at their next sign-in.',
                  actionLabel: 'Reset 2-step',
                  run: act(() => axiosClient.post(`/admin/users/${owner.id}/reset-mfa`), '2-step verification reset', 'Failed to reset 2-step'),
                })}><FiKey /> Reset 2-step</Button>
                {owner.is_active ? (
                  <Button size="sm" variant="outline" className="text-red-600 hover:bg-red-50 hover:text-red-700" onClick={() => setConfirm({
                    title: `Deactivate ${ownerName}?`,
                    description: 'This is the only login of this workspace, so nobody can sign in until you reactivate it. No data is deleted.',
                    actionLabel: 'Deactivate',
                    destructive: true,
                    run: act(() => axiosClient.post(`/admin/users/${owner.id}/deactivate`), 'Login deactivated', 'Failed to deactivate'),
                  })}><FiSlash /> Deactivate</Button>
                ) : (
                  <Button size="sm" variant="outline" onClick={() => setConfirm({
                    title: `Reactivate ${ownerName}?`,
                    description: 'They can sign in again with their existing password.',
                    actionLabel: 'Reactivate',
                    run: act(() => axiosClient.post(`/admin/users/${owner.id}/reactivate`), 'Login reactivated', 'Failed to reactivate'),
                  })}><FiCheckCircle /> Reactivate</Button>
                )}
              </div>
            </div>
          ) : invitations.length ? (
            <div className="text-sm">
              Invitation sent to <b>{invitations[0].email}</b>, waiting to be accepted. Expires {relativeTime(invitations[0].expires_at)}.
            </div>
          ) : (
            <div className="text-sm text-muted-foreground">This workspace has no login yet.</div>
          )}
        </Section>

        {/* WhatsApp */}
        <Section
          icon={FaWhatsapp}
          title="WhatsApp"
          description="The workspace's WhatsApp number. A workspace uses one number."
          action={(
            <div className="flex flex-wrap gap-2">
              {connected && (
                <Button size="sm" variant="outline" onClick={reverify} disabled={verifying}>
                  {verifying ? <Spinner /> : <FiRefreshCw />} Re-verify with Meta
                </Button>
              )}
              <Button size="sm" variant="outline" onClick={() => navigate(`/dashboard/whatsapp-numbers?workspace=${tenant.id}`)}>
                {connected ? 'Change number' : 'Connect a number'}
              </Button>
            </div>
          )}
        >
          {connected ? (
            <div className="flex flex-col gap-4">
              <div className="flex items-center gap-3">
                {whatsapp?.profile_picture_url
                  ? <img src={whatsapp.profile_picture_url} alt="" className="size-11 rounded-full border border-border object-cover" />
                  : <span className="flex size-11 items-center justify-center rounded-full bg-green-50 text-[#25D366]"><FaWhatsapp size={22} /></span>}
                <div className="min-w-0">
                  <div className="font-semibold">{whatsapp?.display_phone_number || brand.whatsapp_number}</div>
                  <div className="truncate text-xs text-muted-foreground">{whatsapp?.verified_name || brand.name}</div>
                </div>
                <Badge variant={waBadge.variant} className="ml-auto shrink-0">{waBadge.label}</Badge>
              </div>
              <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
                <Field label="Meta status">{whatsapp?.connection_status ? <span className="capitalize">{whatsapp.connection_status.toLowerCase()}</span> : null}</Field>
                <Field label="Quality">{whatsapp?.quality_rating ? <span className="capitalize">{whatsapp.quality_rating.toLowerCase()}</span> : null}</Field>
                <Field label="Verified">{brand.whatsapp_verified_at ? shortDate(brand.whatsapp_verified_at) : null}</Field>
                <Field label="Phone Number ID" mono>{brand.phone_number_id}</Field>
                <Field label="WABA ID" mono>{brand.wa_business_id || whatsapp?.waba_id || null}</Field>
              </dl>
              {brand.whatsapp_verification_error && (
                <div className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">Last verification error: {brand.whatsapp_verification_error}</div>
              )}
            </div>
          ) : (
            <div className="flex flex-col items-start gap-2 text-sm">
              <Badge variant="muted"><FaWhatsapp /> Not connected</Badge>
              <span className="text-muted-foreground">Assign a number from WhatsApp Numbers to let this workspace send and receive messages.</span>
            </div>
          )}
        </Section>

        {/* Workspace */}
        <Section
          icon={FiBriefcase}
          title="Workspace"
          action={brand && <Button size="sm" variant="outline" onClick={() => setEditBrandOpen(true)}>Edit details</Button>}
        >
          <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            <Field label="Workspace ID" mono>#{tenant.id}</Field>
            <Field label="Status">{suspended ? 'Suspended' : 'Active'}</Field>
            <Field label="Language">{tenant.language || null}</Field>
            <Field label="Currency">{tenant.currency || null}</Field>
            <Field label="Timezone">{tenant.timezone || null}</Field>
            <Field label="Created">{fullDateTime(tenant.created_at)}</Field>
            <Field label="Created by">{tenant.created_by_name || null}</Field>
            <Field label="Logins">{summary?.users?.active ?? 0} active{summary?.users?.pending_invitations ? `, ${summary.users.pending_invitations} invited` : ''}</Field>
            <Field label="Business name">{brand?.name || null}</Field>
            <Field label="Industry">{brand?.industry || null}</Field>
            <Field label="City">{brand?.city || null}</Field>
            <Field label="Contact person">{brand?.contact_person || null}</Field>
            <Field label="Contact phone">{brand?.phone || null}</Field>
          </dl>
        </Section>

        {/* Brand / WhatsApp business profile */}
        {brand ? (
          <BusinessProfileCard brand={brand} whatsapp={whatsapp} connected={connected} onEdit={() => setProfileOpen(true)} />
        ) : (
          <Section icon={FiTag} title="Brand profile"><div className="text-sm text-muted-foreground">No brand profile.</div></Section>
        )}
      </div>

      {/* Activity */}
      <Section icon={FiActivity} title="Activity" description="What happened in this workspace and who did it (latest 50).">
        {audit.length === 0 ? (
          <div className="py-6 text-center text-xs text-muted-foreground">No activity recorded yet.</div>
        ) : (
          <ol className="flex flex-col">
            {audit.map((e, i) => (
              <li key={`${e.created_at}-${i}`} className="flex gap-3 border-b border-border py-3 last:border-b-0">
                <span className="mt-1.5 size-2 shrink-0 rounded-full bg-primary/60" />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                    <span className="text-[13.5px] font-semibold">{eventLabel(e.event)}</span>
                    <span className="text-xs text-muted-foreground" title={fullDateTime(e.created_at)}>{relativeTime(e.created_at)}</span>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {e.actor_name ? `By ${e.actor_name}` : e.actor_type === 'system' ? 'By the system' : e.actor_type === 'user' ? 'By the workspace' : 'By staff'}
                    {e.meta?.email ? ` · ${e.meta.email}` : ''}
                    {e.meta?.reason ? ` · Reason: ${e.meta.reason}` : ''}
                  </div>
                </div>
              </li>
            ))}
          </ol>
        )}
      </Section>

      <ConfirmDialog confirm={confirm} onClose={() => setConfirm(null)} />
      <EditBrandDialog open={editBrandOpen} onOpenChange={setEditBrandOpen} tenantId={tenant.id} brand={brand} onSaved={load} />
      <WhatsAppProfileDialog open={profileOpen} onOpenChange={setProfileOpen} tenantId={tenant.id} onSaved={load} />
    </div>
  );
};


export default WorkspaceDetail;
