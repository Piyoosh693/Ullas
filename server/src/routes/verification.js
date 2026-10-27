const express = require('express');
const { z } = require('zod');
const { requireAuth } = require('../auth');
const { isTestMode, query, id, errorResponse } = require('./helpers');
const { withTransaction } = require('../db');
const router = express.Router();
const verificationRequests = new Map();
const profiles = require('./profiles').profiles;
const organizations = require('./organizations').organizations;

const createSchema = z.object({
  type: z.enum(['profile', 'organization']),
  organizationId: z.string().uuid().optional(),
  notes: z.string().trim().max(2000).optional(),
}).strict().superRefine((value, ctx) => {
  if (value.type === 'organization' && !value.organizationId) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['organizationId'], message: 'An organization is required.' });
  }
  if (value.type === 'profile' && value.organizationId) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['organizationId'], message: 'Profile requests cannot specify an organization.' });
  }
});

function mapRow(row) {
  return {
    id: row.id,
    userId: row.user_id,
    organizationId: row.organization_id,
    type: row.request_type,
    status: row.status,
    notes: row.notes,
    createdAt: row.created_at,
    reviewedAt: row.reviewed_at,
    reviewedBy: row.reviewed_by,
  };
}

router.get('/verification/requests', requireAuth, async (req, res) => {
  const reviewer = ['admin', 'reviewer'].includes(req.user.role);
  try {
    const list = isTestMode()
      ? [...verificationRequests.values()].filter((item) => reviewer || item.userId === req.user.id)
      : (await query(reviewer ? 'SELECT * FROM verification_requests ORDER BY created_at DESC LIMIT 500' : 'SELECT * FROM verification_requests WHERE user_id=$1 ORDER BY created_at DESC LIMIT 100', reviewer ? [] : [req.user.id])).rows.map(mapRow);
    return res.json({ requests: list });
  } catch (error) {
    return errorResponse(res, error, 'Could not load verification requests');
  }
});

router.post('/verification/requests', requireAuth, async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid verification request payload' });
  try {
    if (isTestMode()) {
      if (parsed.data.type === 'profile' && !profiles.has(req.user.id)) return res.status(400).json({ error: 'Save your profile before requesting profile verification' });
      if (parsed.data.type === 'organization') {
        const org = organizations.get(parsed.data.organizationId);
        if (!org || (org.owner_user_id !== req.user.id && req.user.role !== 'admin')) return res.status(403).json({ error: 'Organization not found or not owned by you' });
      }
      if ([...verificationRequests.values()].some((item) => item.status === 'pending' && item.userId === req.user.id && item.type === parsed.data.type && item.organizationId === (parsed.data.organizationId || null))) {
        return res.status(409).json({ error: 'A pending verification request already exists' });
      }
      const item = { id: id(), userId: req.user.id, organizationId: parsed.data.organizationId || null, type: parsed.data.type, notes: parsed.data.notes || null, status: 'pending', createdAt: new Date().toISOString(), reviewedAt: null, reviewedBy: null };
      verificationRequests.set(item.id, item);
      return res.status(201).json({ request: item });
    }

    if (parsed.data.type === 'profile') {
      const profile = await query('SELECT id FROM profiles WHERE user_id=$1', [req.user.id]);
      if (!profile.rowCount) return res.status(400).json({ error: 'Save your profile before requesting profile verification' });
    } else {
      const org = await query('SELECT id FROM organizations WHERE id=$1 AND ($2::boolean OR owner_user_id=$3)', [parsed.data.organizationId, req.user.role === 'admin', req.user.id]);
      if (!org.rowCount) return res.status(403).json({ error: 'Organization not found or not owned by you' });
    }

    const duplicate = await query(
      `SELECT id FROM verification_requests WHERE status='pending' AND request_type=$1 AND user_id=$2
       AND (($3::uuid IS NULL AND organization_id IS NULL) OR organization_id=$3) LIMIT 1`,
      [parsed.data.type, req.user.id, parsed.data.organizationId || null],
    );
    if (duplicate.rowCount) return res.status(409).json({ error: 'A pending verification request already exists' });

    const result = await query(
      "INSERT INTO verification_requests(id,user_id,organization_id,request_type,status,notes) VALUES($1,$2,$3,$4,'pending',$5) RETURNING *",
      [id(), req.user.id, parsed.data.organizationId || null, parsed.data.type, parsed.data.notes || null],
    );
    return res.status(201).json({ request: mapRow(result.rows[0]) });
  } catch (error) {
    if (error.code === '23505') return res.status(409).json({ error: 'A pending verification request already exists' });
    return errorResponse(res, error, 'Could not submit verification request');
  }
});

