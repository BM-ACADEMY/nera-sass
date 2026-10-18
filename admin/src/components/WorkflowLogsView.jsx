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
  // Real values only: no success rate until something has run, no assumed engine count.
  const [telemetry, setTelemetry] = useState({ totalExecutions: 0, successRate: null, aiInterventions: 0, activeWorkflows: 0 });
  const [loading, setLoading] = useState(false);
  const [selectedEngine, setSelectedEngine] = useState('ALL');
  const [selectedStatus, setSelectedStatus] = useState('ALL');
  const [selectedScope, setSelectedScope] = useState('ALL');

  const fetchWorkflowData = async () => {
    setLoading(true);
    try {
      const [logsRes, teleRes] = await Promise.all([
        axiosClient.get('/admin/workflows/logs', {
          params: {
            workflow: selectedEngine !== 'ALL' ? selectedEngine : undefined,
            status: selectedStatus !== 'ALL' ? selectedStatus : undefined,
            scope: selectedScope !== 'ALL' ? selectedScope : undefined,
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
  }, [selectedEngine, selectedStatus, selectedScope]);

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
<<<<<<< HEAD
      render: (r) => <Badge variant="info" className="font-bold"><FiZap />{r.workflow || 'WF00'}</Badge>,
    },
    {
=======
      render: (wf) => (
        <Tag color="geekblue" style={{ borderRadius: 10, fontWeight: 700, padding: '2px 8px' }}>
          <ThunderboltOutlined style={{ marginRight: 4 }} />
          {wf || 'Unknown'}
        </Tag>
      ),
    },
    {
      // WF06/WF07 are platform events (no workspace); WF00–WF05 belong to one workspace.
      title: 'Scope',
      key: 'scope',
      width: 190,
      render: (_, r) => (r.scope === 'platform'
        ? <Tag color="purple" style={{ borderRadius: 10, fontWeight: 600 }}>Platform</Tag>
        : (
          <span>
            <Tag color="blue" style={{ borderRadius: 10, fontWeight: 600 }}>Workspace</Tag>
            <span style={{ fontSize: 12, color: '#475569' }}>{r.tenant_name || `#${r.tenant_id}`}</span>
          </span>
        )),
    },
    {
      title: 'Status',
      dataIndex: 'status',
>>>>>>> origin/aakash
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
<<<<<<< HEAD
      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Total Executions" value={telemetry.totalExecutions || 0} icon={<FiZap className="text-blue-600" />} />
        <StatTile label="Success Rate" value={`${telemetry.successRate ?? 100}%`} icon={<FiCheck />} valueClassName="text-green-600" />
        <StatTile label="AI Interventions" value={telemetry.aiInterventions || 0} icon={<FiCpu />} valueClassName="text-violet-600" />
        <StatTile label="Active Engines" value={telemetry.activeWorkflows || 8} />
      </div>
=======
      <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
        <Col xs={24} sm={12} md={6}>
          <Card bordered={false} style={{ borderRadius: 12, background: '#fff', border: '1px solid #e2e8f0' }}>
            <Statistic title={<span style={{ fontSize: 12, color: '#64748b', fontWeight: 600 }}>TOTAL EXECUTIONS</span>} value={telemetry.totalExecutions || 0} prefix={<ThunderboltOutlined style={{ color: '#2563eb' }} />} valueStyle={{ color: '#0f172a', fontWeight: 800 }} />
          </Card>
        </Col>
        <Col xs={24} sm={12} md={6}>
          <Card bordered={false} style={{ borderRadius: 12, background: '#fff', border: '1px solid #e2e8f0' }}>
            <Statistic title={<span style={{ fontSize: 12, color: '#64748b', fontWeight: 600 }}>SUCCESS RATE</span>} value={telemetry.successRate ?? '—'} suffix={telemetry.successRate == null ? undefined : '%'} prefix={<CheckOutlined style={{ color: '#16a34a' }} />} valueStyle={{ color: '#16a34a', fontWeight: 800 }} />
          </Card>
        </Col>
        <Col xs={24} sm={12} md={6}>
          <Card bordered={false} style={{ borderRadius: 12, background: '#fff', border: '1px solid #e2e8f0' }}>
            <Statistic title={<span style={{ fontSize: 12, color: '#64748b', fontWeight: 600 }}>AI INTERVENTIONS</span>} value={telemetry.aiInterventions || 0} prefix={<RobotOutlined style={{ color: '#7c3aed' }} />} valueStyle={{ color: '#7c3aed', fontWeight: 800 }} />
          </Card>
        </Col>
        <Col xs={24} sm={12} md={6}>
          <Card bordered={false} style={{ borderRadius: 12, background: '#fff', border: '1px solid #e2e8f0' }}>
            <Statistic title={<span style={{ fontSize: 12, color: '#64748b', fontWeight: 600 }}>ACTIVE ENGINES (7 DAYS)</span>} value={telemetry.activeWorkflows ?? 0} valueStyle={{ color: '#0f172a', fontWeight: 800 }} />
          </Card>
        </Col>
      </Row>
>>>>>>> origin/aakash

      <div className="mb-4 flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="text-base font-extrabold">Workflow Execution Logs</div>
          <div className="text-xs text-slate-400">
            Real-time logs for all automated AI sales, reminders, and journey workflows across the platform.
          </div>
        </div>

<<<<<<< HEAD
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
=======
        <Space>
          <Select
            value={selectedEngine}
            onChange={setSelectedEngine}
            options={ENGINES.map(e => ({ value: e.id, label: e.name }))}
            style={{ width: 220 }}
          />
          <Select
            value={selectedScope}
            onChange={setSelectedScope}
            options={[
              { value: 'ALL', label: 'All Scopes' },
              { value: 'tenant', label: 'Workspace (WF00–WF05)' },
              { value: 'platform', label: 'Platform (WF06–WF07)' },
            ]}
            style={{ width: 200 }}
          />
          <Select
            value={selectedStatus}
            onChange={setSelectedStatus}
            options={[
              { value: 'ALL', label: 'All Statuses' },
              { value: 'success', label: 'Success Only' },
              { value: 'failed', label: 'Failed Only' },
            ]}
            style={{ width: 140 }}
          />
          <Button icon={<ReloadOutlined />} onClick={fetchWorkflowData} loading={loading}>
            Refresh
>>>>>>> origin/aakash
          </Button>
        </div>
      </div>

<<<<<<< HEAD
      <Card className="py-2">
        <DataTable columns={columns} data={logs} loading={loading} pageSize={12} emptyText="No workflow logs found." />
      </Card>
=======
      <Table
        rowKey="id"
        dataSource={logs}
        columns={columns}
        loading={loading}
        pagination={{ pageSize: 12, hideOnSinglePage: true }}
        locale={{ emptyText: 'No workflow executions have been recorded yet.' }}
        style={{ background: '#fff', borderRadius: 12, border: '1px solid #e2e8f0' }}
      />
>>>>>>> origin/aakash
    </div>
  );
};

export default WorkflowLogsView;
