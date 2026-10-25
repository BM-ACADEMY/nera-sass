const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { google } = require('googleapis');
const { GoogleCalendarCredentials } = require('../models');
const { encrypt, decrypt } = require('../utils/crypto');
const { currentTenantId, requireTenantId } = require('./tenantContext');

// Every workspace connects its own Google account; all calls below act on the
// calendar of the tenant in the current request/job context.
const DEFAULT_TIME_ZONE = process.env.GOOGLE_CALENDAR_TIME_ZONE || 'Asia/Kolkata';
// Before per-workspace connections, one calendar was configured in .env. That
// connection now belongs only to the workspace named here (if any).
const ENV_TENANT_ID = Number(process.env.GOOGLE_CALENDAR_ENV_TENANT_ID) || null;
const SCOPES = [
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/calendar.freebusy',
  'https://www.googleapis.com/auth/userinfo.email',
  'openid',
];
const STATE_TTL = '15m';

const SETTINGS_DEFAULTS = {
  calendar_id: 'primary',
  time_zone: DEFAULT_TIME_ZONE,
  booking_enabled: true,
  meeting_minutes: 30,
  work_days: [1, 2, 3, 4, 5, 6],
  work_start: '10:00',
  work_end: '19:00',
};
const SETTING_KEYS = Object.keys(SETTINGS_DEFAULTS);

class CalendarError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'CalendarError';
    this.code = code;
  }
}

const createOAuthClient = () => new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI
);

const isConfigured = () => Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.GOOGLE_REDIRECT_URI);

const requireOAuthConfig = () => {
  if (!isConfigured()) throw new CalendarError('Google Calendar OAuth is not configured', 'NOT_CONFIGURED');
};

// The OAuth state carries the workspace across Google's redirect. It is signed
// with a key derived from JWT_SECRET so it can never pass as a login token.
const stateSecret = () => {
  if (!process.env.JWT_SECRET) throw new Error('JWT_SECRET is not configured');
  return crypto.createHash('sha256').update(`${process.env.JWT_SECRET}:google-calendar-oauth`).digest();
};

const loadRow = () => GoogleCalendarCredentials.findOne({}).lean();

const envConnection = () => (
  ENV_TENANT_ID && currentTenantId() === ENV_TENANT_ID && process.env.GOOGLE_REFRESH_TOKEN
    ? { refreshToken: process.env.GOOGLE_REFRESH_TOKEN, calendarId: process.env.GOOGLE_CALENDAR_ID || 'primary', email: process.env.GOOGLE_CALENDAR_ID || null }
    : null
);

const settingsOf = (row) => {
  const settings = {};
  for (const key of SETTING_KEYS) settings[key] = row?.[key] ?? SETTINGS_DEFAULTS[key];
  return settings;
};

// The workspace's connection: credentials + booking rules. Throws when the
// workspace has not connected a calendar.
const getConnection = async () => {
  requireTenantId();
  const row = await loadRow();
  const settings = settingsOf(row);
  if (row?.refresh_token_encrypted) {
    return { refreshToken: decrypt(row.refresh_token_encrypted), email: row.connected_email || null, settings };
  }
  const legacy = envConnection();
  if (legacy) return { refreshToken: legacy.refreshToken, email: legacy.email, settings: { ...settings, calendar_id: row?.calendar_id || legacy.calendarId } };
  throw new CalendarError('Google Calendar is not connected', 'NOT_CONNECTED');
};

const calendarClient = async () => {
  requireOAuthConfig();
  const connection = await getConnection();
  const auth = createOAuthClient();
  auth.setCredentials({ refresh_token: connection.refreshToken });
  return { calendar: google.calendar({ version: 'v3', auth }), connection, settings: connection.settings };
};

const getAuthorizationUrl = ({ userId } = {}) => {
  requireOAuthConfig();
  const tenantId = requireTenantId();
  const state = jwt.sign({ t: tenantId, u: userId || null, n: crypto.randomUUID() }, stateSecret(), { expiresIn: STATE_TTL });
  return createOAuthClient().generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: true,
    scope: SCOPES,
    state,
  });
};

