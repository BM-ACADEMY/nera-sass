/**
 * Password rules for user-chosen passwords. Not specified by the Full Scope
 * document; this is a technical recommendation (minimum length, a letter and a
 * digit, not the email address).
 */
const MIN_LENGTH = 10;
const MAX_LENGTH = 128;

function passwordProblem(password, email = '') {
  if (typeof password !== 'string' || !password) return 'Password is required';
  if (password.length < MIN_LENGTH) return `Password must be at least ${MIN_LENGTH} characters`;
  if (password.length > MAX_LENGTH) return `Password must be at most ${MAX_LENGTH} characters`;
  if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) return 'Password must contain at least one letter and one number';
  if (email && password.toLowerCase() === String(email).toLowerCase()) return 'Password cannot be your email address';
  return null;
}

const normalizeEmail = (email) => String(email || '').trim().toLowerCase();
const isEmail = (email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizeEmail(email));

module.exports = { MIN_LENGTH, passwordProblem, normalizeEmail, isEmail };
