import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FiMessageSquare, FiFileText, FiSend, FiMail, FiCheckCircle, FiAlertTriangle, FiClock, FiRefreshCw, FiShield, FiLink } from 'react-icons/fi';
import { FaWhatsapp } from 'react-icons/fa';
import { api } from '../../services/api.js';
import { connectWhatsApp } from '../settings/settingsPolicy.js';
import BusinessProfileCard from './BusinessProfileCard.jsx';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

const QUALITY = { GREEN: ['success', 'High'], YELLOW: ['warning', 'Medium'], RED: ['danger', 'Low'] };
const title = (s) => String(s || '').toLowerCase().replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
const when = (v) => (v ? new Date(v).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '—');

function connectionBadge(data) {
  const status = String(data.number?.connection_status || '').toUpperCase();
  if (status === 'BANNED') return <Badge variant="danger"><FiAlertTriangle /> Banned by Meta</Badge>;
  if (status === 'CONNECTED' || data.status === 'verified') return <Badge variant="success"><FiCheckCircle /> Connected</Badge>;
  return <Badge variant="warning"><FiClock /> {status ? title(status) : 'Verification pending'}</Badge>;
}

const Stat = ({ label, value, tone }) => (
  <Card className="gap-1 px-5 py-4">
    <span className="text-[12.5px] font-medium text-muted-foreground">{label}</span>
    <span className={cn('text-2xl font-extrabold tabular-nums', tone)}>{value}</span>
  </Card>
);

