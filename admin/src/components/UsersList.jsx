import React from 'react';
import { Table, Tag, Button, Empty, Dropdown, Space, Popconfirm } from 'antd';
import { MoreOutlined, StopOutlined, CheckCircleOutlined, ReloadOutlined, KeyOutlined, EditOutlined } from '@ant-design/icons';
import UserAvatar from './UserAvatar';
import { roleStyle, formatRole } from '../utils/roles';

const UsersList = ({ users, loading, onChangeRole, onToggleActive, onRevokeSessions, onResetMfa }) => {
  const columns = [
    {
      title: 'User',
      dataIndex: 'name',
      key: 'name',
      sorter: (a, b) => String(a.name || '').localeCompare(String(b.name || '')),
      render: (_, user) => (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <UserAvatar name={user.name} role={user.role || user.staff_role} size={38} />
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 600, fontSize: 13.5, color: '#1e293b', whiteSpace: 'nowrap' }}>
              {user.name || 'Unnamed User'}
            </div>
            <div style={{ fontSize: 12, color: '#94a3b8', whiteSpace: 'nowrap' }}>
              {user.email || 'No email on file'}
            </div>
          </div>
        </div>
      ),
    },
    {
      title: 'Phone',
      dataIndex: 'phone',
      key: 'phone',
      render: (phone) => <span style={{ color: phone ? '#475569' : '#cbd5e1', fontSize: 13 }}>{phone || '—'}</span>,
    },
    {
      title: 'Role',
      dataIndex: 'role',
      key: 'role',
      render: (_, user) => {
        const displayRole = user.staff_role || user.role || 'agent';
        const style = roleStyle(displayRole);
        return (
          <Tag style={{ background: style.bg, color: style.color, border: 'none', borderRadius: 20, fontWeight: 700, fontSize: 11, padding: '2px 12px' }}>
            {user.is_platform_staff ? `Staff · ${formatRole(displayRole)}` : formatRole(displayRole)}
          </Tag>
        );
      },
    },
    {
      title: 'Status',
      dataIndex: 'is_active',
      key: 'is_active',
      render: (isActive) => (
        <Tag color={isActive !== false ? 'success' : 'error'} style={{ borderRadius: 12, fontWeight: 600 }}>
          {isActive !== false ? 'Active' : 'Deactivated'}
        </Tag>
      ),
    },
    {
      title: 'Workspace',
      dataIndex: 'tenant_id',
      key: 'tenant_id',
      render: (tenantId) => (
        <span style={{ fontSize: 12, color: tenantId ? '#334155' : '#94a3b8', fontWeight: 500 }}>
          {tenantId ? `Tenant #${tenantId}` : 'Platform'}
        </span>
      ),
    },
    {
      title: 'Actions',
      key: 'actions',
      render: (_, user) => {
        const items = [
          {
            key: 'role',
            icon: <EditOutlined />,
            label: 'Change Role',
            onClick: () => onChangeRole && onChangeRole(user),
          },
          {
            key: 'active',
            icon: user.is_active !== false ? <StopOutlined /> : <CheckCircleOutlined />,
            danger: user.is_active !== false,
            label: user.is_active !== false ? 'Deactivate User' : 'Reactivate User',
            onClick: () => onToggleActive && onToggleActive(user),
          },
          {
            key: 'revoke',
            icon: <ReloadOutlined />,
            label: 'Revoke All Sessions',
            onClick: () => onRevokeSessions && onRevokeSessions(user),
          },
          {
            key: 'reset-mfa',
            icon: <KeyOutlined />,
            label: 'Reset MFA',
            disabled: !user.mfa_enabled,
            onClick: () => onResetMfa && onResetMfa(user),
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
      className="users-table"
      rowKey="id"
      loading={loading}
      dataSource={users}
      columns={columns}
      pagination={{ pageSize: 8, hideOnSinglePage: true }}
      locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No users found." style={{ padding: '32px 0' }} /> }}
    />
  );
};

export default UsersList;
