const test = require('node:test');
const assert = require('node:assert/strict');
const app = require('../src/app');
const { getTestOutbox } = require('../src/email');
function tokenFromMail(kind, email) {
  const message = [...getTestOutbox()].reverse().find((item) => item.to === email && item.subject.toLowerCase().includes(kind === 'reset' ? 'reset' : 'verify'));
  if (!message) return null;
  const match = String(message.text || '').match(/[?&]token=([^\s&]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

const server = app.listen(0);

function extractSessionToken(setCookieHeader) {
  if (!setCookieHeader) return null;
  const match = setCookieHeader.match(/ullas_session=([^;]+)/);
  return match ? match[1] : null;
}

async function request(path, options = {}) {
  const port = server.address().port;
  const headers = {
    ...(options.headers || {}),
  };

  if (options.body && !headers['content-type']) {
    headers['content-type'] = 'application/json';
  }

  return fetch(`http://127.0.0.1:${port}${path}`, {
    headers,
    method: options.method || 'GET',
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
}

test('public signup never grants admin role even with admin payload fields', async () => {
  process.env.ADMIN_BOOTSTRAP_SECRET = 'bootstrap-secret';

  const signup = await request('/api/signup', {
    method: 'POST',
    body: {
      name: 'Alice Admin',
      email: 'alice@example.com',
      password: 'strongpass123',
      role: 'admin',
      isAdmin: true,
      reviewer: true,
      privileges: ['admin', 'reviewer'],
    },
  });

  assert.equal(signup.status, 400);
  const signupPayload = await signup.json();
  assert.match(signupPayload.error, /Role and privilege fields are not allowed/i);

  const login = await request('/api/login', {
    method: 'POST',
    body: {
      email: 'alice@example.com',
      password: 'strongpass123',
    },
  });
  assert.equal(login.status, 401);

  const bootstrap = await request('/api/admin/bootstrap', {
    method: 'POST',
    headers: { 'x-admin-secret': 'bootstrap-secret' },
    body: {
      name: 'Root Admin',
      email: 'root@example.com',
      password: 'strongpass123',
    },
  });

  assert.equal(bootstrap.status, 201);
  const bootstrapPayload = await bootstrap.json();
  assert.equal(bootstrapPayload.user.role, 'admin');

  const adminLogin = await request('/api/login', {
    method: 'POST',
    body: {
      email: 'root@example.com',
      password: 'strongpass123',
    },
  });

  assert.equal(adminLogin.status, 200);
  const adminSession = extractSessionToken(adminLogin.headers.get('set-cookie'));
  const privilegedOverview = await request('/api/admin/overview', {
    headers: { 'x-session-token': adminSession },
  });

  assert.equal(privilegedOverview.status, 200);

  const removeOnlyAdmin = await request(`/api/admin/users/${bootstrapPayload.user.id}/role`, {
    method: 'PATCH',
    headers: { 'x-session-token': adminSession },
    body: { role: 'user' },
  });
  assert.equal(removeOnlyAdmin.status, 409, 'the last administrator cannot be demoted');
}, 20000);

test('password reset works', async () => {
  const signup = await request('/api/signup', {
    method: 'POST',
    body: {
      name: 'Bob User',
      email: 'bob@example.com',
      password: 'strongpass123',
    },
  });
  await signup.json();
  const verificationToken = tokenFromMail('verify', 'bob@example.com');
  assert.ok(verificationToken);
  const verify = await request('/api/verify-email', { method: 'POST', body: { token: verificationToken } });
  assert.equal(verify.status, 200);

  const reset = await request('/api/forgot-password', {
    method: 'POST',
    body: { email: 'bob@example.com' },
  });

  assert.equal(reset.status, 200);
  const resetPayload = await reset.json();
  assert.equal(Object.prototype.hasOwnProperty.call(resetPayload, 'resetToken'), false);
  const resetToken = tokenFromMail('reset', 'bob@example.com');
  assert.ok(resetToken);

  const resetComplete = await request('/api/reset-password', {
    method: 'POST',
    body: {
      token: resetToken,
      password: 'newpassword456',
    },
  });

  assert.equal(resetComplete.status, 200);
  const reusedReset = await request('/api/reset-password', { method: 'POST', body: { token: resetToken, password: 'anotherpassword789' } });
  assert.equal(reusedReset.status, 400, 'a reset token must be single-use');
  const login = await request('/api/login', {
    method: 'POST',
    body: { email: 'bob@example.com', password: 'newpassword456' },
  });
  assert.equal(login.status, 200);
});

test('admin endpoint requires admin role', async () => {
  const signup = await request('/api/signup', {
    method: 'POST',
    body: {
      name: 'Carol User',
      email: 'carol@example.com',
      password: 'strongpass123',
    },
  });
  const carolToken = tokenFromMail('verify', 'carol@example.com');
  const verifyCarol = await request('/api/verify-email', { method: 'POST', body: { token: carolToken } });
  assert.equal(verifyCarol.status, 200);
  const login = await request('/api/login', {
    method: 'POST',
    body: {
      email: 'carol@example.com',
      password: 'strongpass123',
    },
  });
  const cookie = login.headers.get('set-cookie');
  const sessionToken = extractSessionToken(cookie);

  const admin = await request('/api/admin/overview', {
    headers: { 'x-session-token': sessionToken },
  });
  assert.equal(admin.status, 403);
});

test.after(async () => {
  await new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) return reject(error);
      resolve();
    });
  });
});
