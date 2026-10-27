const bcrypt = require('bcryptjs');
const crypto = require('node:crypto');
const { v4: uuidv4 } = require('uuid');
const repo = require('./db/repositories');

const DEFAULT_ROLE = 'user';
const ADMIN_ROLE_OVERRIDE_KEYS = ['role', 'isAdmin', 'is_admin', 'admin', 'reviewer', 'privileges', 'permissions', 'isReviewer', 'is_reviewer'];
const memoryStore = repo.memory;
function normalizeEmail(value) { return repo.normalizeEmail(value); }
function hasForbiddenPublicRoleFields(payload = {}) {
  return ADMIN_ROLE_OVERRIDE_KEYS.some((key) => Object.prototype.hasOwnProperty.call(payload, key));
}
function hasAdminRoleOverride(payload = {}) {
  return hasForbiddenPublicRoleFields(payload);
}
function makeUser({ id = uuidv4(), email, password, role = DEFAULT_ROLE, name = 'User', verified = false }) {
  return { id, email: normalizeEmail(email), password: bcrypt.hashSync(password, 12), role, name, verified, status: 'active', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
}
async function createSession(user) { return repo.createSessionRecord(user.id); }
function readTokenFromRequest(req) {
  const rawCookie = req.headers.cookie || '';
  const cookieMatch = rawCookie.match(/(?:^|;)\s*ullas_session=([^;]+)/);
  if (cookieMatch) { try { return decodeURIComponent(cookieMatch[1]); } catch { return null; } }
  const header = req.headers['x-session-token'];
  if (typeof header === 'string' && /^[A-Za-z0-9_-]{40,128}$/.test(header)) return header;
  return null;
}
async function getSessionFromRequest(req) {
  const token = readTokenFromRequest(req);
  if (!token) return null;
  return repo.findSessionRecord(token);
}
async function requireAuth(req, res, next) {
  try {
    const token = readTokenFromRequest(req);
    const result = token ? await repo.findSessionUser(token) : null;
    if (!result) return res.status(401).json({ error: 'Authentication required' });
    if (result.user.status !== 'active') return res.status(403).json({ error: result.user.status === 'suspended' ? 'Account suspended' : 'Account is not active' });
    req.user = result.user;
    req.session = result.session;
    req.sessionToken = token;
    return next();
  } catch (error) {
    return res.status(error.status || 503).json({ error: error.status === 503 ? error.message : 'Authentication could not be verified' });
  }
}
function requireRole(role) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Authentication required' });
    if (req.user.role !== role) return res.status(403).json({ error: 'Forbidden' });
    return next();
  };
}
function createVerificationToken() { return crypto.randomBytes(32).toString('base64url'); }
function createResetToken() { return crypto.randomBytes(32).toString('base64url'); }
module.exports = { DEFAULT_ROLE, memoryStore, makeUser, normalizeEmail, hasAdminRoleOverride, hasForbiddenPublicRoleFields, createSession, getSessionFromRequest, requireAuth, requireRole, createVerificationToken, createResetToken };
