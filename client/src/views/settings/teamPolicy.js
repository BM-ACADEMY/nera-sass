// Settings > Team: what the page shows and allows. The server checks every
// change again (server/services/teamMembers.js); this keeps the page honest.

// The same rules the server checks (server/utils/passwordPolicy.js).
export function passwordProblem(password, email = '') {
  if (!password) return 'Choose a password';
  if (password.length < 10) return 'Use at least 10 characters';
  if (password.length > 128) return 'Use at most 128 characters';
  if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) return 'Use at least one letter and one number';
  if (email && password.toLowerCase() === String(email).toLowerCase()) return 'The password cannot be the email address';
  return null;
}

export const ROLE_HELP = {
  owner: 'Full access, including billing and the team.',
  admin: 'Everything except managing Owners and other Admins.',
  manager: 'Leads, campaigns, templates and AI Brain. Can see the team.',
  agent: 'Inbox and leads only.',
};

// Roles this person may give: Owners any, Admins only Manager and Agent.
export function assignableRoles(myRole) {
  if (myRole === 'owner') return ['owner', 'admin', 'manager', 'agent'];
  if (myRole === 'admin') return ['manager', 'agent'];
  return [];
}

// The Team card is shown to people who may see the team (owner, admin,
// manager); agents never see it.
export const canSeeTeam = (permissions) => Boolean(permissions?.view_team);

// Whether `me` may act on `member` (edit, reset, disable, remove). Nobody acts
// on themselves here; Admins leave Owners and other Admins alone.
export function canActOn({ myRole, myId, canManage }, member) {
  if (!canManage || !member || member.id === myId) return false;
  if (myRole === 'admin' && (member.role === 'owner' || member.role === 'admin')) return false;
  return myRole === 'owner' || myRole === 'admin';
}

export function memberStatus(member) {
  if (member.status === 'disabled' || member.is_active === false) return { label: 'Disabled', variant: 'danger' };
  if (member.must_change_password) return { label: 'Temporary password', variant: 'warning' };
  return { label: 'Active', variant: 'success' };
}

export function invitationStatus(invitation) {
  return invitation.status === 'expired' ? { label: 'Invite expired', variant: 'danger' } : { label: 'Invite sent', variant: 'info' };
}

// "3 of 5 seats used", and whether the workspace is full.
export function seatSummary(seats) {
  const used = Number(seats?.used ?? 0);
  const limit = Number(seats?.limit ?? seats?.max_users ?? 0);
  return {
    used,
    limit,
    full: limit > 0 && used >= limit,
    text: limit > 0 ? `${used} of ${limit} seat${limit === 1 ? '' : 's'} used` : `${used} seat${used === 1 ? '' : 's'} used`,
  };
}

const PHONE_RE = /^\+?[0-9 ()-]{7,20}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Checks the Add person form before it is sent. Returns an error sentence or null.
export function addMemberProblem({ name, email, phone, role, method, password, confirm }, myRole) {
  const cleanName = String(name || '').trim();
  if (cleanName.length < 2 || cleanName.length > 80) return 'Enter their name (2 to 80 characters).';
  if (!EMAIL_RE.test(String(email || '').trim())) return 'Enter a valid email address.';
  if (phone && !PHONE_RE.test(String(phone).trim())) return 'Enter a valid phone number, for example +91 98765 43210.';
  if (!assignableRoles(myRole).includes(role)) return 'Choose a role you are allowed to give.';
  if (method === 'password') {
    const problem = passwordProblem(password, String(email || '').trim());
    if (problem) return `${problem}.`;
    if (password !== confirm) return 'The two passwords do not match.';
  } else if (method !== 'invite') {
    return 'Choose how they get their password.';
  }
  return null;
}

export function editMemberProblem({ name, phone }) {
  const cleanName = String(name || '').trim();
  if (cleanName.length < 2 || cleanName.length > 80) return 'Enter their name (2 to 80 characters).';
  if (phone && !PHONE_RE.test(String(phone).trim())) return 'Enter a valid phone number, for example +91 98765 43210.';
  return null;
}
