const test = require('node:test');
const assert = require('node:assert/strict');
const app = require('../src/app');

const server = app.listen(0);

test('render status route works', async () => {
  const port = server.address().port;
  const response = await fetch(`http://127.0.0.1:${port}/api/render/status`);
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.service, 'ullas-api');
  assert.equal(payload.deploymentTarget, 'render');
});

test.after(async () => {
  await new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) return reject(error);
      resolve();
    });
  });
});
