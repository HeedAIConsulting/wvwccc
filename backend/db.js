/* Postgres pool — active when DATABASE_URL is set (production).
   When unset (dev), the app falls back to the JSON store. */
import pg from 'pg';

const url = process.env.DATABASE_URL;
export const enabled = !!url;

let pool = null;
if (enabled) {
  pool = new pg.Pool({
    connectionString: url,
    // Render/Supabase/Neon managed Postgres require SSL.
    ssl: process.env.PGSSL === 'disable' ? false : { rejectUnauthorized: false },
    max: 10,
    idleTimeoutMillis: 30000,
  });
  pool.on('error', (e) => console.error('[pg] pool error', e.message));
}

export function query(text, params) {
  if (!pool) throw new Error('DATABASE_URL not configured');
  return pool.query(text, params);
}
export async function end() { if (pool) await pool.end(); }
