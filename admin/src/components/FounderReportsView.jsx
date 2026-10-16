import React, { useState, useEffect } from 'react';
import { Card, Row, Col, Statistic, Table, Tag, Button, Empty, Popconfirm, message, Typography } from 'antd';
import {
  BarChartOutlined,
  ReloadOutlined,
  DeleteOutlined,
  DollarCircleOutlined,
  ShopOutlined,
  UsergroupAddOutlined,
  TeamOutlined,
  FileTextOutlined
} from '@ant-design/icons';
import axiosClient from '../api/axiosClient';

const { Text, Title } = Typography;

const FounderReportsView = () => {
  const [snapshot, setSnapshot] = useState(null);
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(false);

  const fetchFounderData = async () => {
    setLoading(true);
    try {
      const res = await axiosClient.get('/admin/reports/founder-dashboard');
      setSnapshot(res.data?.snapshot || null);
      setReports(res.data?.reports || []);
    } catch (err) {
      message.error(err.response?.data?.error || 'Failed to load founder reports');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchFounderData();
  }, []);

  const handleDeleteReport = async (id) => {
    try {
      await axiosClient.delete(`/admin/workflows/logs/${id}`);
      message.success('Report removed');
      fetchFounderData();
    } catch (err) {
      message.error('Failed to remove report');
    }
  };

  const columns = [
    {
      title: 'Report Date',
      dataIndex: 'created_at',
      key: 'created_at',
      width: 180,
      render: (d) => (
        <span style={{ fontWeight: 600, color: '#334155' }}>
          {d ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'}
        </span>
      ),
    },
    {
      title: 'Daily AI Intelligence / Executive Summary',
      dataIndex: 'message',
      key: 'message',
      render: (msg) => (
        <div style={{ background: '#f8fafc', padding: '12px 16px', borderRadius: 8, border: '1px solid #f1f5f9', whiteSpace: 'pre-wrap', fontSize: 13, color: '#1e293b', lineHeight: 1.6 }}>
          {msg || 'Automated daily report generated without narrative.'}
        </div>
      ),
    },
    {
      title: 'Action',
      key: 'action',
      width: 80,
      render: (_, r) => (
        <Popconfirm title="Delete this report?" onConfirm={() => handleDeleteReport(r.id)} okText="Delete" cancelText="Cancel">
          <Button size="small" type="text" danger icon={<DeleteOutlined />} />
        </Popconfirm>
      ),
    },
  ];

  return (
    <div>
      <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
        <Col xs={24} sm={12} md={8}>
          <Card bordered={false} style={{ borderRadius: 12, background: '#fff', border: '1px solid #e2e8f0' }}>
            <Statistic
              title={<span style={{ fontSize: 12, color: '#64748b', fontWeight: 600 }}>MONTHLY RECURRING REVENUE (MRR)</span>}
              value={snapshot?.mrr || 0}
              prefix="₹"
              formatter={(val) => Number(val).toLocaleString('en-IN')}
              valueStyle={{ color: '#16a34a', fontWeight: 800 }}
            />
          </Card>
        </Col>
        <Col xs={24} sm={12} md={8}>
          <Card bordered={false} style={{ borderRadius: 12, background: '#fff', border: '1px solid #e2e8f0' }}>
            <Statistic
              title={<span style={{ fontSize: 12, color: '#64748b', fontWeight: 600 }}>TOTAL CONTRACT VALUE (TCV)</span>}
              value={snapshot?.totalContractValue || 0}
              prefix="₹"
              formatter={(val) => Number(val).toLocaleString('en-IN')}
              valueStyle={{ color: '#2563eb', fontWeight: 800 }}
            />
          </Card>
        </Col>
        <Col xs={24} sm={12} md={8}>
          <Card bordered={false} style={{ borderRadius: 12, background: '#fff', border: '1px solid #e2e8f0' }}>
            <Statistic
              title={<span style={{ fontSize: 12, color: '#64748b', fontWeight: 600 }}>ACTIVE SUBSCRIPTIONS</span>}
              value={snapshot?.activeSubscriptions || 0}
              prefix={<DollarCircleOutlined style={{ color: '#d97706' }} />}
              valueStyle={{ color: '#d97706', fontWeight: 800 }}
            />
          </Card>
        </Col>
      </Row>

      <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
        <Col xs={24} sm={8}>
          <Card bordered={false} style={{ borderRadius: 12, background: '#fff', border: '1px solid #e2e8f0' }}>
            <Statistic
              title={<span style={{ fontSize: 12, color: '#64748b', fontWeight: 600 }}>TOTAL WORKSPACES</span>}
              value={snapshot?.totalWorkspaces || 0}
              prefix={<ShopOutlined style={{ color: '#3b82f6' }} />}
              valueStyle={{ color: '#0f172a', fontWeight: 800 }}
            />
          </Card>
        </Col>
        <Col xs={24} sm={8}>
          <Card bordered={false} style={{ borderRadius: 12, background: '#fff', border: '1px solid #e2e8f0' }}>
            <Statistic
              title={<span style={{ fontSize: 12, color: '#64748b', fontWeight: 600 }}>PLATFORM USERS</span>}
              value={snapshot?.totalUsers || 0}
              prefix={<TeamOutlined style={{ color: '#8b5cf6' }} />}
              valueStyle={{ color: '#0f172a', fontWeight: 800 }}
            />
          </Card>
        </Col>
        <Col xs={24} sm={8}>
          <Card bordered={false} style={{ borderRadius: 12, background: '#fff', border: '1px solid #e2e8f0' }}>
            <Statistic
              title={<span style={{ fontSize: 12, color: '#64748b', fontWeight: 600 }}>TOTAL LEADS MANAGED</span>}
              value={snapshot?.totalLeads || 0}
              prefix={<UsergroupAddOutlined style={{ color: '#10b981' }} />}
              valueStyle={{ color: '#0f172a', fontWeight: 800 }}
            />
          </Card>
        </Col>
      </Row>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 800, color: '#1e293b' }}>Founder Daily Intelligence Reports</div>
          <div style={{ fontSize: 12, color: '#94a3b8' }}>
            Automated executive digests generated by WF06 with revenue, team SLA, and conversation velocity.
          </div>
        </div>
        <Button icon={<ReloadOutlined />} onClick={fetchFounderData} loading={loading}>
          Refresh
        </Button>
      </div>

      <Table
        rowKey="id"
        dataSource={reports}
        columns={columns}
        loading={loading}
        pagination={{ pageSize: 8, hideOnSinglePage: true }}
        locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No daily founder reports recorded yet." style={{ padding: '32px 0' }} /> }}
        style={{ background: '#fff', borderRadius: 12, border: '1px solid #e2e8f0' }}
      />
    </div>
  );
};

export default FounderReportsView;
