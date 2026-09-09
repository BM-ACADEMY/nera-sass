const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST || 'smtp.gmail.com',
  port: parseInt(process.env.EMAIL_PORT || '465', 10),
  secure: process.env.EMAIL_SECURE === 'true',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

/**
 * Send GMB authorization email to a client
 * @param {Object} client - The client record from DB
 */
async function sendGmbConnectEmail(client) {
  const apiBase = process.env.API_BASE_URL;
  const authLink = `${apiBase}/api/mafiya/gmb/auth/${client.id}`;

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
</head>
<body style="margin:0;padding:0;background:#0a0f1d;font-family:'Segoe UI',Tahoma,Geneva,Verdana,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0a0f1d;padding:40px 20px;">
    <tr>
      <td align="center">
        <table width="560" cellpadding="0" cellspacing="0" style="background:#111827;border-radius:16px;border:1px solid #1e293b;overflow:hidden;">
          
          <!-- Header -->
          <tr>
            <td style="background:linear-gradient(135deg,rgba(249,115,22,0.12),rgba(234,88,12,0.03));padding:28px 32px;border-bottom:1px solid #1e293b;">
              <table cellpadding="0" cellspacing="0">
                <tr>
                  <td style="width:44px;height:44px;background:linear-gradient(135deg,#ea580c,#f97316);border-radius:12px;text-align:center;vertical-align:middle;">
                    <span style="font-size:22px;">🛡️</span>
                  </td>
                  <td style="padding-left:14px;">
                    <div style="font-size:18px;font-weight:700;color:#ffffff;letter-spacing:-0.3px;">Mafiya OS</div>
                    <div style="font-size:12px;color:#94a3b8;margin-top:2px;">Google Business Profile Authorization</div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:32px;">
              <p style="color:#e2e8f0;font-size:15px;line-height:1.6;margin:0 0 12px;">
                Hi <strong style="color:#ffffff;">${client.contact_person || 'there'}</strong>,
              </p>
              <p style="color:#94a3b8;font-size:14px;line-height:1.6;margin:0 0 24px;">
                We need to connect your <strong style="color:#f97316;">${client.business_name}</strong> Google Business Profile to start managing and tracking your GMB listing. 
                This is a one-time authorization.
              </p>

              <!-- Info Card -->
              <table width="100%" cellpadding="0" cellspacing="0" style="background:rgba(0,0,0,0.25);border:1px solid #1e293b;border-radius:10px;margin-bottom:28px;">
                <tr>
                  <td style="padding:18px 20px;">
                    <div style="font-size:11px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:10px;">Account Details</div>
                    <div style="color:#e2e8f0;font-size:13px;margin-bottom:6px;">📍 Business: <strong>${client.business_name}</strong></div>
                    <div style="color:#e2e8f0;font-size:13px;margin-bottom:6px;">📧 GMB Email: <strong>${client.gmb_email}</strong></div>
                    ${client.website_url ? `<div style="color:#e2e8f0;font-size:13px;">🌐 Website: <strong>${client.website_url}</strong></div>` : ''}
                  </td>
                </tr>
              </table>

              <!-- CTA Button -->
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td align="center">
                    <a href="${authLink}" target="_blank" style="display:inline-block;background:linear-gradient(135deg,#f97316,#ea580c);color:#ffffff;text-decoration:none;font-size:14px;font-weight:700;padding:16px 40px;border-radius:10px;letter-spacing:0.3px;box-shadow:0 4px 14px rgba(249,115,22,0.3);">
                      🔗 Connect Google Business Profile
                    </a>
                  </td>
                </tr>
              </table>

              <p style="color:#64748b;font-size:12px;line-height:1.5;margin:24px 0 0;text-align:center;">
                Clicking the button will redirect you to Google's secure login.<br/>
                Please sign in with <strong style="color:#94a3b8;">${client.gmb_email}</strong> to authorize access.
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding:18px 32px;border-top:1px solid #1e293b;text-align:center;">
              <p style="color:#475569;font-size:11px;margin:0;">
                Powered by Mafiya OS — ABM Groups &bull; This is an automated email
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  const mailOptions = {
    from: `"Mafiya OS — ABM Groups" <${process.env.EMAIL_USER}>`,
    to: client.gmb_email,
    subject: `🔗 Connect GMB Profile — ${client.business_name}`,
    html,
  };

  const info = await transporter.sendMail(mailOptions);
  console.log(`[Mafiya] GMB connect email sent to ${client.gmb_email} (messageId: ${info.messageId})`);
  return info;
}

module.exports = { sendGmbConnectEmail };
