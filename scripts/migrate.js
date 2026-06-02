#!/usr/bin/env node
/* Apply backend/schema.sql to the Postgres at DATABASE_URL. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as db from '../backend/db.js';

if (!db.enabled) {
  console.error('DATABASE_URL is not set — nothing to migrate. (Dev uses the JSON store.)');
  process.exit(1);
}
const schema = fs.readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'backend', 'schema.sql'), 'utf8');

try {
  await db.query(schema); // multi-statement simple query
  console.log('✓ Schema applied to', process.env.DATABASE_URL.replace(/:\/\/.*@/, '://***@'));
} catch (e) {
  console.error('migration failed:', e.message);
  process.exitCode = 1;
} finally {
  await db.end();
}
