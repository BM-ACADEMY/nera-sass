import React, { useEffect, useState } from 'react';
import { FiActivity, FiChevronLeft, FiChevronRight, FiRefreshCw } from 'react-icons/fi';
import axiosClient from '../../api/axiosClient';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { relativeTime, fullDateTime } from '../../utils/time';

// Same groups as the customer's Settings > Activity (server/services/activity.js).
const GROUPS = [
  { value: 'leads', label: 'Leads & sales tasks', tone: 'info' },
  { value: 'chat', label: 'Chats & messages', tone: 'success' },
  { value: 'campaigns', label: 'Campaigns', tone: 'purple' },
  { value: 'settings', label: 'Settings & AI', tone: 'warning' },
  { value: 'team', label: 'Team', tone: 'gold' },
  { value: 'security', label: 'Sign-in & security', tone: 'danger' },
];
const groupOf = (value) => GROUPS.find((g) => g.value === value) || { label: 'Other', tone: 'muted' };
const ROLE_NAMES = { owner: 'Owner', admin: 'Admin', staff: 'Staff', manager: 'Staff', agent: 'Staff', founder: 'Getnera admin', ops: 'Getnera staff' };
const PAGE_SIZE = 25;

const who = (actor) => {
  if (!actor) return 'System';
  const role = ROLE_NAMES[actor.role];
  return role ? `${actor.name} · ${role}` : actor.name;
};

// Older events have no summary: show the few safe facts they carry.
const fallbackDetails = (e) => [
  e.meta?.email,
  e.meta?.reason ? `Reason: ${e.meta.reason}` : null,
  e.event === 'WORKSPACE_LOGIN_LINK_SENT' && e.meta?.to ? `WhatsApp ${e.meta.to}${e.meta.status === 'failed' ? ' (not delivered)' : ''}` : null,
  e.changes?.length ? `Changed: ${e.changes.join(', ')}` : null,
].filter(Boolean).join(' · ');

// Admin panel workspace page: the workspace's activity log (who did what and
// when), from GET /admin/tenants/:id/activity, with a staff filter and paging.
const WorkspaceActivity = ({ tenantId, refreshKey = 0 }) => {
  const [user, setUser] = useState('all');
  const [group, setGroup] = useState('all');
  const [page, setPage] = useState(1);
  const [reload, setReload] = useState(0);
  // The last answer, tagged with the request it answers (loading until the
  // answer for the current filters and page has arrived).
  const [result, setResult] = useState({ key: null, data: null, error: '' });
  const requestKey = JSON.stringify([tenantId, user, group, page, reload, refreshKey]);
  const loading = result.key !== requestKey;
  const { data, error } = result;

  useEffect(() => {
    let active = true;
    const params = { page, limit: PAGE_SIZE };
    if (user !== 'all') params.user_id = user;
    if (group !== 'all') params.group = group;
    axiosClient.get(`/admin/tenants/${tenantId}/activity`, { params })
      .then((res) => { if (active) setResult({ key: requestKey, data: res.data, error: '' }); })
      .catch((err) => { if (active) setResult((last) => ({ key: requestKey, data: last.data, error: err.response?.data?.error || 'Could not load the activity log' })); });
    return () => { active = false; };
  }, [tenantId, user, group, page, requestKey]);

  const events = data?.events || [];
  const staff = data?.staff || [];
  const pick = (setter) => (value) => { setter(value); setPage(1); };

  return (
    <Card className="gap-4">
      <CardHeader className="px-4 sm:px-6">
        <div className="min-w-0">
          <CardTitle className="flex items-center gap-2 text-[15px]"><FiActivity className="text-primary" /> Activity</CardTitle>
          <CardDescription className="mt-1 text-xs">Who in this workspace (or our team) did what, and when. Newest first.</CardDescription>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 px-4 sm:px-6">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <Select value={user} onValueChange={pick(setUser)}>
            <SelectTrigger className="w-full sm:w-56" aria-label="Staff member"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Everyone</SelectItem>
              {staff.map((s) => <SelectItem key={s.id} value={String(s.id)}>{s.name}{s.active ? '' : ' (removed)'}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={group} onValueChange={pick(setGroup)}>
            <SelectTrigger className="w-full sm:w-52" aria-label="Kind of action"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Everything</SelectItem>
              {GROUPS.map((g) => <SelectItem key={g.value} value={g.value}>{g.label}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" className="sm:ml-auto" onClick={() => setReload((n) => n + 1)} disabled={loading}>
            <FiRefreshCw className={loading ? 'animate-spin' : ''} /> Refresh
          </Button>
        </div>

        {error && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>}

        {loading && !data ? (
          <div className="flex flex-col gap-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-12" />)}</div>
        ) : events.length === 0 ? (
          <div className="py-6 text-center text-xs text-muted-foreground">No activity recorded{user !== 'all' || group !== 'all' ? ' for these filters' : ' yet'}.</div>
        ) : (
          <>
            <div className="hidden md:block">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[120px]">When</TableHead>
                    <TableHead className="w-[190px]">Who</TableHead>
                    <TableHead className="w-[210px]">Action</TableHead>
                    <TableHead>Details</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {events.map((e) => (
                    <TableRow key={e.id ?? `${e.at}-${e.event}`}>
                      <TableCell className="align-top text-xs whitespace-nowrap" title={fullDateTime(e.at)}>{relativeTime(e.at)}</TableCell>
                      <TableCell className="align-top text-xs whitespace-normal">{who(e.actor)}</TableCell>
                      <TableCell className="align-top whitespace-normal">
                        <div className="text-[13px] font-medium">{e.action}</div>
                        <Badge variant={groupOf(e.group).tone} className="mt-1">{groupOf(e.group).label}</Badge>
                      </TableCell>
                      <TableCell className="align-top text-xs whitespace-normal text-muted-foreground">{e.details || fallbackDetails(e) || '—'}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <ol className="flex flex-col md:hidden">
              {events.map((e) => (
                <li key={e.id ?? `${e.at}-${e.event}`} className="flex flex-col gap-0.5 border-b border-border py-3 last:border-b-0">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                    <span className="text-[13.5px] font-semibold">{e.action}</span>
                    <span className="text-xs text-muted-foreground" title={fullDateTime(e.at)}>{relativeTime(e.at)}</span>
                  </div>
                  <div className="text-xs text-muted-foreground">{who(e.actor)}</div>
                  {(e.details || fallbackDetails(e)) && <div className="text-xs break-words text-muted-foreground">{e.details || fallbackDetails(e)}</div>}
                </li>
              ))}
            </ol>
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
              <span>{data.total} {data.total === 1 ? 'entry' : 'entries'} · page {data.page} of {data.pages}</span>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" disabled={loading || data.page <= 1} onClick={() => setPage((p) => Math.max(p - 1, 1))}><FiChevronLeft /> Newer</Button>
                <Button variant="outline" size="sm" disabled={loading || data.page >= data.pages} onClick={() => setPage((p) => p + 1)}>Older <FiChevronRight /></Button>
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
};

export default WorkspaceActivity;
