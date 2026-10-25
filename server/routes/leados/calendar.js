/**
 * Customer panel Calendar: each workspace connects its own Google Calendar.
 * The WhatsApp AI then books Google Meet meetings on that calendar, inside the
 * workspace's working hours; the team sees and cancels them here.
 */
const { runAsTenant } = require('../../services/tenantContext');
const { requirePermission } = require('../../services/permissions');
const audit = require('../../services/audit');
const googleCalendar = require('../../services/googleCalendar');

const appUrl = () => (process.env.NERA_APP_URL || process.env.PORTAL_URL || 'http://localhost:5173').replace(/\/+$/, '');

module.exports = function registerCalendarRoutes(app, ctx) {
  const { Leads, auth, internalAuth } = ctx;
  const manage = requirePermission('calendar.manage');
  const fail = (res, error) => {
    if (error instanceof googleCalendar.CalendarError) {
      const status = error.code === 'NOT_CONNECTED' || error.code === 'NOT_CONFIGURED' ? 409 : 400;
      return res.status(status).json({ error: error.message, code: error.code });
    }
    console.error('[calendar]', error.message);
    return res.status(500).json({ error: 'Server error' });
  };

  app.get('/api/calendar/status', internalAuth, async (req, res) => {
    try {
      res.json(await googleCalendar.getConnectionStatus());
    } catch (error) {
      fail(res, error);
    }
  });

  // Returns the Google consent URL; the browser goes there next.
  app.post('/api/calendar/google/connect', auth, manage, async (req, res) => {
    try {
      res.json({ url: googleCalendar.getAuthorizationUrl({ userId: req.user?.id }) });
    } catch (error) {
      fail(res, error);
    }
  });

  // Google redirects here without a login; the signed state names the
  // workspace. Path kept as registered in the Google Cloud console.
  app.get('/api/auth/google/callback-calender', async (req, res) => {
    const back = (params) => res.redirect(`${appUrl()}/calendar?${new URLSearchParams(params)}`);
    if (req.query.error) return back({ calendar: 'error', message: 'Google sign-in was cancelled.' });
    let state;
    try {
      state = googleCalendar.verifyState(req.query.state);
      if (!req.query.code) throw new googleCalendar.CalendarError('Google did not return an authorization code.', 'NO_CODE');
    } catch (error) {
      return back({ calendar: 'error', message: error.message });
    }
    try {
      const email = await runAsTenant(state.tenantId, async () => {
        const connected = await googleCalendar.exchangeAndStoreCode(String(req.query.code), { userId: state.userId });
        await audit.record(audit.EVENTS.CALENDAR_CONNECTED, {
          tenantId: state.tenantId, actor: { actor_type: 'user', actor_user_id: state.userId, ip: req.ip || null }, targetType: 'google_calendar', meta: { email: connected },
        });
        return connected;
      });
      return back({ calendar: 'connected', email: email || '' });
    } catch (error) {
      console.error('[calendar] Google connection failed:', error.message);
      const message = error instanceof googleCalendar.CalendarError ? error.message : 'Could not connect Google Calendar. Please try again.';
      return back({ calendar: 'error', message });
    }
  });

  app.delete('/api/calendar/google', auth, manage, async (req, res) => {
    try {
      await googleCalendar.disconnect();
      await audit.record(audit.EVENTS.CALENDAR_DISCONNECTED, { tenantId: req.identity.tenantId, req, targetType: 'google_calendar' });
      res.json({ success: true, connected: false });
    } catch (error) {
      fail(res, error);
    }
  });

  app.put('/api/calendar/settings', auth, manage, async (req, res) => {
    try {
      res.json({ success: true, settings: await googleCalendar.updateSettings(req.body || {}) });
    } catch (error) {
      fail(res, error);
    }
  });

  // Upcoming booked meetings, plus times leads asked for while booking was
  // unavailable (for the team to confirm).
  app.get('/api/calendar/meetings', auth, async (req, res) => {
    try {
      const since = new Date(Date.now() - 2 * 60 * 60 * 1000);
      const fields = { _id: 0, id: 1, name: 1, phone: 1, email: 1, booking_status: 1, call_booked_at: 1, meeting_requested_for: 1, google_meet_link: 1, calendar_event_url: 1 };
      const [upcoming, requested] = await Promise.all([
        Leads.find({ booking_status: 'confirmed', call_booked_at: { $gte: since } }, fields).sort({ call_booked_at: 1 }).limit(200).lean(),
        Leads.find({ booking_status: 'requested' }, fields).sort({ meeting_requested_for: 1 }).limit(100).lean(),
      ]);
      res.json({ upcoming, requested });
    } catch (error) {
      fail(res, error);
    }
  });

  app.post('/api/calendar/meetings/:leadId/cancel', auth, async (req, res) => {
    try {
      const leadId = Number(req.params.leadId);
      if (!(await Leads.exists({ id: leadId }))) return res.status(404).json({ error: 'Lead not found' });
      const result = await googleCalendar.cancelMeeting(leadId);
      await Leads.updateOne({ id: leadId }, { $set: {
        booking_status: 'cancelled', calendar_event_id: null, calendar_event_url: null,
        google_meet_link: null, call_booked_at: null, updated_at: new Date(),
      } });
      res.json({ success: true, cancelled: result.cancelled });
    } catch (error) {
      if (googleCalendar.isDisconnectedError(error)) return res.status(409).json({ error: 'Connect your Google Calendar first.', code: 'CALENDAR_NOT_CONNECTED' });
      fail(res, error);
    }
  });
};
