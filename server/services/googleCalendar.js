const crypto = require('crypto');
const { google } = require('googleapis');
const pool = require('../db/connection');
const { encrypt, decrypt } = require('../utils/crypto');

const TIME_ZONE = process.env.GOOGLE_CALENDAR_TIME_ZONE || 'Asia/Kolkata';
const ORGANIZER_EMAIL = process.env.GOOGLE_CALENDAR_ID || 'bmacademypondy@gmail.com';

const calendarCredentialsReady = pool.query(`
  CREATE TABLE IF NOT EXISTS google_calendar_credentials (
    id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    refresh_token_encrypted TEXT NOT NULL,
    connected_email TEXT,
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
  )
`).catch(error => console.error('[Google Calendar] Credential table initialization failed:', error.message));

const createOAuthClient = () => new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI
);

const requireOAuthConfig = () => {
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET ||
    !(process.env.GOOGLE_REDIRECT_URI)) {
    throw new Error('Google Calendar OAuth is not configured');
  }
};

const getStoredRefreshToken = async () => {
  if (process.env.GOOGLE_REFRESH_TOKEN) return process.env.GOOGLE_REFRESH_TOKEN;
  await calendarCredentialsReady;
  const result = await pool.query('SELECT refresh_token_encrypted FROM google_calendar_credentials WHERE id = 1');
  return result.rows[0]?.refresh_token_encrypted
    ? decrypt(result.rows[0].refresh_token_encrypted)
    : null;
};

const getAuthorizedClient = async () => {
  requireOAuthConfig();
  const refreshToken = await getStoredRefreshToken();
  if (!refreshToken) throw new Error('Google Calendar is not connected');
  const client = createOAuthClient();
  client.setCredentials({ refresh_token: refreshToken });
  return client;
};

const getAuthorizationUrl = () => {
  requireOAuthConfig();
  return createOAuthClient().generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: ['https://www.googleapis.com/auth/calendar'],
  });
};

const exchangeAndStoreCode = async code => {
  requireOAuthConfig();
  const client = createOAuthClient();
  const { tokens } = await client.getToken(code);
  if (!tokens.refresh_token) throw new Error('Google did not return a refresh token; reconnect with consent enabled');
  client.setCredentials(tokens);
  const oauth = google.oauth2({ version: 'v2', auth: client });
  const profile = await oauth.userinfo.get().catch(() => ({ data: {} }));
  await calendarCredentialsReady;
  await pool.query(`
    INSERT INTO google_calendar_credentials (id, refresh_token_encrypted, connected_email, updated_at)
    VALUES (1, $1, $2, NOW())
    ON CONFLICT (id) DO UPDATE SET
      refresh_token_encrypted = EXCLUDED.refresh_token_encrypted,
      connected_email = EXCLUDED.connected_email,
      updated_at = NOW()
  `, [encrypt(tokens.refresh_token), profile.data.email || ORGANIZER_EMAIL]);
  return profile.data.email || ORGANIZER_EMAIL;
};

const getConnectionStatus = async () => {
  try {
    const auth = await getAuthorizedClient();
    const calendar = google.calendar({ version: 'v3', auth });
    await calendar.calendarList.get({ calendarId: ORGANIZER_EMAIL });
    return { connected: true, calendar_id: ORGANIZER_EMAIL, time_zone: TIME_ZONE };
  } catch (error) {
    return { connected: false, calendar_id: ORGANIZER_EMAIL, time_zone: TIME_ZONE, error: error.message };
  }
};

const isSlotAvailable = async (start, end) => {
  const auth = await getAuthorizedClient();
  const calendar = google.calendar({ version: 'v3', auth });
  const response = await calendar.freebusy.query({
    requestBody: {
      timeMin: start.toISOString(),
      timeMax: end.toISOString(),
      timeZone: TIME_ZONE,
      items: [{ id: ORGANIZER_EMAIL }],
    },
  });
  return (response.data.calendars?.[ORGANIZER_EMAIL]?.busy || []).length === 0;
};

