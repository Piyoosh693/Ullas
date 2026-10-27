const express = require('express');
const { z } = require('zod');
const { requireAuth } = require('../auth');
const { isTestMode, query, id, errorResponse } = require('./helpers');
const { withTransaction } = require('../db');
const { notifyUser, emailUser } = require('../notifications-service');
const router = express.Router();
const bookings = new Map();
const createSchema = z.object({ offerId: z.string().uuid(), slotStart: z.string().datetime({ offset: true }), slotEnd: z.string().datetime({ offset: true }) }).strict();
const allowedFrom = { requested: ['accepted', 'declined', 'cancelled'], accepted: ['cancelled', 'completed'], declined: [], cancelled: [], completed: [] };
function mapRow(row) {
  return { id: row.id, offerId: row.offer_id, userId: row.user_id, slotStart: row.slot_start, slotEnd: row.slot_end, status: row.status, createdAt: row.created_at, updatedAt: row.updated_at };
}
function validInterval(start, end) { return Number.isFinite(new Date(start).getTime()) && Number.isFinite(new Date(end).getTime()) && new Date(end) > new Date(start); }

router.get('/bookings', requireAuth, async (req, res) => {
  try {
    let list;
    if (isTestMode()) list = [...bookings.values()].filter((booking) => booking.userId === req.user.id || booking.offerOwnerId === req.user.id || req.user.role === 'admin');
    else {
      const result = await query(
        req.user.role === 'admin'
          ? 'SELECT b.*,o.user_id AS offer_owner_id,o.title AS offer_title FROM bookings b JOIN offers o ON o.id=b.offer_id ORDER BY b.created_at DESC LIMIT 500'
          : 'SELECT b.*,o.user_id AS offer_owner_id,o.title AS offer_title FROM bookings b JOIN offers o ON o.id=b.offer_id WHERE b.user_id=$1 OR o.user_id=$1 ORDER BY b.created_at DESC LIMIT 500',
        req.user.role === 'admin' ? [] : [req.user.id],
      );
      list = result.rows.map((row) => ({ ...mapRow(row), offerOwnerId: row.offer_owner_id, offerTitle: row.offer_title }));
    }
    return res.json({ bookings: list });
  } catch (error) { return errorResponse(res, error, 'Could not load bookings'); }
});

