import express from "express";
import session from "express-session";
import path from "path";
import { fileURLToPath } from "url";

import {
  db,
  run,
  get,
  all,
  ensureSchema,
  ensureMigratedFromKv,
} from "./db.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

app.set("trust proxy", 1);
app.use(express.json({ limit: "15mb" })); // base64 images can be large

app.use(
  session({
    secret: process.env.SESSION_SECRET || "caffeineyeon-secret",
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: "auto",
    },
  })
);

function requireAuth(req, res, next) {
  if (!req.session?.username) {
    return res.status(401).json({ ok: false, message: "로그인이 필요합니다." });
  }
  next();
}

function assertItemType(type) {
  if (type !== "beans" && type !== "recipes") {
    const err = new Error("Unknown type");
    err.status = 404;
    throw err;
  }
}

function sanitizeUser(row) {
  if (!row) return null;
  const { password, ...rest } = row;
  return rest;
}

// ---- boot: schema + migration (keeps existing kv data as backup) ----
await ensureSchema();
await ensureMigratedFromKv();

// ---- AUTH ----
app.get("/api/auth/me", requireAuth, async (req, res) => {
  const user = await get(
    "SELECT username,name,profileImage FROM users WHERE username=?",
    [req.session.username]
  );
  res.json({ ok: true, user: user || null });
});

app.post("/api/auth/signup", async (req, res) => {
  const { name, username, password } = req.body || {};
  if (!name || !username || !password) {
    return res.status(400).json({ ok: false, message: "모든 항목을 입력하세요." });
  }

  const exists = await get("SELECT 1 FROM users WHERE username=?", [username]);
  if (exists) {
    return res.status(409).json({ ok: false, message: "이미 존재하는 아이디입니다." });
  }

  await run(
    "INSERT INTO users(username,name,password,profileImage) VALUES(?,?,?,NULL)",
    [username, name, password]
  );

  req.session.username = username;
  res.json({ ok: true, user: { username, name, profileImage: null } });
});

app.post("/api/auth/login", async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ ok: false, message: "아이디와 비밀번호를 입력하세요." });
  }

  const user = await get(
    "SELECT username,name,profileImage FROM users WHERE username=? AND password=?",
    [username, password]
  );
  if (!user) {
    return res.status(401).json({ ok: false, message: "로그인 정보가 올바르지 않습니다." });
  }

  req.session.username = username;
  res.json({ ok: true, user });
});

app.post("/api/auth/logout", (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.put("/api/auth/me", requireAuth, async (req, res) => {
  const username = req.session.username;
  const { name, newUsername, currentPassword, newPassword, profileImage } = req.body || {};

  const user = await get("SELECT * FROM users WHERE username=?", [username]);
  if (!user) return res.status(404).json({ ok: false, message: "사용자를 찾을 수 없습니다." });

  // name/profile image
  if (typeof name === "string" && name.trim()) {
    await run("UPDATE users SET name=? WHERE username=?", [name.trim(), username]);
  }
  if (typeof profileImage === "string") {
    await run("UPDATE users SET profileImage=? WHERE username=?", [profileImage, username]);
  }

  // username change
  if (newUsername && newUsername !== username) {
    const taken = await get("SELECT 1 FROM users WHERE username=?", [newUsername]);
    if (taken) return res.status(409).json({ ok: false, message: "이미 존재하는 아이디입니다." });

    // update references
    await run("UPDATE users SET username=? WHERE username=?", [newUsername, username]);
    await run("UPDATE posts SET author=? WHERE author=?", [newUsername, username]);
    await run("UPDATE items SET author=? WHERE author=?", [newUsername, username]);
    await run("UPDATE reviews SET username=? WHERE username=?", [newUsername, username]);

    // session update
    req.session.username = newUsername;
  }

  // password change
  if (newPassword) {
    if (!currentPassword || currentPassword !== user.password) {
      return res.status(400).json({ ok: false, message: "현재 비밀번호가 일치하지 않습니다." });
    }
    await run("UPDATE users SET password=? WHERE username=?", [
      newPassword,
      req.session.username,
    ]);
  }

  const updated = await get(
    "SELECT username,name,profileImage FROM users WHERE username=?",
    [req.session.username]
  );
  res.json({ ok: true, user: updated });
});

// users list (no passwords)
app.get("/api/users", requireAuth, async (_req, res) => {
  const users = await all("SELECT username,name,profileImage FROM users ORDER BY name ASC");
  res.json({ ok: true, users });
});

// ---- POSTS (row-based) ----
app.get("/api/posts", requireAuth, async (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit || 200), 1), 1000);
  const rows = await all("SELECT * FROM posts ORDER BY id DESC LIMIT ?", [limit]);
  const posts = rows.map((p) => ({
    ...p,
    images: safeJsonParse(p.images, []),
  }));
  res.json({ ok: true, posts });
});

