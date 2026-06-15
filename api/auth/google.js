// POST /api/auth/google
// Verifies a Google Identity Services ID token (sent from login.html),
// checks the signed-in email against the allowlist, and — if authorized —
// issues a signed session cookie. The Google Client ID is not a secret
// (it's embedded in login.html's frontend code); only SESSION_SECRET is.

const { jwtVerify, createRemoteJWKSet } = require('jose');
const { GOOGLE_CLIENT_ID, ADMIN_EMAILS, signSession, sessionCookie } = require('../_lib/auth');

const GOOGLE_JWKS = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  if (!GOOGLE_CLIENT_ID || !process.env.SESSION_SECRET) {
    return res.status(500).json({ error: 'Server not configured' });
  }

  const credential = req.body?.credential;
  if (!credential) return res.status(400).json({ error: 'Missing credential' });

  try {
    const { payload } = await jwtVerify(credential, GOOGLE_JWKS, {
      issuer:   ['https://accounts.google.com', 'accounts.google.com'],
      audience: GOOGLE_CLIENT_ID,
    });

    const email = (payload.email || '').toLowerCase();
    if (!payload.email_verified || !ADMIN_EMAILS.includes(email)) {
      return res.status(403).json({ error: 'This account is not authorized to access this app.' });
    }

    const token = await signSession(email, payload.name || null);
    res.setHeader('Set-Cookie', sessionCookie(token));
    res.status(200).json({ ok: true, email });
  } catch (err) {
    console.error('[auth/google] error:', err);
    res.status(401).json({ error: 'Invalid Google credential' });
  }
};
