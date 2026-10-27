const express = require('express');
const { z } = require('zod');
const { isTestMode, query, errorResponse } = require('./helpers');
const profiles = require('./profiles').profiles;
const repo = require('../db/repositories');

const router = express.Router();
const querySchema = z.object({
  q: z.string().trim().max(100).optional(),
  role: z.enum(['user', 'professional', 'organization']).optional(),
}).strict();

function mapRow(row) {
  return {
    userId: row.user_id,
    name: row.display_name,
    role: row.role,
    bio: row.bio,
    city: row.city,
    organization: row.organization_name,
    verificationStatus: row.verification_status,
  };
}

// Only public profile fields are returned. Email addresses, session details, and moderation notes are never exposed.
router.get('/directory', async (req, res) => {
  const parsed = querySchema.safeParse({ q: req.query.q, role: req.query.role });
  if (!parsed.success) return res.status(400).json({ error: 'Invalid directory filters' });
  const q = parsed.data.q || '';
  const role = parsed.data.role || null;
  try {
    if (isTestMode()) {
      const results = [];
      for (const profile of profiles.values()) {
        const user = repo.memory.usersById.get(profile.userId);
        if (!user || user.status !== 'active' || !user.verified || profile.visibility !== 'public') continue;
        if (role && user.role !== role) continue;
        const haystack = `${profile.name || ''} ${profile.bio || ''} ${profile.city || ''} ${profile.organization || ''}`.toLowerCase();
        if (q && !haystack.includes(q.toLowerCase())) continue;
        results.push({ userId: user.id, name: profile.name || user.name, role: user.role, bio: profile.bio || null, city: profile.city || null, organization: profile.organization || null, verificationStatus: profile.verificationStatus || 'pending' });
      }
      return res.json({ profiles: results.slice(0, 100) });
    }
    const params = [];
    const predicates = ["u.status = 'active'", 'u.email_verified = TRUE', "p.visibility = 'public'"];
    if (role) { params.push(role); predicates.push(`u.role = $${params.length}`); }
    if (q) {
      params.push(q);
      const placeholder = `$${params.length}`;
      predicates.push(`(POSITION(LOWER(${placeholder}) IN LOWER(p.display_name)) > 0 OR POSITION(LOWER(${placeholder}) IN LOWER(COALESCE(p.bio,''))) > 0 OR POSITION(LOWER(${placeholder}) IN LOWER(COALESCE(p.city,''))) > 0 OR POSITION(LOWER(${placeholder}) IN LOWER(COALESCE(p.organization_name,''))) > 0)`);
    }
    params.push(100);
    const result = await query(`
      SELECT p.user_id, p.display_name, u.role, p.bio, p.city, p.organization_name, p.verification_status
      FROM profiles p JOIN users u ON u.id = p.user_id
      WHERE ${predicates.join(' AND ')}
      ORDER BY CASE WHEN p.verification_status='approved' THEN 0 ELSE 1 END, p.display_name ASC
      LIMIT $${params.length}
    `, params);
    return res.json({ profiles: result.rows.map(mapRow) });
  } catch (error) {
    return errorResponse(res, error, 'Could not load community directory');
  }
});

module.exports = router;
