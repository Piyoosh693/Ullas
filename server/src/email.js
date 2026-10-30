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
// Send via Brevo (formerly Sendinblue) HTTP API — avoids SMTP port restrictions on cloud hosts.
async function sendViaBrevo({ from, to, subject, html, text }) {
  const apiKey = process.env.BREVO_API_KEY;
  const fromEmail = process.env.BREVO_FROM_EMAIL || from;
  const fromName = process.env.BREVO_FROM_NAME || 'Ullas';
  if (!apiKey || !fromEmail) return null; // not configured
  const response = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'api-key': apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sender: { name: fromName, email: fromEmail },
      to: [{ email: to }],
      subject,
      htmlContent: html,
      textContent: text || undefined,
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Brevo API returned HTTP ${response.status}: ${body.slice(0, 200)}`);
  }
  return true;
}

async function dispatchOutboxBatch(limit = 20) {
  if (isTestMode()) {
    for (const item of testOutbox) item.status = 'pending';
    return { attempted: 0, sent: 0 };
  }

  const isBrevoConfigured = Boolean(process.env.BREVO_API_KEY && process.env.BREVO_FROM_EMAIL);
  if (!isBrevoConfigured) {
    console.warn('Email dispatch skipped: BREVO_API_KEY and BREVO_FROM_EMAIL must be set');
    return { attempted: 0, sent: 0, skipped: true };
  }

  const senderEmail = process.env.BREVO_FROM_EMAIL;
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
      await sendViaBrevo({ from: senderEmail, to: item.recipient, subject: item.subject, html: item.html_body, text: item.text_body || undefined });
      await query("UPDATE email_outbox SET status='sent',sent_at=NOW(),last_error=NULL,html_body='',text_body='',updated_at=NOW() WHERE id=$1", [item.id]);
      sent += 1;
      console.log(`[Email] Sent to ${item.recipient} — "${item.subject}"`);
    } catch (error) {
      console.error(`[Email Error] Failed to send to ${item.recipient}:`, error.message);
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
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}</title>
</head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;margin:0;padding:24px;background-color:#f8fafc;color:#1e293b;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;border:1px solid #e2e8f0;overflow:hidden;">
    <tr>
      <td style="padding:32px 28px 16px;">
        <h1 style="margin:0 0 16px;font-size:22px;font-weight:700;color:#0f172a;">${escapeHtml(title)}</h1>
        <p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:#334155;">${escapeHtml(message)}</p>
        <p style="margin:0 0 24px;">
          <a href="${safeLink}" target="_blank" style="display:inline-block;padding:12px 24px;background-color:#2563eb;color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;border-radius:8px;">${escapeHtml(buttonText)}</a>
        </p>
        <p style="margin:0 0 8px;font-size:13px;line-height:1.5;color:#64748b;">
          If the button above does not work, copy and paste this link into your browser:
        </p>
        <p style="margin:0 0 24px;font-size:12px;word-break:break-all;color:#2563eb;">
          <a href="${safeLink}" style="color:#2563eb;text-decoration:underline;">${safeLink}</a>
        </p>
      </td>
    </tr>
    <tr>
      <td style="padding:16px 28px;background:#f1f5f9;border-top:1px solid #e2e8f0;font-size:12px;color:#64748b;line-height:1.5;">
        <p style="margin:0 0 4px;">You received this automated notification because an action was requested for your Ullas account.</p>
        <p style="margin:0;">If you did not request this, you can safely ignore this email.</p>
      </td>
    </tr>
  </table>
</body>
</html>`;
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
