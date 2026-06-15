// GET /api/auth/logout — clears the session cookie and sends the user back
// to the login page.

const { clearCookie } = require('../_lib/auth');

module.exports = async function handler(req, res) {
  res.setHeader('Set-Cookie', clearCookie());
  res.writeHead(302, { Location: '/login.html' });
  res.end();
};
