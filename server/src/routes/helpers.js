const { isTestMode, query } = require('../db');
const { v4: uuidv4 } = require('uuid');
function id() { return uuidv4(); }
function toIso(value) { return value instanceof Date ? value.toISOString() : value; }
function errorResponse(res, error, fallback = 'Request failed') {
  if (error.code === '23505') return res.status(409).json({ error: 'A record with these details already exists' });
  if (error.code === '23503') return res.status(400).json({ error: 'Referenced record does not exist' });
  if (error.code === '23P01' || error.code === 'BOOKING_CONFLICT') return res.status(409).json({ error: 'The requested time conflicts with an existing booking' });
  if (error.code === 'DATABASE_URL_REQUIRED') return res.status(503).json({ error: 'Database is not configured' });
  console.error(fallback, { code: error.code || 'INTERNAL_ERROR', message: process.env.NODE_ENV === 'production' ? 'Database operation failed' : error.message });
  return res.status(error.status || 500).json({ error: fallback });
}
module.exports = { isTestMode, query, id, toIso, errorResponse };
