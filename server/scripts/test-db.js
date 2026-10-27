// Explicit smoke test for a disposable PostgreSQL database.
// Safety: only accepts a database whose name contains "test" or "ci".
const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) {
  console.error('Set TEST_DATABASE_URL to a disposable PostgreSQL database whose name contains test or ci.');
  process.exit(2);
}
let databaseName = '';
try {
  const parsed = new URL(databaseUrl);
  if (!/^postgres(?:ql)?:$/.test(parsed.protocol)) throw new Error('Not a PostgreSQL URL');
  databaseName = decodeURIComponent(parsed.pathname.replace(/^\//, '')).toLowerCase();
} catch {
  console.error('TEST_DATABASE_URL must be a valid PostgreSQL URL.');
  process.exit(2);
}
if (!/(^|[_-])(test|ci)([_-]|$)/.test(databaseName)) {
  console.error('Refusing to run DB smoke test: database name must contain test or ci. Do not use production.');
  process.exit(2);
}
process.env.DATABASE_URL = databaseUrl;
process.env.NODE_ENV = 'test-db';
if (process.env.TEST_PGSSL) process.env.PGSSL = process.env.TEST_PGSSL;
const { runMigrations, testConnection, query, withTransaction, closePool } = require('../src/db');
const { randomUUID } = require('node:crypto');
(async () => {
  try {
    await runMigrations();
    const readiness = await testConnection();
    if (!readiness.ok) throw new Error(`PostgreSQL readiness failed: ${JSON.stringify(readiness)}`);
    const providerId = randomUUID();
    const bookerId = randomUUID();
    const offerId = randomUUID();
    const windowId = randomUUID();
    const bookingId = randomUUID();
    const base = new Date(Date.now() + 72 * 60 * 60 * 1000);
    const end = new Date(base.getTime() + 2 * 60 * 60 * 1000);
    const email = `db-smoke-${providerId}@example.test`;
    await withTransaction(async (client) => {
      await client.query('INSERT INTO users(id,email,password_hash,role,email_verified,name,status) VALUES($1,$2,$3,$4,TRUE,$5,$6),($7,$8,$3,$4,TRUE,$9,$6)', [providerId,email,'not-a-real-password-hash','user','DB smoke provider','active',bookerId,`db-booker-${bookerId}@example.test`,'DB smoke booker']);
      await client.query("INSERT INTO offers(id,user_id,title,description,status) VALUES($1,$2,'DB smoke offer','Test-only data for database integrity validation','published')", [offerId,providerId]);
      await client.query('INSERT INTO availability_windows(id,user_id,starts_at,ends_at) VALUES($1,$2,$3,$4)', [windowId,providerId,base.toISOString(),end.toISOString()]);
      const check = await client.query('SELECT id,email FROM users WHERE id=$1 AND email=$2', [providerId,email]);
      if (check.rowCount !== 1) throw new Error('Could not read back a test row.');
      await client.query('INSERT INTO bookings(id,offer_id,user_id,slot_start,slot_end,status) VALUES($1,$2,$3,$4,$5,$6)', [bookingId,offerId,bookerId,new Date(base.getTime()+15*60_000).toISOString(),new Date(base.getTime()+45*60_000).toISOString(),'requested']);
      await client.query('SAVEPOINT booking_overlap_probe');
      let bookingOverlapRejected = false;
      try {
        await client.query('INSERT INTO bookings(id,offer_id,user_id,slot_start,slot_end,status) VALUES($1,$2,$3,$4,$5,$6)', [randomUUID(),offerId,bookerId,new Date(base.getTime()+30*60_000).toISOString(),new Date(base.getTime()+60*60_000).toISOString(),'requested']);
      } catch (error) {
        if (error.code !== '23P01') throw error;
        bookingOverlapRejected = true;
        await client.query('ROLLBACK TO SAVEPOINT booking_overlap_probe');
      }
      if (!bookingOverlapRejected) throw new Error('Database did not reject an overlapping active booking.');
      await client.query('SAVEPOINT availability_overlap_probe');
      let availabilityOverlapRejected = false;
      try {
        await client.query('INSERT INTO availability_windows(id,user_id,starts_at,ends_at) VALUES($1,$2,$3,$4)', [randomUUID(),providerId,new Date(base.getTime()+30*60_000).toISOString(),new Date(end.getTime()+30*60_000).toISOString()]);
      } catch (error) {
        if (error.code !== '23P01') throw error;
        availabilityOverlapRejected = true;
        await client.query('ROLLBACK TO SAVEPOINT availability_overlap_probe');
      }
      if (!availabilityOverlapRejected) throw new Error('Database did not reject overlapping availability windows.');
      await client.query('DELETE FROM users WHERE id IN ($1,$2)', [providerId,bookerId]);
    });
    console.log('PostgreSQL smoke test passed: migrations, readiness, CRUD, booking exclusion, and availability exclusion.');
  } catch (error) {
    console.error('PostgreSQL smoke test failed:', error.message);
    process.exitCode = 1;
  } finally {
    await closePool();
  }
})();
