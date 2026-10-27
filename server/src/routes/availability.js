const express = require('express');
const { z } = require('zod');
const { requireAuth } = require('../auth');
const { isTestMode, query, id, errorResponse } = require('./helpers');
const { withTransaction } = require('../db');
const router = express.Router();
const availability = new Map();

const schema = z.object({
  starts_at: z.string().datetime({ offset: true }),
  ends_at: z.string().datetime({ offset: true }),
}).strict();

function mapRow(row) {
  return { id: row.id, userId: row.user_id, starts_at: row.starts_at, ends_at: row.ends_at, createdAt: row.created_at };
}
function validRange(start, end) {
  return Number.isFinite(new Date(start).getTime()) && Number.isFinite(new Date(end).getTime()) && new Date(end) > new Date(start);
}

// Publicly expose only future time windows for a published offer; this enables a booker to choose a valid time.
router.get('/availability/offer/:offerId', async (req, res) => {
  try {
    if (isTestMode()) {
      const offer = require('./offers').offers.get(req.params.offerId);
      if (!offer || offer.status !== 'published') return res.status(404).json({ error: 'Published offer not found' });
      const list = [...availability.values()].filter((item) => item.userId === offer.userId && new Date(item.ends_at || item.endsAt) > new Date()).sort((a, b) => new Date(a.starts_at || a.startsAt) - new Date(b.starts_at || b.startsAt));
      return res.json({ availability: list });
    }
    const offer = await query("SELECT user_id FROM offers WHERE id=$1 AND status='published'", [req.params.offerId]);
    if (!offer.rowCount) return res.status(404).json({ error: 'Published offer not found' });
    const result = await query('SELECT * FROM availability_windows WHERE user_id=$1 AND ends_at > NOW() ORDER BY starts_at LIMIT 100', [offer.rows[0].user_id]);
    return res.json({ availability: result.rows.map(mapRow) });
  } catch (error) {
    return errorResponse(res, error, 'Could not load offer availability');
  }
});

router.get('/availability', requireAuth, async (req, res) => {
  try {
    const list = isTestMode()
      ? [...availability.values()].filter((item) => item.userId === req.user.id || req.user.role === 'admin')
      : (await query(req.user.role === 'admin'
        ? 'SELECT * FROM availability_windows ORDER BY starts_at LIMIT 500'
        : 'SELECT * FROM availability_windows WHERE user_id=$1 ORDER BY starts_at LIMIT 500', req.user.role === 'admin' ? [] : [req.user.id])).rows.map(mapRow);
    return res.json({ availability: list });
  } catch (error) {
    return errorResponse(res, error, 'Could not load availability');
  }
});

router.post('/availability', requireAuth, async (req, res) => {
  if (!['professional', 'organization', 'admin'].includes(req.user.role)) return res.status(403).json({ error: 'Only professional and organization accounts can manage availability' });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success || !validRange(parsed.data?.starts_at, parsed.data?.ends_at) || new Date(parsed.data?.starts_at) <= new Date()) {
    return res.status(400).json({ error: 'Availability must be a valid future time range' });
  }
  try {
    if (isTestMode()) {
      const conflict = [...availability.values()].some((item) => item.userId === req.user.id && new Date(item.starts_at || item.startsAt) < new Date(parsed.data.ends_at) && new Date(item.ends_at || item.endsAt) > new Date(parsed.data.starts_at));
      if (conflict) return res.status(409).json({ error: 'Availability windows cannot overlap' });
      const item = { id: id(), userId: req.user.id, ...parsed.data, createdAt: new Date().toISOString() };
      availability.set(item.id, item);
      return res.status(201).json({ availability: item });
    }
    const result = await withTransaction(async (client) => {
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`availability:${req.user.id}`]);
      const conflict = await client.query('SELECT 1 FROM availability_windows WHERE user_id=$1 AND starts_at < $3 AND ends_at > $2 LIMIT 1', [req.user.id, parsed.data.starts_at, parsed.data.ends_at]);
      if (conflict.rowCount) { const error = new Error('Availability windows cannot overlap'); error.code = 'AVAILABILITY_CONFLICT'; throw error; }
      return client.query('INSERT INTO availability_windows(id,user_id,starts_at,ends_at) VALUES($1,$2,$3,$4) RETURNING *', [id(), req.user.id, parsed.data.starts_at, parsed.data.ends_at]);
    });
    return res.status(201).json({ availability: mapRow(result.rows[0]) });
  } catch (error) {
    if (error.code === 'AVAILABILITY_CONFLICT' || error.code === '23P01') return res.status(409).json({ error: 'Availability windows cannot overlap' });
    return errorResponse(res, error, 'Could not create availability');
  }
});

router.delete('/availability/:id', requireAuth, async (req, res) => {
  if (!['professional', 'organization', 'admin'].includes(req.user.role)) return res.status(403).json({ error: 'Only professional and organization accounts can manage availability' });
  try {
    if (isTestMode()) {
      const item = availability.get(req.params.id);
      if (!item) return res.status(404).json({ error: 'Availability not found' });
      if (item.userId !== req.user.id && req.user.role !== 'admin') return res.status(403).json({ error: 'Forbidden' });
      const used = [...require('./bookings').bookings.values()].some((booking) => {
        if (booking.status !== 'requested' && booking.status !== 'accepted') return false;
        const offer = require('./offers').offers.get(booking.offerId);
        return offer?.userId === item.userId && new Date(booking.slotStart) < new Date(item.ends_at || item.endsAt) && new Date(booking.slotEnd) > new Date(item.starts_at || item.startsAt);
      });
      if (used) return res.status(409).json({ error: 'This availability window overlaps an active booking and cannot be deleted' });
      availability.delete(req.params.id);
      return res.status(204).end();
    }
    const result = await withTransaction(async (client) => {
      const item = await client.query('SELECT * FROM availability_windows WHERE id=$1 FOR UPDATE', [req.params.id]);
      if (!item.rowCount || (item.rows[0].user_id !== req.user.id && req.user.role !== 'admin')) return { missing: true };
      const used = await client.query("SELECT 1 FROM bookings b JOIN offers o ON o.id=b.offer_id WHERE o.user_id=$1 AND b.status IN ('requested','accepted') AND b.slot_start < $3 AND b.slot_end > $2 LIMIT 1", [item.rows[0].user_id, item.rows[0].starts_at, item.rows[0].ends_at]);
      if (used.rowCount) return { conflict: true };
      await client.query('DELETE FROM availability_windows WHERE id=$1', [req.params.id]);
      return { deleted: true };
    });
    if (result.missing) return res.status(404).json({ error: 'Availability not found or access denied' });
    if (result.conflict) return res.status(409).json({ error: 'This availability window overlaps an active booking and cannot be deleted' });
    return res.status(204).end();
  } catch (error) {
    return errorResponse(res, error, 'Could not delete availability');
  }
});

module.exports = { router, availability };