router.post('/bookings', requireAuth, async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success || !validInterval(parsed.data?.slotStart, parsed.data?.slotEnd) || new Date(parsed.data?.slotStart) <= new Date()) {
    return res.status(400).json({ error: 'Provide a valid future booking interval' });
  }
  try {
    if (isTestMode()) {
      const offer = require('./offers').offers.get(parsed.data.offerId);
      if (!offer || offer.status !== 'published') return res.status(404).json({ error: 'Published offer not found' });
      if (offer.userId === req.user.id) return res.status(400).json({ error: 'You cannot book your own offer' });
      const windows = [...require('./availability').availability.values()].filter((window) => window.userId === offer.userId);
      const fitsWindow = windows.some((window) => new Date(window.starts_at || window.startsAt) <= new Date(parsed.data.slotStart) && new Date(window.ends_at || window.endsAt) >= new Date(parsed.data.slotEnd));
      if (!fitsWindow) return res.status(409).json({ error: 'Choose a time fully inside the provider availability window' });
      for (const booking of bookings.values()) {
        if (booking.offerId === parsed.data.offerId && ['requested', 'accepted'].includes(booking.status) && new Date(parsed.data.slotStart) < new Date(booking.slotEnd) && new Date(parsed.data.slotEnd) > new Date(booking.slotStart)) {
          return res.status(409).json({ error: 'The requested time conflicts with an existing booking' });
        }
      }
      const booking = { id: id(), offerId: offer.id, userId: req.user.id, offerOwnerId: offer.userId, offerTitle: offer.title, slotStart: parsed.data.slotStart, slotEnd: parsed.data.slotEnd, status: 'requested', createdAt: new Date().toISOString() };
      bookings.set(booking.id, booking);
      const bookingMessage = `A new booking request was made for: ${offer.title}`;
      await notifyUser(offer.userId, 'booking_request', bookingMessage).catch(() => {});
      await emailUser(offer.userId, { subject: 'New Ullas booking request', title: 'New booking request', message: bookingMessage, path: '/bookings', eventKey: `booking-created:${booking.id}` }).catch(() => {});
      return res.status(201).json({ booking });
    }

    const created = await withTransaction(async (client) => {
      // All app booking create/reschedule operations acquire this same transaction lock per offer.
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [parsed.data.offerId]);
      const offer = await client.query("SELECT id,user_id,status,title FROM offers WHERE id=$1 FOR UPDATE", [parsed.data.offerId]);
      if (!offer.rowCount || offer.rows[0].status !== 'published') { const error = new Error('Published offer not found'); error.code = 'OFFER_NOT_FOUND'; throw error; }
      if (offer.rows[0].user_id === req.user.id) { const error = new Error('You cannot book your own offer'); error.code = 'SELF_BOOKING'; throw error; }
      const availability = await client.query('SELECT 1 FROM availability_windows WHERE user_id=$1 AND starts_at <= $2 AND ends_at >= $3 LIMIT 1 FOR SHARE', [offer.rows[0].user_id, parsed.data.slotStart, parsed.data.slotEnd]);
      if (!availability.rowCount) { const error = new Error('Choose a time fully inside the provider availability window'); error.code = 'BOOKING_AVAILABILITY'; throw error; }
      const conflict = await client.query("SELECT 1 FROM bookings WHERE offer_id=$1 AND status IN ('requested','accepted') AND slot_start < $3 AND slot_end > $2 LIMIT 1", [parsed.data.offerId, parsed.data.slotStart, parsed.data.slotEnd]);
      if (conflict.rowCount) { const error = new Error('The requested time conflicts with an existing booking'); error.code = 'BOOKING_CONFLICT'; throw error; }
      const result = await client.query("INSERT INTO bookings(id,offer_id,user_id,slot_start,slot_end,status) VALUES($1,$2,$3,$4,$5,'requested') RETURNING *", [id(), parsed.data.offerId, req.user.id, parsed.data.slotStart, parsed.data.slotEnd]);
      return { booking: result.rows[0], offerOwnerId: offer.rows[0].user_id, offerTitle: offer.rows[0].title };
    });
    const bookingMessage = `A new booking request was made for: ${created.offerTitle}`;
    await notifyUser(created.offerOwnerId, 'booking_request', bookingMessage).catch(() => {});
    await emailUser(created.offerOwnerId, { subject: 'New Ullas booking request', title: 'New booking request', message: bookingMessage, path: '/bookings', eventKey: `booking-created:${created.booking.id}` }).catch(() => {});
    return res.status(201).json({ booking: { ...mapRow(created.booking), offerOwnerId: created.offerOwnerId, offerTitle: created.offerTitle } });
  } catch (error) {
    if (error.code === 'OFFER_NOT_FOUND') return res.status(404).json({ error: error.message });
    if (error.code === 'SELF_BOOKING') return res.status(400).json({ error: error.message });
    if (error.code === 'BOOKING_AVAILABILITY') return res.status(409).json({ error: error.message });
    return errorResponse(res, error, 'Could not create booking');
  }
});

