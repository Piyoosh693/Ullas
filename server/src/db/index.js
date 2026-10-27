const { Pool } = require('pg');
const fs = require('node:fs/promises');
const path = require('node:path');

let pool;

function isTestMode() {
  return process.env.NODE_ENV === 'test' && !process.env.DATABASE_URL;
}

function getPool() {
  if (!process.env.DATABASE_URL) {
    if (isTestMode()) return null;
    const error = new Error('DATABASE_URL is required. Ullas does not use in-memory storage outside tests.');
    error.code = 'DATABASE_URL_REQUIRED';
    throw error;
  }
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: Number(process.env.PGPOOL_MAX || 10),
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
      ssl: process.env.PGSSL === 'disable' ? false : (process.env.PGSSL === 'require' ? { rejectUnauthorized: false } : undefined),
    });
    pool.on('error', (error) => console.error('Unexpected PostgreSQL pool error', { code: error.code || 'PG_POOL_ERROR', ...(process.env.NODE_ENV === 'production' ? {} : { message: error.message }) }));
  }
  return pool;
}

async function query(text, values = []) {
  const db = getPool();
  if (!db) throw new Error('Database queries are unavailable in memory-only tests.');
  return db.query(text, values);
}

async function withTransaction(callback) {
  const db = getPool();
  if (!db) throw new Error('Database transactions require DATABASE_URL.');
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function testConnection() {
  if (!process.env.DATABASE_URL) return { ok: false, reason: 'DATABASE_URL is not configured' };
  try {
    const result = await query(`
      SELECT
        to_regclass('public.users') IS NOT NULL AS users_ready,
        to_regclass('public.schema_migrations') IS NOT NULL AS migrations_ready,
        to_regclass('public.bookings') IS NOT NULL AS bookings_ready,
        to_regclass('public.availability_windows') IS NOT NULL AS availability_ready,
        to_regclass('public.email_outbox') IS NOT NULL AS outbox_ready,
        to_regclass('public.profiles') IS NOT NULL AS profiles_ready
    `);
    const missing = Object.entries(result.rows[0]).filter(([, ready]) => !ready).map(([name]) => name);
    if (missing.length) return { ok: false, reason: 'Database schema is incomplete', missing };
    const migrations = await query('SELECT id FROM schema_migrations');
    const applied = new Set(migrations.rows.map((row) => row.id));
    const expected = ['001_core.sql', '002_legacy_compat.sql', '003_integrity.sql', '004_booking_integrity.sql'];
    const pending = expected.filter((name) => !applied.has(name));
    if (pending.length) return { ok: false, reason: 'Database migrations are incomplete', pending };
    return { ok: true };
  } catch {
    return { ok: false, reason: 'Database connection or schema check failed' };
  }
}

async function runMigrations() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required to run migrations.');
  const db = getPool();
  const client = await db.connect();
  let locked = false;
  try {
    await client.query('SELECT pg_advisory_lock(182736451)');
    locked = true;
    await client.query('CREATE TABLE IF NOT EXISTS schema_migrations (id TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW())');
    const dir = path.join(__dirname, 'migrations');
    const files = (await fs.readdir(dir)).filter((name) => /^\d+_[a-z0-9_-]+\.sql$/i.test(name)).sort();
    for (const file of files) {
      const found = await client.query('SELECT 1 FROM schema_migrations WHERE id = $1', [file]);
      if (found.rowCount) continue;
      const sql = await fs.readFile(path.join(dir, file), 'utf8');
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (id) VALUES ($1)', [file]);
        await client.query('COMMIT');
        console.log(`Applied migration ${file}`);
      } catch (error) {
        await client.query('ROLLBACK');
        throw new Error(`Migration ${file} failed: ${error.message}`);
      }
    }
  } finally {
    if (locked) await client.query('SELECT pg_advisory_unlock(182736451)').catch(() => {});
    client.release();
  }
}

async function closePool() {
  if (pool) {
    const current = pool;
    pool = undefined;
    await current.end();
  }
}

module.exports = { getPool, getClient: getPool, query, withTransaction, testConnection, runMigrations, closePool, isTestMode };
