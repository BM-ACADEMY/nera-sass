import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import {
  FiUserPlus, FiUsers, FiMoreVertical, FiEdit2, FiKey, FiLogOut, FiSlash, FiCheckCircle, FiTrash2, FiSend, FiX, FiShield, FiRefreshCw, FiAlertTriangle,
} from 'react-icons/fi';
import { api } from '../../services/api.js';
import { timeAgo } from '../../services/sessionFormat.js';
import { roleLabel } from './settingsPolicy.js';
import {
  assignableRoles, canActOn, memberStatus, invitationStatus, seatSummary, addMemberProblem, editMemberProblem, passwordProblem, ROLE_HELP,
  SHARE_HINT, addedNotice, resentNotice,
} from './teamPolicy.js';
import { FormRow, Callout } from './SettingsKit.jsx';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogFooter, AlertDialogTitle, AlertDialogDescription, AlertDialogCancel,
} from '@/components/ui/alert-dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { cn } from '@/lib/utils';

// Success, or a longer-lasting warning when the email did not go out.
const showNotice = ({ ok, text }) => (ok
  ? toast.success(text, { duration: 8000 })
  : toast(text, { duration: 12000, icon: <FiAlertTriangle className="size-5 shrink-0 text-amber-400" /> }));

const RoleSelect = ({ id, value, onChange, roles, disabled }) => (
  <Select value={value} onValueChange={onChange} disabled={disabled}>
    <SelectTrigger id={id} className="w-full"><SelectValue placeholder="Choose a role" /></SelectTrigger>
    <SelectContent>
      {roles.map((role) => (
        <SelectItem key={role} value={role}>{roleLabel(role)}</SelectItem>
      ))}
    </SelectContent>
  </Select>
);

const PasswordFields = ({ password, setPassword, confirm, setConfirm, disabled }) => (
  <>
    <FormRow label="Temporary password" htmlFor="team-password" hint="At least 10 characters, with a letter and a number.">
      <Input id="team-password" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} disabled={disabled} />
    </FormRow>
    <FormRow label="Type it again" htmlFor="team-password-confirm">
      <Input id="team-password-confirm" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} disabled={disabled} />
    </FormRow>
  </>
);

const MethodOption = ({ value, current, onChange, title, text, disabled }) => (
  <label className={cn(
    'flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors',
    current === value ? 'border-primary bg-blue-50/60' : 'border-border hover:bg-slate-50',
    disabled && 'cursor-not-allowed opacity-60',
  )}>
    <input type="radio" name="team-method" value={value} checked={current === value} onChange={() => onChange(value)} disabled={disabled} className="mt-1 accent-blue-600" />
    <span>
      <span className="block text-sm font-semibold text-slate-800">{title}</span>
      <span className="block text-xs text-muted-foreground">{text}</span>
    </span>
  </label>
);