router.patch('/bookings/:id', requireAuth, async (req, res) => {
  const parsed = z.object({ status: z.enum(['accepted', 'declined', 'cancelled', 'completed']).optional(), slotStart: z.string().datetime({ offset: true }).optional(), slotEnd: z.string().datetime({ offset: true }).optional() }).strict().safeParse(req.body);
  if (!parsed.success || (!parsed.data.status && !parsed.data.slotStart && !parsed.data.slotEnd)) return res.status(400).json({ error: 'Invalid booking update' });
  try {
    if (isTestMode()) {
      const booking = bookings.get(req.params.id);
      if (!booking) return res.status(404).json({ error: 'Booking not found' });
      const offer = require('./offers').offers.get(booking.offerId);
      const isBooker = booking.userId === req.user.id;
      const isOwner = offer?.userId === req.user.id;
      const isAdmin = req.user.role === 'admin';
      if (!isBooker && !isOwner && !isAdmin) return res.status(403).json({ error: 'Not allowed to update this booking' });
      if (parsed.data.status) {
        const permittedActor = isAdmin || (isBooker && parsed.data.status === 'cancelled') || (isOwner && ['accepted', 'declined', 'completed', 'cancelled'].includes(parsed.data.status));
        if (!permittedActor || !allowedFrom[booking.status]?.includes(parsed.data.status)) return res.status(403).json({ error: 'Invalid booking state transition' });
      }
      const start = parsed.data.slotStart || booking.slotStart;
      const end = parsed.data.slotEnd || booking.slotEnd;
      if (!validInterval(start, end)) return res.status(400).json({ error: 'Invalid booking interval' });
      if ((parsed.data.slotStart || parsed.data.slotEnd) && new Date(start) <= new Date()) return res.status(400).json({ error: 'Rescheduled bookings must start in the future' });
      if ((parsed.data.slotStart || parsed.data.slotEnd) && !['requested', 'accepted'].includes(booking.status)) return res.status(409).json({ error: 'Only an active booking can be rescheduled' });
      if (parsed.data.slotStart || parsed.data.slotEnd) {
        const windows = [...require('./availability').availability.values()].filter((window) => window.userId === offer?.userId);
        const fitsWindow = windows.some((window) => new Date(window.starts_at || window.startsAt) <= new Date(start) && new Date(window.ends_at || window.endsAt) >= new Date(end));
        if (!fitsWindow) return res.status(409).json({ error: 'Choose a time fully inside the provider availability window' });
        for (const other of bookings.values()) {
          if (other.id !== booking.id && other.offerId === booking.offerId && ['requested', 'accepted'].includes(other.status) && new Date(start) < new Date(other.slotEnd) && new Date(end) > new Date(other.slotStart)) return res.status(409).json({ error: 'The requested time conflicts with an existing booking' });
        }
      }
      const updated = { ...booking, slotStart: start, slotEnd: end, status: parsed.data.status || booking.status, updatedAt: new Date().toISOString() };
      bookings.set(booking.id, updated);
      const notifyTarget = isOwner ? booking.userId : booking.offerOwnerId;
      const message = parsed.data.status ? `Your booking was ${parsed.data.status}.` : 'A booking time was changed.';
      await notifyUser(notifyTarget, 'booking_update', message).catch(() => {});
      await emailUser(notifyTarget, { subject: 'Ullas booking update', title: 'Booking update', message, path: '/bookings', eventKey: `booking-update:${booking.id}:${updated.updatedAt}` }).catch(() => {});
      return res.json({ booking: updated });
    }

    const changed = await withTransaction(async (client) => {
      const result = await client.query('SELECT b.*,o.user_id AS offer_owner_id,o.title AS offer_title FROM bookings b JOIN offers o ON o.id=b.offer_id WHERE b.id=$1 FOR UPDATE OF b', [req.params.id]);
      if (!result.rowCount) { const error = new Error('Booking not found'); error.code = 'BOOKING_NOT_FOUND'; throw error; }
      const booking = result.rows[0];
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [booking.offer_id]);
      const isBooker = booking.user_id === req.user.id;
      const isOwner = booking.offer_owner_id === req.user.id;
      const isAdmin = req.user.role === 'admin';
      if (!isBooker && !isOwner && !isAdmin) { const error = new Error('Not allowed to update this booking'); error.code = 'BOOKING_FORBIDDEN'; throw error; }
      const nextStatus = parsed.data.status || booking.status;
      if (parsed.data.status) {
        const permittedActor = isAdmin || (isBooker && nextStatus === 'cancelled') || (isOwner && ['accepted', 'declined', 'completed', 'cancelled'].includes(nextStatus));
        if (!permittedActor || !allowedFrom[booking.status]?.includes(nextStatus)) { const error = new Error('Invalid booking state transition'); error.code = 'BOOKING_FORBIDDEN'; throw error; }
      }
      const start = parsed.data.slotStart || booking.slot_start;
      const end = parsed.data.slotEnd || booking.slot_end;
      if (!validInterval(start, end)) { const error = new Error('Invalid booking interval'); error.code = 'BOOKING_INVALID'; throw error; }
      if ((parsed.data.slotStart || parsed.data.slotEnd) && new Date(start) <= new Date()) { const error = new Error('Rescheduled bookings must start in the future'); error.code = 'BOOKING_INVALID'; throw error; }
      if ((parsed.data.slotStart || parsed.data.slotEnd) && !['requested', 'accepted'].includes(booking.status)) { const error = new Error('Only an active booking can be rescheduled'); error.code = 'BOOKING_FORBIDDEN'; throw error; }
      if ((parsed.data.slotStart || parsed.data.slotEnd) && ['requested', 'accepted'].includes(nextStatus)) {
        const availability = await client.query('SELECT 1 FROM availability_windows WHERE user_id=$1 AND starts_at <= $2 AND ends_at >= $3 LIMIT 1 FOR SHARE', [booking.offer_owner_id, start, end]);
        if (!availability.rowCount) { const error = new Error('Choose a time fully inside the provider availability window'); error.code = 'BOOKING_AVAILABILITY'; throw error; }
        const conflict = await client.query("SELECT 1 FROM bookings WHERE offer_id=$1 AND id<>$2 AND status IN ('requested','accepted') AND slot_start < $4 AND slot_end > $3 LIMIT 1", [booking.offer_id, booking.id, start, end]);
        if (conflict.rowCount) { const error = new Error('The requested time conflicts with an existing booking'); error.code = 'BOOKING_CONFLICT'; throw error; }
      }
      const saved = await client.query('UPDATE bookings SET slot_start=$2,slot_end=$3,status=$4,updated_at=NOW() WHERE id=$1 RETURNING *', [booking.id, start, end, nextStatus]);
      return { booking: saved.rows[0], offerOwnerId: booking.offer_owner_id, offerTitle: booking.offer_title, userId: booking.user_id, isOwner, isAdmin, statusChanged: Boolean(parsed.data.status), changedStatus: parsed.data.status };
    });
    const target = changed.isOwner ? changed.userId : changed.offerOwnerId;
    const updateMessage = changed.statusChanged ? `Your booking for ${changed.offerTitle} was ${changed.changedStatus}.` : `A booking time for ${changed.offerTitle} was changed.`;
    await notifyUser(target, 'booking_update', updateMessage).catch(() => {});
    await emailUser(target, { subject: 'Ullas booking update', title: 'Booking update', message: updateMessage, path: '/bookings', eventKey: `booking-update:${changed.booking.id}:${changed.booking.updated_at || Date.now()}` }).catch(() => {});
    return res.json({ booking: { ...mapRow(changed.booking), offerOwnerId: changed.offerOwnerId, offerTitle: changed.offerTitle } });
  } catch (error) {
    if (error.code === 'BOOKING_NOT_FOUND') return res.status(404).json({ error: error.message });
    if (error.code === 'BOOKING_FORBIDDEN') return res.status(403).json({ error: error.message });
    if (error.code === 'BOOKING_INVALID') return res.status(400).json({ error: error.message });
    if (error.code === 'BOOKING_AVAILABILITY') return res.status(409).json({ error: error.message });
    return errorResponse(res, error, 'Could not update booking');
  }
});
module.exports = { router, bookings };
