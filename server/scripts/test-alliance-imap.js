require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { ImapFlow } = require('imapflow');

const client = new ImapFlow({
  host: process.env.ALLIANCE_EMAIL_IMAP_HOST || 'imap.zoho.in',
  port: Number(process.env.ALLIANCE_EMAIL_IMAP_PORT) || 993,
  secure: String(process.env.ALLIANCE_EMAIL_IMAP_SECURE || 'true').toLowerCase() !== 'false',
  auth: {
    user: process.env.ALLIANCE_EMAIL_IMAP_USER || process.env.ALLIANCE_EMAIL_SMTP_USER,
    pass: process.env.ALLIANCE_EMAIL_IMAP_PASSWORD || process.env.ALLIANCE_EMAIL_SMTP_PASSWORD,
  },
  logger: false,
});

(async () => {
  try {
    await client.connect();
    console.log('CONNECT: OK');
    const lock = await client.getMailboxLock('INBOX');
    try {
      console.log(`INBOX: OK (${client.mailbox.exists} messages)`);
      const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      const uids = await client.search({ since }, { uid: true });
      console.log(`SEARCH: OK (${uids.length} messages in last 7 days)`);
      if (uids.length) {
        const lastUid = uids[uids.length - 1];
        for await (const message of client.fetch(String(lastUid), { uid: true, envelope: true }, { uid: true })) {
          console.log(`FETCH: OK (UID ${message.uid}, subject available: ${Boolean(message.envelope?.subject)})`);
        }
      }
    } finally {
      lock.release();
    }
  } catch (error) {
    console.error('IMAP FAILURE:', JSON.stringify({
      message: error.message,
      code: error.code,
      command: error.command,
      response: error.response,
      responseStatus: error.responseStatus,
      responseText: error.responseText,
      authenticationFailed: error.authenticationFailed,
    }, null, 2));
    process.exitCode = 1;
  } finally {
    if (client.usable) await client.logout().catch(() => {});
  }
})();