// Returns { tenantId, userId } from a state issued by getAuthorizationUrl.
const verifyState = (state) => {
  try {
    const payload = jwt.verify(String(state || ''), stateSecret());
    if (!Number.isInteger(payload.t) || payload.t <= 0) throw new Error('bad tenant');
    return { tenantId: payload.t, userId: payload.u || null };
  } catch {
    throw new CalendarError('This Google sign-in link has expired. Start the connection again from the Calendar page.', 'BAD_STATE');
  }
};

// Runs inside the workspace's tenant context (see the callback route).
const exchangeAndStoreCode = async (code, { userId } = {}) => {
  requireOAuthConfig();
  requireTenantId();
  const client = createOAuthClient();
  const { tokens } = await client.getToken(code);
  if (!tokens.refresh_token) throw new CalendarError('Google did not return a refresh token; please connect again', 'NO_REFRESH_TOKEN');
  const granted = String(tokens.scope || '');
  if (!granted.includes('calendar.events') || !granted.includes('calendar.freebusy')) {
    throw new CalendarError('Calendar access was not granted. Please connect again and allow all requested permissions.', 'SCOPE_DENIED');
  }
  client.setCredentials(tokens);
  const profile = await google.oauth2({ version: 'v2', auth: client }).userinfo.get().catch(() => ({ data: {} }));
  const email = profile.data.email || null;

  // Revoke the token this replaces so a reconnect does not leave it live.
  const previous = await loadRow();
  if (previous?.refresh_token_encrypted) {
    await createOAuthClient().revokeToken(decrypt(previous.refresh_token_encrypted)).catch(() => {});
  }
  await GoogleCalendarCredentials.updateOne(
    {},
    { $set: {
      refresh_token_encrypted: encrypt(tokens.refresh_token),
      connected_email: email,
      connected_at: new Date(),
      connected_by: userId || null,
      calendar_id: 'primary',
      updated_at: new Date(),
    } },
    { upsert: true }
  );
  return email;
};

const disconnect = async () => {
  requireTenantId();
  const row = await loadRow();
  if (row?.refresh_token_encrypted) {
    await createOAuthClient().revokeToken(decrypt(row.refresh_token_encrypted)).catch(() => {});
  }
  await GoogleCalendarCredentials.updateOne(
    {},
    { $unset: { refresh_token_encrypted: '', connected_email: '', connected_at: '', connected_by: '' }, $set: { updated_at: new Date() } }
  );
  return { connected: false };
};

const getConnectionStatus = async () => {
  requireTenantId();
  const row = await loadRow();
  const base = { configured: isConfigured(), settings: settingsOf(row) };
  if (!row?.refresh_token_encrypted && !envConnection()) return { ...base, connected: false };
  try {
    const { calendar, connection, settings } = await calendarClient();
    await calendar.events.list({ calendarId: settings.calendar_id, maxResults: 1, timeMin: new Date().toISOString() });
    return { ...base, connected: true, email: connection.email, connected_at: row?.connected_at || null, legacy: !row?.refresh_token_encrypted };
  } catch (error) {
    // invalid_grant: the customer revoked access or the token expired.
    const expired = /invalid_grant|unauthorized|401/i.test(String(error.message));
    return { ...base, connected: false, needs_reconnect: true, email: row?.connected_email || null, error: expired ? 'Google access was revoked or expired. Please reconnect.' : error.message };
  }
};

