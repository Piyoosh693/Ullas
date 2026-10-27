const test = require('node:test');
const assert = require('node:assert/strict');
const app = require('../src/app');
const { getTestOutbox } = require('../src/email');

const server = app.listen(0);

async function request(path, options = {}) {
  const port = server.address().port;
  const headers = { ...(options.headers || {}) };
  if (options.body && !headers['content-type']) {
    headers['content-type'] = 'application/json';
  }
  return fetch(`http://127.0.0.1:${port}${path}`, {
    headers,
    method: options.method || 'GET',
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
}

function extractSessionToken(setCookieHeader) {
  if (!setCookieHeader) return null;
  const match = setCookieHeader.match(/ullas_session=([^;]+)/);
  return match ? match[1] : null;
}

test('organization and availability routes work', async () => {
  const signup = await request('/api/signup', {
    method: 'POST',
    body: {
      name: 'Org Owner',
      email: 'owner@example.com',
      password: 'strongpass123',
      accountType: 'organization',
    },
  });
  await signup.json();
  const message = [...getTestOutbox()].reverse().find((item) => item.to === 'owner@example.com' && item.subject.toLowerCase().includes('verify'));
  const tokenMatch = message?.text.match(/[?&]token=([^\s&]+)/);
  assert.ok(tokenMatch);
  const verify = await request('/api/verify-email', {
    method: 'POST',
    body: { token: decodeURIComponent(tokenMatch[1]) },
  });
  assert.equal(verify.status, 200);

  const login = await request('/api/login', {
    method: 'POST',
    body: { email: 'owner@example.com', password: 'strongpass123' },
  });
  const sessionToken = extractSessionToken(login.headers.get('set-cookie'));
  assert.ok(sessionToken);

  const org = await request('/api/organizations', {
    method: 'POST',
    headers: { 'x-session-token': sessionToken },
    body: {
      name: 'Ullas Community Hub',
      slug: 'ullas-community-hub',
      description: 'A community organization',
    },
  });
  assert.equal(org.status, 201);

  const availability = await request('/api/availability', {
    method: 'POST',
    headers: { 'x-session-token': sessionToken },
    body: {
      starts_at: '2026-11-05T10:00:00Z',
      ends_at: '2026-11-05T12:00:00Z',
    },
  });
  assert.equal(availability.status, 201);
});

test('verification requests require admin review', async () => {
  process.env.ADMIN_BOOTSTRAP_SECRET = 'bootstrap-secret';

  const bootstrap = await request('/api/admin/bootstrap', {
    method: 'POST',
    headers: { 'x-admin-secret': 'bootstrap-secret' },
    body: {
      name: 'Verifier Admin',
      email: 'verifier@example.com',
      password: 'strongpass123',
    },
  });
  assert.equal(bootstrap.status, 201);

  const login = await request('/api/login', {
    method: 'POST',
    body: { email: 'verifier@example.com', password: 'strongpass123' },
  });
  const token = extractSessionToken(login.headers.get('set-cookie'));

  const me = await request('/api/me', { headers: { 'x-session-token': token } });
  const mePayload = await me.json();
  const saveProfile = await request(`/api/profiles/${mePayload.user.id}`, { method: 'PUT', headers: { 'x-session-token': token }, body: { name: 'Verifier Admin', bio: 'Test profile', city: 'Roorkee' } });
  assert.equal(saveProfile.status, 200);
  const reqResp = await request('/api/verification/requests', {
    method: 'POST',
    headers: { 'x-session-token': token },
    body: { type: 'profile', notes: 'Need verification' },
  });
  assert.equal(reqResp.status, 201);
});

test.after(async () => {
  await new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) return reject(error);
      resolve();
    });
  });
});


test('public signup accepts only the whitelisted account categories and rejects privileged roles', async () => {
  const professional = await request('/api/signup', { method: 'POST', body: { name: 'Professional One', email: 'professional1@example.com', password: 'strongpass123', accountType: 'professional' } });
  assert.equal(professional.status, 201);
  const profPayload = await professional.json();
  assert.equal(profPayload.user.role, 'professional');
  assert.equal(Object.prototype.hasOwnProperty.call(profPayload, 'verificationToken'), false);

  const forbidden = await request('/api/signup', { method: 'POST', body: { name: 'Bad Role', email: 'bad-role@example.com', password: 'strongpass123', accountType: 'admin' } });
  assert.equal(forbidden.status, 400);
});
