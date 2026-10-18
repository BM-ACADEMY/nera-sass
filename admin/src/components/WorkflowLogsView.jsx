import React, { useState, useEffect } from 'react';
import { toast } from 'sonner';
import { FiRefreshCw, FiCheckCircle, FiXCircle, FiLoader, FiZap, FiCpu, FiCheck } from 'react-icons/fi';
import axiosClient from '../api/axiosClient';
import DataTable from './DataTable';
import StatTile from './StatTile';
import ConfirmDeleteButton from './ConfirmDeleteButton';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';

const ENGINES = [
  { id: 'ALL', name: 'All Engines' },
  { id: 'WF00', name: 'WF00: Lead Integrator' },
  { id: 'WF01', name: 'WF01: Conversational Sales' },
  { id: 'WF02', name: 'WF02: Automated Follow-ups' },
  { id: 'WF03', name: 'WF03: SLA & Reminders' },
  { id: 'WF04', name: 'WF04: Customer Journey' },
  { id: 'WF05', name: 'WF05: Marketing Broadcasts' },
  { id: 'WF06', name: 'WF06: Founder Dashboard' },
  { id: 'WF07', name: 'WF07: Maintenance & Memory' },
];

const STATUSES = [
  { value: 'ALL', label: 'All Statuses' },
  { value: 'success', label: 'Success Only' },
  { value: 'failed', label: 'Failed Only' },
];

const WorkflowLogsView = () => {
  const [logs, setLogs] = useState([]);
  const [telemetry, setTelemetry] = useState({ totalExecutions: 0, successRate: 100, aiInterventions: 0, activeWorkflows: 8 });
  const [loading, setLoading] = useState(false);
  const [selectedEngine, setSelectedEngine] = useState('ALL');
  const [selectedStatus, setSelectedStatus] = useState('ALL');

  const fetchWorkflowData = async () => {
    setLoading(true);
    try {
      const [logsRes, teleRes] = await Promise.all([
        axiosClient.get('/admin/workflows/logs', {
          params: {
            workflow: selectedEngine !== 'ALL' ? selectedEngine : undefined,
            status: selectedStatus !== 'ALL' ? selectedStatus : undefined,
          },
        }),
        axiosClient.get('/admin/workflows/telemetry'),
      ]);
      setLogs(logsRes.data?.logs || []);
      if (teleRes.data?.telemetry) setTelemetry(teleRes.data.telemetry);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to load workflow data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchWorkflowData();
  }, [selectedEngine, selectedStatus]);

  const handleDeleteLog = async (id) => {
    try {
      await axiosClient.delete(`/admin/workflows/logs/${id}`);
      toast.success('Log deleted');
      fetchWorkflowData();
    } catch (err) {
      toast.error('Failed to delete log');
    }
  };

  const columns = [
    {
      key: 'workflow',
      title: 'Engine / Workflow',
      width: 180,
      render: (r) => <Badge variant="info" className="font-bold"><FiZap />{r.workflow || 'WF00'}</Badge>,
    },
    {
      key: 'status',
      title: 'Status',
      width: 120,
      render: (r) => {
        const isSuccess = r.status === 'success';
        const isFailed = r.status === 'failed';
        return (
          <Badge variant={isSuccess ? 'success' : isFailed ? 'danger' : 'warning'}>
            {isSuccess ? <FiCheckCircle /> : isFailed ? <FiXCircle /> : <FiLoader className="animate-spin" />}
            {String(r.status || 'unknown').toUpperCase()}
          </Badge>
        );
      },
    },
    {
      key: 'message',
      title: 'Execution Log / Event Message',
      render: (r) => <span className="font-mono text-[13px] text-slate-700">{r.message || 'No details provided'}</span>,
    },
    {
      key: 'created_at',
      title: 'Timestamp',
      width: 170,
      render: (r) => (
        <span className="text-xs text-muted-foreground">
          {r.created_at ? new Date(r.created_at).toLocaleString('en-IN', { dateStyle: 'short', timeStyle: 'medium' }) : '—'}
        </span>
      ),
    },
    {
      key: 'action',
      title: 'Action',
      width: 80,
      render: (r) => <ConfirmDeleteButton title="Delete this log?" onConfirm={() => handleDeleteLog(r.id)} />,
    },
  ];

  return (
    <div>
      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Total Executions" value={telemetry.totalExecutions || 0} icon={<FiZap className="text-blue-600" />} />
        <StatTile label="Success Rate" value={`${telemetry.successRate ?? 100}%`} icon={<FiCheck />} valueClassName="text-green-600" />
        <StatTile label="AI Interventions" value={telemetry.aiInterventions || 0} icon={<FiCpu />} valueClassName="text-violet-600" />
        <StatTile label="Active Engines" value={telemetry.activeWorkflows || 8} />
      </div>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="text-base font-extrabold">Workflow Execution Logs</div>
          <div className="text-xs text-slate-400">
            Real-time logs for all automated AI sales, reminders, and journey workflows across the platform.
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Select value={selectedEngine} onValueChange={setSelectedEngine}>
            <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
            <SelectContent>
              {ENGINES.map((e) => <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>)}
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

      <Card className="py-2">
        <DataTable columns={columns} data={logs} loading={loading} pageSize={12} emptyText="No workflow logs found." />
      </Card>
    </div>
  );
};

export default WorkflowLogsView;
