import sqlite3 from "sqlite3";
import path from "node:path";
import fs from "node:fs";

sqlite3.verbose();

export const dbPath = process.env.DB_PATH || "/data/caffeineyeon.sqlite";
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

export const db = new sqlite3.Database(dbPath);

// ===== 테이블 생성 =====
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      username TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      password TEXT NOT NULL,
      profileImage TEXT
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS posts (
      id INTEGER PRIMARY KEY,
      title TEXT,
      content TEXT,
      images TEXT,
      category TEXT,
      author TEXT,
      edited INTEGER
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS beans (
      id INTEGER PRIMARY KEY,
      name TEXT,
      info TEXT,
      author TEXT,
      edited INTEGER
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS recipes (
      id INTEGER PRIMARY KEY,
      name TEXT,
      info TEXT,
      author TEXT,
      edited INTEGER
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS reviews (
      itemType TEXT,
      itemId INTEGER,
      username TEXT,
      rating INTEGER,
      text TEXT,
      edited INTEGER,
      PRIMARY KEY (itemType, itemId, username)
    )
  `);

  // 마이그레이션 완료 플래그
  db.run(`
    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT
    )
  `);
});

// ===== Promise helpers =====
export function run(sql, params = []) {
  return new Promise((res, rej) =>
    db.run(sql, params, function (err) {
      if (err) rej(err);
      else res(this);
    })
  );
}

export function get(sql, params = []) {
  return new Promise((res, rej) =>
    db.get(sql, params, (err, row) => (err ? rej(err) : res(row)))
  );
}

export function all(sql, params = []) {
  return new Promise((res, rej) =>
    db.all(sql, params, (err, rows) => (err ? rej(err) : res(rows)))
  );
}
