import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { FiFacebook, FiInfo, FiAlertTriangle, FiCheckCircle, FiRefreshCw } from 'react-icons/fi';
import { api } from '../../services/api.js';
import { SettingsPageHeader, Callout } from './SettingsKit.jsx';
import { isFeatureOff, lastLeadText, pageBadge, facebookState } from './facebookLeadsPolicy.js';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogFooter, AlertDialogTitle,
  AlertDialogDescription, AlertDialogAction, AlertDialogCancel,
} from '@/components/ui/alert-dialog';

// Settings > Integrations: the workspace connects its own Facebook Pages so
// leads from its Facebook / Instagram Lead Form ads arrive in this workspace
// (GET /api/facebook-leads/status; owner/admin connect and disconnect).
export const IntegrationsSection = () => {
  const [params, setParams] = useSearchParams();
  const [status, setStatus] = useState(null);
  const [off, setOff] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [chosen, setChosen] = useState([]);
  const [confirm, setConfirm] = useState(null); // page to disconnect

  const fetchStatus = useCallback(() => api.get('/facebook-leads/status')
    .then((next) => {
      setStatus(next);
      setChosen((next.pending?.pages || []).filter((p) => !p.connected).map((p) => p.id));
      setError('');
    })
    .catch((err) => {
      if (isFeatureOff(err)) setOff(true);
      else setError(err?.message || 'Could not load your integrations.');
    }), []);
  const load = fetchStatus;
  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  // Facebook sends people back here with ?facebook=choose|error.
  useEffect(() => {
    const result = params.get('facebook');
    if (!result) return;
    if (result === 'choose') toast.success('Signed in with Facebook. Now choose the Pages to connect.');
    else toast.error(params.get('message') || 'Could not connect Facebook.', { duration: 8000 });
    setParams({}, { replace: true });
  }, [params, setParams]);

  const run = async (key, fn) => {
    setBusy(key);
    try {
      await fn();
    } finally {
      setBusy('');
    }
  };

  const connect = () => run('connect', async () => {
    try {
      const { url } = await api.post('/facebook-leads/connect', {});
      window.location.href = url;
    } catch (err) {
      toast.error(err?.message || 'Could not start the Facebook sign-in.');
    }
  });

  const savePages = () => run('pages', async () => {
    try {
      const result = await api.post('/facebook-leads/pages', { page_ids: chosen });
      for (const e of result.errors || []) toast.error(`${e.page_name}: ${e.error}`, { duration: 8000 });
      if (result.connected?.length) toast.success(`${result.connected.length} Page${result.connected.length === 1 ? '' : 's'} connected. New leads will appear on the Leads page.`);
    } catch (err) {
      toast.error(err?.message || 'Could not connect the Pages.', { duration: 8000 });
    }
    await load();
  });

  const cancelPending = () => run('cancel', async () => {
    try {
      await api.delete('/facebook-leads/pending');
    } catch (err) {
      toast.error(err?.message || 'Could not cancel.');
    }
    await load();
  });

  const disconnect = (page) => run(`disconnect-${page.page_id}`, async () => {
    try {
      const result = await api.delete(`/facebook-leads/pages/${encodeURIComponent(page.page_id)}`);
      if (result.warning) toast(result.warning, { duration: 10000 });
      else toast.success(`${page.page_name} disconnected. Leads from it will no longer arrive here.`);
    } catch (err) {
      toast.error(err?.message || 'Could not disconnect the Page.');
    }
    await load();
  });

  const toggle = (id) => setChosen((list) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]));
  const state = facebookState(status);
  const canManage = Boolean(status?.can_manage);

  return (
    <div className="max-w-3xl">
      <SettingsPageHeader section="integrations" />
      {off ? (
        <Callout><FiInfo className="mr-1 inline" /> Facebook Lead Ads is not available for your workspace yet. Leads from Click-to-WhatsApp ads already arrive in your Inbox.</Callout>
      ) : error && !status ? (
        <Card className="items-center gap-3 px-6 py-10 text-center">
          <FiAlertTriangle className="size-6 text-amber-500" />
          <p className="text-sm text-muted-foreground">{error}</p>
          <Button variant="outline" onClick={load}><FiRefreshCw /> Try again</Button>
        </Card>
      ) : state === 'loading' ? (
        <Skeleton className="h-48 rounded-2xl" />
      ) : (
        <Card>
          <CardContent className="flex flex-col gap-4">
            <div className="flex items-start gap-3">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-600 ring-4 ring-blue-100"><FiFacebook size={20} /></span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-base font-bold">Facebook Lead Ads</h2>
                  {status.pages.length ? <Badge variant="success"><FiCheckCircle /> Connected</Badge> : <Badge variant="muted">Not connected</Badge>}
                </div>
                <p className="mt-0.5 text-[13px] text-muted-foreground">
                  When someone fills in a Lead Form (Instant Form) on your Facebook or Instagram ad, they are added to your Leads page
                  with the campaign and ad name. Only Pages you connect here send leads to this workspace.
                </p>
              </div>
            </div>

            {state === 'not-configured' && (
              <Callout tone="warn">Facebook connection is not set up on Getnera's side yet. Please contact Getnera support.</Callout>
            )}
            {!canManage && (
              <Callout><FiInfo className="mr-1 inline" /> Only the workspace Owner or an Admin can connect or disconnect Facebook.</Callout>
            )}

            {status.pages.length > 0 && (
              <ul className="divide-y divide-border rounded-lg border border-border">
                {status.pages.map((page) => {
                  const badge = pageBadge(page);
                  return (
                    <li key={page.page_id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="truncate font-semibold">{page.page_name}</span>
                          <Badge variant={badge.variant}>{badge.label}</Badge>
                        </div>
                        <div className="mt-0.5 text-xs text-muted-foreground">
                          {lastLeadText(page.last_lead_at)}{page.leads_received ? ` · ${page.leads_received} lead${page.leads_received === 1 ? '' : 's'} received` : ''}
                        </div>
                        {page.last_error && <Callout tone="error" className="mt-2">{page.last_error}</Callout>}
                      </div>
                      {canManage && (
                        <Button variant="outline" size="sm" disabled={Boolean(busy)} onClick={() => setConfirm(page)}>
                          {busy === `disconnect-${page.page_id}` ? 'Disconnecting…' : 'Disconnect'}
                        </Button>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}

            {canManage && status.pending?.pages?.length > 0 && (
              <div className="flex flex-col gap-3 rounded-lg border border-blue-200 bg-blue-50/50 p-4">
                <div className="text-sm font-semibold">Choose the Pages whose Lead Form leads should come to this workspace</div>
                <div className="flex flex-col gap-2">
                  {status.pending.pages.map((p) => (
                    <label key={p.id} className="flex cursor-pointer items-center gap-2 text-sm">
                      <input type="checkbox" className="size-4" checked={p.connected || chosen.includes(p.id)} disabled={p.connected} onChange={() => toggle(p.id)} />
                      <span>{p.name}</span>
                      {p.connected && <span className="text-xs text-muted-foreground">(already connected)</span>}
                    </label>
                  ))}
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button disabled={!chosen.length || Boolean(busy)} onClick={savePages}>{busy === 'pages' ? 'Connecting…' : 'Connect selected Pages'}</Button>
                  <Button variant="ghost" disabled={Boolean(busy)} onClick={cancelPending}>Cancel</Button>
                </div>
              </div>
            )}

            {canManage && state !== 'not-configured' && state !== 'choosing' && (
              <div>
                <Button onClick={connect} disabled={Boolean(busy)}>
                  <FiFacebook /> {busy === 'connect' ? 'Opening Facebook…' : status.pages.length ? 'Connect another Page' : 'Connect Facebook'}
                </Button>
                <p className="mt-2 text-xs text-muted-foreground">
                  You will sign in with Facebook and allow Getnera to see your Pages and read their Lead Form leads. Getnera never posts on your Page.
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <AlertDialog open={Boolean(confirm)} onOpenChange={(open) => !open && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Disconnect {confirm?.page_name}?</AlertDialogTitle>
            <AlertDialogDescription>
              New Lead Form leads from this Page will stop arriving in Getnera, and Getnera deletes its access to the Page.
              Leads already received stay on your Leads page.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep connected</AlertDialogCancel>
            <AlertDialogAction onClick={() => { const page = confirm; setConfirm(null); disconnect(page); }}>Disconnect</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};
