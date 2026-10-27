const express = require('express');
const { z } = require('zod');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const { requireAuth, normalizeEmail } = require('../auth');
const repo = require('../db/repositories');
const { query, isTestMode } = require('../db');

const router = express.Router();
const bootstrapSchema = z.object({ name: z.string().trim().min(2).max(100), email: z.string().email(), password: z.string().min(12).max(128) });
router.post('/admin/bootstrap', async (req, res) => {
  const expectedSecret = process.env.ADMIN_BOOTSTRAP_SECRET;
  const providedSecret = req.get('x-admin-secret'); // Never accept secrets in JSON bodies.
  if (!expectedSecret || providedSecret !== expectedSecret) return res.status(401).json({ error: 'Admin bootstrap secret required' });
  const parsed = bootstrapSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid bootstrap payload' });
  try {
    const user = await repo.createAdminOnce({ id: uuidv4(), email: normalizeEmail(parsed.data.email), password: await bcrypt.hash(parsed.data.password, 12), name: parsed.data.name, verified: true, role: 'admin' });
    if (process.env.ADMIN_BOOTSTRAP_SECRET) process.env.ADMIN_BOOTSTRAP_SECRET = '';
    return res.status(201).json({ message: 'Admin bootstrap successful. The bootstrap secret has been disabled for this process.', user: { id: user.id, email: user.email, role: user.role, verified: user.verified } });
  } catch (error) {
    if (error.code === 'ADMIN_EXISTS') return res.status(409).json({ error: 'An administrator account already exists' });
    if (error.code === '23505') return res.status(409).json({ error: 'User already exists' });
    console.error('Admin bootstrap failed', { code: error.code || 'ADMIN_BOOTSTRAP_ERROR', ...(process.env.NODE_ENV === 'production' ? {} : { message: error.message }) });
    return res.status(error.status || 500).json({ error: 'Admin bootstrap failed' });
  }
});
router.use(requireAuth);

router.get('/admin/users', async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
  try {
    if (isTestMode()) return res.json({ users: [...repo.memory.users.values()].map((u) => ({ id:u.id,email:u.email,name:u.name,role:u.role,verified:u.verified,status:u.status })) });
    const r = await query('SELECT id,email,name,role,email_verified AS verified,status,created_at FROM users ORDER BY created_at DESC LIMIT 500');
    return res.json({ users:r.rows });
  } catch (error) { return res.status(503).json({ error: 'Could not load users' }); }
});
router.patch('/admin/users/:id/role', async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
  const parsed = z.object({ role:z.enum(['user','professional','organization','reviewer','admin']), status:z.enum(['active','suspended','pending']).optional() }).strict().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error:'Invalid role update' });
  try {
    if (isTestMode()) {
      const target = repo.memory.usersById.get(req.params.id);
      if (!target) return res.status(404).json({ error:'User not found' });
      const deactivatesAdmin = target.role === 'admin' && (parsed.data.role !== 'admin' || (parsed.data.status && parsed.data.status !== 'active'));
      const otherActiveAdmins = [...repo.memory.users.values()].filter((u) => u.id !== target.id && u.role === 'admin' && u.status === 'active').length;
      if (deactivatesAdmin && otherActiveAdmins === 0) return res.status(409).json({ error: 'Cannot deactivate or demote the last active administrator' });
      target.role=parsed.data.role; if(parsed.data.status)target.status=parsed.data.status; target.updatedAt=new Date().toISOString();
      return res.json({user:{id:target.id,email:target.email,name:target.name,role:target.role,verified:target.verified,status:target.status}});
    }
    const updated = await require('../db').withTransaction(async (client) => {
      await client.query('LOCK TABLE users IN EXCLUSIVE MODE');
      const target = await client.query('SELECT id,email,name,role,email_verified AS verified,status FROM users WHERE id=$1 FOR UPDATE',[req.params.id]);
      if (!target.rowCount) { const e=new Error('User not found');e.code='USER_NOT_FOUND';throw e; }
      const deactivatesAdmin = target.rows[0].role === 'admin' && (parsed.data.role !== 'admin' || (parsed.data.status && parsed.data.status !== 'active'));
      if (deactivatesAdmin) {
        const count = await client.query("SELECT COUNT(*)::int AS count FROM users WHERE role='admin' AND status='active' AND id<>$1", [req.params.id]);
        if (count.rows[0].count <= 0) { const e = new Error('Cannot deactivate or demote the last active administrator'); e.code = 'LAST_ADMIN'; throw e; }
      }
      const result=await client.query('UPDATE users SET role=$2,status=COALESCE($3,status),updated_at=NOW() WHERE id=$1 RETURNING id,email,name,role,email_verified AS verified,status',[req.params.id,parsed.data.role,parsed.data.status||null]);
      await client.query('INSERT INTO admin_actions(id,actor_user_id,target_user_id,action,details) VALUES($1,$2,$3,$4,$5)',[uuidv4(),req.user.id,req.params.id,'user_role_updated',JSON.stringify({role:parsed.data.role,status:parsed.data.status||null})]);
      return result.rows[0];
    });
    return res.json({user:updated});
  } catch (error) {
    if(error.code==='USER_NOT_FOUND')return res.status(404).json({error:error.message});
    if(error.code==='LAST_ADMIN')return res.status(409).json({error:error.message});
    console.error('Admin role update failed',{code:error.code || 'ADMIN_UPDATE_ERROR', ...(process.env.NODE_ENV === 'production' ? {} : { message: error.message })});return res.status(500).json({error:'Could not update user'});
  }
});
router.get('/admin/overview', async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
  try {
    if (isTestMode()) return res.json({ message: 'Admin overview', admin: { id: req.user.id, email: req.user.email }, stats: { users: repo.memory.users.size, pendingVerifications: 0 } });
    const result = await query(`SELECT (SELECT COUNT(*)::int FROM users) AS users, (SELECT COUNT(*)::int FROM verification_requests WHERE status='pending') AS "pendingVerifications", (SELECT COUNT(*)::int FROM bookings WHERE status='requested') AS "pendingBookings"`);
    return res.json({ message: 'Admin overview', admin: { id: req.user.id, email: req.user.email }, stats: result.rows[0] });
  } catch (error) { return res.status(503).json({ error: 'Admin overview unavailable' }); }
});
module.exports = router;
