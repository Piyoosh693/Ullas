const test = require('node:test');
const assert = require('node:assert/strict');
const { validateEnv } = require('../src/config');

function productionEnv(overrides = {}) {
  return {
    NODE_ENV: 'production',
    DATABASE_URL: 'postgresql://ullas:password@db.example.internal:5432/ullas',
    FRONTEND_URL: 'https://ullas-frontend.onrender.com',
    PUBLIC_APP_URL: 'https://ullas-frontend.onrender.com',
    SESSION_SECRET: 'a-long-unique-session-secret-for-tests-123456',
    ADMIN_BOOTSTRAP_SECRET: 'a-long-unique-admin-bootstrap-secret-987654',
    BREVO_API_KEY: 'xkeysib-test-key-with-sufficient-length-here',
    BREVO_FROM_EMAIL: 'ullas.noreply@gmail.com',
    COOKIE_SAME_SITE: 'lax',
    ...overrides,
  };
}

test('production configuration accepts a complete secure configuration', () => {
  const config = validateEnv(productionEnv());
  assert.equal(config.nodeEnv, 'production');
  assert.equal(config.cookieSameSite, 'lax');
});

test('production configuration rejects missing public app URL and weak secrets', () => {
  assert.throws(() => validateEnv(productionEnv({ PUBLIC_APP_URL: '' })), /PUBLIC_APP_URL/);
  assert.throws(() => validateEnv(productionEnv({ SESSION_SECRET: 'short' })), /SESSION_SECRET/);
  assert.throws(() => validateEnv(productionEnv({ ADMIN_BOOTSTRAP_SECRET: 'short' })), /ADMIN_BOOTSTRAP_SECRET/);
});

test('production configuration rejects insecure origins and placeholder email settings', () => {
  assert.throws(() => validateEnv(productionEnv({ FRONTEND_URL: 'http://ullas-frontend.onrender.com' })), /FRONTEND_URL/);
  assert.throws(() => validateEnv(productionEnv({ PUBLIC_APP_URL: 'https://ullas-frontend.onrender.com/path' })), /PUBLIC_APP_URL/);
  assert.throws(() => validateEnv(productionEnv({ PUBLIC_APP_URL: 'https://other-frontend.onrender.com' })), /trusted FRONTEND_URL/);
  assert.throws(() => validateEnv(productionEnv({ BREVO_API_KEY: 'short' })), /BREVO_API_KEY/);
  assert.throws(() => validateEnv(productionEnv({ BREVO_FROM_EMAIL: 'not-an-email' })), /BREVO_FROM_EMAIL/);
});
