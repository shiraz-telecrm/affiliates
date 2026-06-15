// POST /api/auth/login
// Verifies the submitted email against the ADMIN_EMAILS allowlist and the
// TeleCRM team-members directory (Master Affiliate workspace), then — if
// authorized — issues a signed session cookie.

const { ADMIN_EMAILS, signSession, sessionCookie } = require('../_lib/auth');
const { tcrm, MASTER_ID, MASTER_TOKEN } = require('../_lib/telecrm');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  if (!process.env.SESSION_SECRET) {
    return res.status(500).json({ error: 'Server not configured' });
  }

  const email = (req.body?.email || '').trim().toLowerCase();
  if (!email || !email.includes('@')) {
    return res.status(400).json({ error: 'Please enter a valid email address.' });
  }

  if (!ADMIN_EMAILS.includes(email)) {
    return res.status(403).json({ error: 'This account is not authorized to access this app.' });
  }

  const { status, body } = await tcrm(MASTER_TOKEN, `/enterprise/${MASTER_ID}/team-members/${encodeURIComponent(email)}`);
  if (status !== 200 || !body) {
    return res.status(403).json({ error: 'Could not verify this email against the TeleCRM team directory.' });
  }

  const member = body.data || body;
  const name   = member?.name || null;

  const token = await signSession(email, name);
  res.setHeader('Set-Cookie', sessionCookie(token));
  res.status(200).json({ ok: true, email, name });
};
