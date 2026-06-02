/* Tiny JSON store under data/_store/ (gitignored, never web-served).
   Interim persistence before Postgres. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const STORE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data', '_store');

function file(name) { return path.join(STORE, name); }
function ensure() { fs.mkdirSync(STORE, { recursive: true }); }

export function read(name, fallback = []) {
  try { return JSON.parse(fs.readFileSync(file(name), 'utf8')); }
  catch { return fallback; }
}
export function write(name, data) {
  ensure();
  fs.writeFileSync(file(name), JSON.stringify(data, null, 2));
}
export function append(name, item) {
  const arr = read(name, []);
  arr.push(item);
  write(name, arr);
  return arr.length;
}
export function exists(name) { return fs.existsSync(file(name)); }
