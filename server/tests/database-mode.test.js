const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

test('non-test execution refuses to silently fall back to in-memory application data', () => {
  const script = `
    process.env.NODE_ENV = 'production';
    delete process.env.DATABASE_URL;
    const repo = require(${JSON.stringify(path.resolve(__dirname, '../src/db/repositories.js'))});
    repo.findUserByEmail('person@example.test').then(() => process.exit(10)).catch((error) => {
      process.stdout.write(String(error.code || 'NO_CODE'));
      process.exit(error.code === 'DATABASE_URL_REQUIRED' ? 0 : 11);
    });
  `;
  const result = spawnSync(process.execPath, ['-e', script], { encoding: 'utf8', env: { ...process.env, DATABASE_URL: '' } });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(result.stdout, 'DATABASE_URL_REQUIRED');
});
