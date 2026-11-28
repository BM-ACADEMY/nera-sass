#!/usr/bin/env node
/**
 * Migration 044 — customer roles become Owner, Admin and Staff, with sections.
 *
 * MongoDB migration, written as a file only: the server never runs it.
 *
 *   MONGODB_URI=... node migrations/044_roles_sections.js            # dry run (report only, the default)
 *   MONGODB_URI=... node migrations/044_roles_sections.js --apply    # write
 *
 * Why: workspace people had four roles (owner, admin, manager, agent). Now
 * there are three, and what an Admin or Staff member can open is a list of
 * sections (services/permissions.js SECTIONS) chosen per person.
 *
 * What it does (idempotent; running it again changes nothing):
 *   Customer users (tenant_id set, not platform staff) and pending
 *   invitations:
 *   - owner: unchanged (Owners have every section; nothing is stored);
 *   - admin without sections: sections = all (followups included);
 *   - manager: role staff, sections = dashboard, leads, sales_tasks, inbox,
 *     templates, campaigns, ai_brain, followups, reports;
 *   - agent (and the original app's user / ops): role staff, sections =
 *     leads, inbox, sales_tasks (no followups);
 *   - staff without sections: sections = leads, inbox.
 *   A user who already has a sections list keeps it (only a retired role name
 *   is changed to staff). The old role is kept in migrated_from_role.
 *   The app already reads unmigrated rows this way (permissions.sectionsFor),
 *   so running this changes nobody's access.
 */
const path = require('path');

const TAG = '[044]';

async function migrate({ apply = false, log = console.log } = {}) {
  const { Users, Invitations } = require('../models');
  const { runAsSystem } = require('../services/tenantContext');
  const { TENANT_ROLES, normalizeTenantRole, sectionsFor } = require('../services/permissions');

  return runAsSystem(async () => {
    const report = { apply, users_changed: 0, users_unchanged: 0, invitations_changed: 0, invitations_unchanged: 0, by_role: {} };

    // The update for one row ({ role, sections }), or null when it is already right.
    function plan(row) {
      const raw = String(row.role || '').toLowerCase();
      const role = normalizeTenantRole(raw);
      if (role === 'owner') return raw === 'owner' ? null : { $set: { role: 'owner', migrated_from_role: row.role } };
      const sections = sectionsFor(raw, row.sections);
      const same = raw === role && Array.isArray(row.sections) && row.sections.join() === sections.join();
      if (same) return null;
      const set = { role, sections };
      if (raw !== role) set.migrated_from_role = row.role ?? null;
      return { $set: set };
    }

    const users = await Users.find(
      { tenant_id: { $ne: null }, is_platform_staff: { $ne: true } },
      { _id: 0, id: 1, tenant_id: 1, email: 1, role: 1, sections: 1 },
    ).lean();
    for (const user of users) {
      const update = plan(user);
      if (!update) { report.users_unchanged += 1; continue; }
      report.users_changed += 1;
      const key = `${user.role ?? '(none)'} -> ${update.$set.role}`;
      report.by_role[key] = (report.by_role[key] || 0) + 1;
      log(`${TAG} user #${user.id} (workspace ${user.tenant_id}): ${key} [${(update.$set.sections || []).join(', ')}] ${apply ? 'updated' : 'would be updated'}`);
      if (apply) await Users.updateOne({ id: user.id, tenant_id: user.tenant_id }, update);
    }

    const pending = await Invitations.find(
      { tenant_id: { $ne: null }, is_platform_staff: { $ne: true }, accepted_at: null, revoked_at: null },
      { _id: 0, id: 1, tenant_id: 1, role: 1, sections: 1 },
    ).lean();
    for (const invitation of pending) {
      const update = plan(invitation);
      if (!update) { report.invitations_unchanged += 1; continue; }
      report.invitations_changed += 1;
      if (apply) await Invitations.updateOne({ id: invitation.id, tenant_id: invitation.tenant_id }, update);
    }

    log(`${TAG} roles now: ${TENANT_ROLES.join(', ')}`);
    log(`${TAG} ${apply ? 'applied' : 'dry run'}: ${JSON.stringify(report)}`);
    return report;
  }, 'migration-044');
}

module.exports = { migrate };

if (require.main === module) {
  require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });
  const apply = process.argv.includes('--apply');
  (async () => {
    const { connectMongo, mongoose } = require('../db/mongo');
    await connectMongo();
    await migrate({ apply });
    await mongoose.disconnect();
  })().then(() => process.exit(0)).catch((error) => {
    console.error(`${TAG} failed:`, error.message);
    process.exit(1);
  });
}
