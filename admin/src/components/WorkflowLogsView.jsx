import React, { useState, useEffect } from 'react';
import { Table, Tag, Button, Select, Space, Card, Row, Col, Statistic, Popconfirm, message } from 'antd';
import { ReloadOutlined, DeleteOutlined, CheckCircleOutlined, CloseCircleOutlined, SyncOutlined, ThunderboltOutlined, RobotOutlined, CheckOutlined } from '@ant-design/icons';
import axiosClient from '../api/axiosClient';

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
      message.error(err.response?.data?.error || 'Failed to load workflow data');
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
      message.success('Log deleted');
      fetchWorkflowData();
    } catch (err) {
      message.error('Failed to delete log');
    }
  };

  const columns = [
    {
      title: 'Engine / Workflow',
      dataIndex: 'workflow',
      key: 'workflow',
      width: 180,
      render: (wf) => (
        <Tag color="geekblue" style={{ borderRadius: 10, fontWeight: 700, padding: '2px 8px' }}>
          <ThunderboltOutlined style={{ marginRight: 4 }} />
          {wf || 'WF00'}
        </Tag>
      ),
    },
    {
      title: 'Status',
      dataIndex: 'status',
      key: 'status',
      width: 120,
      render: (st) => {
        const isSuccess = st === 'success';
        const isFailed = st === 'failed';
        return (
          <Tag color={isSuccess ? 'success' : isFailed ? 'error' : 'warning'} style={{ borderRadius: 12, fontWeight: 600 }}>
            {isSuccess ? <CheckCircleOutlined /> : isFailed ? <CloseCircleOutlined /> : <SyncOutlined spin />} {String(st || 'unknown').toUpperCase()}
          </Tag>
        );
      },
    },
    {
      title: 'Execution Log / Event Message',
      dataIndex: 'message',
      key: 'message',
      render: (msg) => (
        <span style={{ fontSize: 13, color: '#334155', fontFamily: 'monospace' }}>
          {msg || 'No details provided'}
        </span>
      ),
    },
    {
      title: 'Timestamp',
      dataIndex: 'created_at',
      key: 'created_at',
      width: 170,
      render: (d) => (
        <span style={{ fontSize: 12, color: '#64748b' }}>
          {d ? new Date(d).toLocaleString('en-IN', { dateStyle: 'short', timeStyle: 'medium' }) : '—'}
        </span>
      ),
    },
    {
      title: 'Action',
      key: 'action',
      width: 80,
      render: (_, r) => (
        <Popconfirm title="Delete this log?" onConfirm={() => handleDeleteLog(r.id)} okText="Delete" cancelText="Cancel">
          <Button size="small" type="text" danger icon={<DeleteOutlined />} />
        </Popconfirm>
      ),
    },
  ];

  return (
    <div>
      <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
        <Col xs={24} sm={12} md={6}>
          <Card bordered={false} style={{ borderRadius: 12, background: '#fff', border: '1px solid #e2e8f0' }}>
            <Statistic title={<span style={{ fontSize: 12, color: '#64748b', fontWeight: 600 }}>TOTAL EXECUTIONS</span>} value={telemetry.totalExecutions || 0} prefix={<ThunderboltOutlined style={{ color: '#2563eb' }} />} valueStyle={{ color: '#0f172a', fontWeight: 800 }} />
          </Card>
        </Col>
        <Col xs={24} sm={12} md={6}>
          <Card bordered={false} style={{ borderRadius: 12, background: '#fff', border: '1px solid #e2e8f0' }}>
            <Statistic title={<span style={{ fontSize: 12, color: '#64748b', fontWeight: 600 }}>SUCCESS RATE</span>} value={telemetry.successRate ?? 100} suffix="%" prefix={<CheckOutlined style={{ color: '#16a34a' }} />} valueStyle={{ color: '#16a34a', fontWeight: 800 }} />
          </Card>
        </Col>
        <Col xs={24} sm={12} md={6}>
          <Card bordered={false} style={{ borderRadius: 12, background: '#fff', border: '1px solid #e2e8f0' }}>
            <Statistic title={<span style={{ fontSize: 12, color: '#64748b', fontWeight: 600 }}>AI INTERVENTIONS</span>} value={telemetry.aiInterventions || 0} prefix={<RobotOutlined style={{ color: '#7c3aed' }} />} valueStyle={{ color: '#7c3aed', fontWeight: 800 }} />
          </Card>
        </Col>
        <Col xs={24} sm={12} md={6}>
          <Card bordered={false} style={{ borderRadius: 12, background: '#fff', border: '1px solid #e2e8f0' }}>
            <Statistic title={<span style={{ fontSize: 12, color: '#64748b', fontWeight: 600 }}>ACTIVE ENGINES</span>} value={telemetry.activeWorkflows || 8} valueStyle={{ color: '#0f172a', fontWeight: 800 }} />
          </Card>
        </Col>
      </Row>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 800, color: '#1e293b' }}>Workflow Execution Logs</div>
          <div style={{ fontSize: 12, color: '#94a3b8' }}>
            Real-time logs for all automated AI sales, reminders, and journey workflows across the platform.
          </div>
        </div>

        <Space>
          <Select
            value={selectedEngine}
            onChange={setSelectedEngine}
            options={ENGINES.map(e => ({ value: e.id, label: e.name }))}
            style={{ width: 220 }}
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
          </Button>
        </Space>
      </div>

      <Table
        rowKey="id"
        dataSource={logs}
        columns={columns}
        loading={loading}
        pagination={{ pageSize: 12, hideOnSinglePage: true }}
        style={{ background: '#fff', borderRadius: 12, border: '1px solid #e2e8f0' }}
      />
    </div>
  );
};

export default WorkflowLogsView;
