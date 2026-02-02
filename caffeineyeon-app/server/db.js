import sqlite3 from "sqlite3";
import path from "node:path";
import fs from "node:fs";

sqlite3.verbose();

export const dbPath = process.env.DB_PATH || "/data/caffeineyeon.sqlite";
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

export const db = new sqlite3.Database(dbPath);

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

export function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, function (err, rows) {
      if (err) return reject(err);
      resolve(rows);
    });
  });
}

// Legacy kv helpers (keep for migration + backwards safety)
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

export async function ensureSchema() {
  // keep kv table (existing deployments already use it)
  await run(`
    CREATE TABLE IF NOT EXISTS kv (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `);

  // New normalized tables
  await run(`
    CREATE TABLE IF NOT EXISTS users (
      username TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      password TEXT NOT NULL,
      profileImage TEXT
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS posts (
      id INTEGER PRIMARY KEY,
      edited INTEGER,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      images TEXT NOT NULL,
      category TEXT NOT NULL,
      author TEXT NOT NULL
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS items (
      id INTEGER PRIMARY KEY,
      type TEXT NOT NULL,   -- 'beans' | 'recipes'
      name TEXT NOT NULL,
      info TEXT NOT NULL,
      author TEXT NOT NULL,
      edited INTEGER
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS reviews (
      itemType TEXT NOT NULL,
      itemId INTEGER NOT NULL,
      username TEXT NOT NULL,
      rating INTEGER NOT NULL,
      text TEXT NOT NULL,
      edited INTEGER,
      PRIMARY KEY (itemType, itemId, username)
    )
  `);

  // helpful indexes
  await run(`CREATE INDEX IF NOT EXISTS idx_items_type ON items(type)`);
  await run(`CREATE INDEX IF NOT EXISTS idx_reviews_item ON reviews(itemType, itemId)`);
  await run(`CREATE INDEX IF NOT EXISTS idx_posts_author ON posts(author)`);
}

// One-time migration from legacy kv JSON into row-based tables.
// Keeps kv as backup; sets meta.migrated_v2 flag.
export async function ensureMigratedFromKv() {
  const flag = await get("SELECT value FROM meta WHERE key='migrated_v2'");
  if (flag?.value === "1") return;

  // If kv doesn't have expected keys, still set flag to avoid repeated scans
  const users = await getJSON("users", null);
  const beans = await getJSON("data:beans", null);
  const recipes = await getJSON("data:recipes", null);
  const posts = await getJSON("data:posts", null);

  // migrate users
  if (Array.isArray(users)) {
    for (const u of users) {
      if (!u?.username || !u?.password || !u?.name) continue;
      await run(
        `INSERT OR IGNORE INTO users(username,name,password,profileImage)
         VALUES(?,?,?,?)`,
        [u.username, u.name, u.password, u.profileImage || null]
      );
    }
  }

  // migrate items + reviews
  await migrateItemsWithReviews_("beans", beans);
  await migrateItemsWithReviews_("recipes", recipes);

  // migrate posts
  if (Array.isArray(posts)) {
    for (const p of posts) {
      if (!p?.id || !p?.title || !p?.content || !p?.author) continue;
      const images = Array.isArray(p.images) ? p.images : [];
      await run(
        `INSERT OR IGNORE INTO posts(id,edited,title,content,images,category,author)
         VALUES(?,?,?,?,?,?,?)`,
        [
          Number(p.id),
          p.edited || null,
          String(p.title),
          String(p.content),
          JSON.stringify(images),
          String(p.category || "free"),
          String(p.author),
        ]
      );
    }
  }

  await run("INSERT OR REPLACE INTO meta(key,value) VALUES('migrated_v2','1')");
}

async function migrateItemsWithReviews_(type, arr) {
  if (!Array.isArray(arr)) return;

  const mappedType = type === "beans" ? "beans" : "recipes";

  for (const it of arr) {
    if (!it?.id || !it?.name) continue;

    await run(
      `INSERT OR IGNORE INTO items(id,type,name,info,author,edited)
       VALUES(?,?,?,?,?,?)`,
      [
        Number(it.id),
        mappedType,
        String(it.name),
        String(it.info || ""),
        String(it.author || ""),
        it.edited || null,
      ]
    );

    const reviews = it.reviews && typeof it.reviews === "object" ? it.reviews : {};
    for (const [username, r] of Object.entries(reviews)) {
      if (!username || !r) continue;
      const rating = Number(r.rating || r.stars || 0);
      const text = String(r.text || "");
      if (!rating || !text) continue;

      await run(
        `INSERT OR REPLACE INTO reviews(itemType,itemId,username,rating,text,edited)
         VALUES(?,?,?,?,?,?)`,
        [
          mappedType,
          Number(it.id),
          String(username),
          rating,
          text,
          r.edited || null,
        ]
      );
    }
  }
}
