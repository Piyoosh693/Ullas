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
    RESEND_API_KEY: 're_test_key_with_sufficient_length',
    RESEND_FROM_EMAIL: 'Ullas <no-reply@ullas.org>',
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
  assert.throws(() => validateEnv(productionEnv({ RESEND_FROM_EMAIL: 'Ullas <no-reply@example.com>' })), /RESEND_FROM_EMAIL/);
  assert.throws(() => validateEnv(productionEnv({ RESEND_API_KEY: 're_replace_me' })), /RESEND_API_KEY/);
});
