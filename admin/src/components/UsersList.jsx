import React from 'react';
import { Table, Tag, Button, Empty } from 'antd';
import { FaWhatsapp } from 'react-icons/fa';
import UserAvatar from './UserAvatar';
import { roleStyle } from '../utils/roles';

const UsersList = ({ users, loading, onConfigureWhatsApp }) => {
  const columns = [
    {
      title: 'User',
      dataIndex: 'name',
      key: 'name',
      sorter: (a, b) => a.name.localeCompare(b.name),
      render: (_, user) => (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <UserAvatar name={user.name} role={user.role} size={38} />
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 600, fontSize: 13.5, color: '#1e293b', whiteSpace: 'nowrap' }}>{user.name}</div>
            <div style={{ fontSize: 12, color: '#94a3b8', whiteSpace: 'nowrap' }}>{user.email}</div>
          </div>
        </div>
      ),
    },
    {
      title: 'Phone',
      dataIndex: 'phone',
      key: 'phone',
      render: (phone) => <span style={{ color: phone ? '#475569' : '#cbd5e1', fontSize: 13 }}>{phone || 'No phone on file'}</span>,
    },
    {
      title: 'Role',
      dataIndex: 'role',
      key: 'role',
      filters: [...new Set(users.map(u => u.role))].map(role => ({ text: role.replace('_', ' '), value: role })),
      onFilter: (value, user) => user.role === value,
      render: (role) => (
        <Tag style={{ background: roleStyle(role).bg, color: roleStyle(role).color, border: 'none', borderRadius: 20, fontWeight: 700, fontSize: 11, textTransform: 'capitalize', padding: '2px 12px' }}>
          {role.replace('_', ' ')}
        </Tag>
      ),
    },
    {
      title: 'Workspace',
      dataIndex: 'tenant_name',
      key: 'tenant_name',
      sorter: (a, b) => a.tenant_name.localeCompare(b.tenant_name),
      render: (tenant) => <span style={{ color: '#475569', fontSize: 13 }}>{tenant}</span>,
    },
    {
      title: '',
      key: 'actions',
      width: 150,
      render: (_, user) => (
        <Button
          className="whatsapp-config-btn"
          icon={<FaWhatsapp size={15} />}
          onClick={() => onConfigureWhatsApp(user)}
        >
          WhatsApp
        </Button>
      ),
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