// Add a person: name, email, phone, role and how they get their password.
function AddMemberDialog({ open, onClose, myRole, onAdded }) {
  const roles = assignableRoles(myRole);
  // Mounted only while open, so every opening starts from an empty form.
  const [form, setForm] = useState({ name: '', email: '', phone: '', role: 'agent', method: 'password', password: '', confirm: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (key) => (value) => setForm((f) => ({ ...f, [key]: value }));

  const submit = async (e) => {
    e.preventDefault();
    const problem = addMemberProblem(form, myRole);
    if (problem) return setError(problem);
    setBusy(true);
    setError('');
    try {
      const body = { name: form.name.trim(), email: form.email.trim(), phone: form.phone.trim() || null, role: form.role, method: form.method };
      if (form.method === 'password') body.password = form.password;
      const result = await api.addTeamMember(body);
      showNotice(addedNotice({ method: form.method, delivery: result.delivery, name: body.name, email: body.email }));
      onAdded();
      onClose();
    } catch (err) {
      setError(err.message || 'Could not add this person. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && !busy && onClose()}>
      <DialogContent>
        <form onSubmit={submit} noValidate className="grid gap-4">
          <DialogHeader>
            <DialogTitle>Add a person</DialogTitle>
            <DialogDescription>They get their own login to this workspace. Each person uses one seat.</DialogDescription>
          </DialogHeader>
          <FormRow label="Name" htmlFor="team-name">
            <Input id="team-name" autoComplete="off" value={form.name} onChange={(e) => set('name')(e.target.value)} disabled={busy} autoFocus />
          </FormRow>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormRow label="Email" htmlFor="team-email" hint="They sign in with this.">
              <Input id="team-email" type="email" autoComplete="off" value={form.email} onChange={(e) => set('email')(e.target.value)} disabled={busy} />
            </FormRow>
            <FormRow label="Phone (optional)" htmlFor="team-phone">
              <Input id="team-phone" type="tel" autoComplete="off" placeholder="+91 98765 43210" value={form.phone} onChange={(e) => set('phone')(e.target.value)} disabled={busy} />
            </FormRow>
          </div>
          <FormRow label="Role" htmlFor="team-role" hint={ROLE_HELP[form.role]}>
            <RoleSelect id="team-role" value={form.role} onChange={set('role')} roles={roles} disabled={busy} />
          </FormRow>
          <div className="grid gap-2">
            <span className="text-[13px] font-semibold text-slate-700">How will they get their password?</span>
            <MethodOption value="password" current={form.method} onChange={set('method')} disabled={busy}
              title="Set a temporary password" text="You choose it now and tell them. We email them how to sign in, without the password. They change it when they first sign in." />
            <MethodOption value="invite" current={form.method} onChange={set('method')} disabled={busy}
              title="Send an invitation email" text="They get a link by email and choose their own password. The link works once." />
          </div>
          {form.method === 'password' && (
            <PasswordFields password={form.password} setPassword={set('password')} confirm={form.confirm} setConfirm={set('confirm')} disabled={busy} />
          )}
          {error && <Callout tone="error">{error}</Callout>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
            <Button type="submit" disabled={busy}>{busy ? <Spinner /> : form.method === 'invite' ? <FiSend /> : <FiUserPlus />} {form.method === 'invite' ? 'Send invitation' : 'Add person'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// Edit name, phone and role.
function EditMemberDialog({ member, onClose, myRole, onSaved }) {
  // Mounted per member (keyed), so the form starts from their details.
  const [form, setForm] = useState({ name: member?.name || '', phone: member?.phone || '', role: member?.role || 'agent' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  // Admins cannot give Admin, but a member who already is one keeps it in the list.
  const roles = member ? [...new Set([...assignableRoles(myRole), member.role])] : [];

  const submit = async (e) => {
    e.preventDefault();
    const problem = editMemberProblem(form);
    if (problem) return setError(problem);
    setBusy(true);
    setError('');
    try {
      const changes = { name: form.name.trim(), phone: form.phone.trim() || null };
      if (form.role !== member.role) changes.role = form.role;
      await api.updateTeamMember(member.id, changes);
      toast.success('Saved');
      onSaved();
      onClose();
    } catch (err) {
      setError(err.message || 'Could not save. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={Boolean(member)} onOpenChange={(next) => !next && !busy && onClose()}>
      <DialogContent>
        <form onSubmit={submit} noValidate className="grid gap-4">
          <DialogHeader>
            <DialogTitle>Edit {member?.name || 'person'}</DialogTitle>
            <DialogDescription>{member?.email} · The email cannot be changed because it is their login.</DialogDescription>
          </DialogHeader>
          <FormRow label="Name" htmlFor="edit-name">
            <Input id="edit-name" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} disabled={busy} />
          </FormRow>
          <FormRow label="Phone (optional)" htmlFor="edit-phone">
            <Input id="edit-phone" type="tel" placeholder="+91 98765 43210" value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} disabled={busy} />
          </FormRow>
          <FormRow label="Role" htmlFor="edit-role" hint={ROLE_HELP[form.role]}>
            <RoleSelect id="edit-role" value={form.role} onChange={(role) => setForm((f) => ({ ...f, role }))} roles={roles} disabled={busy} />
          </FormRow>
          {error && <Callout tone="error">{error}</Callout>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
            <Button type="submit" disabled={busy}>{busy && <Spinner />} Save changes</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// Set a new temporary password (they choose their own at next sign-in).
function ResetPasswordDialog({ member, onClose, onDone }) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    const problem = passwordProblem(password, member?.email);
    if (problem) return setError(`${problem}.`);
    if (password !== confirm) return setError('The two passwords do not match.');
    setBusy(true);
    setError('');
    try {
      await api.resetTeamMemberPassword(member.id, password);
      toast.success(`New temporary password set for ${member.name || member.email}. ${SHARE_HINT}`, { duration: 8000 });
      onDone();
      onClose();
    } catch (err) {
      setError(err.message || 'Could not reset the password. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={Boolean(member)} onOpenChange={(next) => !next && !busy && onClose()}>
      <DialogContent>
        <form onSubmit={submit} noValidate className="grid gap-4">
          <DialogHeader>
            <DialogTitle>Reset password for {member?.name || member?.email}</DialogTitle>
            <DialogDescription>They are signed out everywhere now, and must choose their own password the next time they sign in.</DialogDescription>
          </DialogHeader>
          <PasswordFields password={password} setPassword={setPassword} confirm={confirm} setConfirm={setConfirm} disabled={busy} />
          {error && <Callout tone="error">{error}</Callout>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
            <Button type="submit" disabled={busy}>{busy ? <Spinner /> : <FiKey />} Set temporary password</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// "Are you sure?" for disable, enable, sign out, remove, cancel invite.
function ConfirmAction({ confirm, onClose }) {
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      await confirm.run();
      onClose();
    } catch {
      // The action already showed its error.
    } finally {
      setBusy(false);
    }
  };
  return (
    <AlertDialog open={Boolean(confirm)} onOpenChange={(next) => !next && !busy && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{confirm?.title}</AlertDialogTitle>
          <AlertDialogDescription>{confirm?.description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
          <Button variant={confirm?.destructive ? 'destructive' : 'default'} onClick={run} disabled={busy}>
            {busy && <Spinner />} {confirm?.actionLabel}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

const Initial = ({ name, muted }) => (
  <span className={cn('flex size-9 shrink-0 items-center justify-center rounded-full text-sm font-bold', muted ? 'bg-slate-100 text-slate-500' : 'bg-blue-100 text-blue-700')}>
    {(name || '?').trim()[0]?.toUpperCase() || '?'}
  </span>
);

// One row of the list: a card on phones, a table row on wider screens.
const Row = ({ avatar, title, subtitle, role, status, twoStep, lastSeen, actions }) => (
  <li className="flex flex-col gap-3 px-4 py-3.5 sm:px-6 md:grid md:grid-cols-[minmax(0,2.2fr)_minmax(0,1fr)_minmax(0,1.2fr)_minmax(0,0.8fr)_minmax(0,1.1fr)_40px] md:items-center md:gap-4">
    <div className="flex min-w-0 items-center gap-3">
      {avatar}
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold text-slate-900">{title}</div>
        <div className="truncate text-xs text-muted-foreground">{subtitle}</div>
      </div>
      <div className="md:hidden">{actions}</div>
    </div>
    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground md:contents">
      <span className="text-sm text-slate-700 md:block">{role}</span>
      <span className="md:block">{status}</span>
      <span className="md:block">{twoStep}</span>
      <span className="md:block">{lastSeen}</span>
    </div>
    <div className="hidden justify-end md:flex">{actions}</div>
  </li>
);

const TeamHeader = () => (
  <div className="mb-6 flex items-center gap-3.5">
    <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-sky-50 text-sky-600 ring-4 ring-sky-100"><FiUsers size={20} /></span>
    <div className="min-w-0">
      <h2 className="text-lg font-extrabold tracking-tight">Team</h2>
      <p className="text-[13px] text-muted-foreground">Add the people who work in this workspace and choose what they can do.</p>
    </div>
  </div>
);

// The Team page (/team): everyone in the workspace, pending invitations, seats,
// and (for Owners and Admins) adding and managing people.
export const TeamSection = ({ tenantInfo, me }) => {
  const navigate = useNavigate();
  const [team, setTeam] = useState(null);
  const [error, setError] = useState('');
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState(null);
  const [resetting, setResetting] = useState(null);
  const [confirm, setConfirm] = useState(null);

  const load = useCallback(() => {
    api.getTeam()
      .then((data) => { setTeam(data); setError(''); })
      .catch((err) => setError(err.message || 'Please check your connection and try again.'));
  }, []);
  useEffect(() => { load(); }, [load]);

  const canManage = Boolean(team?.can_manage ?? tenantInfo?.permissions?.manage_team);
  const myRole = me?.role;
  const actor = { myRole, myId: me?.id, canManage };

  const act = (request, success, failure) => async () => {
    try {
      await request();
      toast.success(success);
      load();
    } catch (err) {
      toast.error(err.message || failure);
      throw err;
    }
  };

  if (!team) {
    return (
      <div className="max-w-6xl">
        <TeamHeader />
        {error ? (
          <Card className="items-center gap-3 px-6 py-10 text-center">
            <FiAlertTriangle className="size-6 text-amber-500" />
            <div className="font-semibold">The team could not be loaded</div>
            <p className="text-sm text-muted-foreground">{error}</p>
            <Button variant="outline" onClick={load}><FiRefreshCw /> Try again</Button>
          </Card>
        ) : (
          <div className="flex flex-col gap-4"><Skeleton className="h-24 rounded-2xl" /><Skeleton className="h-64 rounded-2xl" /></div>
        )}
      </div>
    );
  }

  const resend = async (inv) => {
    try {
      const result = await api.resendInvitation(inv.id);
      showNotice(resentNotice(result.delivery, inv.email));
      load();
    } catch (err) {
      toast.error(err.message || 'Could not resend the invitation');
    }
  };

  const seats = seatSummary(team.seats);
  const users = team.users || [];
  const invitations = team.invitations || [];
  const percent = seats.limit ? Math.min(100, Math.round((seats.used / seats.limit) * 100)) : 0;

  const memberActions = (m) => {
    if (!canActOn(actor, m)) return <span />;
    const who = m.name || m.email;
    const disabled = m.status === 'disabled';
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" aria-label={`Actions for ${who}`}><FiMoreVertical /></Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          <DropdownMenuItem onSelect={() => setEditing(m)}><FiEdit2 /> Edit</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setResetting(m)}><FiKey /> Reset password</DropdownMenuItem>
          {!disabled && (
            <DropdownMenuItem onSelect={() => setConfirm({
              title: `Sign ${who} out everywhere?`,
              description: 'Every device they are signed in on is signed out now. They can sign in again with their password.',
              actionLabel: 'Sign out everywhere',
              run: act(() => api.signOutTeamMember(m.id), `${who} has been signed out everywhere`, 'Could not sign them out'),
            })}><FiLogOut /> Sign out everywhere</DropdownMenuItem>
          )}
          {disabled ? (
            <DropdownMenuItem onSelect={() => setConfirm({
              title: `Enable ${who}?`,
              description: 'They can sign in again with their password. This uses a seat.',
              actionLabel: 'Enable',
              run: act(() => api.setTeamMemberActive(m.id, true), `${who} is enabled`, 'Could not enable them'),
            })}><FiCheckCircle /> Enable</DropdownMenuItem>
          ) : (
            <DropdownMenuItem onSelect={() => setConfirm({
              title: `Disable ${who}?`,
              description: 'They are signed out now and cannot sign in until you enable them again. Their work stays. This frees their seat.',
              actionLabel: 'Disable',
              destructive: true,
              run: act(() => api.setTeamMemberActive(m.id, false), `${who} is disabled`, 'Could not disable them'),
            })}><FiSlash /> Disable</DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onSelect={() => setConfirm({
            title: `Remove ${who} from the workspace?`,
            description: 'They are signed out now and can no longer sign in. Their past work stays in the workspace. This frees their seat.',
            actionLabel: 'Remove',
            destructive: true,
            run: act(() => api.removeTeamMember(m.id), `${who} has been removed`, 'Could not remove them'),
          })}><FiTrash2 /> Remove</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    );
  };

  const inviteActions = (inv) => {
    if (!canManage) return <span />;
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" aria-label={`Actions for the invitation to ${inv.email}`}><FiMoreVertical /></Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          <DropdownMenuItem onSelect={() => resend(inv)}>
            <FiSend /> Resend invite
          </DropdownMenuItem>
          <DropdownMenuItem variant="destructive" onSelect={() => setConfirm({
            title: `Cancel the invitation to ${inv.email}?`,
            description: 'The link in their email stops working. This frees the seat.',
            actionLabel: 'Cancel invitation',
            destructive: true,
            run: act(() => api.cancelInvitation(inv.id), 'Invitation cancelled', 'Could not cancel the invitation'),
          })}><FiX /> Cancel invite</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    );
  };

  return (
    <div className="max-w-6xl">
      <TeamHeader />
      <div className="flex flex-col gap-5">
        {/* Seats */}
        <Card className="gap-3">
          <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold text-slate-900">{seats.text}</div>
              <div className="mt-2 h-2 w-full max-w-sm overflow-hidden rounded-full bg-slate-100">
                <div className={cn('h-full rounded-full', seats.full ? 'bg-amber-500' : 'bg-blue-600')} style={{ width: `${percent}%` }} />
              </div>
              <p className="mt-2 text-xs text-muted-foreground">Everyone with a login and every pending invitation uses a seat. Disabled people do not.</p>
            </div>
            {canManage && (
              <Button onClick={() => setAdding(true)} disabled={seats.full} title={seats.full ? 'All seats are in use' : undefined}>
                <FiUserPlus /> Add person
              </Button>
            )}
          </CardContent>
          {seats.full && canManage && (
            <CardContent>
              <Callout tone="warn" className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <span>All seats are in use. To add someone, buy an extra seat or move to a bigger plan, or disable someone who no longer needs a login.</span>
                <Button size="sm" variant="outline" className="shrink-0 bg-white" onClick={() => navigate('/billing')}>Go to Billing</Button>
              </Callout>
            </CardContent>
          )}
        </Card>

        {/* People */}
        <Card className="gap-0 py-0">
          <CardHeader className="block px-4 py-4 sm:px-6">
            <CardTitle>People</CardTitle>
            <CardDescription className="mt-1">
              {canManage ? 'Everyone who can sign in to this workspace.' : 'Everyone who can sign in to this workspace. Only Owners and Admins can make changes.'}
            </CardDescription>
          </CardHeader>
          <div className="hidden border-y border-border bg-slate-50 px-6 py-2 text-[11px] font-semibold tracking-wide text-slate-500 uppercase md:grid md:grid-cols-[minmax(0,2.2fr)_minmax(0,1fr)_minmax(0,1.2fr)_minmax(0,0.8fr)_minmax(0,1.1fr)_40px] md:gap-4">
            <span>Name</span><span>Role</span><span>Status</span><span>2-step</span><span>Last sign-in</span><span />
          </div>
          <ul className="divide-y divide-border border-t border-border md:border-t-0">
            {users.map((m) => {
              const status = memberStatus(m);
              return (
                <Row
                  key={`u${m.id}`}
                  avatar={<Initial name={m.name || m.email} muted={m.status === 'disabled'} />}
                  title={<>{m.name || m.email}{m.id === me?.id && <span className="ml-1.5 text-xs font-normal text-muted-foreground">(you)</span>}</>}
                  subtitle={[m.email, m.phone].filter(Boolean).join(' · ')}
                  role={roleLabel(m.role)}
                  status={<Badge variant={status.variant}>{status.label}</Badge>}
                  twoStep={<Badge variant={m.mfa_enabled ? 'success' : 'muted'}><FiShield /> {m.mfa_enabled ? 'On' : 'Off'}</Badge>}
                  lastSeen={<span className="text-xs text-muted-foreground">{m.last_login ? timeAgo(m.last_login) : 'Never signed in'}</span>}
                  actions={memberActions(m)}
                />
              );
            })}
            {invitations.map((inv) => {
              const status = invitationStatus(inv);
              return (
                <Row
                  key={`i${inv.id}`}
                  avatar={<Initial name={inv.name || inv.email} muted />}
                  title={inv.name || inv.email}
                  subtitle={inv.name ? inv.email : `Invited ${timeAgo(inv.created_at)}`}
                  role={roleLabel(inv.role)}
                  status={<Badge variant={status.variant}>{status.label}</Badge>}
                  twoStep={<span className="text-xs text-muted-foreground">—</span>}
                  lastSeen={<span className="text-xs text-muted-foreground">Not joined yet</span>}
                  actions={inviteActions(inv)}
                />
              );
            })}
          </ul>
        </Card>
      </div>

      {canManage && adding && <AddMemberDialog open onClose={() => setAdding(false)} myRole={myRole} onAdded={load} />}
      {editing && <EditMemberDialog key={editing.id} member={editing} onClose={() => setEditing(null)} myRole={myRole} onSaved={load} />}
      {resetting && <ResetPasswordDialog key={resetting.id} member={resetting} onClose={() => setResetting(null)} onDone={load} />}
      <ConfirmAction confirm={confirm} onClose={() => setConfirm(null)} />
    </div>
  );
};
