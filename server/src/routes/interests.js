const express = require('express');
const { z } = require('zod');
const { requireAuth } = require('../auth');
const { isTestMode, query, id, errorResponse } = require('./helpers');
const { notifyUser, emailUser } = require('../notifications-service');
const router = express.Router();
const interests = new Map();
const createSchema = z.object({ offerId: z.string().uuid().optional(), needId: z.string().uuid().optional() }).strict().refine((value) => Boolean(value.offerId) !== Boolean(value.needId));
function mapRow(row) {
  return { id: row.id, userId: row.user_id, offerId: row.offer_id, needId: row.need_id, status: row.status, createdAt: row.created_at, listingOwnerId: row.listing_owner_id, listingTitle: row.listing_title };
}
router.get('/interests', requireAuth, async (req, res) => {
  try {
    let list;
    if (isTestMode()) {
      const offerMap = require('./offers').offers;
      const needMap = require('./needs').needs;
      list = [...interests.values()].map((item) => {
        const listing = item.offerId ? offerMap.get(item.offerId) : needMap.get(item.needId);
        return { ...item, listingOwnerId: listing?.userId, listingTitle: listing?.title };
      }).filter((item) => item.userId === req.user.id || item.listingOwnerId === req.user.id || req.user.role === 'admin');
    } else {
      const result = await query(
        `SELECT i.*, COALESCE(o.user_id,n.user_id) AS listing_owner_id, COALESCE(o.title,n.title) AS listing_title
         FROM interests i LEFT JOIN offers o ON o.id=i.offer_id LEFT JOIN needs n ON n.id=i.need_id
         WHERE i.user_id=$1 OR o.user_id=$1 OR n.user_id=$1 OR $2::boolean
         ORDER BY i.created_at DESC LIMIT 500`, [req.user.id, req.user.role === 'admin'],
      );
      list = result.rows.map(mapRow);
    }
    return res.json({ interests: list });
  } catch (error) { return errorResponse(res, error, 'Could not load interests'); }
});
router.post('/interests', requireAuth, async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Interest requires exactly one offerId or needId' });
  try {
    if (isTestMode()) {
      const listing = parsed.data.offerId ? require('./offers').offers.get(parsed.data.offerId) : require('./needs').needs.get(parsed.data.needId);
      if (!listing || listing.status !== 'published') return res.status(404).json({ error: 'Published offer or need not found' });
      if (listing.userId === req.user.id) return res.status(400).json({ error: 'You cannot express interest in your own listing' });
      if ([...interests.values()].some((item) => item.userId === req.user.id && item.offerId === (parsed.data.offerId || null) && item.needId === (parsed.data.needId || null))) return res.status(409).json({ error: 'You have already expressed interest in this listing' });
      const item = { id: id(), userId: req.user.id, offerId: parsed.data.offerId || null, needId: parsed.data.needId || null, status: 'pending', createdAt: new Date().toISOString() };
      interests.set(item.id, item);
      const interestMessage = `Someone expressed interest in your ${parsed.data.offerId ? 'offer' : 'community need'}: ${listing.title}`;
      await notifyUser(listing.userId, 'interest', interestMessage).catch(() => {});
      await emailUser(listing.userId, { subject: 'New interest in your Ullas listing', title: 'Someone is interested', message: interestMessage, path: '/activity', eventKey: `interest-created:${item.id}` }).catch(() => {});
      return res.status(201).json({ interest: { ...item, listingOwnerId: listing.userId, listingTitle: listing.title } });
    }
    const table = parsed.data.offerId ? 'offers' : 'needs';
    const reference = parsed.data.offerId || parsed.data.needId;
    const listing = await query(`SELECT id,user_id,status,title FROM ${table} WHERE id=$1`, [reference]);
    if (!listing.rowCount || listing.rows[0].status !== 'published') return res.status(404).json({ error: 'Published offer or need not found' });
    if (listing.rows[0].user_id === req.user.id) return res.status(400).json({ error: 'You cannot express interest in your own listing' });
    const result = await query("INSERT INTO interests(id,user_id,offer_id,need_id,status) VALUES($1,$2,$3,$4,'pending') RETURNING *", [id(), req.user.id, parsed.data.offerId || null, parsed.data.needId || null]);
    const interestMessage = `Someone expressed interest in your ${parsed.data.offerId ? 'offer' : 'community need'}: ${listing.rows[0].title}`;
    await notifyUser(listing.rows[0].user_id, 'interest', interestMessage).catch(() => {});
    await emailUser(listing.rows[0].user_id, { subject: 'New interest in your Ullas listing', title: 'Someone is interested', message: interestMessage, path: '/activity', eventKey: `interest-created:${result.rows[0].id}` }).catch(() => {});
    return res.status(201).json({ interest: mapRow({ ...result.rows[0], listing_owner_id: listing.rows[0].user_id, listing_title: listing.rows[0].title }) });
  } catch (error) {
    if (error.code === '23505') return res.status(409).json({ error: 'You have already expressed interest in this listing' });
    return errorResponse(res, error, 'Could not create interest');
  }
});
router.patch('/interests/:id', requireAuth, async (req, res) => {
  const parsed = z.object({ status: z.enum(['accepted', 'declined']) }).strict().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Only accept or decline is allowed' });
  try {
    if (isTestMode()) {
      const item = interests.get(req.params.id);
      if (!item) return res.status(404).json({ error: 'Interest not found' });
      const listing = item.offerId ? require('./offers').offers.get(item.offerId) : require('./needs').needs.get(item.needId);
      if (req.user.role !== 'admin' && listing?.userId !== req.user.id) return res.status(403).json({ error: 'Only the listing owner can respond to an interest' });
      if (item.status !== 'pending') return res.status(409).json({ error: 'Interest already handled' });
      const next = { ...item, status: parsed.data.status };
      interests.set(item.id, next);
      const responseMessage = `Your interest was ${parsed.data.status}.`;
      await notifyUser(item.userId, 'interest_response', responseMessage).catch(() => {});
      await emailUser(item.userId, { subject: 'Ullas interest update', title: 'Interest update', message: responseMessage, path: '/activity', eventKey: `interest-response:${item.id}:${parsed.data.status}` }).catch(() => {});
      return res.json({ interest: { ...next, listingOwnerId: listing?.userId, listingTitle: listing?.title } });
    }
    const result = await query(`SELECT i.*,COALESCE(o.user_id,n.user_id) AS listing_owner_id,COALESCE(o.title,n.title) AS listing_title
      FROM interests i LEFT JOIN offers o ON o.id=i.offer_id LEFT JOIN needs n ON n.id=i.need_id WHERE i.id=$1`, [req.params.id]);
    if (!result.rowCount) return res.status(404).json({ error: 'Interest not found' });
    const item = result.rows[0];
    if (item.listing_owner_id !== req.user.id && req.user.role !== 'admin') return res.status(403).json({ error: 'Only the listing owner can respond to an interest' });
    if (item.status !== 'pending') return res.status(409).json({ error: 'Interest already handled' });
    const saved = await query('UPDATE interests SET status=$2 WHERE id=$1 AND status=\'pending\' RETURNING *', [req.params.id, parsed.data.status]);
    if (!saved.rowCount) return res.status(409).json({ error: 'Interest already handled' });
    const responseMessage = `Your interest was ${parsed.data.status}.`;
    await notifyUser(item.user_id, 'interest_response', responseMessage).catch(() => {});
    await emailUser(item.user_id, { subject: 'Ullas interest update', title: 'Interest update', message: responseMessage, path: '/activity', eventKey: `interest-response:${item.id}:${parsed.data.status}` }).catch(() => {});
    return res.json({ interest: mapRow({ ...saved.rows[0], listing_owner_id: item.listing_owner_id, listing_title: item.listing_title }) });
  } catch (error) { return errorResponse(res, error, 'Could not update interest'); }
});
module.exports = { router, interests };