router.patch('/verification/requests/:id', requireAuth, async (req, res) => {
  if (!['admin', 'reviewer'].includes(req.user.role)) return res.status(403).json({ error: 'Reviewer access required' });
  const parsed = z.object({ status: z.enum(['approved', 'rejected']), notes: z.string().max(2000).optional() }).strict().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid review payload' });
  try {
    if (isTestMode()) {
      const item = verificationRequests.get(req.params.id);
      if (!item) return res.status(404).json({ error: 'Request not found' });
      if (item.status !== 'pending') return res.status(409).json({ error: 'Verification request already reviewed' });
      const saved = { ...item, ...parsed.data, reviewedAt: new Date().toISOString(), reviewedBy: req.user.id };
      verificationRequests.set(item.id, saved);
      if (item.type === 'profile') {
        const profile = profiles.get(item.userId);
        if (profile) profiles.set(item.userId, { ...profile, verificationStatus: parsed.data.status });
      }
      if (item.type === 'organization' && item.organizationId) {
        const org = organizations.get(item.organizationId);
        if (org) organizations.set(item.organizationId, { ...org, verification_status: parsed.data.status });
      }
      return res.json({ request: saved });
    }

    const saved = await withTransaction(async (client) => {
      const result = await client.query('SELECT * FROM verification_requests WHERE id=$1 FOR UPDATE', [req.params.id]);
      if (!result.rowCount) { const error = new Error('Request not found'); error.code = 'NOT_FOUND'; throw error; }
      const item = result.rows[0];
      if (item.status !== 'pending') { const error = new Error('Verification request already reviewed'); error.code = 'ALREADY_REVIEWED'; throw error; }
      const updated = await client.query(
        'UPDATE verification_requests SET status=$2,notes=COALESCE($3,notes),reviewed_at=NOW(),reviewed_by=$4 WHERE id=$1 RETURNING *',
        [item.id, parsed.data.status, parsed.data.notes || null, req.user.id],
      );
      if (item.request_type === 'organization' && item.organization_id) {
        await client.query('UPDATE organizations SET verification_status=$2,updated_at=NOW() WHERE id=$1', [item.organization_id, parsed.data.status]);
      }
      if (item.request_type === 'profile') {
        await client.query('UPDATE profiles SET verification_status=$2,updated_at=NOW() WHERE user_id=$1', [item.user_id, parsed.data.status]);
      }
      await client.query('INSERT INTO admin_actions(id,actor_user_id,target_user_id,target_organization_id,action,details) VALUES($1,$2,$3,$4,$5,$6)', [
        id(), req.user.id, item.user_id, item.organization_id || null, 'verification_reviewed', JSON.stringify({ requestId: item.id, type: item.request_type, status: parsed.data.status }),
      ]);
      return updated.rows[0];
    });
    return res.json({ request: mapRow(saved) });
  } catch (error) {
    if (error.code === 'NOT_FOUND') return res.status(404).json({ error: error.message });
    if (error.code === 'ALREADY_REVIEWED') return res.status(409).json({ error: error.message });
    return errorResponse(res, error, 'Could not review verification request');
  }
});

module.exports = { router, verificationRequests };
