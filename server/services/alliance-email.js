const nodemailer = require('nodemailer');

function booleanEnv(value, fallback = false) {
  if (value == null || value === '') return fallback;
  return ['true', '1', 'yes', 'on'].includes(String(value).toLowerCase());
}

function getAllianceEmailConfig() {
  return {
    provider: process.env.ALLIANCE_EMAIL_PROVIDER || 'zoho',
    from: process.env.ALLIANCE_EMAIL_FROM || '',
    fromName: process.env.ALLIANCE_EMAIL_FROM_NAME || 'ABM Groups',
    host: process.env.ALLIANCE_EMAIL_SMTP_HOST || 'smtp.zoho.in',
    port: Number(process.env.ALLIANCE_EMAIL_SMTP_PORT) || 465,
    secure: booleanEnv(process.env.ALLIANCE_EMAIL_SMTP_SECURE, true),
    user: process.env.ALLIANCE_EMAIL_SMTP_USER || '',
    password: process.env.ALLIANCE_EMAIL_SMTP_PASSWORD || '',
    replyTo: process.env.ALLIANCE_EMAIL_REPLY_TO || process.env.ALLIANCE_EMAIL_FROM || '',
  };
}

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function allowedAllianceFromAddresses(config = getAllianceEmailConfig()) {
  return new Set([config.from, config.user, ...String(process.env.ALLIANCE_EMAIL_ALLOWED_FROM || '').split(',')]
    .map(normalizeEmail).filter(Boolean));
}

function isAllianceSenderAllowed(address, config = getAllianceEmailConfig()) {
  return allowedAllianceFromAddresses(config).has(normalizeEmail(address));
}

function publicAllianceEmailConfig() {
  const config = getAllianceEmailConfig();
  return {
    provider: config.provider,
    from: config.from,
    from_name: config.fromName,
    host: config.host,
    port: config.port,
    secure: config.secure,
    user: config.user,
    reply_to: config.replyTo,
    password_configured: Boolean(config.password),
  };
}

function createAllianceEmailTransport() {
  const config = getAllianceEmailConfig();
  if (!config.host || !config.user || !config.password) {
    throw new Error('Alliance Zoho SMTP configuration is incomplete.');
  }
  return nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: { user: config.user, pass: config.password },
  });
}

async function verifyAllianceEmailTransport() {
  const transporter = createAllianceEmailTransport();
  await transporter.verify();
  return true;
}

module.exports = {
  getAllianceEmailConfig,
  publicAllianceEmailConfig,
  createAllianceEmailTransport,
  verifyAllianceEmailTransport,
  allowedAllianceFromAddresses,
  isAllianceSenderAllowed,
};
