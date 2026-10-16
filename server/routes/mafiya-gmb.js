const express = require('express');
const router = express.Router();
const { google } = require('googleapis');
const { MafiyaGmbClients, MafiyaGmbTokens } = require('../models');

const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_CALLBACK_URL
);

/**
 * GET /auth/:clientId
 * Initiates Google OAuth for a specific client.
 * This is the link sent in the email.
 */
router.get('/auth/:clientId', async (req, res) => {
  const { clientId } = req.params;

  try {
    // Verify client exists
    const gmbClient = await MafiyaGmbClients.findOne({ id: clientId }, { id: 1, business_name: 1 }).lean();
    if (!gmbClient) {
      return res.status(404).send(`
        <html><body style="background:#0a0f1d;color:#fff;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;">
          <div style="text-align:center;">
            <h1 style="color:#ef4444;">Client Not Found</h1>
            <p style="color:#94a3b8;">This authorization link is invalid or expired.</p>
          </div>
        </body></html>
      `);
    }

    const url = oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: [
        'https://www.googleapis.com/auth/business.manage'
      ],
      prompt: 'consent select_account',
      state: clientId.toString(), // Pass clientId through OAuth state
    });

    

    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.redirect(url);
  } catch (err) {
    console.error('[Mafiya] GMB auth initiation error:', err);
    res.status(500).send('Authorization error. Please try again.');
  }
});

/**
 * Google OAuth Callback logic
 */
const handleGoogleCallback = async (req, res) => {
  const { code, state: clientId } = req.query;
  const frontendUrl = process.env.PORTAL_URL;

  if (!code || !clientId) {
    return res.redirect(`${frontendUrl}/mafiya/add-client?gmb_error=missing_params`);
  }

  try {
    // Exchange authorization code for tokens
    const { tokens } = await oauth2Client.getToken(code);

    const expiresAt = tokens.expiry_date ? new Date(tokens.expiry_date) : null;

    // Upsert tokens — replace existing if any
    await MafiyaGmbTokens.deleteMany({ client_id: clientId });

    await MafiyaGmbTokens.create({
      client_id: clientId,
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token || null,
      expires_at: expiresAt,
    });

    // Mark client as verified
    await MafiyaGmbClients.updateOne({ id: clientId }, { $set: { gmb_verified: true } });

    // Emit real-time update event via Socket.io
    const io = req.app.get('io');
    if (io) {
      io.emit('mafiya_gmb_connected', { clientId: Number(clientId), gmb_verified: true });
      console.log(`[Socket.io] Emitted mafiya_gmb_connected for client: ${clientId}`);
    }

    console.log(`[Mafiya] GMB connected for client ID: ${clientId}`);

    // Redirect to success page
    res.send(`
      <!DOCTYPE html>
      <html>
      <head><meta charset="utf-8" /><title>GMB Connected</title></head>
      <body style="margin:0;background:#0a0f1d;font-family:'Segoe UI',sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;">
        <div style="text-align:center;background:#111827;border:1px solid #1e293b;border-radius:16px;padding:48px 40px;max-width:420px;">
          <div style="width:64px;height:64px;background:linear-gradient(135deg,#10b981,#059669);border-radius:50%;margin:0 auto 20px;display:flex;align-items:center;justify-content:center;">
            <span style="font-size:30px;">✓</span>
          </div>
          <h1 style="color:#ffffff;font-size:22px;margin:0 0 8px;">GMB Profile Connected!</h1>
          <p style="color:#94a3b8;font-size:14px;line-height:1.5;margin:0 0 28px;">
            Your Google Business Profile has been successfully authorized. You can close this tab now.
          </p>
        </div>
      </body>
      </html>
    `);
  } catch (err) {
    console.error('[Mafiya] GMB OAuth callback error:', err);
    res.redirect(`${frontendUrl}/mafiya/add-client?gmb_error=oauth_failed`);
  }
};

/**
 * GET /auth/callback
 * Google redirects here after user consents.
 * Exchanges code for tokens and stores them.
 */
router.get('/auth/callback', handleGoogleCallback);

/**
 * GET /status/:clientId
 * Check GMB connection status for a client
 */
router.get('/status/:clientId', async (req, res) => {
  try {
    const token = await MafiyaGmbTokens.findOne({ client_id: req.params.clientId }, { refresh_token: 1 }).lean();
    res.json({
      connected: Boolean(token),
      has_refresh_token: Boolean(token) && !!token.refresh_token,
    });
  } catch (err) {
    console.error('[Mafiya] GMB status check error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = {
  router,
  handleGoogleCallback
};
