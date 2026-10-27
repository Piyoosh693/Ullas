const crypto = require('node:crypto');
const { v4: uuidv4 } = require('uuid');
const { query, withTransaction, isTestMode } = require('./index');

const memory = {
  users: new Map(), usersById: new Map(), sessions: new Map(),
  resetTokens: new Map(), verificationTokens: new Map(),
};

function normalizeEmail(value) { return String(value || '').trim().toLowerCase(); }
function hashToken(token) { return crypto.createHmac('sha256', process.env.SESSION_SECRET || 'ullas-test-only-pepper').update(String(token)).digest('hex'); }
function requireMode() {
  if (process.env.DATABASE_URL) return 'database';
  if (isTestMode()) return 'memory';
  const error = new Error('PostgreSQL is required. Configure DATABASE_URL before starting Ullas.');
  error.status = 503; error.code = 'DATABASE_URL_REQUIRED'; throw error;
}
function fromDbUser(row) {
  if (!row) return null;
  return { id: row.id, email: row.email, password: row.password_hash, role: row.role, name: row.name || 'User', verified: row.email_verified, status: row.status || 'active', createdAt: row.created_at, updatedAt: row.updated_at };
}
async function findUserByEmail(email) {
  const normalized = normalizeEmail(email);
  if (requireMode() === 'memory') return memory.users.get(normalized) || null;
  const result = await query('SELECT * FROM users WHERE email = $1 LIMIT 1', [normalized]);
  return fromDbUser(result.rows[0]);
}
async function findUserById(id) {
  if (requireMode() === 'memory') return memory.usersById.get(id) || null;
  const result = await query('SELECT * FROM users WHERE id = $1 LIMIT 1', [id]);
  return fromDbUser(result.rows[0]);
}
async function createUser(user) {
  const normalized = normalizeEmail(user.email);
  if (requireMode() === 'memory') {
    if (memory.users.has(normalized)) { const e = new Error('User already exists'); e.code = '23505'; throw e; }
    const created = { role: 'user', status: 'active', verified: false, name: 'User', ...user, email: normalized, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    memory.users.set(normalized, created); memory.usersById.set(created.id, created); return created;
  }
  const result = await query(
    `INSERT INTO users(id,email,password_hash,role,email_verified,name,status,created_at,updated_at)
     VALUES($1,$2,$3,$4,$5,$6,$7,NOW(),NOW()) RETURNING *`,
    [user.id || uuidv4(), normalized, user.password, user.role || 'user', Boolean(user.verified), user.name || 'User', user.status || 'active'],
  );
  return fromDbUser(result.rows[0]);
}
async function createAdminOnce(user) {
  if (requireMode() === 'memory') {
    if ([...memory.users.values()].some((item) => item.role === 'admin')) { const e = new Error('An administrator account already exists'); e.code = 'ADMIN_EXISTS'; throw e; }
    return createUser({ ...user, role: 'admin', status: 'active', verified: true });
  }
  return withTransaction(async (client) => {
    await client.query('LOCK TABLE users IN EXCLUSIVE MODE');
    const existing = await client.query("SELECT 1 FROM users WHERE role='admin' LIMIT 1");
    if (existing.rowCount) { const e = new Error('An administrator account already exists'); e.code = 'ADMIN_EXISTS'; throw e; }
    const result = await client.query(
      `INSERT INTO users(id,email,password_hash,role,email_verified,name,status,created_at,updated_at)
       VALUES($1,$2,$3,'admin',TRUE,$4,'active',NOW(),NOW()) RETURNING *`,
      [user.id || uuidv4(), normalizeEmail(user.email), user.password, user.name || 'Admin'],
    );
    return fromDbUser(result.rows[0]);
  });
}
async function updateUserVerified(email) {
  const normalized = normalizeEmail(email);
  if (requireMode() === 'memory') {
    const user = memory.users.get(normalized); if (!user) return null;
    user.verified = true; user.updatedAt = new Date().toISOString(); return user;
  }
  const result = await query('UPDATE users SET email_verified=TRUE,updated_at=NOW() WHERE email=$1 RETURNING *', [normalized]);
  return fromDbUser(result.rows[0]);
}
async function updateUserPassword(email, passwordHash) {
  const normalized = normalizeEmail(email);
  if (requireMode() === 'memory') {
    const user = memory.users.get(normalized); if (!user) return null;
    user.password = passwordHash; user.updatedAt = new Date().toISOString();
    for (const [id, session] of memory.sessions) if (session.userId === user.id) memory.sessions.delete(id);
    return user;
  }
  return withTransaction(async (client) => {
    const result = await client.query('UPDATE users SET password_hash=$2,updated_at=NOW() WHERE email=$1 RETURNING *', [normalized, passwordHash]);
    if (result.rows[0]) await client.query('DELETE FROM sessions WHERE user_id=$1', [result.rows[0].id]);
    return fromDbUser(result.rows[0]);
  });
}
async function listAdmins() {
  if (requireMode() === 'memory') return [...memory.users.values()].filter((user) => user.role === 'admin');
  const result = await query("SELECT * FROM users WHERE role='admin' LIMIT 1");
  return result.rows.map(fromDbUser);
}
async function createSessionRecord(userId, durationMs = 1000 * 60 * 60 * 24 * 7) {
  const token = crypto.randomBytes(32).toString('base64url');
  const session = { id: uuidv4(), token, userId, expiresAt: new Date(Date.now() + durationMs).toISOString(), createdAt: new Date().toISOString() };
  if (requireMode() === 'memory') { memory.sessions.set(token, session); return session; }
  await query('DELETE FROM sessions WHERE expires_at <= NOW()');
  await query('INSERT INTO sessions(id,user_id,token_hash,expires_at,created_at) VALUES($1,$2,$3,$4,NOW())', [session.id, userId, hashToken(token), session.expiresAt]);
  return session;
}
async function findSessionRecord(token) {
  if (!token) return null;
  if (requireMode() === 'memory') {
    const session = memory.sessions.get(token);
    if (!session || new Date(session.expiresAt || session.expires_at).getTime() <= Date.now()) return null;
    return session;
  }
  const result = await query('SELECT id,user_id AS "userId",expires_at AS "expiresAt",created_at AS "createdAt" FROM sessions WHERE token_hash=$1 AND expires_at > NOW() LIMIT 1', [hashToken(token)]);
  return result.rows[0] ? { ...result.rows[0], token } : null;
}
async function findSessionUser(token) {
  const session = await findSessionRecord(token);
  if (!session) return null;
  const user = await findUserById(session.userId || session.user_id);
  return user ? { session, user } : null;
}
async function deleteSessionRecord(token) {
  if (!token) return;
  if (requireMode() === 'memory') { memory.sessions.delete(token); return; }
  await query('DELETE FROM sessions WHERE token_hash=$1', [hashToken(token)]);
}
async function setToken(table, email, rawToken, expiryMs) {
  const mode = requireMode();
  const tokenHash = hashToken(rawToken);
  const normalizedEmail = normalizeEmail(email);
  const expiresAt = new Date(Date.now() + expiryMs).toISOString();
  const map = table === 'reset_tokens' ? memory.resetTokens : memory.verificationTokens;
  if (mode === 'memory') {
    for (const [existingHash, record] of map) if (record.email === normalizedEmail) map.delete(existingHash);
    map.set(tokenHash, { email: normalizedEmail, expiresAt, createdAt: Date.now() });
    return;
  }
  await withTransaction(async (client) => {
    await client.query(`DELETE FROM ${table} WHERE user_email=$1`, [normalizedEmail]);
    await client.query(`INSERT INTO ${table}(token,user_email,created_at,expires_at) VALUES($1,$2,NOW(),$3)`, [tokenHash, normalizedEmail, expiresAt]);
  });
}
async function getToken(table, rawToken) {
  const mode = requireMode();
  const tokenHash = hashToken(rawToken);
  const map = table === 'reset_tokens' ? memory.resetTokens : memory.verificationTokens;
  if (mode === 'memory') {
    const record = map.get(tokenHash);
    if (!record || new Date(record.expiresAt).getTime() <= Date.now()) { map.delete(tokenHash); return null; }
    return { ...record, tokenHash };
  }
  const result = await query(`SELECT user_email AS email,expires_at AS "expiresAt" FROM ${table} WHERE token=$1 AND expires_at > NOW() LIMIT 1`, [tokenHash]);
  return result.rows[0] ? { ...result.rows[0], tokenHash } : null;
}
async function deleteToken(table, rawToken) {
  const mode = requireMode();
  const tokenHash = hashToken(rawToken);
  const map = table === 'reset_tokens' ? memory.resetTokens : memory.verificationTokens;
  if (mode === 'memory') { map.delete(tokenHash); return; }
  await query(`DELETE FROM ${table} WHERE token=$1`, [tokenHash]);
}
async function consumeVerificationToken(rawToken) {
  const tokenHash = hashToken(rawToken);
  if (requireMode() === 'memory') {
    const record = memory.verificationTokens.get(tokenHash);
    if (!record || new Date(record.expiresAt).getTime() <= Date.now()) { memory.verificationTokens.delete(tokenHash); return null; }
    memory.verificationTokens.delete(tokenHash);
    const user = memory.users.get(record.email);
    if (!user) return null;
    user.verified = true; user.updatedAt = new Date().toISOString();
    return user;
  }
  return withTransaction(async (client) => {
    const consumed = await client.query('DELETE FROM verification_tokens WHERE token=$1 AND expires_at > NOW() RETURNING user_email', [tokenHash]);
    if (!consumed.rowCount) return null;
    const updated = await client.query('UPDATE users SET email_verified=TRUE,updated_at=NOW() WHERE email=$1 RETURNING *', [consumed.rows[0].user_email]);
    return fromDbUser(updated.rows[0]);
  });
}
async function consumeResetToken(rawToken, passwordHash) {
  const tokenHash = hashToken(rawToken);
  if (requireMode() === 'memory') {
    const record = memory.resetTokens.get(tokenHash);
    if (!record || new Date(record.expiresAt).getTime() <= Date.now()) { memory.resetTokens.delete(tokenHash); return null; }
    memory.resetTokens.delete(tokenHash);
    const user = memory.users.get(record.email);
    if (!user) return null;
    user.password = passwordHash; user.updatedAt = new Date().toISOString();
    for (const [id, session] of memory.sessions) if (session.userId === user.id) memory.sessions.delete(id);
    return user;
  }
  return withTransaction(async (client) => {
    const consumed = await client.query('DELETE FROM reset_tokens WHERE token=$1 AND expires_at > NOW() RETURNING user_email', [tokenHash]);
    if (!consumed.rowCount) return null;
    const updated = await client.query('UPDATE users SET password_hash=$2,updated_at=NOW() WHERE email=$1 RETURNING *', [consumed.rows[0].user_email, passwordHash]);
    if (!updated.rowCount) return null;
    await client.query('DELETE FROM sessions WHERE user_id=$1', [updated.rows[0].id]);
    return fromDbUser(updated.rows[0]);
  });
}
const setResetToken = (email, token) => setToken('reset_tokens', email, token, 60 * 60 * 1000);
const getResetToken = (token) => getToken('reset_tokens', token);
const deleteResetToken = (token) => deleteToken('reset_tokens', token);
const setVerificationToken = (email, token) => setToken('verification_tokens', email, token, 24 * 60 * 60 * 1000);
const getVerificationToken = (token) => getToken('verification_tokens', token);
const deleteVerificationToken = (token) => deleteToken('verification_tokens', token);

module.exports = { memory, normalizeEmail, hashToken, requireMode, findUserByEmail, findUserById, createUser, createAdminOnce, updateUserVerified, updateUserPassword, listAdmins, createSessionRecord, findSessionRecord, findSessionUser, deleteSessionRecord, setResetToken, getResetToken, deleteResetToken, setVerificationToken, getVerificationToken, deleteVerificationToken, consumeVerificationToken, consumeResetToken };
