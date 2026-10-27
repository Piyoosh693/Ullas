const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const testsDir = path.join(__dirname, '..', 'tests');
const files = fs.readdirSync(testsDir).filter((name) => name.endsWith('.test.js')).map((name) => path.join(testsDir, name));
const result = spawnSync(process.execPath, ['--test', ...files], { stdio: 'inherit', env: { ...process.env, NODE_ENV: 'test', DATABASE_URL: '' } });
process.exit(result.status === null ? 1 : result.status);