const updateSettings = async (input = {}) => {
  requireTenantId();
  const $set = { updated_at: new Date() };
  const time = /^([01]\d|2[0-3]):[0-5]\d$/;
  if ('booking_enabled' in input) $set.booking_enabled = Boolean(input.booking_enabled);
  if ('meeting_minutes' in input) {
    const minutes = Number(input.meeting_minutes);
    if (![15, 30, 45, 60, 90, 120].includes(minutes)) throw new CalendarError('Meeting length must be 15, 30, 45, 60, 90 or 120 minutes', 'INVALID');
    $set.meeting_minutes = minutes;
  }
  if ('work_days' in input) {
    const days = [...new Set((Array.isArray(input.work_days) ? input.work_days : []).map(Number))].filter((d) => Number.isInteger(d) && d >= 0 && d <= 6).sort();
    if (!days.length) throw new CalendarError('Pick at least one working day', 'INVALID');
    $set.work_days = days;
  }
  for (const key of ['work_start', 'work_end']) {
    if (key in input) {
      if (!time.test(String(input[key]))) throw new CalendarError('Times must be in HH:MM format', 'INVALID');
      $set[key] = String(input[key]);
    }
  }
  if ('time_zone' in input) {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: String(input.time_zone) });
    } catch {
      throw new CalendarError('Unknown time zone', 'INVALID');
    }
    $set.time_zone = String(input.time_zone);
  }
  const current = settingsOf(await loadRow());
  if (($set.work_start || current.work_start) >= ($set.work_end || current.work_end)) {
    throw new CalendarError('Working hours must end after they start', 'INVALID');
  }
  await GoogleCalendarCredentials.updateOne({}, { $set }, { upsert: true });
  return settingsOf(await loadRow());
};

// Weekday and HH:MM of a moment in the workspace's time zone.
const localParts = (date, timeZone) => {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(date).map((p) => [p.type, p.value]));
  return { day: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts.weekday), time: `${parts.hour}:${parts.minute}` };
};

const withinWorkingHours = (start, end, settings) => {
  const from = localParts(start, settings.time_zone);
  const to = localParts(new Date(end.getTime() - 1), settings.time_zone);
  return from.day === to.day && settings.work_days.includes(from.day) &&
    from.time >= settings.work_start && to.time < settings.work_end;
};

const describeWorkingHours = (settings) => {
  const names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return `${settings.work_days.map((d) => names[d]).join(', ')}, ${settings.work_start}–${settings.work_end} (${settings.time_zone})`;
};

const freeBusy = async (calendar, settings, start, end) => {
  const response = await calendar.freebusy.query({
    requestBody: { timeMin: start.toISOString(), timeMax: end.toISOString(), timeZone: settings.time_zone, items: [{ id: settings.calendar_id }] },
  });
  return (response.data.calendars?.[settings.calendar_id]?.busy || []).length === 0;
};

const isSlotAvailable = async (start, end) => {
  const { calendar, settings } = await calendarClient();
  return freeBusy(calendar, settings, start, end);
};

const meetLinkOf = (event) => event.hangoutLink || event.conferenceData?.entryPoints?.find(item => item.entryPointType === 'video')?.uri || null;

const findLeadEvent = async (calendar, settings, leadId) => {
  const existing = await calendar.events.list({
    calendarId: settings.calendar_id,
    privateExtendedProperty: [`lead_id=${leadId}`, 'source=LeadOS'],
    timeMin: new Date().toISOString(),
    singleEvents: true,
    maxResults: 1,
    orderBy: 'startTime',
  });
  return existing.data.items?.[0] || null;
};

