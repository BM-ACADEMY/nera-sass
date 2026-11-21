import { useState, useEffect, useCallback } from 'react';
import { useNavigate, useParams, Navigate } from 'react-router-dom';
import { FiChevronRight, FiRefreshCw, FiAlertTriangle } from 'react-icons/fi';
import { api } from '../services/api.js';
import { settingsSections, settingsLoadState, findSection, roleLabel } from './settings/settingsPolicy.js';
import { syncCurrentUser } from '../hooks/useAuth.js';
import { NOTICE_KEY, NOTICES, USER_KEY } from '../services/session.js';
import { SectionIcon, Callout } from './settings/SettingsKit.jsx';
import { ProfileSection } from './settings/ProfileSection.jsx';
import { BrandProfileSection } from './settings/BrandProfileSection.jsx';
import { TwoStepSection } from './settings/TwoStepSection.jsx';
import { PasswordSection } from './settings/PasswordSection.jsx';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

// Customer Settings, laid out like the admin panel's: a summary banner and a
// hub of cards, each opening /settings/<section>. Everything is read from the
// signed-in user's own workspace (the server decides which one from the
// session); what can be edited follows the permission flags in GET
// /api/tenant, and the server checks every change again.
// Billing is its own page (/billing); WhatsApp is on the WhatsApp Number page.
export const SettingsView = () => {
  const { section } = useParams();
  const navigate = useNavigate();
  const [tenantInfo, setTenantInfo] = useState(null);
  const [brand, setBrand] = useState(null);
  const [me, setMe] = useState(null);
  const [loaded, setLoaded] = useState(false); // at least one complete load
  const [error, setError] = useState('');
  const [version, setVersion] = useState(0); // remounts the forms after each load
  const [reloadKey, setReloadKey] = useState(0);
  const load = useCallback(() => setReloadKey((key) => key + 1), []);

  useEffect(() => {
    let active = true;
    Promise.all([api.getTenant(), api.getClients(), api.getMe()])
      .then(([tenant, clients, profile]) => {
        if (!active) return;
        setTenantInfo(tenant);
        setBrand(clients.clients?.[0] || null);
        setMe(profile);
        setError('');
        setLoaded(true);
        setVersion((v) => v + 1);
        syncCurrentUser(profile); // header and sidebar show the current name and role
      })
      .catch((err) => {
        if (active) setError(err.message || 'Please check your connection and try again.');
      });
    return () => { active = false; };
  }, [reloadKey]);

  // Every session was revoked by the server, including this one.
  const signedOutEverywhere = () => {
    localStorage.removeItem(USER_KEY);
    sessionStorage.setItem(NOTICE_KEY, NOTICES.signedOutEverywhere);
    window.location.href = '/login';
  };

  if (section && !findSection(section)) return <Navigate to="/settings" replace />;

  const view = settingsLoadState({ loaded, error });
  if (view === 'loading') {
    return (
      <div className="flex max-w-6xl flex-col gap-5 p-4 md:p-8">
        <Skeleton className="h-28 rounded-2xl" />
        <div className="grid gap-4 md:grid-cols-2"><Skeleton className="h-24 rounded-2xl" /><Skeleton className="h-24 rounded-2xl" /></div>
      </div>
    );
  }
  if (view === 'error') {
    // Nothing loaded: show the problem and a retry, never empty forms.
    return (
      <div className="p-4 md:p-8">
        <Card className="max-w-xl items-center gap-3 px-6 py-12 text-center">
          <FiAlertTriangle className="size-7 text-amber-500" />
          <div className="font-semibold">Settings could not be loaded</div>
          <p className="text-sm text-muted-foreground">{error}</p>
          <Button variant="outline" onClick={load}><FiRefreshCw /> Try again</Button>
        </Card>
      </div>
    );
  }

  const stale = view === 'ready-with-error' && (
    <Callout tone="error" className="mb-4">Could not refresh settings ({error}). Showing the last loaded values.</Callout>
  );

  const props = { tenantInfo, brand, me, onSaved: load };
  if (section) {
    return (
      <div className="p-4 md:p-8">
        {stale}
        {section === 'profile' && <ProfileSection key={version} {...props} />}
        {section === 'brand' && <BrandProfileSection key={version} {...props} />}
        {section === 'two-step' && <TwoStepSection key={version} {...props} />}
        {section === 'password' && <PasswordSection key={version} {...props} onSignedOutEverywhere={signedOutEverywhere} />}
      </div>
    );
  }

  const tenant = tenantInfo?.tenant || {};
  const status = {
    profile: tenant.name,
    brand: brand?.name || 'Not set up yet',
    'two-step': me?.mfa_enabled ? <Badge variant="success">On</Badge> : <Badge variant="danger">Off</Badge>,
    password: null,
  };

  return (
    <div className="max-w-6xl p-4 md:p-8">
      {stale}
      {/* Account summary */}
      <div className="relative mb-6 overflow-hidden rounded-2xl border border-border bg-gradient-to-r from-blue-600 to-indigo-600 p-5 text-white shadow-sm sm:p-6">
        <div className="pointer-events-none absolute -top-16 -right-10 size-48 rounded-full bg-white/10" />
        <div className="relative flex flex-col gap-4 sm:flex-row sm:items-center">
          <span className="flex size-14 shrink-0 items-center justify-center rounded-full bg-white text-xl font-extrabold text-blue-700 shadow-md">
            {me?.name ? me.name.trim()[0].toUpperCase() : 'U'}
          </span>
          <div className="min-w-0 flex-1">
            <div className="truncate text-xl font-extrabold">{me?.name || 'Your account'}</div>
            <div className="truncate text-sm text-blue-100">{me?.email}</div>
          </div>
          <div className="flex flex-wrap gap-2">
            {tenant.name && <span className="rounded-full bg-white/15 px-3 py-1 text-xs font-semibold ring-1 ring-white/25">{tenant.name}</span>}
            {roleLabel(me?.role) && <span className="rounded-full bg-white/15 px-3 py-1 text-xs font-semibold ring-1 ring-white/25">{roleLabel(me?.role)}</span>}
            <span className={`rounded-full px-3 py-1 text-xs font-semibold ring-1 ${me?.mfa_enabled ? 'bg-emerald-400/20 ring-emerald-200/40' : 'bg-red-400/25 ring-red-200/40'}`}>
              {me?.mfa_enabled ? '2-step on' : '2-step off'}
            </span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {settingsSections().map((s) => (
          <button
            key={s.key}
            type="button"
            onClick={() => navigate(`/settings/${s.key}`)}
            className="group flex cursor-pointer items-start gap-4 rounded-2xl border border-border bg-card p-5 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-md"
          >
            <SectionIcon section={s.key} size={22} className="size-12" />
            <span className="min-w-0 flex-1">
              <span className="block font-bold text-slate-900">{s.title}</span>
              <span className="mt-0.5 block text-[13px] text-muted-foreground">{s.text}</span>
              {status[s.key] && <span className="mt-2.5 block text-xs text-slate-500">{status[s.key]}</span>}
            </span>
            <FiChevronRight className="mt-1 text-slate-300 transition-transform group-hover:translate-x-0.5 group-hover:text-primary" />
          </button>
        ))}
      </div>
    </div>
  );
};
