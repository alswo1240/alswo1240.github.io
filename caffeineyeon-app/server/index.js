import express from 'express';
import session from 'express-session';
import path from 'path';
import { fileURLToPath } from 'url';

// ✅ openDb 제거, db를 직접 import
import { db, getJSON, setJSON } from './db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// ✅ openDb() 호출 제거 (db는 db.js에서 이미 열어둠)
// const db = openDb();

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
      secure: 'auto',
      maxAge: 10 * 1000 // 10초
    }
  })
);

// --- Helpers ---
const DATA_KEYS = new Set(['beans', 'recipes', 'posts']);

async function ensureDefaults() {
  const users = await getJSON('users', null);
  if (!users) await setJSON('users', []);

  for (const k of DATA_KEYS) {
    const v = await getJSON(`data:${k}`, null);
    if (!v) await setJSON(`data:${k}`, []);
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

  const users = await getJSON('users', []);
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

  const users = await getJSON('users', []);
  if (users.find(u => u.username === username)) {
    return res.status(409).json({ ok: false, message: '이미 존재하는 아이디입니다.' });
  }

  const newUser = { name, username, password, profileImage: null };
  users.push(newUser);
  await setJSON('users', users);

  req.session.username = username;
  res.json({ ok: true, user: sanitizeUser(newUser) });
});

app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ ok: false, message: '아이디와 비밀번호를 입력하세요.' });
  }

  const users = await getJSON('users', []);
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

  const users = await getJSON('users', []);
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
    const posts = await getJSON('data:posts', []);
    posts.forEach(p => {
      if (p.author === old) p.author = newUsername;
    });
    await setJSON('data:posts', posts);

    // Update reviews map keys in beans/recipes
    for (const type of ['beans', 'recipes']) {
      const items = await getJSON(`data:${type}`, []);
      items.forEach(it => {
        if (it.reviews && it.reviews[old]) {
          it.reviews[newUsername] = it.reviews[old];
          delete it.reviews[old];
        }
      });
      await setJSON(`data:${type}`, items);
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

  await setJSON('users', users);
  res.json({ ok: true, user: sanitizeUser(user) });
});

// --- Users (public, no passwords) ---
app.get('/api/users', requireAuth, async (req, res) => {
  const users = await getJSON('users', []);
  res.json({ ok: true, users: users.map(sanitizeUser) });
});

// --- Data (beans/recipes/posts) ---
app.get('/api/data/:type', requireAuth, async (req, res) => {
  const { type } = req.params;
  if (!DATA_KEYS.has(type)) return res.status(404).json({ ok: false, message: 'Unknown type' });

  const data = await getJSON(`data:${type}`, []);
  res.json({ ok: true, data });
});

app.put('/api/data/:type', requireAuth, async (req, res) => {
  const { type } = req.params;
  if (!DATA_KEYS.has(type)) return res.status(404).json({ ok: false, message: 'Unknown type' });

  const data = req.body;
  if (!Array.isArray(data)) {
    return res.status(400).json({ ok: false, message: 'Body must be an array' });
  }
  await setJSON(`data:${type}`, data);
  res.json({ ok: true });
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`CaffeineYeon server listening on ${port}`);
  // ✅ 필요하면 DB 경로 확인 로그(원할 때만)
  // console.log("DB PATH:", process.env.DB_PATH);
});

// ------ 서버: “DB 전체 덤프” Export API 만들기 -------

// 맨 위 근처에
const EXPORT_TOKEN = process.env.EXPORT_TOKEN;

// 맨 아래 아무 API들 근처에 추가
app.get('/api/admin/export', async (req, res) => {
  const token = req.query.token;
  if (!EXPORT_TOKEN || token !== EXPORT_TOKEN) {
    return res.status(403).json({ ok: false, message: 'forbidden' });
  }

  // kv 테이블 전체를 읽어서 내보내기
  db.all('SELECT key, value FROM kv ORDER BY key', [], (err, rows) => {
    if (err) return res.status(500).json({ ok: false, message: 'db error' });

    // users에 password가 평문으로 들어있다면, 시트로 내보낼 때 제거 권장
    const cleaned = rows.map(r => {
      if (r.key === 'users') {
        try {
          const users = JSON.parse(r.value);
          const safeUsers = Array.isArray(users)
            ? users.map(({ password, ...rest }) => rest)
            : users;
          return { key: r.key, value: JSON.stringify(safeUsers) };
        } catch {
          return r;
        }
      }
      return r;
    });

    res.json({ ok: true, exportedAt: new Date().toISOString(), rows: cleaned });
  });
});

// --- Static frontend ---
const publicDir = path.join(__dirname, '..', 'public');
app.use(express.static(publicDir));

// SPA fallback (✅ /api 로 시작하는 요청은 제외)
app.get(/^\/(?!api).*/, (req, res) => {
  res.sendFile(path.join(publicDir, 'index.html'));
});
