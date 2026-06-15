// Vercel Edge Middleware — runs on every request to this project (static
// HTML pages and /api/* functions alike) and gates the whole site behind a
// signed session cookie issued by /api/auth/login.
//
// NOTE: ADMIN_EMAILS and SESSION_COOKIE are duplicated from api/_lib/auth.js
// (this file runs on the Edge runtime via ESM and can't share a CJS module
// with the Node API routes). Keep both lists in sync.

import { jwtVerify } from 'jose';

const SESSION_COOKIE = 'session';

// Only these emails are allowed to sign in.
const ADMIN_EMAILS = ['shiraz@telecrm.in'];

// Paths that must remain reachable without a session (the login page itself
// and the endpoints it calls).
const PUBLIC_PATHS = new Set([
  '/login.html',
  '/api/auth/login',
  '/api/auth/logout',
]);

function getCookie(req, name) {
  const header = req.headers.get('cookie') || '';
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return null;
}

export default async function middleware(req) {
  const url = new URL(req.url);
  if (PUBLIC_PATHS.has(url.pathname)) return;

  const token = getCookie(req, SESSION_COOKIE);
  let email = null;

  if (token && process.env.SESSION_SECRET) {
    try {
      const secret = new TextEncoder().encode(process.env.SESSION_SECRET);
      const { payload } = await jwtVerify(token, secret);
      email = (payload.email || '').toLowerCase();
    } catch {
      email = null;
    }
  }

  if (email && ADMIN_EMAILS.includes(email)) {
    // The old affiliate self-service landing page is orphaned now that the
    // whole site is admin-gated — send the admin straight to the dashboard.
    if (url.pathname === '/' || url.pathname === '/index.html') {
      return Response.redirect(new URL('/admin.html', req.url), 302);
    }
    return;
  }

  if (url.pathname.startsWith('/api/')) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'content-type': 'application/json' },
    });
  }

  const loginUrl = new URL('/login.html', req.url);
  loginUrl.searchParams.set('redirect', url.pathname + url.search);
  return Response.redirect(loginUrl, 302);
}

export const config = { matcher: '/(.*)' };
