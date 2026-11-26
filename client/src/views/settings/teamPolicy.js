// The Team page: what it shows and allows. The server checks every
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
  admin: 'Everything except managing Owners.',
  manager: 'Leads, campaigns, templates and AI Brain. Can see the team.',
  agent: 'Inbox and leads only.',
};

// Roles this person may give: Owners any, Admins only Manager and Agent.
export function assignableRoles(myRole) {
  if (myRole === 'owner') return ['owner', 'admin', 'manager', 'agent'];
  if (myRole === 'admin') return ['manager', 'agent'];
  return [];
}

// The Team page and its sidebar item are for people who may see the team
// (owner, admin, manager); agents never see them.
export const canSeeTeam = (permissions) => Boolean(permissions?.view_team);

// Whether `me` may act on `member` (edit, reset, disable, remove). Nobody acts
// on themselves here; Admins leave Owners alone.
export function canActOn({ myRole, myId, canManage }, member) {
  if (!canManage || !member || member.id === myId) return false;
  if (myRole === 'admin' && member.role === 'owner') return false;
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

// Sidebar sections this person may see: an item with `permission` needs that
// flag (GET /api/tenant permissions); a section left empty is dropped.
export function menuSections(sections, permissions) {
  return sections
    .map((section) => ({ ...section, items: section.items.filter((item) => !item.permission || Boolean(permissions?.[item.permission])) }))
    .filter((section) => section.items.length > 0);
}

export const SHARE_HINT = 'Share it with them yourself, for example in person or by phone. They will be asked to choose their own password when they first sign in.';

// What to say after adding someone, from the server's `delivery` answer:
// { ok, text }, ok false when the email did not go out.
export function addedNotice({ method, delivery, name, email }) {
  const sent = delivery?.delivered === true;
  if (method === 'invite') {
    return sent
      ? { ok: true, text: `Invitation emailed to ${email}.` }
      : { ok: false, text: 'Invitation created, but the email could not be sent. Use "Resend invite" to try again.' };
  }
  return sent
    ? { ok: true, text: `${name} can now sign in. We emailed the sign-in details to ${email}, without the password. ${SHARE_HINT}` }
    : { ok: false, text: `${name} was added and can sign in, but the email could not be sent. Give them the sign-in page address and the temporary password yourself. They must choose their own password when they first sign in.` };
}

export function resentNotice(delivery, email) {
  return delivery?.delivered === true
    ? { ok: true, text: `Invitation emailed again to ${email}.` }
    : { ok: false, text: `The invitation to ${email} was renewed, but the email could not be sent. Try "Resend invite" again.` };
}
