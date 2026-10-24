import React, { useState, useEffect } from 'react';
import { toast } from 'sonner';
import { FiRefreshCw, FiCheckCircle, FiXCircle, FiLoader, FiZap, FiCheck } from 'react-icons/fi';
import axiosClient from '../api/axiosClient';
import DataTable from './DataTable';
import StatTile from './StatTile';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';

// Everything on this page is read live from n8n: only the workflows connected
// there (named "Nera WF…") and their real runs. A run whose error branch
// caught a failure (for example the LLM call) is shown as failed, not success.

const STATUSES = [
  { value: 'ALL', label: 'All Statuses' },
  { value: 'success', label: 'Success Only' },
  { value: 'error', label: 'Failed Only' },
];

const fmt = (d) => (d ? new Date(d).toLocaleString('en-IN', { dateStyle: 'short', timeStyle: 'medium' }) : '—');
const shortName = (name) => String(name || '').replace(/^Nera\s+/i, '');

const RunStatus = ({ status }) => {
  if (status === 'success') return <Badge variant="success"><FiCheckCircle />SUCCESS</Badge>;
  if (status === 'error' || status === 'crashed') return <Badge variant="danger"><FiXCircle />FAILED</Badge>;
  return <Badge variant="warning"><FiLoader />{String(status || 'unknown').toUpperCase()}</Badge>;
};

