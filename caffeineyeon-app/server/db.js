import sqlite3 from "sqlite3";
import path from "node:path";
import fs from "node:fs";


// 1) verbose는 1번만, DB 열기 전에
sqlite3.verbose();

// 2) Persistent Disk 경로(기본값 /data/...)
export const dbPath = process.env.DB_PATH || "/data/caffeineyeon.sqlite";

// 3) 폴더 없으면 생성 (Render에서 /data 마운트됐다면 보통 존재하지만 안전하게)
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

// 4) DB는 한 번만 열어서 공유
export const db = new sqlite3.Database(dbPath);

// 5) 초기 테이블 생성도 이 인스턴스에서 수행
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS kv (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `);
});

export function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) return reject(err);
      resolve(this);
    });
  });
}

export function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, function (err, row) {
      if (err) return reject(err);
      resolve(row);
    });
  });
}

export async function getJSON(key, fallback) {
  const row = await get("SELECT value FROM kv WHERE key = ?", [key]);
  if (!row) return fallback;
  try {
    return JSON.parse(row.value);
  } catch {
    return fallback;
  }
}

export async function setJSON(key, value) {
  const raw = JSON.stringify(value);
  await run(
    "INSERT INTO kv(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
    [key, raw]
  );
}