app.post("/api/posts", requireAuth, async (req, res) => {
  const { title, content, images, category } = req.body || {};
  if (!title || !content) {
    return res.status(400).json({ ok: false, message: "제목과 내용을 입력하세요." });
  }

  const id = Date.now();
  await run(
    `INSERT INTO posts(id,title,content,images,category,author,edited)
     VALUES(?,?,?,?,?,?,NULL)`,
    [
      id,
      String(title),
      String(content),
      JSON.stringify(Array.isArray(images) ? images : []),
      String(category || "free"),
      req.session.username,
    ]
  );
  res.json({ ok: true, id });
});

app.put("/api/posts/:id", requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  const { title, content, images, category } = req.body || {};
  if (!title || !content) {
    return res.status(400).json({ ok: false, message: "제목과 내용을 입력하세요." });
  }

  const r = await run(
    `UPDATE posts
     SET title=?, content=?, images=?, category=?, edited=?
     WHERE id=? AND author=?`,
    [
      String(title),
      String(content),
      JSON.stringify(Array.isArray(images) ? images : []),
      String(category || "free"),
      Date.now(),
      id,
      req.session.username,
    ]
  );

  if (r.changes === 0) {
    return res.status(403).json({ ok: false, message: "수정 권한이 없습니다." });
  }

  res.json({ ok: true });
});

app.delete("/api/posts/:id", requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  const r = await run("DELETE FROM posts WHERE id=? AND author=?", [
    id,
    req.session.username,
  ]);
  if (r.changes === 0) {
    return res.status(403).json({ ok: false, message: "삭제 권한이 없습니다." });
  }
  res.json({ ok: true });
});

// ---- ITEMS (beans/recipes) + REVIEWS (row-based) ----
app.get("/api/items/:type", requireAuth, async (req, res) => {
  const type = req.params.type;
  assertItemType(type);

  const limit = Math.min(Math.max(Number(req.query.limit || 500), 1), 2000);
  const items = await all(
    "SELECT id,name,info,author,edited FROM items WHERE type=? ORDER BY id DESC LIMIT ?",
    [type, limit]
  );

  // fetch all reviews for returned items in one query
  const ids = items.map((it) => it.id);
  let reviewsByKey = new Map();
  if (ids.length) {
    const placeholders = ids.map(() => "?").join(",");
    const revs = await all(
      `SELECT itemType,itemId,username,rating,text,edited
       FROM reviews
       WHERE itemType=? AND itemId IN (${placeholders})`,
      [type, ...ids]
    );

    for (const r of revs) {
      const k = String(r.itemId);
      const cur = reviewsByKey.get(k) || {};
      cur[r.username] = {
        id: r.edited || Date.now(),
        edited: r.edited || null,
        rating: r.rating,
        text: r.text,
      };
      reviewsByKey.set(k, cur);
    }
  }

  const data = items.map((it) => ({
    ...it,
    reviews: reviewsByKey.get(String(it.id)) || {},
  }));

  res.json({ ok: true, data });
});

app.post("/api/items/:type", requireAuth, async (req, res) => {
  const type = req.params.type;
  assertItemType(type);

  const { id, name, info } = req.body || {};
  if (!name) return res.status(400).json({ ok: false, message: "이름을 입력하세요." });

  const newId = Number(id) || Date.now();
  await run(
    `INSERT INTO items(id,type,name,info,author,edited)
     VALUES(?,?,?,?,?,NULL)`,
    [newId, type, String(name), String(info || ""), req.session.username]
  );

  res.json({ ok: true, id: newId });
});

app.put("/api/items/:type/:id", requireAuth, async (req, res) => {
  const type = req.params.type;
  assertItemType(type);

  const id = Number(req.params.id);
  const { name, info } = req.body || {};
  if (!name) return res.status(400).json({ ok: false, message: "이름을 입력하세요." });

  const r = await run(
    `UPDATE items
     SET name=?, info=?, edited=?
     WHERE id=? AND type=? AND author=?`,
    [String(name), String(info || ""), Date.now(), id, type, req.session.username]
  );

  if (r.changes === 0) {
    return res.status(403).json({ ok: false, message: "수정 권한이 없습니다." });
  }
  res.json({ ok: true });
});

