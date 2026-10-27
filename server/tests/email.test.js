const test = require('node:test');
const assert = require('node:assert/strict');
const { v4: uuidv4 } = require('uuid');
const repo = require('../src/db/repositories');
const { emailUser } = require('../src/notifications-service');
const { getTestOutbox } = require('../src/email');

test('activity emails require verified active account and escape dynamic HTML', async () => {
  const activeId = uuidv4();
  await repo.createUser({ id: activeId, email: `email-${activeId}@example.test`, password: 'test-hash', role: 'user', status: 'active', verified: true, name: 'Email Test' });
  const eventKey = `email-test:${activeId}`;
  await emailUser(activeId, { subject: 'Test message', title: '<img src=x onerror=alert(1)>', message: 'Hello <script>alert(1)</script>', path: '/activity', eventKey });
  const message = getTestOutbox().find((item) => item.eventKey === eventKey);
  assert.ok(message, 'email was queued in test mode');
  assert.ok(message.html.includes('&lt;img src=x onerror=alert(1)&gt;'));
  assert.ok(message.html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
  assert.ok(!message.html.includes('<script>'));

  await emailUser(activeId, { subject: 'duplicate', title: 'Duplicate', message: 'Should not duplicate this event', eventKey });
  assert.equal(getTestOutbox().filter((item) => item.eventKey === eventKey).length, 1, 'event key deduplicates repeat requests');
});

test('activity email is not queued for an unverified account', async () => {
  const id = uuidv4();
  await repo.createUser({ id, email: `unverified-${id}@example.test`, password: 'test-hash', role: 'user', status: 'active', verified: false, name: 'Unverified' });
  const eventKey = `email-unverified:${id}`;
  await emailUser(id, { subject: 'Test', title: 'Test', message: 'Test', eventKey });
  assert.equal(getTestOutbox().some((item) => item.eventKey === eventKey), false);
});
