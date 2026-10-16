import React from 'react';
import { Table, Tag, Button, Empty, Dropdown, Tooltip } from 'antd';
import { MoreOutlined, SettingOutlined, StopOutlined, CheckCircleOutlined, UserOutlined, CrownOutlined } from '@ant-design/icons';
import { FaWhatsapp } from 'react-icons/fa';

const LIFECYCLE_TAGS = {
  active: { color: 'success', label: 'Active' },
  grace: { color: 'processing', label: 'Grace Period (Days 1–7)' },
  restricted: { color: 'warning', label: 'Restricted (Read-Only)' },
  suspended: { color: 'error', label: 'Suspended (No Login)' },
  archived: { color: 'purple', label: 'Archived' },
  deleted: { color: 'default', label: 'Deleted' },
};

const WA_STATUS_TAGS = {
  verified: { color: '#15803d', bg: '#f0fdf4', label: 'Verified' },
  verification_pending: { color: '#b45309', bg: '#fffbeb', label: 'Pending' },
  verification_failed: { color: '#b91c1c', bg: '#fef2f2', label: 'Failed' },
  not_configured: { color: '#64748b', bg: '#f8fafc', label: 'Not Configured' },
};

const TenantsList = ({
  tenants,
  loading,
  onConfigureWhatsApp,
  onSuspendTenant,
  onReinstateTenant,
  onViewTenant,
}) => {
  const columns = [
    {
      title: 'Workspace',
      dataIndex: 'name',
      key: 'name',
      sorter: (a, b) => String(a.name || '').localeCompare(String(b.name || '')),
      render: (_, tenant) => (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontWeight: 700, fontSize: 14, color: '#1e293b' }}>
              {tenant.name || 'Unnamed Workspace'}
            </span>
            {tenant.is_founding_client && (
              <Tag color="gold" style={{ fontSize: 10.5, borderRadius: 10, fontWeight: 700 }}>
                Founding Client
              </Tag>
            )}
          </div>
          <div style={{ fontSize: 11.5, color: '#94a3b8' }}>
            ID: #{tenant.id} · Brand: {tenant.brand?.name || tenant.name}
          </div>
        </div>
      ),
    },
    {
      title: 'Owner',
      key: 'owner',
      render: (_, tenant) => {
        const owner = tenant.owner;
        if (!owner) {
          return <span style={{ color: '#94a3b8', fontSize: 12.5, fontStyle: 'italic' }}>Pending Invitation</span>;
        }
        return (
          <div>
            <div style={{ fontWeight: 600, fontSize: 13, color: '#334155' }}>{owner.name}</div>
            <div style={{ fontSize: 11.5, color: '#94a3b8' }}>{owner.email}</div>
          </div>
        );
      },
    },
    {
      title: 'Plan & Seats',
      key: 'plan',
      render: (_, tenant) => {
        const planName = tenant.plan?.name || 'No Plan';
        const activeUsers = tenant.users?.active || 0;
        const maxUsers = tenant.users?.max_users === -1 ? '∞' : (tenant.users?.max_users || 3);
        return (
          <div>
            <div style={{ fontWeight: 600, fontSize: 13, color: '#1e293b' }}>{planName}</div>
            <div style={{ fontSize: 11.5, color: '#64748b' }}>
              {activeUsers} / {maxUsers} seats used
            </div>
          </div>
        );
      },
    },
    {
      title: 'WhatsApp',
      key: 'whatsapp',
      render: (_, tenant) => {
        const statusKey = tenant.brand?.whatsapp_status || 'not_configured';
        const tag = WA_STATUS_TAGS[statusKey] || WA_STATUS_TAGS.not_configured;
        const num = tenant.brand?.whatsapp_number;
        return (
          <div>
            <Tag style={{ background: tag.bg, color: tag.color, border: 'none', borderRadius: 12, fontWeight: 700, fontSize: 11 }}>
              <FaWhatsapp style={{ marginRight: 4, verticalAlign: -1 }} />
              {tag.label}
            </Tag>
            {num && <div style={{ fontSize: 11.5, color: '#64748b', marginTop: 2 }}>{num}</div>}
          </div>
        );
      },
    },
    {
      title: 'Lifecycle',
      key: 'lifecycle',
      render: (_, tenant) => {
        const stateKey = tenant.status === 'suspended' ? 'suspended' : (tenant.lifecycle_state || 'active');
        const tag = LIFECYCLE_TAGS[stateKey] || LIFECYCLE_TAGS.active;
        return (
          <Tag color={tag.color} style={{ borderRadius: 12, fontWeight: 600 }}>
            {tag.label}
          </Tag>
        );
      },
    },
    {
      title: 'Created',
      dataIndex: 'created_at',
      key: 'created_at',
      render: (date) => (
        <span style={{ fontSize: 12, color: '#64748b' }}>
          {date ? new Date(date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'}
        </span>
      ),
    },
    {
      title: 'Actions',
      key: 'actions',
      render: (_, tenant) => {
        const isSuspended = tenant.status === 'suspended';
        const items = [
          {
            key: 'whatsapp',
            icon: <FaWhatsapp color="#25D366" />,
            label: 'Configure WhatsApp',
            onClick: () => onConfigureWhatsApp && onConfigureWhatsApp(tenant),
          },
          {
            key: 'details',
            icon: <SettingOutlined />,
            label: 'View Workspace Details',
            onClick: () => onViewTenant && onViewTenant(tenant),
          },
          {
            key: 'lifecycle',
            icon: isSuspended ? <CheckCircleOutlined /> : <StopOutlined />,
            danger: !isSuspended,
            label: isSuspended ? 'Reinstate Workspace' : 'Suspend Workspace',
            onClick: () => {
              if (isSuspended) {
                onReinstateTenant && onReinstateTenant(tenant);
              } else {
                onSuspendTenant && onSuspendTenant(tenant);
              }
            },
          },
        ];

        return (
          <Dropdown menu={{ items }} trigger={['click']}>
            <Button size="small" type="text" icon={<MoreOutlined />} />
          </Dropdown>
        );
      },
    },
  ];

  return (
    <Table
      className="tenants-table"
      rowKey="id"
      loading={loading}
      dataSource={tenants}
      columns={columns}
      pagination={{ pageSize: 10, hideOnSinglePage: true }}
      locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No workspaces found." style={{ padding: '32px 0' }} /> }}
    />
  );
};

export default TenantsList;
