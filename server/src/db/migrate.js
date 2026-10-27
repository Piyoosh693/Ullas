require('dotenv').config({ path: require('node:path').resolve(__dirname, '../../../.env') });
const { runMigrations, closePool } = require('./index');
runMigrations()
  .then(() => console.log('Database migrations complete.'))
  .catch((error) => { console.error(error.message); process.exitCode = 1; })
  .finally(() => closePool());
