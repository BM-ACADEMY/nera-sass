import { useEffect, useState } from 'react';
import { FiRefreshCw, FiChevronLeft, FiChevronRight, FiX, FiAlertTriangle } from 'react-icons/fi';
import { api } from '../../services/api.js';
import { canViewActivity } from './settingsPolicy.js';
import {
  ACTIVITY_GROUPS, activityQuery, activityFilterProblem, hasActivityFilters, emptyActivityFilters, actorText, activityTime, groupTone, groupLabel,
} from './activityPolicy.js';
import { SettingsPageHeader, FormRow, Callout } from './SettingsKit.jsx';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

// Settings > Activity: who in the workspace did what, and when
// (GET /api/activity, owner/admin). Newest first, 25 per page, filtered by
// team member, kind of action and dates. A table on wide screens, a list of
// cards on phones.
export const ActivitySection = ({ me }) => {
  const allowed = canViewActivity(me?.role);
  const [filters, setFilters] = useState(emptyActivityFilters);
  const [page, setPage] = useState(1);
  const [reloadKey, setReloadKey] = useState(0);
  // The last answer, tagged with the request it answers: loading until the
  // answer for the current filters, page and refresh has arrived.
  const [result, setResult] = useState({ key: null, data: null, error: '' });
  const problem = activityFilterProblem(filters);
  const requestKey = JSON.stringify([filters, page, reloadKey]);
  const loading = !problem && result.key !== requestKey;
  const data = result.data;
  const error = result.error;

  useEffect(() => {
    if (!allowed || problem) return undefined;
    let active = true;
    api.getActivity(activityQuery(filters, page))
      .then((answer) => {
        if (active) setResult({ key: requestKey, data: answer, error: '' });
      })
      .catch((err) => {
        if (active) setResult((last) => ({ key: requestKey, data: last.data, error: err.message || 'Could not load the activity log. Please try again.' }));
      });
    return () => { active = false; };
  }, [allowed, problem, filters, page, requestKey]);

  const change = (key) => (value) => {
    setFilters((current) => ({ ...current, [key]: value }));
    setPage(1);
  };

  if (!allowed) {
    return (
      <div className="max-w-6xl">
        <SettingsPageHeader section="activity" />
        <Callout tone="warn">Only the workspace owner and admins can see the activity log.</Callout>
      </div>
    );
  }

  const events = data?.events || [];
  const staff = data?.staff || [];

  return (
    <div className="max-w-6xl">
      <SettingsPageHeader section="activity" />

      <Card className="mb-4 gap-0 py-4">
        <CardContent className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_150px_150px_auto] lg:items-end">
          <FormRow label="Team member" htmlFor="activity-user">
            <Select value={filters.user} onValueChange={change('user')}>
              <SelectTrigger id="activity-user" className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Everyone</SelectItem>
                {staff.map((person) => (
                  <SelectItem key={person.id} value={String(person.id)}>
                    {person.name}{person.active ? '' : ' (removed)'}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormRow>
          <FormRow label="What" htmlFor="activity-group">
            <Select value={filters.group} onValueChange={change('group')}>
              <SelectTrigger id="activity-group" className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Everything</SelectItem>
                {ACTIVITY_GROUPS.map((group) => <SelectItem key={group.value} value={group.value}>{group.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </FormRow>
          <FormRow label="From" htmlFor="activity-from">
            <Input id="activity-from" type="date" value={filters.from} max={filters.to || undefined} onChange={(e) => change('from')(e.target.value)} />
          </FormRow>
          <FormRow label="To" htmlFor="activity-to">
            <Input id="activity-to" type="date" value={filters.to} min={filters.from || undefined} onChange={(e) => change('to')(e.target.value)} />
          </FormRow>
          <div className="flex gap-2 sm:col-span-2 lg:col-span-1">
            {hasActivityFilters(filters) && (
              <Button variant="ghost" onClick={() => { setFilters(emptyActivityFilters()); setPage(1); }}><FiX /> Clear</Button>
            )}
            <Button variant="outline" onClick={() => setReloadKey((key) => key + 1)} disabled={loading} aria-label="Refresh">
              <FiRefreshCw className={loading ? 'animate-spin' : ''} /> Refresh
            </Button>
          </div>
        </CardContent>
      </Card>

      {problem && <Callout tone="warn" className="mb-4">{problem}</Callout>}
      {error && !problem && <Callout tone="error" className="mb-4"><FiAlertTriangle className="mr-1.5 inline" />{error}</Callout>}

      {loading && !data ? (
        <div className="flex flex-col gap-2">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-14 rounded-xl" />)}</div>
      ) : !events.length ? (
        <Card className="items-center px-6 py-12 text-center">
          <div className="font-semibold">No activity found</div>
          <p className="text-sm text-muted-foreground">
            {hasActivityFilters(filters) ? 'Nothing matches these filters. Try a wider date range or another team member.' : 'Changes made by your team will show up here.'}
          </p>
        </Card>
      ) : (
        <>
          {/* Wide screens: a table. */}
          <Card className="hidden gap-0 overflow-hidden py-0 md:flex">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[130px]">When</TableHead>
                  <TableHead className="w-[190px]">Who</TableHead>
                  <TableHead className="w-[220px]">Action</TableHead>
                  <TableHead>Details</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {events.map((event) => {
                  const when = activityTime(event.at);
                  return (
                    <TableRow key={event.id}>
                      <TableCell className="align-top whitespace-nowrap">
                        <div className="font-medium">{when.date}</div>
                        <div className="text-xs text-muted-foreground">{when.time}</div>
                      </TableCell>
                      <TableCell className="align-top whitespace-normal">{actorText(event.actor)}</TableCell>
                      <TableCell className="align-top whitespace-normal">
                        <div className="font-medium">{event.action}</div>
                        <Badge variant={groupTone(event.group)} className="mt-1">{groupLabel(event.group)}</Badge>
                      </TableCell>
                      <TableCell className="align-top text-sm whitespace-normal text-slate-600">{event.details || '—'}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </Card>

          {/* Phones: one card per event. */}
          <div className="flex flex-col gap-2 md:hidden">
            {events.map((event) => {
              const when = activityTime(event.at);
              return (
                <Card key={event.id} className="gap-1.5 px-4 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 font-semibold">{event.action}</div>
                    <span className="shrink-0 text-xs text-muted-foreground">{when.date}, {when.time}</span>
                  </div>
                  <div className="text-[13px] text-slate-600">{actorText(event.actor)}</div>
                  {event.details && <div className="text-[13px] break-words text-slate-500">{event.details}</div>}
                  <Badge variant={groupTone(event.group)} className="mt-0.5">{groupLabel(event.group)}</Badge>
                </Card>
              );
            })}
          </div>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm text-muted-foreground">
            <span>{data.total} {data.total === 1 ? 'entry' : 'entries'} · page {data.page} of {data.pages}</span>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={loading || data.page <= 1} onClick={() => setPage((p) => Math.max(p - 1, 1))}><FiChevronLeft /> Newer</Button>
              <Button variant="outline" size="sm" disabled={loading || data.page >= data.pages} onClick={() => setPage((p) => p + 1)}>Older <FiChevronRight /></Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
};
