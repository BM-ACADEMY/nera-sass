/**
 * Delivery progress of campaign messages (plan N4).
 *
 * campaign_logs.status moves one way: sent → delivered → read → replied. Meta's
 * receipts can arrive out of order (a late "delivered" after "read"), so a
 * status only ever moves forward. Counts are cumulative, as people read them:
 * "delivered" includes the messages that were then read or answered.
 */
const { CampaignLogs } = require('../models');

const RANK = Object.freeze({ sent: 1, delivered: 2, read: 3, replied: 4 });
const REPLY_WINDOW_DAYS = 7;

const lowerThan = (status) => Object.keys(RANK).filter((s) => RANK[s] < RANK[status]);

/** Moves the log of one WhatsApp message forward to `status` (never back). */
async function advanceByMessageId(waMessageId, status) {
  if (!RANK[status] || !waMessageId) return 0;
  const result = await CampaignLogs.updateMany({ wa_message_id: waMessageId, status: { $in: lowerThan(status) } }, { $set: { status } });
  return result.modifiedCount || 0;
}

/**
 * A contact wrote back: credit the reply to the latest campaign message sent
 * to them in the last REPLY_WINDOW_DAYS days, and to that one only.
 */
async function recordReply(leadId, now = new Date()) {
  if (leadId == null) return 0;
  const since = new Date(now.getTime() - REPLY_WINDOW_DAYS * 24 * 3600 * 1000);
  const latest = await CampaignLogs.findOne({ lead_id: Number(leadId), status: { $in: Object.keys(RANK).filter((s) => s !== 'replied') }, sent_at: { $gte: since } }, { _id: 0, id: 1 }).sort({ sent_at: -1 }).lean();
  if (!latest) return 0;
  const result = await CampaignLogs.updateOne({ id: latest.id, status: { $ne: 'replied' } }, { $set: { status: 'replied', replied_at: now } });
  return result.modifiedCount || 0;
}

/** { sent, delivered, read, replied, failed } for campaigns, from the logs of the current workspace. */
async function countsFor(campaignIds) {
  const rows = campaignIds.length
    ? await CampaignLogs.aggregate([{ $match: { campaign_id: { $in: campaignIds } } }, { $group: { _id: { campaign_id: '$campaign_id', status: '$status' }, n: { $sum: 1 } } }])
    : [];
  const out = new Map(campaignIds.map((id) => [id, { sent: 0, delivered: 0, read: 0, replied: 0, failed: 0, skipped: 0 }]));
  for (const row of rows) {
    const counts = out.get(row._id.campaign_id);
    const n = row.n;
    const status = row._id.status;
    if (status === 'failed') counts.failed += n;
    else if (status === 'skipped') counts.skipped += n;
    else if (RANK[status]) {
      counts.sent += n;
      if (RANK[status] >= RANK.delivered) counts.delivered += n;
      if (RANK[status] >= RANK.read) counts.read += n;
      if (status === 'replied') counts.replied += n;
    }
  }
  return out;
}

module.exports = { RANK, REPLY_WINDOW_DAYS, advanceByMessageId, recordReply, countsFor };
