/**
 * Moves chat files from server/uploads/media/ to the media server and points
 * the messages at the new media:// references.
 *
 *   node scripts/migrate-media-to-mediaserver.js            dry run: only counts
 *   node scripts/migrate-media-to-mediaserver.js --apply    copy and update messages
 *   ... --apply --delete-local                              also delete the copied local files
 *
 * Needs MEDIA_SERVER_URL, MEDIA_PUBLIC_URL, MEDIA_SIGNING_SECRET and
 * MEDIA_INTERNAL_KEY in server/.env and the media server running. Safe to run
 * again: messages already on media:// are skipped.
 */
const fs = require('fs');
const path = require('path');
const { connectMongo } = require('../db/mongo');
const { Messages } = require('../models');
const { runAsSystem, runAsTenant } = require('../services/tenantContext');
const mediaStore = require('../services/mediaStore');

const APPLY = process.argv.includes('--apply');
const DELETE_LOCAL = process.argv.includes('--delete-local');
const SERVER_ROOT = path.join(__dirname, '..');

const MIME = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif',
  '.mp4': 'video/mp4', '.3gp': 'video/3gpp', '.ogg': 'audio/ogg; codecs=opus', '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4',
  '.aac': 'audio/aac', '.amr': 'audio/amr', '.pdf': 'application/pdf', '.txt': 'text/plain',
  '.doc': 'application/msword', '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel', '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

// "/uploads/media/x.jpg" or "https://api.getnera.in/uploads/media/x.jpg" -> "uploads/media/x.jpg"
function localPathOf(mediaUrl) {
  const match = /(?:^|\/)(uploads\/media\/[^/?#]+)$/.exec(String(mediaUrl || '').split(/[?#]/)[0]);
  return match ? match[1] : null;
}

async function main() {
  if (APPLY && !mediaStore.enabled()) throw new Error('Media server settings are missing in server/.env');
  await connectMongo();

  const rows = await runAsSystem(() => Messages.find(
    { media_url: /uploads\/media\// },
    { _id: 0, id: 1, tenant_id: 1, media_url: 1 },
  ).lean(), 'media-migration');

  const stats = { messages: rows.length, copied: 0, updated: 0, missing: 0, failed: 0 };
  const copiedFiles = new Set();
  const byTenant = new Map();
  for (const row of rows) {
    if (!row.tenant_id || !localPathOf(row.media_url)) continue;
    if (!byTenant.has(row.tenant_id)) byTenant.set(row.tenant_id, []);
    byTenant.get(row.tenant_id).push(row);
  }

  for (const [tenantId, messages] of byTenant) {
    await runAsTenant(tenantId, async () => {
      const refs = new Map(); // one copy per file, even when forwarded many times
      for (const message of messages) {
        const relative = localPathOf(message.media_url);
        const fullPath = path.join(SERVER_ROOT, relative);
        if (!fs.existsSync(fullPath)) {
          stats.missing++;
          continue;
        }
        if (!APPLY) continue;
        try {
          if (!refs.has(relative)) {
            const name = path.basename(relative);
            const saved = await mediaStore.save({ filePath: fullPath, mime: MIME[path.extname(name).toLowerCase()], name, source: 'migration' });
            refs.set(relative, saved.ref);
            copiedFiles.add(fullPath);
            stats.copied++;
          }
          await Messages.updateOne({ id: message.id }, { $set: { media_url: refs.get(relative) } });
          stats.updated++;
        } catch (err) {
          stats.failed++;
          console.error(`  message ${message.id} (tenant ${tenantId}): ${err.message}`);
        }
      }
    });
    console.log(`tenant ${tenantId}: ${messages.length} message(s)`);
  }

  if (APPLY && DELETE_LOCAL && stats.failed === 0) {
    for (const file of copiedFiles) fs.unlinkSync(file);
    console.log(`Deleted ${copiedFiles.size} local file(s).`);
  }

  console.log(APPLY ? 'Done.' : 'Dry run (add --apply to copy).', stats);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
