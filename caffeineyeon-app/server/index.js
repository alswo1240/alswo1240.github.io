import express from "express";
import session from "express-session";
import path from "path";
import { fileURLToPath } from "url";
import { db, run, get, all } from "./db.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();

app.set("trust proxy", 1);
app.use(express.json({ limit: "10mb" }));

app.use(
  session({
    secret: process.env.SESSION_SECRET || "caffeineyeon-secret",
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, sameSite: "lax", secure: "auto" },
  })
);

function requireAuth(req, res, next) {
  if (!req.session.username)
    return res.status(401).json({ message: "로그인이 필요합니다." });
  next();
}

/* ================= AUTH ================= */

app.post("/api/auth/login", async (req, res) => {
  const { username, password } = req.body;
  const user = await get(
    "SELECT username,name,profileImage FROM users WHERE username=? AND password=?",
    [username, password]
  );
  if (!user) return res.status(401).json({ message: "로그인 실패" });

  req.session.username = user.username;
  res.json({ user });
});

app.get("/api/auth/me", async (req, res) => {
  if (!req.session.username) return res.json({ user: null });
  const user = await get(
    "SELECT username,name,profileImage FROM users WHERE username=?",
    [req.session.username]
  );
  res.json({ user });
});

/* ================= POSTS ================= */

// 목록 (최근 N개)
app.get("/api/posts", requireAuth, async (req, res) => {
  const limit = Number(req.query.limit || 50);
  const rows = await all(
    "SELECT * FROM posts ORDER BY id DESC LIMIT ?",
    [limit]
  );
  res.json({ posts: rows.map(p => ({ ...p, images: JSON.parse(p.images || "[]") })) });
});

// 추가
app.post("/api/posts", requireAuth, async (req, res) => {
  const { title, content, images, category } = req.body;
  const id = Date.now();
  await run(
    `INSERT INTO posts(id,title,content,images,category,author,edited)
     VALUES(?,?,?,?,?,?,NULL)`,
    [id, title, content, JSON.stringify(images || []), category, req.session.username]
  );
  res.json({ id });
});

// 수정
app.put("/api/posts/:id", requireAuth, async (req, res) => {
  const { title, content, images, category } = req.body;
  await run(
    `UPDATE posts SET title=?,content=?,images=?,category=?,edited=?
     WHERE id=? AND author=?`,
    [
      title,
      content,
      JSON.stringify(images || []),
      category,
      Date.now(),
      req.params.id,
      req.session.username,
    ]
  );
  res.json({ ok: true });
});

// 삭제
app.delete("/api/posts/:id", requireAuth, async (req, res) => {
  await run(
    "DELETE FROM posts WHERE id=? AND author=?",
    [req.params.id, req.session.username]
  );
  res.json({ ok: true });
});

/* ================= STATIC ================= */

const publicDir = path.join(__dirname, "..", "public");
app.use(express.static(publicDir));
app.get(/^\/(?!api).*/, (req, res) =>
  res.sendFile(path.join(publicDir, "index.html"))
);

app.listen(process.env.PORT || 3000, () =>
  console.log("Server running")
);