const bookMeeting = async ({ leadId, brand, name, email, phone, start, durationMinutes = 30, notes = '' }) => {
  const startDate = new Date(start);
  if (Number.isNaN(startDate.getTime()) || startDate <= new Date()) throw new Error('Meeting time must be a valid future date');
  const endDate = new Date(startDate.getTime() + durationMinutes * 60 * 1000);
  const auth = await getAuthorizedClient();
  const calendar = google.calendar({ version: 'v3', auth });

  // Workflow retries must be idempotent. Reuse an existing future LeadOS
  // event for this lead rather than creating a duplicate Calendar/Meet entry.
  const existing = await calendar.events.list({
    calendarId: ORGANIZER_EMAIL,
    privateExtendedProperty: [`lead_id=${leadId}`, 'source=LeadOS'],
    timeMin: new Date().toISOString(),
    singleEvents: true,
    maxResults: 1,
    orderBy: 'startTime',
  });
  const existingEvent = existing.data.items?.[0];
  if (existingEvent) {
    const existingStart = new Date(existingEvent.start?.dateTime || existingEvent.start?.date);
    const sameSlot = !Number.isNaN(existingStart.getTime()) && Math.abs(existingStart.getTime() - startDate.getTime()) < 60000;
    if (!sameSlot) {
      if (!(await isSlotAvailable(startDate, endDate))) return { booked: false, reason: 'slot_unavailable' };
      const updated = await calendar.events.patch({
        calendarId: ORGANIZER_EMAIL,
        eventId: existingEvent.id,
        sendUpdates: email ? 'all' : 'none',
        requestBody: {
          start: { dateTime: startDate.toISOString(), timeZone: TIME_ZONE },
          end: { dateTime: endDate.toISOString(), timeZone: TIME_ZONE },
        },
      });
      return {
        booked: true,
        rescheduled: true,
        event_id: updated.data.id,
        event_url: updated.data.htmlLink,
        meet_link: updated.data.hangoutLink || updated.data.conferenceData?.entryPoints?.find(item => item.entryPointType === 'video')?.uri || null,
        start: updated.data.start?.dateTime,
        end: updated.data.end?.dateTime,
      };
    }
    return {
      booked: true,
      reused: true,
      event_id: existingEvent.id,
      event_url: existingEvent.htmlLink,
      meet_link: existingEvent.hangoutLink || existingEvent.conferenceData?.entryPoints?.find(item => item.entryPointType === 'video')?.uri || null,
      start: existingEvent.start?.dateTime,
      end: existingEvent.end?.dateTime,
    };
  }

  if (!(await isSlotAvailable(startDate, endDate))) return { booked: false, reason: 'slot_unavailable' };

  const response = await calendar.events.insert({
    calendarId: ORGANIZER_EMAIL,
    conferenceDataVersion: 1,
    sendUpdates: email ? 'all' : 'none',
    requestBody: {
      summary: `${brand || 'ABM Groups'} meeting — ${name || phone || `Lead ${leadId}`}`,
      description: [`Lead ID: ${leadId}`, `Mobile: ${phone || 'Not provided'}`, notes].filter(Boolean).join('\n'),
      start: { dateTime: startDate.toISOString(), timeZone: TIME_ZONE },
      end: { dateTime: endDate.toISOString(), timeZone: TIME_ZONE },
      attendees: email ? [{ email }] : [],
      conferenceData: {
        createRequest: { requestId: `leados-${leadId}-${crypto.randomUUID()}`, conferenceSolutionKey: { type: 'hangoutsMeet' } },
      },
      extendedProperties: { private: { lead_id: String(leadId), source: 'LeadOS' } },
    },
  });
  return {
    booked: true,
    event_id: response.data.id,
    event_url: response.data.htmlLink,
    meet_link: response.data.hangoutLink || response.data.conferenceData?.entryPoints?.find(item => item.entryPointType === 'video')?.uri || null,
    start: response.data.start?.dateTime || startDate.toISOString(),
    end: response.data.end?.dateTime || endDate.toISOString(),
  };
};

// Mirrors bookMeeting's own lookup (by lead_id/source on the event, not a
// DB column) so cancellation is correct even if the leads table's cached
// calendar_event_id is stale or was never written.
const cancelMeeting = async (leadId) => {
  const auth = await getAuthorizedClient();
  const calendar = google.calendar({ version: 'v3', auth });

  const existing = await calendar.events.list({
    calendarId: ORGANIZER_EMAIL,
    privateExtendedProperty: [`lead_id=${leadId}`, 'source=LeadOS'],
    timeMin: new Date().toISOString(),
    singleEvents: true,
    maxResults: 1,
    orderBy: 'startTime',
  });
  const existingEvent = existing.data.items?.[0];
  if (!existingEvent) return { cancelled: false, reason: 'not_found' };

  await calendar.events.delete({
    calendarId: ORGANIZER_EMAIL,
    eventId: existingEvent.id,
    sendUpdates: 'all',
  });
  return { cancelled: true, event_id: existingEvent.id, start: existingEvent.start?.dateTime };
};

module.exports = {
  TIME_ZONE,
  ORGANIZER_EMAIL,
  getAuthorizationUrl,
  exchangeAndStoreCode,
  getConnectionStatus,
  isSlotAvailable,
  bookMeeting,
  cancelMeeting,
};
