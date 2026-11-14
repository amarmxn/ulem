const { randomBytes, scryptSync, timingSafeEqual } = require('node:crypto');

const salt = 'invitation-prototype-v1';
if (!process.env.ADMIN_PASSWORD?.trim()) throw new Error('Set ADMIN_PASSWORD before starting.');
const passwordHash = scryptSync(process.env.ADMIN_PASSWORD, salt, 64);
const sessions = new Map();
const lifetime = 8 * 60 * 60;

function credentialsMatch(username, password) {
  if (username !== 'admin' || typeof password !== 'string' || password.length > 256) return false;
  return timingSafeEqual(scryptSync(password, salt, 64), passwordHash);
}

function tokenFor(req) {
  return /(?:^|;\s*)invitation_session=([a-f0-9]{64})(?:;|$)/.exec(req.headers.cookie ?? '')?.[1];
}

function authenticated(req) {
  return sessions.get(tokenFor(req)) > Date.now();
}

function setCookie(res, token, age) {
  const secure = (process.env.RAILWAY_ENVIRONMENT_ID || process.env.COOKIE_SECURE === '1') ? '; Secure' : '';
  res.setHeader('Set-Cookie', 'invitation_session=' + token
    + '; Path=/; HttpOnly; SameSite=Strict; Max-Age=' + age + secure);
}

function signIn(req, res) {
  const now = Date.now();
  for (const [token, expires] of sessions) {
    if (expires <= now) sessions.delete(token);
  }
  sessions.delete(tokenFor(req));
  const token = randomBytes(32).toString('hex');
  sessions.set(token, now + lifetime * 1000);
  setCookie(res, token, lifetime);
}

function signOut(req, res) {
  sessions.delete(tokenFor(req));
  setCookie(res, '', 0);
}

module.exports = { authenticated, credentialsMatch, signIn, signOut };



