import React from 'react';
import { Avatar } from 'antd';
import { UserOutlined, CrownOutlined } from '@ant-design/icons';
import { roleStyle } from '../utils/roles';

// One consistent avatar treatment for people across the whole app (sidebar
// profile + the users table) — an icon in a role-tinted circle, rather than
// mixing a randomly-generated cartoon avatar in one place and nothing in
// another.
const UserAvatar = ({ name, role, size = 40 }) => {
  const style = roleStyle(role);
  const initial = typeof name === 'string' && name.trim() ? name.trim().charAt(0).toUpperCase() : '?';
  const isHighRole = ['owner', 'admin', 'superadmin', 'staff_admin'].includes(String(role || '').toLowerCase());
  return (
    <Avatar
      size={size}
      icon={isHighRole ? <CrownOutlined /> : <UserOutlined />}
      style={{ background: style.bg, color: style.color, border: `1px solid ${style.color}22`, flexShrink: 0, fontWeight: 700 }}
    >
      {!role && initial ? initial : null}
    </Avatar>
  );
};

export default UserAvatar;
