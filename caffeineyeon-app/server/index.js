import express from 'express';
import session from 'express-session';
import path from 'path';
import { fileURLToPath } from 'url';
import { openDb, getJSON, setJSON } from './db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const db = openDb();

app.set('trust proxy', 1);

app.use(express.json({ limit: '10mb' })); // allow base64 images

// Session cookie (in-memory store). For small club use it's OK.
app.use(
  session({
    secret: process.env.SESSION_SECRET || 'caffeineyeon-secret',
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: 'auto'
    }
  })
);

// --- Helpers ---
const DATA_KEYS = new Set(['beans', 'recipes', 'posts']);

async function ensureDefaults() {
  const users = await getJSON(db, 'users', null);
  if (!users) await setJSON(db, 'users', []);

  for (const k of DATA_KEYS) {
    const v = await getJSON(db, `data:${k}`, null);
    if (!v) await setJSON(db, `data:${k}`, []);
  }
}

function requireAuth(req, res, next) {
  if (!req.session?.username) {
    return res.status(401).json({ ok: false, message: '로그인이 필요합니다.' });
  }
  next();
}

function sanitizeUser(u) {
  const { password, ...rest } = u;
  return rest;
}

await ensureDefaults();

// --- Auth ---
app.get('/api/auth/me', async (req, res) => {
  const username = req.session?.username;
  if (!username) return res.json({ ok: true, user: null });

  const users = await getJSON(db, 'users', []);
  const user = users.find(u => u.username === username);
  if (!user) {
    req.session.destroy(() => {});
    return res.json({ ok: true, user: null });
  }
  res.json({ ok: true, user: sanitizeUser(user) });
});

app.post('/api/auth/signup', async (req, res) => {
  const { name, username, password } = req.body || {};
  if (!name || !username || !password) {
    return res.status(400).json({ ok: false, message: '모든 항목을 입력하세요.' });
  }

  const users = await getJSON(db, 'users', []);
  if (users.find(u => u.username === username)) {
    return res.status(409).json({ ok: false, message: '이미 존재하는 아이디입니다.' });
  }

  const newUser = { name, username, password, profileImage: null };
  users.push(newUser);
  await setJSON(db, 'users', users);

  req.session.username = username;
  res.json({ ok: true, user: sanitizeUser(newUser) });
});

app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ ok: false, message: '아이디와 비밀번호를 입력하세요.' });
  }

  const users = await getJSON(db, 'users', []);
  const user = users.find(u => u.username === username && u.password === password);
  if (!user) {
    return res.status(401).json({ ok: false, message: '로그인 정보가 올바르지 않습니다.' });
  }

  req.session.username = username;
  res.json({ ok: true, user: sanitizeUser(user) });
});

app.post('/api/auth/logout', (req, res) => {
  req.session.destroy(() => {
    res.json({ ok: true });
  });
});

app.put('/api/auth/me', requireAuth, async (req, res) => {
  const username = req.session.username;
  const { name, newUsername, currentPassword, newPassword, profileImage } = req.body || {};

  const users = await getJSON(db, 'users', []);
  const user = users.find(u => u.username === username);
  if (!user) return res.status(404).json({ ok: false, message: '사용자를 찾을 수 없습니다.' });

  if (name) user.name = name;

  // Profile image update (optional)
  if (typeof profileImage === 'string') {
    user.profileImage = profileImage;
  }

  // Username change (optional)
  if (newUsername && newUsername !== user.username) {
    if (users.find(u => u.username === newUsername)) {
      return res.status(409).json({ ok: false, message: '이미 존재하는 아이디입니다.' });
    }

    // Update author / review keys to keep data consistent
    const old = user.username;
    user.username = newUsername;

    // Update posts author field
    const posts = await getJSON(db, 'data:posts', []);
    posts.forEach(p => {
      if (p.author === old) p.author = newUsername;
    });
    await setJSON(db, 'data:posts', posts);

    // Update reviews map keys in beans/recipes
    for (const type of ['beans', 'recipes']) {
      const items = await getJSON(db, `data:${type}`, []);
      items.forEach(it => {
        if (it.reviews && it.reviews[old]) {
          it.reviews[newUsername] = it.reviews[old];
          delete it.reviews[old];
        }
      });
      await setJSON(db, `data:${type}`, items);
    }

    // Update session username
    req.session.username = newUsername;
  }

  // Password change (optional)
  if (newPassword) {
    if (!currentPassword || currentPassword !== user.password) {
      return res.status(400).json({ ok: false, message: '현재 비밀번호가 일치하지 않습니다.' });
    }
    user.password = newPassword;
  }

  await setJSON(db, 'users', users);
  res.json({ ok: true, user: sanitizeUser(user) });
});

// --- Users (public, no passwords) ---
app.get('/api/users', requireAuth, async (req, res) => {
  const users = await getJSON(db, 'users', []);
  res.json({ ok: true, users: users.map(sanitizeUser) });
});

// --- Data (beans/recipes/posts) ---
app.get('/api/data/:type', requireAuth, async (req, res) => {
  const { type } = req.params;
  if (!DATA_KEYS.has(type)) return res.status(404).json({ ok: false, message: 'Unknown type' });

  const data = await getJSON(db, `data:${type}`, []);
  res.json({ ok: true, data });
});

app.put('/api/data/:type', requireAuth, async (req, res) => {
  const { type } = req.params;
  if (!DATA_KEYS.has(type)) return res.status(404).json({ ok: false, message: 'Unknown type' });

  const data = req.body;
  if (!Array.isArray(data)) {
    return res.status(400).json({ ok: false, message: 'Body must be an array' });
  }
  await setJSON(db, `data:${type}`, data);
  res.json({ ok: true });
});

// --- Static frontend ---
const publicDir = path.join(__dirname, '..', 'public');
app.use(express.static(publicDir));

// SPA fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(publicDir, 'index.html'));
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`CaffeineYeon server listening on ${port}`);
});