app.delete("/api/items/:type/:id", requireAuth, async (req, res) => {
  const type = req.params.type;
  assertItemType(type);

  const id = Number(req.params.id);
  // ensure author matches
  const r = await run("DELETE FROM items WHERE id=? AND type=? AND author=?", [
    id,
    type,
    req.session.username,
  ]);
  if (r.changes === 0) {
    return res.status(403).json({ ok: false, message: "삭제 권한이 없습니다." });
  }
  // delete associated reviews
  await run("DELETE FROM reviews WHERE itemType=? AND itemId=?", [type, id]);

  res.json({ ok: true });
});

// upsert review for current user
app.put("/api/items/:type/:id/reviews", requireAuth, async (req, res) => {
  const type = req.params.type;
  assertItemType(type);

  const itemId = Number(req.params.id);
  const { rating, text } = req.body || {};
  const r = Number(rating);
  const t = String(text || "").trim();
  if (!r || r < 1 || r > 5 || !t) {
    return res
      .status(400)
      .json({ ok: false, message: "별점과 코멘트를 모두 입력하세요." });
  }

  // ensure item exists
  const item = await get("SELECT 1 FROM items WHERE id=? AND type=?", [itemId, type]);
  if (!item) return res.status(404).json({ ok: false, message: "항목을 찾을 수 없습니다." });

  const edited = Date.now();
  await run(
    `INSERT INTO reviews(itemType,itemId,username,rating,text,edited)
     VALUES(?,?,?,?,?,?)
     ON CONFLICT(itemType,itemId,username) DO UPDATE SET
       rating=excluded.rating, text=excluded.text, edited=excluded.edited`,
    [type, itemId, req.session.username, r, t, edited]
  );

  res.json({ ok: true });
});

app.delete("/api/items/:type/:id/reviews", requireAuth, async (req, res) => {
  const type = req.params.type;
  assertItemType(type);

  const itemId = Number(req.params.id);
  await run(
    "DELETE FROM reviews WHERE itemType=? AND itemId=? AND username=?",
    [type, itemId, req.session.username]
  );
  res.json({ ok: true });
});

// ---- Google Sheets export (localStorage-like) ----
const EXPORT_TOKEN = process.env.EXPORT_TOKEN;
app.get("/api/admin/export", async (req, res) => {
  const token = req.query.token;
  if (!EXPORT_TOKEN || token !== EXPORT_TOKEN) {
    return res.status(403).json({ ok: false, message: "forbidden" });
  }

  const users = await all("SELECT username,name,profileImage FROM users ORDER BY username");
  const postsRows = await all("SELECT * FROM posts ORDER BY id DESC");
  const itemsBeans = await all("SELECT id,name,info,author,edited FROM items WHERE type='beans' ORDER BY id DESC");
  const itemsRecipes = await all("SELECT id,name,info,author,edited FROM items WHERE type='recipes' ORDER BY id DESC");

  const beans = await attachReviews(itemsBeans, "beans");
  const recipes = await attachReviews(itemsRecipes, "recipes");

  const posts = postsRows.map(p => ({
    id: p.id,
    edited: p.edited || null,
    title: p.title,
    content: p.content,
    images: safeJsonParse(p.images, []),
    category: p.category,
    author: p.author
  }));

  res.json({
    ok: true,
    exportedAt: new Date().toISOString(),
    rows: [
      { key: "users", value: JSON.stringify(users) },
      { key: "data:beans", value: JSON.stringify(beans) },
      { key: "data:recipes", value: JSON.stringify(recipes) },
      { key: "data:posts", value: JSON.stringify(posts) },
    ],
  });
});

// helpers used above
function safeJsonParse(s, fallback) {
  try {
    const v = JSON.parse(s);
    return v ?? fallback;
  } catch {
    return fallback;
  }
}

async function attachReviews(items, type) {
  const ids = items.map(i => i.id);
  if (!ids.length) return items.map(i => ({...i, reviews: {}}));

  const placeholders = ids.map(() => "?").join(",");
  const revs = await all(
    `SELECT itemId,username,rating,text,edited FROM reviews
     WHERE itemType=? AND itemId IN (${placeholders})`,
    [type, ...ids]
  );

  const map = new Map();
  for (const r of revs) {
    const k = String(r.itemId);
    const cur = map.get(k) || {};
    cur[r.username] = { id: r.edited || Date.now(), edited: r.edited || null, rating: r.rating, text: r.text };
    map.set(k, cur);
  }

  return items.map(i => ({...i, reviews: map.get(String(i.id)) || {}}));
}

// ---- Error handler ----
app.use((err, _req, res, _next) => {
  const status = err.status || 500;
  res.status(status).json({ ok: false, message: err.message || "server error" });
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`CaffeineYeon server listening on ${port}`));
