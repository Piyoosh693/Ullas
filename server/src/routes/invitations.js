const express = require('express');
const { z } = require('zod');
const { requireAuth } = require('../auth');
const { isTestMode, query, id, errorResponse } = require('./helpers');
const { notifyUser, emailUser } = require('../notifications-service');
const repo = require('../db/repositories');
const router = express.Router();
const invitations = new Map();
const createSchema = z.object({ recipientUserId: z.string().uuid(), offerId: z.string().uuid().optional(), needId: z.string().uuid().optional() }).strict().refine((value) => Boolean(value.offerId) !== Boolean(value.needId));
function mapRow(row) { return { id: row.id, senderUserId: row.sender_user_id, recipientUserId: row.recipient_user_id, offerId: row.offer_id, needId: row.need_id, status: row.status, createdAt: row.created_at }; }
router.get('/invitations', requireAuth, async (req, res) => {
  try {
    const list = isTestMode()
      ? [...invitations.values()].filter((item) => item.senderUserId === req.user.id || item.recipientUserId === req.user.id || req.user.role === 'admin')
      : (await query(req.user.role === 'admin' ? 'SELECT * FROM invitations ORDER BY created_at DESC LIMIT 500' : 'SELECT * FROM invitations WHERE sender_user_id=$1 OR recipient_user_id=$1 ORDER BY created_at DESC LIMIT 500', req.user.role === 'admin' ? [] : [req.user.id])).rows.map(mapRow);
    return res.json({ invitations: list });
  } catch (error) { return errorResponse(res, error, 'Could not load invitations'); }
});
router.post('/invitations', requireAuth, async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invitation requires a recipient and exactly one offerId or needId' });
  if (parsed.data.recipientUserId === req.user.id) return res.status(400).json({ error: 'You cannot invite yourself' });
  try {
    const reference = parsed.data.offerId || parsed.data.needId;
    let listingOwnerId;
    let listingTitle;
    if (isTestMode()) {
      const listing = parsed.data.offerId ? require('./offers').offers.get(reference) : require('./needs').needs.get(reference);
      if (!listing || listing.status !== 'published') return res.status(404).json({ error: 'Published offer or need not found' });
      listingOwnerId = listing.userId; listingTitle = listing.title;
      const recipient = repo.memory.usersById.get(parsed.data.recipientUserId);
      if (!recipient || recipient.status !== 'active' || !recipient.verified) return res.status(404).json({ error: 'Recipient not found' });
    } else {
      const recipient = await query('SELECT id,status,email_verified FROM users WHERE id=$1', [parsed.data.recipientUserId]);
      if (!recipient.rowCount || recipient.rows[0].status !== 'active' || !recipient.rows[0].email_verified) return res.status(404).json({ error: 'Recipient not found' });
      const table = parsed.data.offerId ? 'offers' : 'needs';
      const listing = await query(`SELECT id,user_id,status,title FROM ${table} WHERE id=$1`, [reference]);
      if (!listing.rowCount || listing.rows[0].status !== 'published') return res.status(404).json({ error: 'Published offer or need not found' });
      listingOwnerId = listing.rows[0].user_id; listingTitle = listing.rows[0].title;
    }
    if (listingOwnerId !== req.user.id && req.user.role !== 'admin') return res.status(403).json({ error: 'Only the listing owner can send invitations' });
    const item = isTestMode()
      ? { id: id(), senderUserId: req.user.id, recipientUserId: parsed.data.recipientUserId, offerId: parsed.data.offerId || null, needId: parsed.data.needId || null, status: 'pending', createdAt: new Date().toISOString() }
      : mapRow((await query("INSERT INTO invitations(id,sender_user_id,recipient_user_id,offer_id,need_id,status) VALUES($1,$2,$3,$4,$5,'pending') RETURNING *", [id(), req.user.id, parsed.data.recipientUserId, parsed.data.offerId || null, parsed.data.needId || null])).rows[0]);
    if (isTestMode()) invitations.set(item.id, item);
    const invitationMessage = `You have a new invitation for ${parsed.data.offerId ? 'an offer' : 'a community need'}: ${listingTitle}`;
    await notifyUser(parsed.data.recipientUserId, 'invitation', invitationMessage).catch(() => {});
    await emailUser(parsed.data.recipientUserId, { subject: 'You have a new Ullas invitation', title: 'New invitation', message: invitationMessage, path: '/activity', eventKey: `invitation-created:${item.id}` }).catch(() => {});
    return res.status(201).json({ invitation: item });
  } catch (error) {
    if (error.code === '23505') return res.status(409).json({ error: 'A pending invitation already exists for this recipient and listing' });
    return errorResponse(res, error, 'Could not send invitation');
  }
});
router.patch('/invitations/:id', requireAuth, async (req, res) => {
  const parsed = z.object({ status: z.enum(['accepted', 'declined']) }).strict().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Only accept or decline is allowed' });
  try {
    if (isTestMode()) {
      const item = invitations.get(req.params.id);
      if (!item) return res.status(404).json({ error: 'Invitation not found' });
      if (item.recipientUserId !== req.user.id && req.user.role !== 'admin') return res.status(403).json({ error: 'Only the recipient can respond' });
      if (item.status !== 'pending') return res.status(409).json({ error: 'Invitation already handled' });
      const updated = { ...item, status: parsed.data.status }; invitations.set(item.id, updated);
      const responseMessage = `Your invitation was ${parsed.data.status}.`;
      await notifyUser(item.senderUserId, 'invitation_response', responseMessage).catch(() => {});
      await emailUser(item.senderUserId, { subject: 'Ullas invitation update', title: 'Invitation update', message: responseMessage, path: '/activity', eventKey: `invitation-response:${item.id}:${parsed.data.status}` }).catch(() => {});
      return res.json({ invitation: updated });
    }
    const old = await query('SELECT * FROM invitations WHERE id=$1', [req.params.id]);
    if (!old.rowCount) return res.status(404).json({ error: 'Invitation not found' });
    if (old.rows[0].recipient_user_id !== req.user.id && req.user.role !== 'admin') return res.status(403).json({ error: 'Only the recipient can respond' });
    if (old.rows[0].status !== 'pending') return res.status(409).json({ error: 'Invitation already handled' });
    const saved = await query("UPDATE invitations SET status=$2 WHERE id=$1 AND status='pending' RETURNING *", [req.params.id, parsed.data.status]);
    if (!saved.rowCount) return res.status(409).json({ error: 'Invitation already handled' });
    const responseMessage = `Your invitation was ${parsed.data.status}.`;
    await notifyUser(old.rows[0].sender_user_id, 'invitation_response', responseMessage).catch(() => {});
    await emailUser(old.rows[0].sender_user_id, { subject: 'Ullas invitation update', title: 'Invitation update', message: responseMessage, path: '/activity', eventKey: `invitation-response:${req.params.id}:${parsed.data.status}` }).catch(() => {});
    return res.json({ invitation: mapRow(saved.rows[0]) });
  } catch (error) { return errorResponse(res, error, 'Could not update invitation'); }
});
module.exports = { router, invitations };
