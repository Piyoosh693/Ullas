const { v4: uuidv4 } = require('uuid');
const { query, isTestMode } = require('./db');
const notificationStore = require('./notification-store');
const repositories = require('./db/repositories');
const { sendActivityEmail } = require('./email');

async function notifyUser(userId, type, message) {
  if (!userId || !message) return null;
  if (isTestMode()) {
    const item = { id: uuidv4(), userId, type: type || 'general', message: String(message).slice(0, 1000), read: false, createdAt: new Date().toISOString() };
    notificationStore.set(item.id, item);
    return item;
  }
  const result = await query(
    'INSERT INTO notifications(id,user_id,type,message,is_read) VALUES($1,$2,$3,$4,FALSE) RETURNING *',
    [uuidv4(), userId, type || 'general', String(message).slice(0, 1000)],
  );
  const row = result.rows[0];
  return { id: row.id, userId: row.user_id, type: row.type, message: row.message, read: row.is_read, createdAt: row.created_at };
}
async function emailUser(userId, { subject, title, message, path = '/activity', eventKey, buttonText = 'View activity' }) {
  if (!userId || !eventKey) return null;
  const user = await repositories.findUserById(userId);
  if (!user || user.status !== 'active' || !user.verified || !user.email) return null;
  return sendActivityEmail(user.email, { subject, title, message, path, eventKey, buttonText });
}
module.exports = { notifyUser, emailUser };
