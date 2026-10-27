const { v4: uuidv4 } = require('uuid');
const { query, isTestMode, withTransaction } = require('./db');

const testOutbox = [];
function frontendBase() { return String(process.env.PUBLIC_APP_URL || process.env.FRONTEND_URL || 'http://localhost:5173').split(',')[0].trim().replace(/\/+$/, ''); }
async function queueEmail({ to, subject, html, text, eventKey }) {
  if (isTestMode()) {
    if (!testOutbox.some((item) => item.eventKey === eventKey)) testOutbox.push({ id: uuidv4(), to, subject, html, text, eventKey, status: 'pending' });
    return { queued: true, test: true };
  }
  const id = uuidv4();
  const result = await query(
    `INSERT INTO email_outbox(id,recipient,subject,html_body,text_body,event_key,status,created_at,updated_at)
     VALUES($1,$2,$3,$4,$5,$6,'pending',NOW(),NOW())
     ON CONFLICT(event_key) DO UPDATE SET event_key=EXCLUDED.event_key
     RETURNING id,status`, [id, to, subject, html, text || '', eventKey],
  );
  // Return quickly; the durable outbox worker handles delivery/retries independently.
  void dispatchOutboxBatch(5).catch((error) => console.error('Email outbox dispatch deferred', { code: error.code || 'EMAIL_DISPATCH_ERROR' }));
  return { queued: true, ...result.rows[0] };
}
async function dispatchOutboxBatch(limit = 20) {
  if (isTestMode()) {
    for (const item of testOutbox) item.status = 'pending';
    return { attempted: 0, sent: 0 };
  }
  const key = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM_EMAIL;
  if (!key || !from) return { attempted: 0, sent: 0, skipped: true };
  // Surface worker crashes instead of leaving outbox rows stuck in `sending` forever.
  await query("UPDATE email_outbox SET status='failed',last_error=COALESCE(last_error,'Dispatch worker stopped before completion'),updated_at=NOW() WHERE status='sending' AND attempts >= 8 AND updated_at <= NOW() - INTERVAL '10 minutes'").catch(() => {});
  const picked = await withTransaction(async (client) => client.query(
    `WITH picked AS (
       SELECT id FROM email_outbox
       WHERE attempts < 8 AND ((status IN ('pending','failed') AND next_attempt_at <= NOW()) OR (status='sending' AND updated_at <= NOW() - INTERVAL '10 minutes'))
       ORDER BY created_at ASC LIMIT $1 FOR UPDATE SKIP LOCKED
     )
     UPDATE email_outbox e SET status='sending',attempts=e.attempts+1,updated_at=NOW()
     FROM picked WHERE e.id=picked.id RETURNING e.*`, [Math.max(1, Math.min(100, limit))],
  ));
  const result = { rows: picked.rows, rowCount: picked.rowCount };
  let sent = 0;
  for (const item of result.rows) {
    try {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'Idempotency-Key': require('node:crypto').createHash('sha256').update(String(item.event_key)).digest('hex') },
        body: JSON.stringify({ from, to: [item.recipient], subject: item.subject, html: item.html_body, text: item.text_body || undefined }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) {
        // Do not retain provider response bodies: they can contain addresses or request details.
        throw new Error(`Email provider returned HTTP ${response.status}`);
      }
      await query("UPDATE email_outbox SET status='sent',sent_at=NOW(),last_error=NULL,html_body='',text_body='',updated_at=NOW() WHERE id=$1", [item.id]);
      sent += 1;
    } catch (error) {
      const attempts = Number(item.attempts || 0) + 1;
      const delayMinutes = Math.min(60, 2 ** Math.min(attempts, 6));
      await query("UPDATE email_outbox SET status='failed',last_error=$2,next_attempt_at=NOW()+($3 * INTERVAL '1 minute'),updated_at=NOW() WHERE id=$1", [item.id, String(error.message).slice(0, 500), delayMinutes]).catch(() => {});
    }
  }
  return { attempted: result.rowCount, sent };
}
function escapeHtml(value) {
  const replacements = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  return String(value ?? '').replace(/[&<>"']/g, (char) => replacements[char]);
}
function emailTemplate(title, message, link, buttonText) {
  const safeLink = escapeHtml(link);
  return `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;line-height:1.6;color:#172033"><h2>${escapeHtml(title)}</h2><p>${escapeHtml(message)}</p><p><a href="${safeLink}" style="display:inline-block;padding:12px 18px;background:#2459db;color:#fff;text-decoration:none;border-radius:8px">${escapeHtml(buttonText)}</a></p><p>If you did not request this, you can ignore this email.</p><p>— Ullas</p></div>`;
}
async function sendActivityEmail(email, { subject, title, message, path = '/', eventKey, buttonText = 'Open Ullas' }) {
  const safePath = String(path).startsWith('/') && !String(path).startsWith('//') ? String(path) : '/';
  const link = `${frontendBase()}${safePath}`;
  return queueEmail({ to: email, subject, html: emailTemplate(title, message, link, buttonText), text: `${title}\n\n${message}\n\n${link}`, eventKey });
}
async function sendVerificationEmail(email, token) {
  const link = `${frontendBase()}/verify-email?token=${encodeURIComponent(token)}`;
  return queueEmail({ to: email, subject: 'Verify your Ullas account', html: emailTemplate('Verify your Ullas account', 'Confirm your email address to activate your account.', link, 'Verify email'), text: `Verify your Ullas account: ${link}`, eventKey: `verify:${email}:${require('node:crypto').createHash('sha256').update(token).digest('hex')}` });
}
async function sendPasswordResetEmail(email, token) {
  const link = `${frontendBase()}/reset-password?token=${encodeURIComponent(token)}`;
  return queueEmail({ to: email, subject: 'Reset your Ullas password', html: emailTemplate('Reset your password', 'Use the secure link below to choose a new password. This link expires in one hour.', link, 'Reset password'), text: `Reset your Ullas password: ${link}`, eventKey: `reset:${email}:${require('node:crypto').createHash('sha256').update(token).digest('hex')}` });
}
function getTestOutbox() { return testOutbox; }
module.exports = { queueEmail, dispatchOutboxBatch, sendVerificationEmail, sendPasswordResetEmail, sendActivityEmail, getTestOutbox };
