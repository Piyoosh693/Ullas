require('dotenv').config({ path: require('node:path').resolve(__dirname, '../../.env') });
const { dispatchOutboxBatch } = require('../src/email');
const { closePool } = require('../src/db');
dispatchOutboxBatch(100).then((result) => console.log(JSON.stringify(result))).catch((error) => { console.error(error.message); process.exitCode = 1; }).finally(() => closePool());