/** Customer panel: the workspace's connected WhatsApp number. */
const WhatsAppNumberPage = () => {
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [signupConfig, setSignupConfig] = useState(null);

  const load = async () => {
    try {
      setData(await api.get('/whatsapp/overview'));
      setError(null);
    } catch (err) {
      setError(err?.message || 'Could not load WhatsApp details');
    }
  };
  useEffect(() => { load(); }, []);
  // Whether secure WhatsApp signup is available (shown to Owners/Admins with no number yet).
  useEffect(() => {
    if (data && !data.connected && data.can_manage && !signupConfig) {
      api.getMetaEmbeddedSignupConfig().then(setSignupConfig).catch(() => setSignupConfig({ enabled: false }));
    }
  }, [data, signupConfig]);

  if (error && !data) {
    return (
      <div className="p-4 md:p-8">
        <Card className="items-center gap-3 px-6 py-14 text-center">
          <FiAlertTriangle className="size-7 text-amber-500" />
          <div className="font-semibold">Could not load your WhatsApp number</div>
          <p className="text-sm text-muted-foreground">{error}</p>
          <Button variant="outline" onClick={load}><FiRefreshCw /> Try again</Button>
        </Card>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex flex-col gap-5 p-4 md:p-8">
        <Skeleton className="h-40 rounded-xl" />
        <div className="grid gap-4 sm:grid-cols-3"><Skeleton className="h-24 rounded-xl" /><Skeleton className="h-24 rounded-xl" /><Skeleton className="h-24 rounded-xl" /></div>
        <Skeleton className="h-64 rounded-xl" />
      </div>
    );
  }

  if (!data.connected) {
    return (
      <div className="p-4 md:p-8">
        <Card className="items-center gap-3 px-6 py-16 text-center">
          <span className="flex size-14 items-center justify-center rounded-2xl bg-green-50 text-[#25D366]"><FaWhatsapp size={28} /></span>
          <div className="text-lg font-bold">No WhatsApp number connected yet</div>
          <p className="max-w-md text-sm text-muted-foreground">
            The Getnera team connects your WhatsApp Business number to this workspace. Once it is connected you can chat with customers, send templates and run campaigns from here.
          </p>
          <Button asChild variant="outline"><a href="mailto:support@getnera.in?subject=Connect%20WhatsApp%20for%20my%20workspace"><FiMail /> Contact Getnera support</a></Button>
          {(() => {
            // "Connect WhatsApp" (secure customer-owned signup) for Owners/Admins,
            // disabled until the server reports signup as available.
            const connect = connectWhatsApp({ permissions: { manage_whatsapp: data.can_manage }, signupConfig });
            if (!connect.visible) return null;
            return (
              <div className="mt-2 flex flex-col items-center gap-1.5">
                <Button disabled={!connect.enabled} title={connect.reason || ''}><FiLink /> Connect WhatsApp</Button>
                {!connect.enabled && signupConfig && <p className="max-w-sm text-xs text-muted-foreground">{connect.reason}</p>}
              </div>
            );
          })()}
        </Card>
      </div>
    );
  }

  const { number, profile, templates } = data;
  const quality = QUALITY[String(number.quality_rating || '').toUpperCase()];
  const name = number.verified_name || data.brand_name || 'Your business';

  return (
    <div className="flex flex-col gap-5 p-4 md:p-8">
      {/* Number card */}
      <Card className="gap-0 overflow-hidden py-0">
        <div className="h-20" style={{ background: 'linear-gradient(90deg, #075e54 0%, #128c7e 55%, #25d366 100%)' }} />
        <div className="flex flex-col gap-4 px-5 pb-5 sm:flex-row sm:items-end sm:justify-between">
          <div className="flex items-end gap-4">
            <span className="-mt-10 flex size-20 shrink-0 items-center justify-center overflow-hidden rounded-full border-4 border-card bg-green-50 text-[#25D366] shadow-sm">
              {profile?.picture_url ? <img src={profile.picture_url} alt="" className="size-full object-cover" /> : <FaWhatsapp size={34} />}
            </span>
            <div className="min-w-0 pb-1">
              <div className="truncate text-lg font-extrabold">{name}</div>
              <div className="text-sm text-muted-foreground">{number.display_phone_number || '—'}</div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 pb-1">
            {connectionBadge(data)}
            {quality && <Badge variant={quality[0]}>Quality: {quality[1]}</Badge>}
            {data.managed_by_platform && <Badge variant="info"><FiShield /> Managed by Getnera</Badge>}
          </div>
        </div>
        {(() => {
          const banned = String(number.connection_status || '').toUpperCase() === 'BANNED';
          const text = banned
            ? 'Meta has banned this number, so it cannot send or receive messages. Contact the Getnera team to appeal or connect another number.'
            : data.error || (!data.can_send ? 'This number cannot send messages yet. The Getnera team is finishing the connection.' : null);
          if (!text) return null;
          return (
            <div className={cn('flex items-start gap-2 border-t px-5 py-3 text-[13px]', banned ? 'border-red-200 bg-red-50 text-red-800' : 'border-amber-200 bg-amber-50 text-amber-800')}>
              <FiAlertTriangle className="mt-0.5 shrink-0" /> {text}
            </div>
          );
        })()}
      </Card>

      {/* Templates */}
      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="Approved templates" value={templates.approved} tone="text-green-700" />
        <Stat label="In review" value={templates.pending} tone="text-amber-600" />
        <Stat label="Rejected" value={templates.rejected} tone="text-red-600" />
      </div>

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        {/* Business profile */}
        <BusinessProfileCard
          key={JSON.stringify(profile || {})}
          profile={profile}
          editable={Boolean(data.profile_editable)}
          photoEditable={Boolean(data.photo_editable)}
          canManage={Boolean(data.can_manage)}
          onSaved={load}
        />

        <div className="flex flex-col gap-5">
          {/* Quick actions */}
          <Card className="gap-2 px-5 py-5">
            <div className="mb-1 text-[15px] font-bold">Quick actions</div>
            <Button className="justify-start bg-[#25D366] hover:bg-[#1fb857]" onClick={() => navigate('/inbox')}><FiMessageSquare /> Open WhatsApp Chat</Button>
            <Button variant="outline" className="justify-start" onClick={() => navigate('/templates')}><FiFileText /> Manage templates</Button>
            <Button variant="outline" className="justify-start" onClick={() => navigate('/campaigns')}><FiSend /> Run a campaign</Button>
          </Card>

          {/* Technical details */}
          <Card className="gap-3 px-5 py-5">
            <div className="flex items-center justify-between">
              <div className="text-[15px] font-bold">Connection details</div>
              <Button variant="ghost" size="sm" disabled={refreshing} onClick={async () => { setRefreshing(true); await load(); setRefreshing(false); }}>
                <FiRefreshCw className={cn(refreshing && 'animate-spin')} /> Refresh
              </Button>
            </div>
            <dl className="grid gap-2.5 text-sm">
              {[
                ['Phone number ID', number.phone_number_id],
                ['WhatsApp Business Account', number.waba_id],
                ['Access credential', data.can_send ? `Configured${data.credential_last4 ? ` (ending ${data.credential_last4})` : ''}` : 'Not configured'],
                ['Verified', when(data.verified_at)],
                ['Last checked with Meta', when(number.last_synced_at)],
              ].map(([k, v]) => (
                <div key={k} className="flex items-center justify-between gap-3">
                  <dt className="text-muted-foreground">{k}</dt>
                  <dd className="font-mono text-[12.5px]">{v || '—'}</dd>
                </div>
              ))}
            </dl>
          </Card>
        </div>
      </div>
    </div>
  );
};

export default WhatsAppNumberPage;
