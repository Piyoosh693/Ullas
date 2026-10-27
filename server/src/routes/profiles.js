const express = require('express');
const { z } = require('zod');
const { requireAuth } = require('../auth');
const { isTestMode, query, id, errorResponse } = require('./helpers');
const router = express.Router();
const profiles = new Map();
const profileSchema = z.object({ name: z.string().trim().min(2).max(100).optional(), bio: z.string().max(500).optional(), city: z.string().max(100).optional(), organization: z.string().max(150).optional(), visibility: z.enum(['public','private']).optional() }).strict();
function mapRow(r) { return { id: r.id, userId: r.user_id, name: r.display_name, bio: r.bio, city: r.city, organization: r.organization_name, visibility: r.visibility, verificationStatus: r.verification_status || 'pending', createdAt: r.created_at, updatedAt: r.updated_at }; }
router.get('/profiles/:userId', requireAuth, async (req,res) => {
  try {
    let profile;
    if (isTestMode()) profile = profiles.get(req.params.userId) || null;
    else { const r = await query('SELECT * FROM profiles WHERE user_id=$1 LIMIT 1',[req.params.userId]); profile = r.rows[0] ? mapRow(r.rows[0]) : null; }
    if (!profile) return res.status(404).json({ error: 'Profile not found' });
    if (profile.visibility === 'private' && profile.userId !== req.user.id && req.user.role !== 'admin') return res.status(403).json({ error:'Profile is private' });
    return res.json({ profile });
  } catch(e) { return errorResponse(res,e,'Could not load profile'); }
});
router.put('/profiles/:userId', requireAuth, async (req,res) => {
  if (req.params.userId !== req.user.id && req.user.role !== 'admin') return res.status(403).json({ error:'You can only update your own profile' });
  const parsed = profileSchema.safeParse(req.body); if (!parsed.success) return res.status(400).json({ error:'Invalid profile payload' });
  try {
    if (isTestMode()) {
      const old = profiles.get(req.params.userId) || { id:id(), userId:req.params.userId, name:req.user.name, visibility:'public' };
      const next = { ...old, ...parsed.data, updatedAt:new Date().toISOString() }; profiles.set(req.params.userId,next); return res.json({ profile:next });
    }
    const current = await query('SELECT * FROM profiles WHERE user_id=$1 LIMIT 1',[req.params.userId]);
    const prior = current.rows[0] || {};
    const value = { name: parsed.data.name ?? prior.display_name ?? req.user.name, bio: parsed.data.bio ?? prior.bio ?? null, city: parsed.data.city ?? prior.city ?? null, organization: parsed.data.organization ?? prior.organization_name ?? null, visibility: parsed.data.visibility ?? prior.visibility ?? 'public' };
    const result = await query(`INSERT INTO profiles(id,user_id,display_name,bio,city,organization_name,visibility,created_at,updated_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,NOW(),NOW()) ON CONFLICT(user_id) DO UPDATE SET display_name=EXCLUDED.display_name,bio=EXCLUDED.bio,city=EXCLUDED.city,organization_name=EXCLUDED.organization_name,visibility=EXCLUDED.visibility,updated_at=NOW() RETURNING *`,
      [prior.id || id(),req.params.userId,value.name,value.bio,value.city,value.organization,value.visibility]);
    return res.json({ profile:mapRow(result.rows[0]) });
  } catch(e) { return errorResponse(res,e,'Could not save profile'); }
});
module.exports = { router, profiles };