const bookMeeting = async ({ leadId, brand, name, email, phone, start, durationMinutes, notes = '', enforceWorkingHours = true }) => {
  const startDate = new Date(start);
  if (Number.isNaN(startDate.getTime()) || startDate <= new Date()) throw new CalendarError('Meeting time must be a valid future date', 'INVALID');
  const { calendar, settings } = await calendarClient();
  const minutes = Number(durationMinutes) || settings.meeting_minutes;
  const endDate = new Date(startDate.getTime() + minutes * 60 * 1000);
  if (enforceWorkingHours && !withinWorkingHours(startDate, endDate, settings)) {
    return { booked: false, reason: 'outside_working_hours', working_hours: describeWorkingHours(settings) };
  }

  // Workflow retries must be idempotent. Reuse an existing future LeadOS
  // event for this lead rather than creating a duplicate Calendar/Meet entry.
  const existingEvent = await findLeadEvent(calendar, settings, leadId);
  if (existingEvent) {
    const existingStart = new Date(existingEvent.start?.dateTime || existingEvent.start?.date);
    const sameSlot = !Number.isNaN(existingStart.getTime()) && Math.abs(existingStart.getTime() - startDate.getTime()) < 60000;
    if (!sameSlot) {
      if (!(await freeBusy(calendar, settings, startDate, endDate))) return { booked: false, reason: 'slot_unavailable' };
      const updated = await calendar.events.patch({
        calendarId: settings.calendar_id,
        eventId: existingEvent.id,
        sendUpdates: email ? 'all' : 'none',
        requestBody: {
          start: { dateTime: startDate.toISOString(), timeZone: settings.time_zone },
          end: { dateTime: endDate.toISOString(), timeZone: settings.time_zone },
        },
      });
      return {
        booked: true,
        rescheduled: true,
        event_id: updated.data.id,
        event_url: updated.data.htmlLink,
        meet_link: meetLinkOf(updated.data),
        start: updated.data.start?.dateTime,
        end: updated.data.end?.dateTime,
      };
    }
    return {
      booked: true,
      reused: true,
      event_id: existingEvent.id,
      event_url: existingEvent.htmlLink,
      meet_link: meetLinkOf(existingEvent),
      start: existingEvent.start?.dateTime,
      end: existingEvent.end?.dateTime,
    };
  }

  if (!(await freeBusy(calendar, settings, startDate, endDate))) return { booked: false, reason: 'slot_unavailable' };

  const response = await calendar.events.insert({
    calendarId: settings.calendar_id,
    conferenceDataVersion: 1,
    sendUpdates: email ? 'all' : 'none',
    requestBody: {
      summary: `${brand || 'Meeting'} — ${name || phone || `Lead ${leadId}`}`,
      description: [`Mobile: ${phone || 'Not provided'}`, notes].filter(Boolean).join('\n'),
      start: { dateTime: startDate.toISOString(), timeZone: settings.time_zone },
      end: { dateTime: endDate.toISOString(), timeZone: settings.time_zone },
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
    meet_link: meetLinkOf(response.data),
    start: response.data.start?.dateTime || startDate.toISOString(),
    end: response.data.end?.dateTime || endDate.toISOString(),
  };
};

// Mirrors bookMeeting's own lookup (by lead_id/source on the event, not a
// DB column) so cancellation is correct even if the leads table's cached
// calendar_event_id is stale or was never written.
const cancelMeeting = async (leadId) => {
  const { calendar, settings } = await calendarClient();
  const existingEvent = await findLeadEvent(calendar, settings, leadId);
  if (!existingEvent) return { cancelled: false, reason: 'not_found' };

  await calendar.events.delete({
    calendarId: settings.calendar_id,
    eventId: existingEvent.id,
    sendUpdates: 'all',
  });
  return { cancelled: true, event_id: existingEvent.id, start: existingEvent.start?.dateTime };
};

// Booking rules for the AI prompt and replies; never throws.
const getBookingContext = async () => {
  try {
    const row = await loadRow();
    const settings = settingsOf(row);
    const connected = Boolean(row?.refresh_token_encrypted || envConnection());
    return { connected, enabled: connected && settings.booking_enabled, settings, working_hours: describeWorkingHours(settings), notify_email: row?.connected_email || null };
  } catch {
    return { connected: false, enabled: false, settings: settingsOf(null), working_hours: describeWorkingHours(settingsOf(null)), notify_email: null };
  }
};

const isDisconnectedError = (error) => (
  error?.code === 'NOT_CONNECTED' || error?.code === 'NOT_CONFIGURED' ||
  /not connected|oauth is not configured|refresh token|invalid_grant/i.test(String(error?.message))
);

module.exports = {
  DEFAULT_TIME_ZONE,
  // Kept for callers that format times before a workspace is known.
  TIME_ZONE: DEFAULT_TIME_ZONE,
  CalendarError,
  isConfigured,
  getAuthorizationUrl,
  verifyState,
  exchangeAndStoreCode,
  disconnect,
  getConnectionStatus,
  updateSettings,
  getBookingContext,
  withinWorkingHours,
  isSlotAvailable,
  bookMeeting,
  cancelMeeting,
  isDisconnectedError,
};
