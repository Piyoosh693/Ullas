const express = require('express');
const bcrypt = require('bcryptjs');
const { z } = require('zod');
const { v4: uuidv4 } = require('uuid');
const repo = require('../db/repositories');
const { requireAuth, normalizeEmail, createVerificationToken, createResetToken, hasForbiddenPublicRoleFields } = require('../auth');
const { sendVerificationEmail, sendPasswordResetEmail } = require('../email');

const router = express.Router();
const signupSchema = z.object({ name: z.string().trim().min(2).max(100), email: z.string().email().max(254), password: z.string().min(10).max(128), accountType: z.enum(['user','professional','organization']).optional() }).passthrough();
const loginSchema = z.object({ email: z.string().email(), password: z.string().min(1).max(128) });
const resetRequestSchema = z.object({ email: z.string().email() });
const resetCompleteSchema = z.object({ token: z.string().min(20).max(256), password: z.string().min(10).max(128) });

function publicUser(user) { return { id: user.id, email: user.email, name: user.name, role: user.role, verified: Boolean(user.verified) }; }
function cookieOptions() {
  const sameSite = String(process.env.COOKIE_SAME_SITE || 'lax').toLowerCase();
  // SameSite=none requires Secure=true or browsers will reject the cookie entirely.
  const secure = process.env.NODE_ENV === 'production' || sameSite === 'none';
  return { httpOnly: true, sameSite, secure, path: '/', maxAge: 7 * 24 * 60 * 60 * 1000 };
}
function handlePersistenceError(res, error) {
  if (error.code === '23505') return res.status(409).json({ error: 'User already exists' });
  if (error.code === 'DATABASE_URL_REQUIRED') return res.status(503).json({ error: 'Database is not configured' });
  console.error('Authentication operation failed', { code: error.code || 'AUTH_ERROR', ...(process.env.NODE_ENV === 'production' ? {} : { message: error.message }) });
  return res.status(error.status || 500).json({ error: 'The request could not be completed' });
}

router.post('/signup', async (req, res) => {
  const parsed = signupSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid signup payload' });
  if (hasForbiddenPublicRoleFields(req.body || {})) return res.status(400).json({ error: 'Role and privilege fields are not allowed during public signup' });
  const email = normalizeEmail(parsed.data.email);
  try {
    const password = await bcrypt.hash(parsed.data.password, 12);
    const user = await repo.createUser({ id: uuidv4(), email, password, name: parsed.data.name, role: parsed.data.accountType || 'user', verified: false, status: 'active' });
    const token = createVerificationToken();
    await repo.setVerificationToken(email, token);
    await sendVerificationEmail(email, token);
    return res.status(201).json({ message: 'Signup successful. Check your email for a verification link.', user: publicUser(user) });
  } catch (error) { return handlePersistenceError(res, error); }
});

router.post('/login', async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid login payload' });
  try {
    const user = await repo.findUserByEmail(normalizeEmail(parsed.data.email));
    if (!user || user.status !== 'active' || !(await bcrypt.compare(parsed.data.password, user.password))) return res.status(401).json({ error: 'Invalid credentials' });
    if (!user.verified) return res.status(403).json({ error: 'Please verify your email before signing in' });
    const session = await repo.createSessionRecord(user.id);
    res.cookie('ullas_session', session.token, cookieOptions());
    return res.json({ message: 'Login successful', user: publicUser(user) });
  } catch (error) { return handlePersistenceError(res, error); }
});

router.post('/logout', async (req, res) => {
  try {
    const raw = req.headers.cookie || '';
    const match = raw.match(/(?:^|;)\s*ullas_session=([^;]+)/);
    const token = match ? decodeURIComponent(match[1]) : (/^[A-Za-z0-9_-]{40,128}$/.test(String(req.headers['x-session-token'] || '')) ? req.headers['x-session-token'] : null);
    if (token) await repo.deleteSessionRecord(token);
    const clearOptions = cookieOptions();
    delete clearOptions.maxAge;
    res.clearCookie('ullas_session', clearOptions);
    return res.json({ message: 'Logged out' });
  } catch (error) { return handlePersistenceError(res, error); }
});

router.get('/me', requireAuth, (req, res) => res.json({ user: publicUser(req.user) }));

router.post('/resend-verification', async (req, res) => {
  const parsed = resetRequestSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid email' });
  try {
    const email = normalizeEmail(parsed.data.email);
    const user = await repo.findUserByEmail(email);
    // Keep the response generic so this endpoint does not disclose whether an account exists.
    if (user && !user.verified && user.status === 'active') {
      const token = createVerificationToken();
      await repo.setVerificationToken(email, token);
      await sendVerificationEmail(email, token);
    }
    return res.status(200).json({ message: 'If the account exists and needs verification, a new link has been sent.' });
  } catch (error) { return handlePersistenceError(res, error); }
});

router.post('/verify-email', async (req, res) => {
  const token = String(req.body?.token || '');
  if (token.length < 20 || token.length > 256) return res.status(400).json({ error: 'Invalid or expired verification token' });
  try {
    const user = await repo.consumeVerificationToken(token);
    if (!user) return res.status(400).json({ error: 'Invalid or expired verification token' });
    return res.json({ message: 'Email verified', user: { id: user.id, verified: true } });
  } catch (error) { return handlePersistenceError(res, error); }
});

router.post('/forgot-password', async (req, res) => {
  const parsed = resetRequestSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid email' });
  try {
    const email = normalizeEmail(parsed.data.email);
    const user = await repo.findUserByEmail(email);
    if (user && user.status !== 'suspended') {
      const token = createResetToken();
      await repo.setResetToken(email, token);
      await sendPasswordResetEmail(email, token);
    }
    return res.status(200).json({ message: 'If that account exists, a reset link has been sent.' });
  } catch (error) { return handlePersistenceError(res, error); }
});

router.post('/reset-password', async (req, res) => {
  const parsed = resetCompleteSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid reset payload' });
  try {
    const hash = await bcrypt.hash(parsed.data.password, 12);
    const user = await repo.consumeResetToken(parsed.data.token, hash);
    if (!user) return res.status(400).json({ error: 'Invalid or expired reset token' });
    return res.json({ message: 'Password reset successful. Please sign in again.' });
  } catch (error) { return handlePersistenceError(res, error); }
});

module.exports = router;
