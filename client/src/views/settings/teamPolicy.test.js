import test from 'node:test';
import assert from 'node:assert';
import {
  passwordProblem, assignableRoles, canSeeTeam, canActOn, memberStatus, seatSummary, addMemberProblem, editMemberProblem,
} from './teamPolicy.js';

test('the Team card is for people who may see the team; agents never see it', () => {
  assert.strictEqual(canSeeTeam({ view_team: true }), true);
  assert.strictEqual(canSeeTeam({ view_team: false, manage_team: false }), false);
  assert.strictEqual(canSeeTeam(undefined), false);
});

test('roles: Owners give any role, Admins only Manager and Agent, others none', () => {
  assert.deepStrictEqual(assignableRoles('owner'), ['owner', 'admin', 'manager', 'agent']);
  assert.deepStrictEqual(assignableRoles('admin'), ['manager', 'agent']);
  assert.deepStrictEqual(assignableRoles('manager'), []);
  assert.deepStrictEqual(assignableRoles('agent'), []);
});

test('actions: never on yourself, Admins leave Owners alone, managers only look', () => {
  const owner = { id: 1, role: 'owner' };
  const agent = { id: 3, role: 'agent' };
  assert.strictEqual(canActOn({ myRole: 'owner', myId: 1, canManage: true }, owner), false);
  assert.strictEqual(canActOn({ myRole: 'owner', myId: 1, canManage: true }, agent), true);
  assert.strictEqual(canActOn({ myRole: 'admin', myId: 2, canManage: true }, owner), false);
  assert.strictEqual(canActOn({ myRole: 'admin', myId: 2, canManage: true }, agent), true);
  assert.strictEqual(canActOn({ myRole: 'manager', myId: 4, canManage: false }, agent), false);
});

test('status and seats', () => {
  assert.strictEqual(memberStatus({ status: 'disabled' }).label, 'Disabled');
  assert.strictEqual(memberStatus({ status: 'active', must_change_password: true }).label, 'Temporary password');
  assert.strictEqual(memberStatus({ status: 'active' }).label, 'Active');
  assert.deepStrictEqual(seatSummary({ used: 3, limit: 5 }), { used: 3, limit: 5, full: false, text: '3 of 5 seats used' });
  assert.strictEqual(seatSummary({ used: 1, limit: 1 }).full, true);
  assert.strictEqual(seatSummary({ used: 1, limit: 1 }).text, '1 of 1 seat used');
});

test('add and edit forms are checked like the server', () => {
  const ok = { name: 'Priya', email: 'priya@shop.in', phone: '+91 98765 43210', role: 'agent', method: 'password', password: 'Temporary-1x', confirm: 'Temporary-1x' };
  assert.strictEqual(addMemberProblem(ok, 'owner'), null);
  assert.strictEqual(addMemberProblem({ ...ok, method: 'invite', password: '', confirm: '' }, 'admin'), null);
  assert.match(addMemberProblem({ ...ok, role: 'admin' }, 'admin'), /role/);
  assert.match(addMemberProblem({ ...ok, password: 'short1', confirm: 'short1' }, 'owner'), /10 characters/);
  assert.match(addMemberProblem({ ...ok, confirm: 'other-pass-1' }, 'owner'), /do not match/);
  assert.match(addMemberProblem({ ...ok, email: 'nope' }, 'owner'), /email/);
  assert.match(addMemberProblem({ ...ok, phone: 'call me' }, 'owner'), /phone/);
  assert.strictEqual(passwordProblem('abcdefghij'), 'Use at least one letter and one number');
  assert.strictEqual(editMemberProblem({ name: 'Ravi', phone: '' }), null);
  assert.match(editMemberProblem({ name: 'R' }), /name/);
});
