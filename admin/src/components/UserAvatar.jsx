import React from 'react';
import { FiUser } from 'react-icons/fi';
import { FaCrown } from 'react-icons/fa';
import { roleStyle } from '../utils/roles';

// One consistent avatar treatment for people across the whole app (sidebar
// profile + the users table) — an icon in a role-tinted circle, rather than
// mixing a randomly-generated cartoon avatar in one place and nothing in
// another.
const UserAvatar = ({ name, role, size = 40 }) => {
  const style = roleStyle(role);
  const initial = typeof name === 'string' && name.trim() ? name.trim().charAt(0).toUpperCase() : '?';
  const isHighRole = ['owner', 'admin', 'superadmin', 'staff_admin'].includes(String(role || '').toLowerCase());
  const Icon = isHighRole ? FaCrown : FiUser;
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-full font-bold"
      style={{ width: size, height: size, background: style.bg, color: style.color, border: `1px solid ${style.color}22`, fontSize: size * 0.42 }}
    >
      {role ? <Icon /> : initial}
    </span>
  );
};

export default UserAvatar;
