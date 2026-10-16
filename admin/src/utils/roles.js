export const ROLE_STYLES = {
  // Customer Roles
  owner: { bg: '#fef3c7', color: '#b45309', label: 'Owner' },
  admin: { bg: '#e0f2fe', color: '#0369a1', label: 'Admin' },
  manager: { bg: '#ede9fe', color: '#6d28d9', label: 'Manager' },
  agent: { bg: '#dcfce7', color: '#15803d', label: 'Agent' },

  // Platform Staff Roles
  superadmin: { bg: '#fce7f3', color: '#be185d', label: 'Super Admin' },
  staff_admin: { bg: '#ffe4e6', color: '#e11d48', label: 'Staff Admin' },
  staff_support: { bg: '#e0e7ff', color: '#4338ca', label: 'Staff Support' },
  staff_billing: { bg: '#ecfdf5', color: '#047857', label: 'Staff Billing' },
  founder: { bg: '#fef3c7', color: '#b45309', label: 'Founder' },
};

export const formatRole = (role) => {
  if (!role) return 'None';
  const str = String(role).trim().replace(/[_-]/g, ' ');
  return str.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
};

export const roleStyle = (role) => {
  if (!role) return { bg: '#f1f5f9', color: '#475569', label: 'Unknown' };
  const key = String(role).toLowerCase().trim();
  return ROLE_STYLES[key] || { bg: '#f1f5f9', color: '#475569', label: formatRole(role) };
};
