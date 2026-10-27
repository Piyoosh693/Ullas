const test = require('node:test');
const assert = require('node:assert/strict');
const app = require('../src/app');

const server = app.listen(0);

test('GET /api/health returns healthy status', async () => {
  const port = server.address().port;
  const response = await fetch(`http://127.0.0.1:${port}/api/health`);
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.status, 'healthy');
  assert.equal(payload.service, 'ullas-api');
});

test.after(async () => {
  await new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) return reject(error);
      resolve();
    });
  });
});
