// Every account falls in one of three groups:
//  - Admin (Owner): platform staff with the founder role, full access
//  - Staff: platform staff with the ops role, everything except billing
//  - Customer: the single login of a workspace
export const USER_TYPES = {
  admin: { key: 'admin', label: 'Admin (Owner)', bg: '#fef3c7', color: '#b45309' },
  staff: { key: 'staff', label: 'Staff', bg: '#e0e7ff', color: '#4338ca' },
  customer: { key: 'customer', label: 'Customer', bg: '#dcfce7', color: '#15803d' },
  unknown: { key: 'unknown', label: 'No access', bg: '#f1f5f9', color: '#475569' },
};

export const userType = (user) => {
  if (!user) return USER_TYPES.unknown;
  if (user.is_platform_staff || user.tenant_id == null) {
    if (user.staff_role === 'founder') return USER_TYPES.admin;
    if (user.staff_role === 'ops') return USER_TYPES.staff;
    return USER_TYPES.unknown;
  }
  return USER_TYPES.customer;
};

// Colours for a staff role on its own (the signed-in admin's avatar).
export const roleStyle = (role) => {
  const key = String(role || '').toLowerCase().trim();
  if (key === 'founder') return USER_TYPES.admin;
  if (key === 'ops') return USER_TYPES.staff;
  return USER_TYPES.customer;
};
