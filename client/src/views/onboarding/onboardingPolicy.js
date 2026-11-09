// Pure rules for the Home setup checklist (N5). The server decides every
// status; this file only turns the server's answer into labels, tones and the
// one action a step offers, so it can be tested without a browser.

export const STATUS_LABELS = {
  done: 'Done',
  in_review: 'In review',
  todo: 'To do',
  locked: 'Locked',
};

export const STATUS_TONES = {
  done: { color: '#16a34a', background: '#f0fdf4', border: '#bbf7d0' },
  in_review: { color: '#b45309', background: '#fffbeb', border: '#fde68a' },
  todo: { color: '#2563eb', background: '#eff6ff', border: '#bfdbfe' },
  locked: { color: '#64748b', background: '#f1f5f9', border: '#e2e8f0' },
};

export const NOTICE_TONES = {
  critical: { color: '#b91c1c', background: '#fef2f2', border: '#fecaca' },
  warning: { color: '#b45309', background: '#fffbeb', border: '#fde68a' },
  info: { color: '#1d4ed8', background: '#eff6ff', border: '#bfdbfe' },
};

export const TEMPLATE_TONES = {
  approved: STATUS_TONES.done,
  in_review: STATUS_TONES.in_review,
  rejected: NOTICE_TONES.critical,
  paused: NOTICE_TONES.warning,
  unknown: STATUS_TONES.locked,
};

export const statusLabel = (status) => STATUS_LABELS[status] || STATUS_LABELS.todo;

/** Owners and admins run the setup; the server checks the role on every call. */
export const canManageSetup = (role) => role === 'owner' || role === 'admin';

/** The checklist is for workspaces that are not live yet. */
export const showChecklist = (overview) => Boolean(overview && overview.live && !overview.live.is_live);

/** The label of the one button a step offers, or null when it offers none. */
export function stepAction(step, { canManage = true, embeddedSignup = false } = {}) {
  if (!step || step.status === 'locked' || !canManage) return null;
  switch (step.key) {
    case 'business': return step.status === 'done' ? 'Edit' : 'Add details';
    case 'whatsapp':
      if (step.status === 'done' || step.status === 'in_review') return null;
      return embeddedSignup ? 'Connect WhatsApp' : 'Ask our team to connect';
    case 'services': return step.status === 'done' ? 'Edit services' : 'Add a service';
    case 'templates': return step.status === 'done' ? 'Manage templates' : 'Open templates';
    case 'test': return step.status === 'done' ? 'Send another' : 'Send a test message';
    case 'go_live': return step.status === 'todo' ? 'Go live' : null;
    default: return null;
  }
}

/** Checks a service form before it is sent; the server checks again. */
export function validateService(form = {}) {
  const errors = {};
  if (String(form.name || '').trim().length < 2) errors.name = 'Give the service a name';
  const price = Number(form.price_inr);
  if (form.price_inr === '' || form.price_inr == null || !Number.isFinite(price) || price < 0) errors.price_inr = 'Enter the price in rupees';
  const minutes = Number(form.duration_minutes);
  if (!Number.isInteger(minutes) || minutes < 5 || minutes > 1440) errors.duration_minutes = 'Enter minutes, between 5 and 1440';
  const answers = Array.isArray(form.answers) ? form.answers : [];
  if (answers.some((item) => Boolean(String(item.question || '').trim()) !== Boolean(String(item.answer || '').trim()))) {
    errors.answers = 'Each question needs an answer';
  }
  return { ok: Object.keys(errors).length === 0, errors };
}

/** The body sent to the server: blank question rows are dropped. */
export function serviceBody(form) {
  return {
    name: String(form.name || '').trim(),
    price_inr: Number(form.price_inr),
    duration_minutes: Number(form.duration_minutes),
    availability: String(form.availability || '').trim(),
    notes: String(form.notes || '').trim(),
    answers: (form.answers || []).filter((item) => String(item.question || '').trim() || String(item.answer || '').trim()),
  };
}

/** What the test-message button needs to ask for, from the server's error code. */
export function testMessageHint(error) {
  switch (error?.code) {
    case 'CONFIRMATION_REQUIRED': return { needsConfirm: true };
    case 'PHONE_REQUIRED': return { needsPhone: true };
    default: return {};
  }
}

/** Short summary line for the card header, for example "3 of 6 steps done". */
export const progressLine = (overview) => (overview ? `${overview.done_count} of ${overview.total} steps done` : '');
