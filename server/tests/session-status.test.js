const test = require('node:test');
const assert = require('node:assert/strict');
const app = require('../src/app');
const repo = require('../src/db/repositories');
const { getTestOutbox } = require('../src/email');

const server = app.listen(0);
async function request(path, { method = 'GET', body, token } = {}) {
  const headers = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (token) headers['x-session-token'] = token;
  return fetch(`http://127.0.0.1:${server.address().port}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
}
function sessionFromCookie(value) {
  const match = String(value || '').match(/ullas_session=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

test('non-active accounts lose access even when they have an existing session', async () => {
  const email = `status-${Date.now()}@example.test`;
  await request('/api/signup', { method: 'POST', body: { name: 'Status Test', email, password: 'strong-pass-1234' } });
  const emailRecord = [...getTestOutbox()].reverse().find((item) => item.to === email && item.subject.toLowerCase().includes('verify'));
  const match = String(emailRecord?.text || '').match(/[?&]token=([^\s&]+)/);
  assert.ok(match);
  const verified = await request('/api/verify-email', { method: 'POST', body: { token: decodeURIComponent(match[1]) } });
  assert.equal(verified.status, 200);
  const login = await request('/api/login', { method: 'POST', body: { email, password: 'strong-pass-1234' } });
  const token = sessionFromCookie(login.headers.get('set-cookie'));
  assert.ok(token);
  const user = repo.memory.users.get(email);
  assert.ok(user);
  user.status = 'pending';
  const response = await request('/api/me', { token });
  assert.equal(response.status, 403);
});

test.after(async () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));