const WorkflowLogsView = () => {
  const [workflows, setWorkflows] = useState([]);
  const [runs, setRuns] = useState([]);
  const [selectedWorkflow, setSelectedWorkflow] = useState('ALL');
  const [selectedStatus, setSelectedStatus] = useState('ALL');
  const [detail, setDetail] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  const fetchWorkflowData = async () => {
    setLoading(true);
    try {
      const [wf, ex] = await Promise.all([
        axiosClient.get('/admin/n8n/workflows'),
        axiosClient.get('/admin/n8n/executions', {
          params: {
            workflow_id: selectedWorkflow !== 'ALL' ? selectedWorkflow : undefined,
            limit: 100,
          },
        }),
      ]);
      setWorkflows(wf.data?.workflows || []);
      // n8n filters by its own status; a caught error is still "success" there.
      const rows = ex.data?.executions || [];
      setRuns(selectedStatus === 'ALL' ? rows : rows.filter((r) => r.status === selectedStatus));
      setError(null);
    } catch (err) {
      setError(err.response?.data?.error || 'Could not reach n8n');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchWorkflowData();
    const timer = setInterval(fetchWorkflowData, 30000);
    return () => clearInterval(timer);
  }, [selectedWorkflow, selectedStatus]);

  const openRun = async (run) => {
    setDetail({ ...run, loading: true });
    try {
      const { data } = await axiosClient.get(`/admin/n8n/executions/${run.id}`);
      setDetail({ ...run, ...data.execution });
    } catch (err) {
      toast.error(err.response?.data?.error || 'Could not load the run');
      setDetail(null);
    }
  };

  const published = workflows.filter((w) => w.active).length;
  const succeeded = runs.filter((r) => r.status === 'success').length;
  const failed = runs.filter((r) => r.status === 'error' || r.status === 'crashed').length;

  const columns = [
    { key: 'workflow_name', title: 'Workflow', width: 200, render: (r) => <Badge variant="info" className="font-bold"><FiZap />{shortName(r.workflow_name)}</Badge> },
    { key: 'status', title: 'Status', width: 110, render: (r) => <RunStatus status={r.status} /> },
    {
      key: 'tenant_name',
      title: 'Workspace / Lead',
      width: 190,
      render: (r) => (r.tenant_id == null
        ? <span className="text-xs text-slate-400">—</span>
        : <span className="text-xs text-slate-700">{r.tenant_name || `#${r.tenant_id}`}{r.lead_id ? ` · lead #${r.lead_id}` : ''}</span>),
    },
    {
      key: 'last_node',
      title: 'Result',
      render: (r) => (r.error
        ? <span className="font-mono text-[13px] text-red-700">{r.error.node}: {r.error.message}</span>
        : <span className="font-mono text-[13px] text-slate-700">Ended at {r.last_node || '—'}</span>),
    },
    { key: 'started_at', title: 'Started', width: 160, render: (r) => <span className="text-xs text-muted-foreground">{fmt(r.started_at)}</span> },
    { key: 'duration_ms', title: 'Took', width: 70, render: (r) => <span className="text-xs tabular-nums">{r.duration_ms == null ? '—' : `${(r.duration_ms / 1000).toFixed(1)}s`}</span> },
    { key: 'id', title: 'Run', width: 100, render: (r) => <Button variant="outline" size="sm" onClick={() => openRun(r)}>#{r.id}</Button> },
  ];

  return (
    <div>
      {error && <Card className="mb-4 border-red-200 bg-red-50 px-5 py-3 text-sm text-red-700">{error}</Card>}

      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Published" value={`${published} / ${workflows.length}`} icon={<FiZap className="text-blue-600" />} />
        <StatTile label="Runs shown" value={runs.length} />
        <StatTile label="Success Rate" value={runs.length ? `${Math.round((succeeded / runs.length) * 100)}%` : '—'} icon={<FiCheck />} valueClassName="text-green-600" />
        <StatTile label="Failed" value={failed} icon={<FiXCircle />} valueClassName={failed ? 'text-red-600' : undefined} />
      </div>

      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {workflows.map((w) => (
          <Card
            key={w.id}
            role="button"
            tabIndex={0}
            onClick={() => setSelectedWorkflow(selectedWorkflow === w.id ? 'ALL' : w.id)}
            onKeyDown={(e) => e.key === 'Enter' && setSelectedWorkflow(selectedWorkflow === w.id ? 'ALL' : w.id)}
            className={cn('cursor-pointer gap-2 px-5 py-4', selectedWorkflow === w.id && 'ring-2 ring-blue-500')}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="font-bold">{shortName(w.name)}</span>
              <Badge variant={w.active ? 'success' : 'muted'}>{w.active ? 'Published' : 'Not published'}</Badge>
            </div>
            <div className="text-xs text-slate-500">Trigger: {w.trigger || '—'}</div>
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
              Last run: {w.last_execution ? <>{fmt(w.last_execution.started_at)}</> : 'never'}
            </div>
          </Card>
        ))}
      </div>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="text-base font-extrabold">Workflow Runs</div>
          <div className="text-xs text-slate-400">Live from n8n: every run of the connected workflows, newest first.</div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Select value={selectedWorkflow} onValueChange={setSelectedWorkflow}>
            <SelectTrigger className="w-60"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All Workflows</SelectItem>
              {workflows.map((w) => <SelectItem key={w.id} value={w.id}>{shortName(w.name)}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={selectedStatus} onValueChange={setSelectedStatus}>
            <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
            <SelectContent>
              {STATUSES.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button variant="outline" onClick={fetchWorkflowData} disabled={loading}>
            <FiRefreshCw className={cn(loading && 'animate-spin')} /> Refresh
          </Button>
        </div>
      </div>

      {detail && (
        <Card className="mb-4 gap-2 px-5 py-4 text-sm">
          <div className="flex items-center justify-between">
            <span className="font-bold">{shortName(detail.workflow_name)} · run #{detail.id}</span>
            <Button variant="ghost" size="sm" onClick={() => setDetail(null)}>Close</Button>
          </div>
          {detail.loading ? <span className="text-slate-500">Loading…</span> : (
            <>
              {detail.error && (
                <div className="text-red-700">
                  {detail.error.handled ? 'Run finished, but ' : 'Failed at '}<b>{detail.error.node || 'unknown node'}</b>
                  {detail.error.handled ? ' failed' : ''}: {detail.error.message}
                </div>
              )}
              <div className="flex flex-wrap gap-1.5">
                {(detail.nodes || []).map((n) => (
                  <Badge key={n.name} variant={n.status === 'error' ? 'danger' : 'success'} title={n.error || ''}>{n.name}</Badge>
                ))}
              </div>
            </>
          )}
        </Card>
      )}

      <Card className="py-2">
        <DataTable columns={columns} data={runs} loading={loading} pageSize={12} emptyText="No runs yet for the connected workflows." />
      </Card>
    </div>
  );
};

export default WorkflowLogsView;
