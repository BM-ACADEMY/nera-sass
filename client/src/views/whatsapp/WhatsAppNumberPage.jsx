import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FiMessageSquare, FiFileText, FiSend, FiMapPin, FiMail, FiGlobe, FiInfo, FiCheckCircle, FiAlertTriangle, FiClock, FiRefreshCw, FiShield } from 'react-icons/fi';
import { FaWhatsapp } from 'react-icons/fa';
import { api } from '../../services/api.js';
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

const InfoRow = ({ icon: Icon, label, value, href }) => (
  <div className="flex items-start gap-3 py-2.5">
    <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground"><Icon className="size-4" /></span>
    <div className="min-w-0">
      <div className="text-[12px] text-muted-foreground">{label}</div>
      {value
        ? (href ? <a href={href} target="_blank" rel="noreferrer" className="block truncate text-sm font-medium text-blue-700 hover:underline">{value}</a> : <div className="text-sm font-medium break-words whitespace-pre-wrap">{value}</div>)
        : <div className="text-sm text-muted-foreground">Not added</div>}
    </div>
  </div>
);

/** Customer panel: the workspace's connected WhatsApp number. */
const WhatsAppNumberPage = () => {
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = async () => {
    try {
      setData(await api.get('/whatsapp/overview'));
      setError(null);
    } catch (err) {
      setError(err?.message || 'Could not load WhatsApp details');
    }
  };
  useEffect(() => { load(); }, []);

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
        <Card className="gap-1 px-5 py-5">
          <div className="mb-1 flex items-center justify-between gap-2">
            <div>
              <div className="text-[15px] font-bold">WhatsApp business profile</div>
              <p className="text-[12.5px] text-muted-foreground">What customers see when they open your profile in WhatsApp.</p>
            </div>
            {profile?.vertical && <Badge variant="outline">{title(profile.vertical)}</Badge>}
          </div>
          <div className="divide-y divide-border">
            <InfoRow icon={FiInfo} label="About" value={profile?.about} />
            <InfoRow icon={FiFileText} label="Description" value={profile?.description} />
            <InfoRow icon={FiMapPin} label="Address" value={profile?.address} />
            <InfoRow icon={FiMail} label="Email" value={profile?.email} href={profile?.email ? `mailto:${profile.email}` : undefined} />
            <InfoRow icon={FiGlobe} label="Website" value={profile?.websites?.[0]} href={profile?.websites?.[0]} />
          </div>
          <p className="mt-2 text-[12px] text-muted-foreground">To change the profile, update your Brand Profile in Settings or ask the Getnera team.</p>
        </Card>

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
