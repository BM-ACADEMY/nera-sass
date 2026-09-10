import React from 'react';
import { List, Typography, Spin } from 'antd';

const { Text } = Typography;

const UsersList = ({ users, loading }) => {
  if (loading) {
    return <div style={{ textAlign: 'center', padding: 20 }}><Spin /></div>;
  }

  return (
    <List
      dataSource={users}
      renderItem={(user) => (
        <List.Item className="user-item" style={{ borderBottom: 'none' }}>
          <div className="user-info">
            <strong>{user.name}</strong>
            <span>{user.email} | Phone: {user.phone || 'N/A'}</span>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div className="badge">{user.role}</div>
            <div style={{ color: 'var(--text-muted)', fontSize: 12, marginTop: 4 }}>
              Tenant: {user.tenant_name}
            </div>
          </div>
        </List.Item>
      )}
      locale={{ emptyText: <Text style={{ color: 'var(--text-muted)' }}>No users found.</Text> }}
    />
  );
};

export default UsersList;
