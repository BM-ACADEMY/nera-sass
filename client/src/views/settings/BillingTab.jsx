import { SectionTitle, ReadOnly, Notice } from './ui.jsx';

const date = (value) => (value ? new Date(value).toLocaleDateString() : '');

// Billing: read-only plan details from GET /api/tenant (owner/admin only;
// the server returns full details only to billing.view).
export const BillingTab = ({ tenantInfo }) => {
  const sub = tenantInfo?.subscription;
  const usage = tenantInfo?.usage;
  return (
    <div>
      <SectionTitle>Billing</SectionTitle>
      {!sub && <Notice tone="muted">No active plan.</Notice>}
      <ReadOnly label="Plan" value={sub?.plan_name} />
      <ReadOnly label="Term" value={sub?.term_months ? `${sub.term_months} month${sub.term_months === 1 ? '' : 's'}` : ''} />
      <ReadOnly label="Current period" value={sub?.current_period_start ? `${date(sub.current_period_start)} – ${date(sub.current_period_end)}` : ''} />
      <ReadOnly label="Workspace status" value={tenantInfo?.lifecycle?.state} />
      <ReadOnly label="Users" value={usage ? `${usage.users} active${usage.max_users >= 0 ? ` of ${usage.max_users}` : ''}${usage.pending_invitations ? `, ${usage.pending_invitations} invited` : ''}` : ''} />
      <p style={{ fontSize: 11, marginTop: 6 }}>To change your plan, contact support.</p>
    </div>
  );
};
