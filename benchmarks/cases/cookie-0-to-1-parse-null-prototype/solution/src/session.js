const cookie = require('cookie');

const SESSION_COOKIE = 'sid';

function readSession(cookieHeader) {
  const cookies = cookie.parse(cookieHeader || '');
  if (!Object.hasOwn(cookies, SESSION_COOKIE)) return null;
  return {
    id: cookies[SESSION_COOKIE],
    theme: Object.hasOwn(cookies, 'theme') ? cookies.theme : 'light',
  };
}

function sessionCookie(id, maxAgeSeconds) {
  return cookie.serialize(SESSION_COOKIE, id, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: maxAgeSeconds,
  });
}

module.exports = { readSession, sessionCookie };
