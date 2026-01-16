import sqlite3 from 'sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// If you add a Render Persistent Disk, set DB_PATH to the mounted path.
const dbPath = process.env.DB_PATH || path.join(__dirname, '..', 'data.sqlite');

export function openDb() {
  sqlite3.verbose();
  const db = new sqlite3.Database(dbPath);

  db.serialize(() => {
    db.run(
      `CREATE TABLE IF NOT EXISTS kv (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      )`
    );
  });

  return db;
}

export function run(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) return reject(err);
      resolve(this);
    });
  });
}

export function get(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, function (err, row) {
      if (err) return reject(err);
      resolve(row);
    });
  });
}

export async function getJSON(db, key, fallback) {
  const row = await get(db, 'SELECT value FROM kv WHERE key = ?', [key]);
  if (!row) return fallback;
  try {
    return JSON.parse(row.value);
  } catch {
    return fallback;
  }
}

export async function setJSON(db, key, value) {
  const raw = JSON.stringify(value);
  await run(
    db,
    'INSERT INTO kv(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',
    [key, raw]
  );
}

export { dbPath };
