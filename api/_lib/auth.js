// Shared session helpers for the Google Sign-In gate.
//
// NOTE: ADMIN_EMAILS and SESSION_COOKIE are duplicated in middleware.js
// (which runs on the Edge runtime and can't share a CJS module with the
// Node API routes). Keep both lists in sync.

const { SignJWT } = require('jose');

const SESSION_COOKIE   = 'session';
const SESSION_MAX_AGE  = 60 * 60 * 24 * 7; // 7 days

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';

// Only these Google accounts are allowed to sign in.
const ADMIN_EMAILS = ['shiraz@telecrm.in'];

async function signSession(email, name) {
  const secret = new TextEncoder().encode(process.env.SESSION_SECRET);
  return new SignJWT({ email, name })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_MAX_AGE}s`)
    .sign(secret);
}

function sessionCookie(token) {
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_MAX_AGE}`;
}

function clearCookie() {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

module.exports = {
  SESSION_COOKIE,
  GOOGLE_CLIENT_ID,
  ADMIN_EMAILS,
  signSession,
  sessionCookie,
  clearCookie,
};
