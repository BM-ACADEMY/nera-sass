export const ROLE_STYLES = {
  admin: { bg: '#e0f2fe', color: '#0369a1' },
  tenant_admin: { bg: '#ede9fe', color: '#6d28d9' },
  founder: { bg: '#fef3c7', color: '#b45309' },
  agent: { bg: '#dcfce7', color: '#15803d' },
};

export const roleStyle = (role) => ROLE_STYLES[role] || { bg: '#f1f5f9', color: '#475569' };
