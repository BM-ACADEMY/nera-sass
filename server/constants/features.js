/**
 * Feature flags, read from the environment on every call so a deploy (or a
 * test) can flip them without a restart. All default to off.
 *
 *   WA_EMBEDDED_SIGNUP_ENABLED  Meta Embedded Signup (N5 Mode A). Keep it off
 *                               until Meta approves Getnera as a Tech Provider.
 */
const ON = new Set(['1', 'true', 'on', 'yes']);
const flag = (name) => ON.has(String(process.env[name] || '').trim().toLowerCase());

module.exports = {
  flag,
  embeddedSignupEnabled: () => flag('WA_EMBEDDED_SIGNUP_ENABLED'),
};
