import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  db, initDatabase, recordAssetTransaction, flushDatabase, incrementWriteCount, resetDatabase,
  PERMISSION_CATALOG, WEBHOOK_EVENT_CATALOG, sanitizePermissions, normalizeRolePositions,
  getUserAccess, migrateLegacyUserPermissions
} from './db.js';
import {
  sendDiscordWebhook, sendNoticeDiscordWebhook, getGlobalWebhookUrl,
  getAllWebhookConfigs, sendTestEventWebhook,
  hasPendingWebhookFallbacks, drainPendingWebhookFallbacks
} from './discord.js';
import zlib from 'node:zlib';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const JWT_SECRET = process.env.JWT_SECRET || 'minecraft-platform-super-secret-key-2026';
const PORT = process.env.PORT || 5000;

// 업로드 디렉토리 확인 (Render 영속 볼륨 DATA_DIR 지원)
const dataDir = process.env.DATA_DIR || __dirname;
const uploadDir = path.join(dataDir, 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Multer 설정
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    const uniqueName = `${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`;
    cb(null, uniqueName);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB
});

// DB 초기화
initDatabase();

const app = express();
app.use(cors({
  exposedHeaders: ['X-Webhook-Fallback-Pending']
}));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use('/uploads', express.static(uploadDir));

// 서버 공유 IP가 디스코드/Cloudflare 429로 제한된 경우 클라이언트 브라우저가 릴레이할 수 있도록 헤더 표시
app.use((req, res, next) => {
  const origJson = res.json.bind(res);
  res.json = (body) => {
    if (hasPendingWebhookFallbacks()) {
      res.setHeader('X-Webhook-Fallback-Pending', '1');
    }
    return origJson(body);
  };
  next();
});

// 모든 데이터 변경 요청(POST, PUT, DELETE, PATCH) 완료 시 즉시 SQLite 디스크 동기화 (무료 서버 슬립 대비)
app.use((req, res, next) => {
  if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(req.method)) {
    res.on('finish', () => {
      if (res.statusCode >= 200 && res.statusCode < 400) {
        if (!req.path.startsWith('/api/auth/login') && !req.path.startsWith('/api/admin/reset') && !req.path.endsWith('/test') && !req.path.endsWith('/test-webhook')) {
          incrementWriteCount();
        }
        flushDatabase('TRUNCATE');
      }
    });
  }
  next();
});

// 무료 서버 절전(슬립) 방지 및 헬스 체크 엔드포인트
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// --- Auth 미들웨어 ---
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ error: '인증 토큰이 필요합니다.' });

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ error: '유효하지 않거나 만료된 토큰입니다.' });
    const freshUser = db.prepare('SELECT id, username, nickname, points, credits, custom_title, must_change_password, is_admin, status FROM users WHERE id = ?').get(user.id);
    if (!freshUser) return res.status(404).json({ error: '존재하지 않는 유저입니다.' });

    // roleList = 부여된 모든 역할의 권한 합집합 (기존 권한 체크 코드와 호환되도록 이름 유지)
    const access = getUserAccess(freshUser.id);
    freshUser.roleList = access.permissions;
    freshUser.assignedRoles = access.roles;
    freshUser.topRolePosition = access.topPosition;
    req.user = freshUser;
    next();
  });
}

// 프론트엔드에 내려줄 사용자 정보 (로그인 / me 공통)
function buildClientUser(u) {
  const access = getUserAccess(u.id);
  return {
    id: u.id,
    username: u.username,
    nickname: u.nickname,
    points: u.points,
    credits: u.credits,
    custom_title: u.custom_title || '',
    must_change_password: u.must_change_password === 1,
    is_admin: u.is_admin === 1,
    permissions: access.permissions,
    roles: access.roles,
    status: u.status
  };
}

function requireRole(roleName) {
  return (req, res, next) => {
    if (req.user.is_admin === 1) return next();
    if (Array.isArray(roleName)) {
      if (roleName.some(r => req.user.roleList.includes(r))) return next();
      return res.status(403).json({ error: `'${roleName.join(' 또는 ')}' 권한이 필요합니다.` });
    }
    if (req.user.roleList.includes(roleName)) return next();
    return res.status(403).json({ error: `'${roleName}' 권한이 필요합니다.` });
  };
}

function requireAdmin(req, res, next) {
  if (req.user.is_admin === 1) return next();
  return res.status(403).json({ error: '슈퍼관리자 권한이 필요합니다.' });
}

function getNumericSetting(key, defaultVal = 1) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  if (!row || row.value === undefined || row.value === null || row.value === '') return defaultVal;
  const parsed = Number(row.value);
  return isNaN(parsed) ? defaultVal : parsed;
}

// --- Cloudflare Turnstile 서버 측 검증 (siteverify) ---
async function verifyTurnstileToken(req, res, expectedAction) {
  const secret = (process.env.TURNSTILE_SECRET || '').trim();
  // TURNSTILE_SECRET 환경변수가 아직 설정되지 않은 배포 환경에서는 로그인 차단을 방지하기 위해 통과 처리
  if (!secret) {
    return true;
  }

  const token = req.body?.['cf-turnstile-response'];
  const expectedHostnames = new Set(
    (process.env.TURNSTILE_HOSTNAMES ?? '')
      .split(',')
      .map((hostname) => hostname.trim())
      .filter(Boolean)
  );

  if (typeof token !== 'string' || token.length === 0 || token.length > 2048) {
    res.status(403).json({ error: '보안 인증(Turnstile) 토큰이 필요합니다.' });
    return false;
  }

  const forwarded = req.headers['x-forwarded-for'];
  const clientIp = (typeof forwarded === 'string' ? forwarded.split(',')[0].trim() : req.ip) || '';

  let result;
  try {
    const r = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      signal: AbortSignal.timeout(10_000),
      body: new URLSearchParams({
        secret,
        response: token,
        remoteip: clientIp
      })
    });
    if (!r.ok) throw new Error(`siteverify ${r.status}`);
    result = await r.json();
  } catch (err) {
    console.error('[Turnstile Siteverify Error]', err.message);
    res.status(403).json({ error: '보안 인증(Turnstile) 서버 검증에 실패했습니다. 다시 시도해주세요.' });
    return false;
  }

  if (
    !result.success ||
    result.action !== expectedAction ||
    (expectedHostnames.size > 0 && !expectedHostnames.has(result.hostname))
  ) {
    res.status(403).json({ error: '보안 인증(Turnstile) 검증에 실패했거나 만료되었습니다. 다시 시도해주세요.' });
    return false;
  }

  return true;
}

// --- 인증 라우트 ---
app.post('/api/auth/login', async (req, res) => {
  if (!(await verifyTurnstileToken(req, res, 'login'))) return;

  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: '아이디와 비밀번호를 입력해주세요.' });
  }

  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  const writeCountRow = db.prepare("SELECT value FROM settings WHERE key = 'write_count'").get();
  const isFreshContainer = !writeCountRow || String(writeCountRow.value) === '0';
  const isDefaultAdminFallback = isFreshContainer && user && user.username === 'admin' && password === 'admin';

  if (!user || (!bcrypt.compareSync(password, user.password) && !isDefaultAdminFallback)) {
    return res.status(401).json({ error: '아이디 또는 비밀번호가 올바르지 않습니다.' });
  }

  // 가입 승인 상태 체크
  if (user.status === 'pending') {
    return res.status(403).json({ error: '가입 승인 대기 중입니다. "계정 관리" 관리자의 승인 후 로그인하실 수 있습니다.' });
  }
  if (user.status === 'rejected') {
    return res.status(403).json({ error: '가입 승인이 거절된 계정입니다. 관리자에게 문의하세요.' });
  }

  const token = jwt.sign(
    { id: user.id, username: user.username, is_admin: user.is_admin },
    JWT_SECRET,
    { expiresIn: '7d' }
  );

  res.json({ token, user: buildClientUser(user) });
});

app.post('/api/auth/change-password', authenticateToken, (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!newPassword || newPassword.length < 4) {
    return res.status(400).json({ error: '새 비밀번호는 최소 4자 이상이어야 합니다.' });
  }

  const user = db.prepare('SELECT password FROM users WHERE id = ?').get(req.user.id);
  if (currentPassword && !bcrypt.compareSync(currentPassword, user.password)) {
    return res.status(400).json({ error: '현재 비밀번호가 일치하지 않습니다.' });
  }

  const newHash = bcrypt.hashSync(newPassword, 10);
  db.prepare('UPDATE users SET password = ?, must_change_password = 0 WHERE id = ?').run(newHash, req.user.id);

  res.json({ message: '비밀번호가 성공적으로 변경되었습니다.' });
});

app.get('/api/auth/me', authenticateToken, (req, res) => {
  res.json({ user: buildClientUser(req.user) });
});

// 회원가입: 즉시 가입되지 않고 'pending' 상태로 등록
app.post('/api/auth/register', async (req, res) => {
  if (!(await verifyTurnstileToken(req, res, 'signup'))) return;

  const { username, password, nickname } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: '아이디와 비밀번호를 입력해주세요.' });
  }

  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (existing) {
    return res.status(400).json({ error: '이미 사용 중인 아이디입니다.' });
  }

  const hash = bcrypt.hashSync(password, 10);
  db.prepare(`
    INSERT INTO users (username, password, nickname, points, credits, must_change_password, is_admin, roles, status)
    VALUES (?, ?, ?, 0, 0, 0, 0, '[]', 'pending')
  `).run(username, hash, nickname || username);

  sendDiscordWebhook('user_register', {
    action_title: '신규 회원가입 신청 접수',
    username,
    nickname: nickname || username,
    status_label: '가입 승인 대기 중 (pending)',
    description: `'${nickname || username}' (@${username}) 플레이어가 회원가입을 신청했습니다.`,
    actor_name: `${nickname || username} (@${username})`
  });

  res.json({
    message: '회원가입 신청이 성공적으로 접수되었습니다! "계정 관리" 관리자의 승인 후 로그인할 수 있습니다.',
    pending: true
  });
});

// --- 유저 & 계정 관리 ---
app.get('/api/users', authenticateToken, (req, res) => {
  const canManage = req.user.is_admin === 1 || ['계정 관리', '역할 관리', '랭킹 관리자', '데이터 관리'].some(p => req.user.roleList.includes(p));
  if (!canManage) {
    return res.status(403).json({ error: '"계정 관리", "역할 관리", "랭킹 관리자", "데이터 관리" 또는 슈퍼관리자 권한이 필요합니다.' });
  }

  const users = db.prepare(`
    SELECT id, username, nickname, points, credits, custom_title, must_change_password, is_admin, status, created_at
    FROM users ORDER BY id ASC
  `).all();
  const parsed = users.map(u => {
    const access = getUserAccess(u.id);
    return {
      ...u,
      roles: access.roles,
      permissions: access.permissions,
      must_change_password: u.must_change_password === 1,
      is_admin: u.is_admin === 1
    };
  });
  res.json(parsed);
});

// 가입 승인/거절 ('계정 관리' 권한 또는 슈퍼관리자)
app.put('/api/users/:id/status', authenticateToken, (req, res) => {
  const canManage = req.user.is_admin === 1 || req.user.roleList.includes('계정 관리');
  if (!canManage) {
    return res.status(403).json({ error: '"계정 관리" 권한이 필요합니다.' });
  }

  const { status } = req.body; // 'approved' or 'rejected'
  if (!['approved', 'rejected'].includes(status)) {
    return res.status(400).json({ error: '올바른 상태(approved/rejected)를 지정하세요.' });
  }

  const targetUser = db.prepare('SELECT id, username, nickname FROM users WHERE id = ?').get(req.params.id);
  db.prepare('UPDATE users SET status = ? WHERE id = ?').run(status, req.params.id);

  if (targetUser) {
    sendDiscordWebhook('user_register', {
      action_title: status === 'approved' ? '회원가입 승인 완료' : '회원가입 거절 처리',
      username: targetUser.username,
      nickname: targetUser.nickname || targetUser.username,
      status_label: status === 'approved' ? '승인 완료 (approved)' : '거절됨 (rejected)',
      description: `'${targetUser.nickname || targetUser.username}' (@${targetUser.username}) 계정이 ${status === 'approved' ? '승인' : '거절'}되었습니다.`,
      actor_name: `${req.user.nickname || req.user.username} (@${req.user.username})`
    });
  }

  res.json({ message: `계정이 ${status === 'approved' ? '승인' : '거절'}되었습니다.` });
});

// 사용자 프로필 상세 수정 (닉네임, 칭호, 아이디 등 - 슈퍼관리자 또는 계정 관리)
app.put('/api/users/:id/profile', authenticateToken, (req, res) => {
  const canManage = req.user.is_admin === 1 || req.user.roleList.includes('계정 관리');
  if (!canManage) {
    return res.status(403).json({ error: '"계정 관리" 또는 슈퍼관리자 권한이 필요합니다.' });
  }
  const { nickname, custom_title, username } = req.body;
  const target = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!target) return res.status(404).json({ error: '유저를 찾을 수 없습니다.' });

  const newUsername = (username && target.username !== 'admin') ? username.trim() : target.username;
  db.prepare('UPDATE users SET username = ?, nickname = ?, custom_title = ? WHERE id = ?')
    .run(newUsername, nickname ?? target.nickname, custom_title ?? (target.custom_title || ''), req.params.id);
  res.json({ message: '플레이어 프로필 및 칭호가 수정되었습니다.' });
});

// 슈퍼 관리자 계정 생성 (슈퍼관리자만 가능)
app.post('/api/users/super-admin', authenticateToken, requireAdmin, (req, res) => {
  const { username, password, nickname } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: '아이디와 비밀번호를 입력해주세요.' });
  }

  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (existing) {
    return res.status(400).json({ error: '이미 사용 중인 아이디입니다.' });
  }

  const hash = bcrypt.hashSync(password, 10);

  const result = db.prepare(`
    INSERT INTO users (username, password, nickname, points, credits, must_change_password, is_admin, roles, status)
    VALUES (?, ?, ?, 1000, 50000, 1, 1, '[]', 'approved')
  `).run(username, hash, nickname || '슈퍼관리자');

  recordAssetTransaction({
    userId: result.lastInsertRowid,
    assetType: 'POINT',
    amount: 1000,
    category: '관리자 계정 생성',
    description: '슈퍼관리자 계정 생성 초기 연방 포인트 지급',
    actor: req.user,
    balanceBefore: 0,
    balanceAfter: 1000
  });
  recordAssetTransaction({
    userId: result.lastInsertRowid,
    assetType: 'CREDIT',
    amount: 50000,
    category: '관리자 계정 생성',
    description: '슈퍼관리자 계정 생성 초기 크레딧 지급',
    actor: req.user,
    balanceBefore: 0,
    balanceAfter: 50000
  });

  res.json({
    message: '새로운 슈퍼 관리자 계정이 생성되었습니다. (접속 시 비밀번호 변경 요청)',
    id: result.lastInsertRowid
  });
});

// 슈퍼관리자 지정/해제 (슈퍼관리자만)
app.put('/api/users/:id/admin', authenticateToken, requireAdmin, (req, res) => {
  const target = db.prepare('SELECT id, username FROM users WHERE id = ?').get(req.params.id);
  if (!target) return res.status(404).json({ error: '유저를 찾을 수 없습니다.' });
  const makeAdmin = req.body.is_admin ? 1 : 0;
  if (!makeAdmin && target.username === 'admin') {
    return res.status(400).json({ error: '기본 admin 계정의 슈퍼관리자 권한은 해제할 수 없습니다.' });
  }
  if (!makeAdmin && target.id === req.user.id) {
    return res.status(400).json({ error: '자기 자신의 슈퍼관리자 권한은 해제할 수 없습니다.' });
  }
  db.prepare('UPDATE users SET is_admin = ? WHERE id = ?').run(makeAdmin, target.id);
  res.json({ message: makeAdmin ? '슈퍼관리자로 지정되었습니다.' : '슈퍼관리자 권한이 해제되었습니다.' });
});

// ─────────────────────────────────────────────────────────────
// 디스코드 스타일 역할(Role) 관리
//  - 슈퍼관리자: 모든 역할 관리 가능
//  - '역할 관리' 권한자: 자신의 최상위 역할보다 "아래" 있는 역할만 관리/부여 가능,
//    자신이 가진 권한만 역할에 넣을 수 있음 (디스코드와 동일한 위계 규칙)
// ─────────────────────────────────────────────────────────────
function canManageRoles(user) {
  return user.is_admin === 1 || user.roleList.includes('역할 관리');
}

function isRoleBelowUser(user, role) {
  return user.is_admin === 1 || role.position < user.topRolePosition;
}

function loadRole(id) {
  const r = db.prepare('SELECT * FROM roles WHERE id = ?').get(id);
  if (!r) return null;
  let perms = [];
  try { perms = JSON.parse(r.permissions || '[]'); } catch { perms = []; }
  return { ...r, permissions: perms };
}

// 권한자가 줄 수 없는 권한이 섞여 있는지 확인
function findForbiddenPermissions(user, perms) {
  if (user.is_admin === 1) return [];
  return perms.filter(p => !user.roleList.includes(p));
}

app.get('/api/permissions', authenticateToken, (req, res) => {
  res.json(PERMISSION_CATALOG);
});

app.get('/api/roles', authenticateToken, (req, res) => {
  const rows = db.prepare(`
    SELECT r.*, (SELECT COUNT(*) FROM user_roles ur WHERE ur.role_id = r.id) as member_count
    FROM roles r ORDER BY r.position DESC
  `).all();
  res.json(rows.map(r => {
    let perms = [];
    try { perms = JSON.parse(r.permissions || '[]'); } catch { perms = []; }
    return { ...r, permissions: perms, manageable: isRoleBelowUser(req.user, r) && canManageRoles(req.user) };
  }));
});

app.post('/api/roles', authenticateToken, (req, res) => {
  if (!canManageRoles(req.user)) return res.status(403).json({ error: "'역할 관리' 권한이 필요합니다." });
  const name = String(req.body.name || '').trim();
  if (!name) return res.status(400).json({ error: '역할 이름을 입력해주세요.' });

  let perms = sanitizePermissions(req.body.permissions);
  if (perms.length === 0) {
    const matched = PERMISSION_CATALOG.map(p => p.key).filter(k => (name === k || name.includes(k)) && (req.user.is_admin === 1 || req.user.roleList.includes(k)));
    if (matched.length > 0) perms = matched;
  }
  const forbidden = findForbiddenPermissions(req.user, perms);
  if (forbidden.length) return res.status(403).json({ error: `본인이 가지지 않은 권한은 부여할 수 없습니다: ${forbidden.join(', ')}` });

  // 디스코드처럼 새 역할은 맨 아래에 생성
  db.exec('BEGIN TRANSACTION;');
  try {
    db.prepare('UPDATE roles SET position = position + 1').run();
    const result = db.prepare('INSERT INTO roles (name, color, position, permissions) VALUES (?, ?, 1, ?)')
      .run(name, req.body.color || '#99aab5', JSON.stringify(perms));
    db.exec('COMMIT;');
    sendDiscordWebhook('role_change', {
      action_title: '신규 역할 생성',
      target_name: name,
      detail: perms.length ? `포함 권한: ${perms.join(', ')}` : '권한 없음 (표시용 역할)',
      description: `'${name}' 역할이 새로 생성되었습니다.`,
      actor_name: `${req.user.nickname || req.user.username} (@${req.user.username})`
    });
    res.json({ message: `'${name}' 역할이 생성되었습니다.`, id: result.lastInsertRowid });
  } catch (err) {
    db.exec('ROLLBACK;');
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/roles/order', authenticateToken, (req, res) => {
  if (!canManageRoles(req.user)) return res.status(403).json({ error: "'역할 관리' 권한이 필요합니다." });
  const order = Array.isArray(req.body.order) ? req.body.order.map(Number) : null; // 위 → 아래 순서의 id 배열
  const all = db.prepare('SELECT id, position FROM roles').all();
  if (!order || order.length !== all.length || new Set(order).size !== all.length || !all.every(r => order.includes(r.id))) {
    return res.status(400).json({ error: '전체 역할 id 목록을 위에서 아래 순서로 보내주세요.' });
  }

  const n = order.length;
  const newPos = new Map(order.map((id, idx) => [id, n - idx]));

  if (req.user.is_admin !== 1) {
    // 내 최상위 역할 이상에 있는 역할은 위치가 바뀌면 안 된다
    const locked = all.filter(r => r.position >= req.user.topRolePosition);
    if (locked.some(r => newPos.get(r.id) !== r.position)) {
      return res.status(403).json({ error: '자신의 최상위 역할보다 위(또는 같은 위치)의 역할 순서는 변경할 수 없습니다.' });
    }
  }

  const upd = db.prepare('UPDATE roles SET position = ? WHERE id = ?');
  db.exec('BEGIN TRANSACTION;');
  try {
    for (const [id, pos] of newPos) upd.run(pos, id);
    db.exec('COMMIT;');
  } catch (err) {
    db.exec('ROLLBACK;');
    return res.status(500).json({ error: err.message });
  }
  res.json({ message: '역할 순서가 저장되었습니다.' });
});

app.put('/api/roles/:id', authenticateToken, (req, res) => {
  if (!canManageRoles(req.user)) return res.status(403).json({ error: "'역할 관리' 권한이 필요합니다." });
  const role = loadRole(req.params.id);
  if (!role) return res.status(404).json({ error: '역할을 찾을 수 없습니다.' });
  if (!isRoleBelowUser(req.user, role)) return res.status(403).json({ error: '자신의 최상위 역할보다 아래에 있는 역할만 수정할 수 있습니다.' });

  const name = req.body.name !== undefined ? String(req.body.name).trim() : role.name;
  if (!name) return res.status(400).json({ error: '역할 이름을 입력해주세요.' });

  let perms = role.permissions;
  if (req.body.permissions !== undefined) {
    perms = sanitizePermissions(req.body.permissions);
    // 바뀌는 권한(추가·제거) 모두 본인이 가진 권한이어야 함
    const changed = [...perms.filter(p => !role.permissions.includes(p)), ...role.permissions.filter(p => !perms.includes(p))];
    const forbidden = findForbiddenPermissions(req.user, changed);
    if (forbidden.length) return res.status(403).json({ error: `본인이 가지지 않은 권한은 변경할 수 없습니다: ${forbidden.join(', ')}` });
  }

  db.prepare('UPDATE roles SET name = ?, color = ?, permissions = ? WHERE id = ?')
    .run(name, req.body.color || role.color, JSON.stringify(perms), role.id);
  if (!req.body.auto_save) {
    sendDiscordWebhook('role_change', {
      action_title: '역할 설정 및 권한 수정',
      target_name: name,
      detail: perms.length ? `포함 권한: ${perms.join(', ')}` : '권한 없음',
      description: `'${name}' 역할의 이름/색상/권한 설정이 수정되었습니다.`,
      actor_name: `${req.user.nickname || req.user.username} (@${req.user.username})`
    });
  }
  res.json({ message: `'${name}' 역할이 저장되었습니다.` });
});

app.delete('/api/roles/:id', authenticateToken, (req, res) => {
  if (!canManageRoles(req.user)) return res.status(403).json({ error: "'역할 관리' 권한이 필요합니다." });
  const role = loadRole(req.params.id);
  if (!role) return res.status(404).json({ error: '역할을 찾을 수 없습니다.' });
  if (!isRoleBelowUser(req.user, role)) return res.status(403).json({ error: '자신의 최상위 역할보다 아래에 있는 역할만 삭제할 수 있습니다.' });

  db.prepare('DELETE FROM roles WHERE id = ?').run(role.id);
  normalizeRolePositions();
  sendDiscordWebhook('role_change', {
    action_title: '역할 삭제',
    target_name: role.name,
    detail: '역할 삭제 완료',
    description: `'${role.name}' 역할이 삭제되었습니다.`,
    actor_name: `${req.user.nickname || req.user.username} (@${req.user.username})`
  });
  res.json({ message: `'${role.name}' 역할이 삭제되었습니다.` });
});

// 사용자에게 역할 부여/해제 (role_ids 전체 목록으로 교체)
app.put('/api/users/:id/roles', authenticateToken, (req, res) => {
  if (!canManageRoles(req.user)) return res.status(403).json({ error: "'역할 관리' 권한이 필요합니다." });
  const target = db.prepare('SELECT id, username, nickname, is_admin FROM users WHERE id = ?').get(req.params.id);
  if (!target) return res.status(404).json({ error: '유저를 찾을 수 없습니다.' });
  if (target.is_admin === 1 && req.user.is_admin !== 1) {
    return res.status(403).json({ error: '슈퍼관리자의 역할은 슈퍼관리자만 변경할 수 있습니다.' });
  }

  const requested = [...new Set((Array.isArray(req.body.role_ids) ? req.body.role_ids : []).map(Number))];
  const current = db.prepare('SELECT role_id FROM user_roles WHERE user_id = ?').all(target.id).map(r => r.role_id);
  const toAdd = requested.filter(id => !current.includes(id));
  const toRemove = current.filter(id => !requested.includes(id));

  for (const id of [...toAdd, ...toRemove]) {
    const role = loadRole(id);
    if (!role) return res.status(400).json({ error: `존재하지 않는 역할입니다 (id: ${id}).` });
    if (!isRoleBelowUser(req.user, role)) {
      return res.status(403).json({ error: `'${role.name}' 역할은 자신의 최상위 역할보다 높거나 같아 부여/해제할 수 없습니다.` });
    }
  }

  db.exec('BEGIN TRANSACTION;');
  try {
    const del = db.prepare('DELETE FROM user_roles WHERE user_id = ? AND role_id = ?');
    const ins = db.prepare('INSERT OR IGNORE INTO user_roles (user_id, role_id) VALUES (?, ?)');
    toRemove.forEach(id => del.run(target.id, id));
    toAdd.forEach(id => ins.run(target.id, id));
    db.exec('COMMIT;');
  } catch (err) {
    db.exec('ROLLBACK;');
    return res.status(500).json({ error: err.message });
  }

  if (toAdd.length > 0 || toRemove.length > 0) {
    const assignedNames = getUserAccess(target.id).roles.map(r => r.name);
    sendDiscordWebhook('role_change', {
      action_title: '플레이어 역할 부여/해제',
      target_name: `${target.nickname || target.username} (@${target.username})`,
      detail: assignedNames.length ? `현재 역할: ${assignedNames.join(', ')}` : '부여된 역할 없음',
      description: `'${target.nickname || target.username}' 플레이어의 개인별 역할이 업데이트되었습니다.`,
      actor_name: `${req.user.nickname || req.user.username} (@${req.user.username})`
    });
  }

  res.json({ message: '사용자 역할이 업데이트되었습니다.' });
});

app.put('/api/users/:id/assets', authenticateToken, (req, res) => {
  const canManage = req.user.is_admin === 1 || req.user.roleList.includes('랭킹 관리자') || req.user.roleList.includes('크레딧 관리');
  if (!canManage) {
    return res.status(403).json({ error: '재화 조정 권한(슈퍼관리자/랭킹 관리자/크레딧 관리)이 필요합니다.' });
  }

  const { points, credits, reason, sync_active_season } = req.body;
  const targetUser = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!targetUser) return res.status(404).json({ error: '사용자를 찾을 수 없습니다.' });

  const newPoints = points !== undefined ? Number(points) : targetUser.points;
  const newCredits = credits !== undefined ? Number(credits) : targetUser.credits;
  const pointDiff = newPoints - (targetUser.points || 0);
  const creditDiff = newCredits - (targetUser.credits || 0);

  db.prepare('UPDATE users SET points = ?, credits = ? WHERE id = ?').run(newPoints, newCredits, req.params.id);

  if (pointDiff !== 0) {
    recordAssetTransaction({
      userId: targetUser.id,
      assetType: 'POINT',
      amount: pointDiff,
      category: '관리자 수동 조정',
      description: reason ? `[관리자 조정] ${reason}` : `관리자(${req.user.nickname || req.user.username})에 의한 연방 포인트 수동 조정`,
      referenceType: 'admin_adjust',
      referenceId: targetUser.id,
      actor: req.user,
      balanceBefore: targetUser.points || 0,
      balanceAfter: newPoints
    });

    if (sync_active_season) {
      const activeSeason = db.prepare('SELECT id FROM seasons WHERE is_active = 1 LIMIT 1').get();
      if (activeSeason) {
        db.prepare(`
          INSERT INTO user_season_points (season_id, user_id, points)
          VALUES (?, ?, ?)
          ON CONFLICT(season_id, user_id) DO UPDATE SET points = MAX(0, points + excluded.points)
        `).run(activeSeason.id, targetUser.id, pointDiff);
      }
    }
  }

  if (creditDiff !== 0) {
    recordAssetTransaction({
      userId: targetUser.id,
      assetType: 'CREDIT',
      amount: creditDiff,
      category: '관리자 수동 조정',
      description: reason ? `[관리자 조정] ${reason}` : `관리자(${req.user.nickname || req.user.username})에 의한 크레딧 수동 조정`,
      referenceType: 'admin_adjust',
      referenceId: targetUser.id,
      actor: req.user,
      balanceBefore: targetUser.credits || 0,
      balanceAfter: newCredits
    });
  }

  if (pointDiff !== 0 || creditDiff !== 0) {
    sendDiscordWebhook('manual_adjust', {
      target_name: targetUser.nickname || targetUser.username,
      target_username: targetUser.username,
      point_diff_text: pointDiff === 0 ? '변동 없음' : `${pointDiff > 0 ? '+' : ''}${pointDiff.toLocaleString()} P`,
      credit_diff_text: creditDiff === 0 ? '변동 없음' : `${creditDiff > 0 ? '+' : ''}${creditDiff.toLocaleString()} C`,
      after_points: newPoints,
      after_credits: newCredits,
      category: '관리자 수동 조정',
      reason: reason || '관리자 패널에서 재화 수치 직접 조정',
      actor_name: `${req.user.nickname || req.user.username} (@${req.user.username})`
    });
  }

  res.json({ message: '재화 수치가 정밀 업데이트되었으며 입출금 원장에 기록되었습니다.' });
});

app.post('/api/users/:id/reset-password', authenticateToken, (req, res) => {
  const canManage = req.user.is_admin === 1 || req.user.roleList.includes('계정 관리');
  if (!canManage) return res.status(403).json({ error: '권한이 없습니다.' });

  const { newPassword } = req.body;
  const targetPass = newPassword || '1234';
  const hash = bcrypt.hashSync(targetPass, 10);
  db.prepare('UPDATE users SET password = ?, must_change_password = 1 WHERE id = ?').run(hash, req.params.id);
  res.json({ message: `비밀번호가 초기화되었습니다 (임시: ${targetPass}). 접속 시 변경이 요구됩니다.` });
});

app.delete('/api/users/:id', authenticateToken, (req, res) => {
  const canManage = req.user.is_admin === 1 || req.user.roleList.includes('계정 관리');
  if (!canManage) return res.status(403).json({ error: '권한이 없습니다.' });

  const target = db.prepare('SELECT username FROM users WHERE id = ?').get(req.params.id);
  if (target?.username === 'admin') {
    return res.status(400).json({ error: '기본 admin 계정은 삭제할 수 없습니다.' });
  }

  db.prepare('DELETE FROM users WHERE id = ?').run(req.params.id);
  res.json({ message: '계정이 삭제되었습니다.' });
});

// --- 공지사항 (납품 안내문 등) ---
app.get('/api/notices', authenticateToken, (req, res) => {
  const rows = db.prepare(`
    SELECT n.*, u.username as author_username, u.nickname as author_nickname
    FROM notices n
    LEFT JOIN users u ON n.updated_by = u.id
    ORDER BY n.id ASC
  `).all();
  res.json(rows);
});

app.get('/api/notices/:category', (req, res) => {
  const notice = db.prepare(`
    SELECT n.*, u.username as author_username, u.nickname as author_nickname
    FROM notices n
    LEFT JOIN users u ON n.updated_by = u.id
    WHERE n.category = ?
    ORDER BY n.id DESC
    LIMIT 1
  `).get(req.params.category);

  res.json(notice || {
    category: req.params.category,
    title: '안내문',
    content: '등록된 안내문이 없습니다.',
    webhook_url: '',
    webhook_enabled: 0,
    mention_type: 'none',
    embed_color: '#3b82f6',
    message_template: ''
  });
});

app.put('/api/notices/:category', authenticateToken, requireRole('공지 관리'), async (req, res) => {
  const {
    title,
    content,
    webhook_url = '',
    webhook_enabled = 0,
    mention_type = 'none',
    embed_color = '#3b82f6',
    message_template = '',
    send_now = false
  } = req.body;

  const exists = db.prepare('SELECT id FROM notices WHERE category = ?').get(req.params.category);
  let noticeId;
  if (exists) {
    db.prepare(`
      UPDATE notices
      SET title = ?, content = ?, webhook_url = ?, webhook_enabled = ?,
          mention_type = ?, embed_color = ?, message_template = ?,
          updated_by = ?, updated_at = CURRENT_TIMESTAMP
      WHERE category = ?
    `).run(
      title,
      content,
      webhook_url,
      webhook_enabled ? 1 : 0,
      mention_type,
      embed_color,
      message_template,
      req.user.id,
      req.params.category
    );
    noticeId = exists.id;
  } else {
    const result = db.prepare(`
      INSERT INTO notices (category, title, content, webhook_url, webhook_enabled, mention_type, embed_color, message_template, updated_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      req.params.category,
      title,
      content,
      webhook_url,
      webhook_enabled ? 1 : 0,
      mention_type,
      embed_color,
      message_template,
      req.user.id
    );
    noticeId = result.lastInsertRowid;
  }

  let webhookMessage = '';
  let fallbackWebhooks = undefined;
  // 즉시 전송 요청이 있거나 (자동 저장이 아닌 수동 저장 시) 자동 웹훅이 활성화된 경우 디스코드 발송
  if (send_now || (!req.body.auto_save && webhook_enabled)) {
    try {
      const whRes = await sendNoticeDiscordWebhook({
        category: req.params.category,
        category_display: req.params.category === 'supply' ? '납품 공지사항' : req.params.category,
        title,
        content,
        webhook_url,
        mention_type,
        embed_color,
        message_template,
        author_name: req.user.nickname || req.user.username
      });
      if (whRes?.fallback_webhook) {
        fallbackWebhooks = [whRes.fallback_webhook];
      }
      webhookMessage = ' (디스코드 웹훅 알림이 성공적으로 전송되었습니다.)';
    } catch (err) {
      console.error('[Notice Webhook Error]', err.message);
      webhookMessage = ` (디스코드 웹훅 전송 오류: ${err.message})`;
    }
  }

  res.json({
    message: `안내문이 업데이트되었습니다.${webhookMessage}`,
    id: noticeId,
    fallback_webhooks: fallbackWebhooks
  });
});

// 공지사항 웹훅 단독 테스트 발송
app.post('/api/notices/:category/test-webhook', authenticateToken, requireRole('공지 관리'), async (req, res) => {
  try {
    const {
      title,
      content,
      webhook_url,
      mention_type,
      embed_color,
      message_template
    } = req.body;

    const whRes = await sendNoticeDiscordWebhook({
      category: req.params.category,
      category_display: req.params.category === 'supply' ? '납품 공지사항' : req.params.category,
      title: title || '공지사항 테스트 알림',
      content: content || '이 메시지는 공지사항 디스코드 웹훅 연동 테스트 메시지입니다.',
      webhook_url: webhook_url || '',
      mention_type: mention_type || 'none',
      embed_color: embed_color || '#3b82f6',
      message_template: message_template || '',
      author_name: req.user.nickname || req.user.username
    }, { isTest: true });

    res.json({
      message: '디스코드 테스트 웹훅 발송이 성공했습니다!',
      fallback_webhooks: whRes?.fallback_webhook ? [whRes.fallback_webhook] : undefined
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// --- 납품 모듈 ---
app.get('/api/supplies', authenticateToken, (req, res) => {
  const items = db.prepare('SELECT * FROM supplies WHERE is_active = 1 ORDER BY id DESC').all();
  res.json(items);
});

app.post('/api/supplies', authenticateToken, requireRole(['납품 등록', '납품 관리']), (req, res) => {
  const { name, category, unit, custom_unit, points_per_unit, credits_per_unit, description } = req.body;
  if (!name) return res.status(400).json({ error: '상품명을 입력해주세요.' });

  const finalCategory = (category && String(category).trim()) || '광물';
  if (unit === '기타' && (!custom_unit || !String(custom_unit).trim())) {
    return res.status(400).json({ error: '기타 단위를 직접 입력해주세요.' });
  }
  const finalUnit = (unit === '기타' ? String(custom_unit).trim() : (unit && String(unit).trim())) || '개';

  const result = db.prepare(`
    INSERT INTO supplies (name, category, unit, points_per_unit, credits_per_unit, description, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(name, finalCategory, finalUnit, Number(points_per_unit) || 0, Number(credits_per_unit) || 0, description || '', req.user.id);

  sendDiscordWebhook('supply_item_created', {
    id: result.lastInsertRowid,
    name,
    category: finalCategory,
    unit: finalUnit,
    points_per_unit: Number(points_per_unit) || 0,
    credits_per_unit: Number(credits_per_unit) || 0,
    description: description || '',
    actor_name: `${req.user.nickname || req.user.username} (@${req.user.username})`
  });

  res.json({ message: '납품 상품이 등록되었습니다.', id: result.lastInsertRowid });
});

app.put('/api/supplies/:id', authenticateToken, requireRole(['납품 등록', '납품 관리']), (req, res) => {
  const { name, category, unit, custom_unit, points_per_unit, credits_per_unit, description } = req.body;
  if (!name) return res.status(400).json({ error: '상품명을 입력해주세요.' });

  const finalCategory = (category && String(category).trim()) || '광물';
  if (unit === '기타' && (!custom_unit || !String(custom_unit).trim())) {
    return res.status(400).json({ error: '기타 단위를 직접 입력해주세요.' });
  }
  const finalUnit = (unit === '기타' ? String(custom_unit).trim() : (unit && String(unit).trim())) || '개';

  db.prepare(`
    UPDATE supplies
    SET name = ?, category = ?, unit = ?, points_per_unit = ?, credits_per_unit = ?, description = ?
    WHERE id = ?
  `).run(name, finalCategory, finalUnit, Number(points_per_unit) || 0, Number(credits_per_unit) || 0, description || '', req.params.id);

  res.json({ message: '납품 품목 정보 및 단가 수치가 수정되었습니다.' });
});

app.delete('/api/supplies/:id', authenticateToken, requireRole(['납품 등록', '납품 관리']), (req, res) => {
  db.prepare('UPDATE supplies SET is_active = 0 WHERE id = ?').run(req.params.id);
  res.json({ message: '납품 상품이 삭제되었습니다.' });
});

app.get('/api/supplies/requests', authenticateToken, (req, res) => {
  const canManage = req.user.is_admin === 1 || req.user.roleList.includes('납품 관리');
  let list;
  if (canManage) {
    list = db.prepare(`
      SELECT sr.*,
             COALESCE(s.name, sr.custom_item_name, '자율 납품 품목') as supply_name,
             COALESCE(s.category, '자율 납품') as supply_category,
             COALESCE(s.unit, sr.custom_unit, '개') as unit,
             COALESCE(s.points_per_unit, 0) as points_per_unit,
             COALESCE(s.credits_per_unit, 0) as credits_per_unit,
             u.username, u.nickname
      FROM supply_requests sr
      LEFT JOIN supplies s ON sr.supply_id = s.id
      JOIN users u ON sr.user_id = u.id
      ORDER BY sr.id DESC
    `).all();
  } else {
    list = db.prepare(`
      SELECT sr.*,
             COALESCE(s.name, sr.custom_item_name, '자율 납품 품목') as supply_name,
             COALESCE(s.category, '자율 납품') as supply_category,
             COALESCE(s.unit, sr.custom_unit, '개') as unit,
             COALESCE(s.points_per_unit, 0) as points_per_unit,
             COALESCE(s.credits_per_unit, 0) as credits_per_unit,
             u.username, u.nickname
      FROM supply_requests sr
      LEFT JOIN supplies s ON sr.supply_id = s.id
      JOIN users u ON sr.user_id = u.id
      WHERE sr.user_id = ?
      ORDER BY sr.id DESC
    `).all(req.user.id);
  }
  res.json(list);
});

app.post('/api/supplies/requests', authenticateToken, upload.single('proof_image'), (req, res) => {
  const { supply_id, amount, chest_location, is_custom, custom_item_name, custom_unit, custom_items_json, notes } = req.body;
  const isCustomMode = is_custom === '1' || is_custom === 'true' || is_custom === true || !supply_id;

  if (!chest_location) {
    return res.status(400).json({ error: '상자 위치를 입력해주세요.' });
  }

  const proof_image = req.file ? `/uploads/${req.file.filename}` : null;

  if (isCustomMode) {
    let parsedItems = [];
    try {
      if (custom_items_json) {
        parsedItems = typeof custom_items_json === 'string' ? JSON.parse(custom_items_json) : custom_items_json;
      }
    } catch (e) {
      parsedItems = [];
    }

    let summaryName = custom_item_name || '';
    let totalAmount = Number(amount) || 1;
    let mainUnit = custom_unit || '개';

    if (Array.isArray(parsedItems) && parsedItems.length > 0) {
      const validItems = parsedItems.filter(it => it.name && String(it.name).trim() !== '');
      if (validItems.length === 0) {
        return res.status(400).json({ error: '납품할 아이템 이름을 최소 1개 이상 입력해주세요.' });
      }
      for (const it of validItems) {
        if (it.unit === '기타' && (!it.custom_unit || !String(it.custom_unit).trim())) {
          return res.status(400).json({ error: `'${it.name}' 품목의 기타 단위를 직접 입력해주세요.` });
        }
      }
      const resolveItemUnit = (it) => (it.unit === '기타' ? String(it.custom_unit || '').trim() : String(it.unit || '').trim()) || '개';
      summaryName = validItems.map(it => `${it.name.trim()} (${it.amount || 1}${resolveItemUnit(it)})`).join(', ');
      totalAmount = validItems.reduce((acc, it) => acc + (Number(it.amount) || 1), 0);
      mainUnit = validItems.length === 1 ? resolveItemUnit(validItems[0]) : '종(합산)';
    } else if (!summaryName.trim()) {
      return res.status(400).json({ error: '직접 납품할 아이템 이름과 수량을 입력해주세요.' });
    }

    const result = db.prepare(`
      INSERT INTO supply_requests (
        supply_id, is_custom, custom_item_name, custom_unit, custom_items_json,
        user_id, amount, chest_location, notes, proof_image, status
      ) VALUES (NULL, 1, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')
    `).run(
      summaryName,
      mainUnit,
      typeof custom_items_json === 'string' ? custom_items_json : JSON.stringify(parsedItems),
      req.user.id,
      totalAmount,
      chest_location,
      notes || '',
      proof_image
    );

    sendDiscordWebhook('supply_request', {
      id: result.lastInsertRowid,
      is_custom: true,
      supply_name: summaryName,
      amount: totalAmount,
      unit: mainUnit,
      chest_location,
      notes: notes || '',
      user_name: req.user.nickname || req.user.username,
      username: req.user.username
    });

    return res.json({ message: '자율 직접 입력 납품 신청이 접수되었습니다. 관리자가 확인 후 보상을 책정하여 지급합니다.', id: result.lastInsertRowid });
  } else {
    if (!supply_id || !amount) {
      return res.status(400).json({ error: '모든 필수 항목(물품, 수량, 상자 위치)을 입력해주세요.' });
    }

    const supplyInfo = db.prepare('SELECT name, unit FROM supplies WHERE id = ?').get(Number(supply_id));
    const result = db.prepare(`
      INSERT INTO supply_requests (supply_id, is_custom, user_id, amount, chest_location, notes, proof_image, status)
      VALUES (?, 0, ?, ?, ?, ?, ?, 'pending')
    `).run(Number(supply_id), req.user.id, Number(amount), chest_location, notes || '', proof_image);

    sendDiscordWebhook('supply_request', {
      id: result.lastInsertRowid,
      is_custom: false,
      supply_name: supplyInfo?.name || '지정 품목',
      amount: Number(amount),
      unit: supplyInfo?.unit || '개',
      chest_location,
      notes: notes || '',
      user_name: req.user.nickname || req.user.username,
      username: req.user.username
    });

    return res.json({ message: '납품 신청이 접수되었습니다.', id: result.lastInsertRowid });
  }
});

app.put('/api/supplies/requests/:id/review', authenticateToken, requireRole('납품 관리'), (req, res) => {
  const { status, admin_comment, custom_points, custom_credits } = req.body;
  if (!['approved', 'rejected'].includes(status)) {
    return res.status(400).json({ error: '올바른 승인/거절 상태를 지정하세요.' });
  }

  const reqItem = db.prepare(`
    SELECT sr.*,
           COALESCE(s.name, sr.custom_item_name, '자율 납품') as supply_name,
           COALESCE(s.unit, sr.custom_unit, '개') as unit,
           COALESCE(s.points_per_unit, 0) as points_per_unit,
           COALESCE(s.credits_per_unit, 0) as credits_per_unit,
           u.username, u.nickname
    FROM supply_requests sr
    LEFT JOIN supplies s ON sr.supply_id = s.id
    LEFT JOIN users u ON sr.user_id = u.id
    WHERE sr.id = ?
  `).get(req.params.id);

  if (!reqItem) return res.status(404).json({ error: '신청 내역을 찾을 수 없습니다.' });
  if (reqItem.status !== 'pending') return res.status(400).json({ error: '이미 처리된 신청입니다.' });

  let earnedPoints = 0;
  let earnedCredits = 0;

  if (status === 'approved') {
    const pointMult = getNumericSetting('point_multiplier', 1.0);
    const creditMult = getNumericSetting('credit_multiplier', 1.0);

    if (custom_points !== undefined && custom_points !== null && custom_points !== '') {
      earnedPoints = Math.round(Number(custom_points));
    } else {
      earnedPoints = Math.round(reqItem.amount * reqItem.points_per_unit * pointMult);
    }

    if (custom_credits !== undefined && custom_credits !== null && custom_credits !== '') {
      earnedCredits = Math.round(Number(custom_credits));
    } else {
      earnedCredits = Math.round(reqItem.amount * reqItem.credits_per_unit * creditMult);
    }

    const beforeUser = db.prepare('SELECT points, credits FROM users WHERE id = ?').get(reqItem.user_id);
    db.prepare('UPDATE users SET points = points + ?, credits = credits + ? WHERE id = ?')
      .run(earnedPoints, earnedCredits, reqItem.user_id);

    if (earnedPoints !== 0) {
      recordAssetTransaction({
        userId: reqItem.user_id,
        assetType: 'POINT',
        amount: earnedPoints,
        category: reqItem.is_custom ? '자율 물자 납품' : '물자 납품',
        description: `[납품 승인 #${reqItem.id}] ${reqItem.supply_name} (${reqItem.amount}${reqItem.unit}) 보상 지급`,
        referenceType: 'supply_request',
        referenceId: reqItem.id,
        actor: req.user,
        balanceBefore: beforeUser?.points || 0,
        balanceAfter: (beforeUser?.points || 0) + earnedPoints
      });
    }

    if (earnedCredits !== 0) {
      recordAssetTransaction({
        userId: reqItem.user_id,
        assetType: 'CREDIT',
        amount: earnedCredits,
        category: reqItem.is_custom ? '자율 물자 납품' : '물자 납품',
        description: `[납품 승인 #${reqItem.id}] ${reqItem.supply_name} (${reqItem.amount}${reqItem.unit}) 크레딧 지급`,
        referenceType: 'supply_request',
        referenceId: reqItem.id,
        actor: req.user,
        balanceBefore: beforeUser?.credits || 0,
        balanceAfter: (beforeUser?.credits || 0) + earnedCredits
      });
    }

    const activeSeason = db.prepare('SELECT id FROM seasons WHERE is_active = 1 LIMIT 1').get();
    if (activeSeason && earnedPoints !== 0) {
      db.prepare(`
        INSERT INTO user_season_points (season_id, user_id, points)
        VALUES (?, ?, ?)
        ON CONFLICT(season_id, user_id) DO UPDATE SET points = points + excluded.points
      `).run(activeSeason.id, reqItem.user_id, earnedPoints);
    }
  }

  db.prepare(`
    UPDATE supply_requests
    SET status = ?, admin_comment = ?, points_earned = ?, credits_earned = ?, reviewed_by = ?, reviewed_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(status, admin_comment || '', earnedPoints, earnedCredits, req.user.id, req.params.id);

  if (status === 'approved') {
    sendDiscordWebhook('supply_reward', {
      request_id: reqItem.id,
      user_name: reqItem.nickname || reqItem.username,
      username: reqItem.username,
      supply_name: reqItem.supply_name,
      amount: reqItem.amount,
      unit: reqItem.unit,
      chest_location: reqItem.chest_location,
      points_earned: earnedPoints,
      credits_earned: earnedCredits,
      admin_comment: admin_comment || '',
      reviewer_name: `${req.user.nickname || req.user.username} (@${req.user.username})`
    });
  } else {
    sendDiscordWebhook('supply_rejected', {
      request_id: reqItem.id,
      user_name: reqItem.nickname || reqItem.username,
      username: reqItem.username,
      supply_name: reqItem.supply_name,
      amount: reqItem.amount,
      unit: reqItem.unit,
      admin_comment: admin_comment || '',
      reviewer_name: `${req.user.nickname || req.user.username} (@${req.user.username})`
    });
  }

  res.json({ message: `납품 신청이 ${status === 'approved' ? `승인 (+${earnedPoints}P, +${earnedCredits.toLocaleString()}C)` : '거절'}되었습니다.` });
});

// 이미 처리된 납품 신청 내역도 사후 수치 수정 가능 ('납품 관리' 권한)
app.put('/api/supplies/requests/:id/edit', authenticateToken, requireRole('납품 관리'), (req, res) => {
  const { amount, chest_location, custom_item_name, points_earned, credits_earned, admin_comment } = req.body;
  const reqItem = db.prepare('SELECT * FROM supply_requests WHERE id = ?').get(req.params.id);
  if (!reqItem) return res.status(404).json({ error: '납품 신청 내역을 찾을 수 없습니다.' });

  const newPoints = points_earned !== undefined ? Number(points_earned) : reqItem.points_earned;
  const newCredits = credits_earned !== undefined ? Number(credits_earned) : reqItem.credits_earned;
  const diffPoints = newPoints - (reqItem.points_earned || 0);
  const diffCredits = newCredits - (reqItem.credits_earned || 0);

  if (reqItem.status === 'approved' && (diffPoints !== 0 || diffCredits !== 0)) {
    const beforeUser = db.prepare('SELECT points, credits FROM users WHERE id = ?').get(reqItem.user_id);
    db.prepare('UPDATE users SET points = points + ?, credits = credits + ? WHERE id = ?')
      .run(diffPoints, diffCredits, reqItem.user_id);

    if (diffPoints !== 0) {
      recordAssetTransaction({
        userId: reqItem.user_id,
        assetType: 'POINT',
        amount: diffPoints,
        category: '납품 보상 정정',
        description: `[납품 내역 #${reqItem.id} 수치 정정] 기존 ${reqItem.points_earned}P → ${newPoints}P`,
        referenceType: 'supply_request',
        referenceId: reqItem.id,
        actor: req.user,
        balanceBefore: beforeUser?.points || 0,
        balanceAfter: (beforeUser?.points || 0) + diffPoints
      });
      const activeSeason = db.prepare('SELECT id FROM seasons WHERE is_active = 1 LIMIT 1').get();
      if (activeSeason) {
        db.prepare(`
          INSERT INTO user_season_points (season_id, user_id, points)
          VALUES (?, ?, ?)
          ON CONFLICT(season_id, user_id) DO UPDATE SET points = points + excluded.points
        `).run(activeSeason.id, reqItem.user_id, diffPoints);
      }
    }
    if (diffCredits !== 0) {
      recordAssetTransaction({
        userId: reqItem.user_id,
        assetType: 'CREDIT',
        amount: diffCredits,
        category: '납품 보상 정정',
        description: `[납품 내역 #${reqItem.id} 수치 정정] 기존 ${reqItem.credits_earned}C → ${newCredits}C`,
        referenceType: 'supply_request',
        referenceId: reqItem.id,
        actor: req.user,
        balanceBefore: beforeUser?.credits || 0,
        balanceAfter: (beforeUser?.credits || 0) + diffCredits
      });
    }
  }

  db.prepare(`
    UPDATE supply_requests
    SET amount = ?, chest_location = ?, custom_item_name = COALESCE(?, custom_item_name),
        points_earned = ?, credits_earned = ?, admin_comment = ?
    WHERE id = ?
  `).run(
    amount !== undefined ? Number(amount) : reqItem.amount,
    chest_location ?? reqItem.chest_location,
    custom_item_name ?? null,
    newPoints,
    newCredits,
    admin_comment ?? reqItem.admin_comment,
    req.params.id
  );

  const reqUser = db.prepare('SELECT username, nickname FROM users WHERE id = ?').get(reqItem.user_id);
  const supplyRow = reqItem.supply_id ? db.prepare('SELECT name, unit FROM supplies WHERE id = ?').get(reqItem.supply_id) : null;
  sendDiscordWebhook('supply_reward', {
    request_id: reqItem.id,
    user_name: reqUser ? (reqUser.nickname || reqUser.username) : `#${reqItem.user_id}`,
    username: reqUser?.username || '',
    supply_name: custom_item_name || reqItem.custom_item_name || supplyRow?.name || '지정 품목',
    amount: amount !== undefined ? Number(amount) : reqItem.amount,
    unit: supplyRow?.unit || '개',
    points_earned: newPoints,
    credits_earned: newCredits,
    admin_comment: `[사후 수치 수정] ${admin_comment ?? reqItem.admin_comment ?? ''}`.trim(),
    reviewer_name: `${req.user.nickname || req.user.username} (@${req.user.username})`
  });

  res.json({ message: '납품 기록 및 지급 수치가 수정되었습니다.' });
});

// --- 랭킹 & 시즌 & 랭킹 관리자 ---
app.get('/api/ranking/tiers', authenticateToken, (req, res) => {
  const tiers = db.prepare('SELECT * FROM ranking_tiers ORDER BY min_points DESC, sort_order ASC').all();
  res.json(tiers);
});

app.post('/api/ranking/tiers', authenticateToken, requireRole(['랭킹 관리자', '시즌 관리']), (req, res) => {
  const { name, min_points, badge_color, icon_emoji, perk_description, sort_order } = req.body;
  if (!name || min_points === undefined) return res.status(400).json({ error: '티어 이름과 최소 필요 포인트를 입력해주세요.' });

  const result = db.prepare(`
    INSERT INTO ranking_tiers (name, min_points, badge_color, icon_emoji, perk_description, sort_order)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(name, Number(min_points) || 0, badge_color || '#3b82f6', icon_emoji || '⚔️', perk_description || '', Number(sort_order) || 0);

  res.json({ message: '새로운 랭킹 계급(티어)이 추가되었습니다.', id: result.lastInsertRowid });
});

app.put('/api/ranking/tiers/:id', authenticateToken, requireRole(['랭킹 관리자', '시즌 관리']), (req, res) => {
  const { name, min_points, badge_color, icon_emoji, perk_description, sort_order } = req.body;
  db.prepare(`
    UPDATE ranking_tiers
    SET name = ?, min_points = ?, badge_color = ?, icon_emoji = ?, perk_description = ?, sort_order = ?
    WHERE id = ?
  `).run(name, Number(min_points) || 0, badge_color || '#3b82f6', icon_emoji || '⚔️', perk_description || '', Number(sort_order) || 0, req.params.id);

  res.json({ message: '랭킹 계급(티어) 정보가 수정되었습니다.' });
});

app.delete('/api/ranking/tiers/:id', authenticateToken, requireRole(['랭킹 관리자', '시즌 관리']), (req, res) => {
  db.prepare('DELETE FROM ranking_tiers WHERE id = ?').run(req.params.id);
  res.json({ message: '랭킹 계급(티어)이 삭제되었습니다.' });
});

app.get('/api/ranking/config', authenticateToken, (req, res) => {
  const keys = ['ranking_board_notice', 'ranking_show_credit_tab', 'ranking_top_limit', 'point_multiplier', 'credit_multiplier'];
  const rows = db.prepare(`SELECT key, value FROM settings WHERE key IN ('ranking_board_notice', 'ranking_show_credit_tab', 'ranking_top_limit', 'point_multiplier', 'credit_multiplier')`).all();
  const cfg = {
    ranking_board_notice: '이번 시즌도 함께 국가를 키워가요! 납품·퀘스트·알바 하나하나가 모두 기여도로 기록됩니다.',
    ranking_show_credit_tab: '1',
    ranking_top_limit: '100',
    point_multiplier: '1.0',
    credit_multiplier: '1.0'
  };
  rows.forEach(r => { cfg[r.key] = r.value; });
  res.json(cfg);
});

app.put('/api/ranking/config', authenticateToken, requireRole(['랭킹 관리자', '시즌 관리']), (req, res) => {
  const allowed = ['ranking_board_notice', 'ranking_show_credit_tab', 'ranking_top_limit', 'point_multiplier', 'credit_multiplier'];
  const stmt = db.prepare(`INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`);
  for (const k of allowed) {
    if (req.body[k] !== undefined) {
      stmt.run(k, String(req.body[k]));
    }
  }
  res.json({ message: '랭킹 보드 및 배율 설정이 저장되었습니다.' });
});

app.get('/api/ranking', authenticateToken, (req, res) => {
  const { season_id, include_hidden, sort_by } = req.query;
  const canManageRanking = req.user.is_admin === 1 || req.user.roleList.includes('랭킹 관리자') || req.user.roleList.includes('시즌 관리');
  const showHidden = canManageRanking && (include_hidden === '1' || include_hidden === 'true');
  const topLimit = Math.max(10, Math.min(500, getNumericSetting('ranking_top_limit', 100)));

  let ranking;

  if (season_id && season_id !== 'all') {
    const sid = Number(season_id);
    ranking = db.prepare(`
      SELECT
        u.id, u.username, u.nickname, u.credits,
        u.points as total_points_all_time,
        COALESCE(NULLIF(usp.custom_title, ''), u.custom_title, '') as custom_title,
        COALESCE(usp.points, 0) as base_points,
        COALESCE(usp.bonus_points, 0) as bonus_points,
        (COALESCE(usp.points, 0) + COALESCE(usp.bonus_points, 0)) as points,
        COALESCE(usp.admin_memo, '') as admin_memo,
        COALESCE(usp.is_hidden, 0) as is_hidden,
        (SELECT COUNT(*) FROM supply_requests sr WHERE sr.user_id = u.id AND sr.status = 'approved') as supply_count,
        (SELECT COUNT(*) FROM quest_submissions qs WHERE qs.user_id = u.id AND qs.status = 'approved') as quest_count,
        (SELECT COUNT(*) FROM part_time_jobs pj WHERE pj.status = 'completed' AND (pj.worker_id = u.id OR pj.workers_json LIKE '%"user_id":' || u.id || ',%' OR pj.workers_json LIKE '%"user_id":' || u.id || '}%')) as job_count
      FROM users u
      LEFT JOIN user_season_points usp ON u.id = usp.user_id AND usp.season_id = ?
      WHERE u.status = 'approved'
        AND (? = 1 OR COALESCE(usp.is_hidden, 0) = 0)
      ORDER BY ${sort_by === 'credits' ? 'u.credits DESC, points DESC' : 'points DESC, u.credits DESC'}, u.id ASC
      LIMIT ?
    `).all(sid, showHidden ? 1 : 0, topLimit);
  } else {
    const activeSeason = db.prepare('SELECT id FROM seasons WHERE is_active = 1 LIMIT 1').get();
    const activeSid = activeSeason ? activeSeason.id : -1;
    ranking = db.prepare(`
      SELECT
        u.id, u.username, u.nickname, u.credits,
        u.points as base_points,
        COALESCE(usp.bonus_points, 0) as bonus_points,
        (u.points + COALESCE(usp.bonus_points, 0)) as points,
        COALESCE(NULLIF(usp.custom_title, ''), u.custom_title, '') as custom_title,
        COALESCE(usp.admin_memo, '') as admin_memo,
        COALESCE(usp.is_hidden, 0) as is_hidden,
        (SELECT COUNT(*) FROM supply_requests sr WHERE sr.user_id = u.id AND sr.status = 'approved') as supply_count,
        (SELECT COUNT(*) FROM quest_submissions qs WHERE qs.user_id = u.id AND qs.status = 'approved') as quest_count,
        (SELECT COUNT(*) FROM part_time_jobs pj WHERE pj.status = 'completed' AND (pj.worker_id = u.id OR pj.workers_json LIKE '%"user_id":' || u.id || ',%' OR pj.workers_json LIKE '%"user_id":' || u.id || '}%')) as job_count
      FROM users u
      LEFT JOIN user_season_points usp ON u.id = usp.user_id AND usp.season_id = ?
      WHERE u.status = 'approved'
        AND (? = 1 OR COALESCE(usp.is_hidden, 0) = 0)
      ORDER BY ${sort_by === 'credits' ? 'u.credits DESC, points DESC' : 'points DESC, u.credits DESC'}, u.id ASC
      LIMIT ?
    `).all(activeSid, showHidden ? 1 : 0, topLimit);
  }

  const enriched = ranking.map(r => ({
    ...r,
    roles: getUserAccess(r.id).roles
  }));

  res.json(enriched);
});

// 나의 랭킹 요약: 남과의 격차 대신 "내 위치와 내 성장"을 보여주기 위한 개인 지표
app.get('/api/ranking/me', authenticateToken, (req, res) => {
  const { season_id } = req.query;
  const activeSeason = db.prepare('SELECT id FROM seasons WHERE is_active = 1 LIMIT 1').get();
  const isSeason = season_id && season_id !== 'all';
  const sid = isSeason ? Number(season_id) : (activeSeason ? activeSeason.id : -1);

  const pointsExpr = isSeason
    ? '(COALESCE(usp.points, 0) + COALESCE(usp.bonus_points, 0))'
    : '(u.points + COALESCE(usp.bonus_points, 0))';

  const rows = db.prepare(`
    SELECT u.id, ${pointsExpr} as pts
    FROM users u
    LEFT JOIN user_season_points usp ON u.id = usp.user_id AND usp.season_id = ?
    WHERE u.status = 'approved' AND COALESCE(usp.is_hidden, 0) = 0
  `).all(sid);

  const mine = rows.find(r => r.id === req.user.id);
  const myPoints = mine ? mine.pts : 0;
  const participants = rows.filter(r => r.pts > 0).length;
  const totalPoints = rows.reduce((acc, r) => acc + Math.max(0, r.pts), 0);
  const rank = mine && myPoints > 0 ? rows.filter(r => r.pts > myPoints).length + 1 : null;

  const weekly = db.prepare(`
    SELECT COALESCE(SUM(amount), 0) as s FROM asset_transactions
    WHERE user_id = ? AND asset_type = 'POINT' AND tx_type = 'IN' AND created_at >= datetime('now', '-7 day')
  `).get(req.user.id).s;

  const counts = db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM supply_requests WHERE user_id = ? AND status = 'approved') as supply_count,
      (SELECT COUNT(*) FROM quest_submissions WHERE user_id = ? AND status = 'approved') as quest_count,
      (SELECT COUNT(*) FROM part_time_jobs WHERE status = 'completed' AND (worker_id = ? OR workers_json LIKE '%"user_id":' || ? || ',%' OR workers_json LIKE '%"user_id":' || ? || '}%')) as job_count
  `).get(req.user.id, req.user.id, req.user.id, req.user.id, req.user.id);

  res.json({
    points: myPoints,
    rank,
    participants,
    top_percent: rank && participants > 0 ? Math.max(1, Math.ceil((rank / participants) * 100)) : null,
    contribution_percent: totalPoints > 0 ? Math.round((Math.max(0, myPoints) / totalPoints) * 1000) / 10 : 0,
    total_points: totalPoints,
    weekly_points: weekly,
    ...counts
  });
});

// 랭킹 초기화 기능 ('랭킹 관리자', '시즌 관리', 또는 슈퍼관리자)
app.post('/api/ranking/reset', authenticateToken, requireRole(['랭킹 관리자', '시즌 관리']), (req, res) => {
  const {
    scope = 'season', // 'season' | 'all_seasons' | 'total_points' | 'credits' | 'everything'
    season_id,
    create_new_season = false,
    new_season_name = '',
    reason = ''
  } = req.body;

  const activeSeason = db.prepare('SELECT * FROM seasons WHERE is_active = 1 LIMIT 1').get();
  const targetSeasonId = season_id && season_id !== 'all' ? Number(season_id) : (activeSeason ? activeSeason.id : null);

  db.exec('BEGIN TRANSACTION;');
  try {
    if (scope === 'season' && targetSeasonId) {
      db.prepare('UPDATE user_season_points SET points = 0, bonus_points = 0 WHERE season_id = ?').run(targetSeasonId);
    } else if (scope === 'all_seasons') {
      db.prepare('UPDATE user_season_points SET points = 0, bonus_points = 0').run();
    } else if (scope === 'total_points') {
      const allUsers = db.prepare('SELECT id, points FROM users WHERE points != 0').all();
      for (const u of allUsers) {
        recordAssetTransaction({
          userId: u.id,
          assetType: 'POINT',
          amount: -u.points,
          category: '랭킹/포인트 전체 초기화',
          description: reason ? `[초기화] ${reason}` : `랭킹 관리자에 의한 연방 포인트 일괄 초기화`,
          actor: req.user,
          balanceBefore: u.points,
          balanceAfter: 0,
          skipWebhook: true
        });
      }
      db.prepare('UPDATE users SET points = 0').run();
      if (targetSeasonId) {
        db.prepare('UPDATE user_season_points SET points = 0, bonus_points = 0 WHERE season_id = ?').run(targetSeasonId);
      }
    } else if (scope === 'credits') {
      const allUsers = db.prepare('SELECT id, credits FROM users WHERE credits != 0').all();
      for (const u of allUsers) {
        recordAssetTransaction({
          userId: u.id,
          assetType: 'CREDIT',
          amount: -u.credits,
          category: '크레딧 전체 초기화',
          description: reason ? `[초기화] ${reason}` : `랭킹 관리자에 의한 크레딧 일괄 초기화`,
          actor: req.user,
          balanceBefore: u.credits,
          balanceAfter: 0,
          skipWebhook: true
        });
      }
      db.prepare('UPDATE users SET credits = 0').run();
    } else if (scope === 'everything') {
      const allUsers = db.prepare('SELECT id, points, credits FROM users').all();
      for (const u of allUsers) {
        if (u.points !== 0) {
          recordAssetTransaction({
            userId: u.id,
            assetType: 'POINT',
            amount: -u.points,
            category: '전체 시즌/재화 통합 초기화',
            description: reason ? `[전체 초기화] ${reason}` : `랭킹 관리자에 의한 전체 시즌/포인트 통합 초기화`,
            actor: req.user,
            balanceBefore: u.points,
            balanceAfter: 0,
            skipWebhook: true
          });
        }
        if (u.credits !== 0) {
          recordAssetTransaction({
            userId: u.id,
            assetType: 'CREDIT',
            amount: -u.credits,
            category: '전체 시즌/재화 통합 초기화',
            description: reason ? `[전체 초기화] ${reason}` : `랭킹 관리자에 의한 전체 시즌/크레딧 통합 초기화`,
            actor: req.user,
            balanceBefore: u.credits,
            balanceAfter: 0,
            skipWebhook: true
          });
        }
      }
      db.prepare('UPDATE users SET points = 0, credits = 0').run();
      db.prepare('UPDATE user_season_points SET points = 0, bonus_points = 0').run();
    }

    let createdSeasonId = null;
    if (create_new_season && new_season_name.trim()) {
      db.prepare('UPDATE seasons SET is_active = 0').run();
      const sRes = db.prepare(`
        INSERT INTO seasons (name, start_date, end_date, reward_description, target_points, is_active)
        VALUES (?, date('now'), date('now', '+30 day'), '시즌 1~3위 특별 보상 지급', 10000, 1)
      `).run(new_season_name.trim());
      createdSeasonId = sRes.lastInsertRowid;
    }

    db.exec('COMMIT;');

    sendDiscordWebhook('season_change', {
      action_label: `랭킹/시즌 초기화 (${scope})${create_new_season && new_season_name.trim() ? ' + 신규 시즌 개막' : ''}`,
      season_name: (create_new_season && new_season_name.trim()) ? new_season_name.trim() : (activeSeason?.name || '전체 시즌'),
      period: activeSeason ? `${activeSeason.start_date || ''} ~ ${activeSeason.end_date || ''}` : '-',
      description: reason || '랭킹 관리자에 의한 초기화 실행',
      actor_name: `${req.user.nickname || req.user.username} (@${req.user.username})`
    });

    res.json({
      message: '선택한 범위의 랭킹 및 수치 초기화가 완료되었습니다.',
      createdSeasonId
    });
  } catch (err) {
    db.exec('ROLLBACK;');
    res.status(500).json({ error: `랭킹 초기화 중 오류 발생: ${err.message}` });
  }
});

// 랭킹 관리자: 특정 플레이어의 랭킹 세부 수치/칭호/보너스/노출여부 정밀 수정
app.put('/api/ranking/users/:userId', authenticateToken, requireRole(['랭킹 관리자', '시즌 관리']), (req, res) => {
  const userId = Number(req.params.userId);
  const {
    season_id,
    season_points,
    bonus_points,
    total_points,
    credits,
    custom_title,
    admin_memo,
    is_hidden,
    reason
  } = req.body;

  const targetUser = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  if (!targetUser) return res.status(404).json({ error: '플레이어를 찾을 수 없습니다.' });

  const activeSeason = db.prepare('SELECT id FROM seasons WHERE is_active = 1 LIMIT 1').get();
  const targetSeasonId = (season_id && season_id !== 'all') ? Number(season_id) : (activeSeason ? activeSeason.id : null);

  db.exec('BEGIN TRANSACTION;');
  try {
    if (total_points !== undefined && total_points !== null && total_points !== '') {
      const newTotalPts = Number(total_points);
      const diffPts = newTotalPts - (targetUser.points || 0);
      if (diffPts !== 0) {
        db.prepare('UPDATE users SET points = ? WHERE id = ?').run(newTotalPts, userId);
        recordAssetTransaction({
          userId,
          assetType: 'POINT',
          amount: diffPts,
          category: '랭킹 관리자 정밀 수정',
          description: reason ? `[랭킹 정밀 조정] ${reason}` : `랭킹 관리자(${req.user.nickname || req.user.username})가 누적 연방 포인트 조정`,
          referenceType: 'ranking_admin',
          referenceId: userId,
          actor: req.user,
          balanceBefore: targetUser.points || 0,
          balanceAfter: newTotalPts
        });
      }
    }

    if (credits !== undefined && credits !== null && credits !== '') {
      const newCredits = Number(credits);
      const diffCreds = newCredits - (targetUser.credits || 0);
      if (diffCreds !== 0) {
        db.prepare('UPDATE users SET credits = ? WHERE id = ?').run(newCredits, userId);
        recordAssetTransaction({
          userId,
          assetType: 'CREDIT',
          amount: diffCreds,
          category: '랭킹 관리자 정밀 수정',
          description: reason ? `[랭킹 정밀 조정] ${reason}` : `랭킹 관리자(${req.user.nickname || req.user.username})가 보유 크레딧 조정`,
          referenceType: 'ranking_admin',
          referenceId: userId,
          actor: req.user,
          balanceBefore: targetUser.credits || 0,
          balanceAfter: newCredits
        });
      }
    }

    if (custom_title !== undefined) {
      db.prepare('UPDATE users SET custom_title = ? WHERE id = ?').run(custom_title, userId);
    }

    if (targetSeasonId) {
      const existingUsp = db.prepare('SELECT * FROM user_season_points WHERE season_id = ? AND user_id = ?').get(targetSeasonId, userId);
      const nextPts = season_points !== undefined && season_points !== '' ? Number(season_points) : (existingUsp ? existingUsp.points : (targetUser.points || 0));
      const nextBonus = bonus_points !== undefined && bonus_points !== '' ? Number(bonus_points) : (existingUsp ? existingUsp.bonus_points : 0);
      const nextTitle = custom_title !== undefined ? custom_title : (existingUsp ? existingUsp.custom_title : '');
      const nextMemo = admin_memo !== undefined ? admin_memo : (existingUsp ? existingUsp.admin_memo : '');
      const nextHidden = is_hidden !== undefined ? (is_hidden ? 1 : 0) : (existingUsp ? existingUsp.is_hidden : 0);

      db.prepare(`
        INSERT INTO user_season_points (season_id, user_id, points, bonus_points, custom_title, admin_memo, is_hidden)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(season_id, user_id) DO UPDATE SET
          points = excluded.points,
          bonus_points = excluded.bonus_points,
          custom_title = excluded.custom_title,
          admin_memo = excluded.admin_memo,
          is_hidden = excluded.is_hidden
      `).run(targetSeasonId, userId, nextPts, nextBonus, nextTitle, nextMemo, nextHidden);
    }

    db.exec('COMMIT;');

    const updatedTarget = db.prepare('SELECT points, credits FROM users WHERE id = ?').get(userId);
    const diffPtsTotal = (updatedTarget?.points || 0) - (targetUser.points || 0);
    const diffCredsTotal = (updatedTarget?.credits || 0) - (targetUser.credits || 0);
    if (diffPtsTotal !== 0 || diffCredsTotal !== 0) {
      sendDiscordWebhook('manual_adjust', {
        target_name: targetUser.nickname || targetUser.username,
        target_username: targetUser.username,
        point_diff: diffPtsTotal,
        credit_diff: diffCredsTotal,
        points_after: updatedTarget?.points || 0,
        credits_after: updatedTarget?.credits || 0,
        category: '랭킹 관리자 정밀 수치 수정',
        reason: reason || '랭킹 보드 정밀 조정',
        actor_name: `${req.user.nickname || req.user.username} (@${req.user.username})`
      });
    }

    res.json({ message: `[${targetUser.nickname || targetUser.username}] 플레이어의 랭킹 세부 수치 및 설정이 업데이트되었습니다.` });
  } catch (err) {
    db.exec('ROLLBACK;');
    res.status(500).json({ error: `랭킹 정보 수정 실패: ${err.message}` });
  }
});

// 랭킹 관리자: 전체 또는 선택 플레이어 일괄 보너스/배율/가감 적용
app.post('/api/ranking/bulk-adjust', authenticateToken, requireRole(['랭킹 관리자', '시즌 관리']), (req, res) => {
  const {
    season_id,
    action_type, // 'add_season_points' | 'add_bonus_points' | 'multiply_season_points' | 'add_total_points' | 'add_credits'
    value,
    reason = ''
  } = req.body;

  const numVal = Number(value);
  if (isNaN(numVal)) return res.status(400).json({ error: '유효한 수치를 입력해주세요.' });

  const activeSeason = db.prepare('SELECT id FROM seasons WHERE is_active = 1 LIMIT 1').get();
  const targetSeasonId = (season_id && season_id !== 'all') ? Number(season_id) : (activeSeason ? activeSeason.id : null);

  db.exec('BEGIN TRANSACTION;');
  try {
    const approvedUsers = db.prepare("SELECT id, points, credits FROM users WHERE status = 'approved'").all();

    if (action_type === 'add_season_points' && targetSeasonId) {
      for (const u of approvedUsers) {
        db.prepare(`
          INSERT INTO user_season_points (season_id, user_id, points)
          VALUES (?, ?, MAX(0, ?))
          ON CONFLICT(season_id, user_id) DO UPDATE SET points = MAX(0, points + ?)
        `).run(targetSeasonId, u.id, numVal, numVal);
      }
    } else if (action_type === 'add_bonus_points' && targetSeasonId) {
      for (const u of approvedUsers) {
        db.prepare(`
          INSERT INTO user_season_points (season_id, user_id, points, bonus_points)
          VALUES (?, ?, 0, ?)
          ON CONFLICT(season_id, user_id) DO UPDATE SET bonus_points = bonus_points + ?
        `).run(targetSeasonId, u.id, numVal, numVal);
      }
    } else if (action_type === 'multiply_season_points' && targetSeasonId) {
      db.prepare(`
        UPDATE user_season_points
        SET points = CAST(ROUND(points * ?) AS INTEGER)
        WHERE season_id = ?
      `).run(numVal, targetSeasonId);
    } else if (action_type === 'add_total_points') {
      for (const u of approvedUsers) {
        const nextPts = Math.max(0, (u.points || 0) + numVal);
        const diff = nextPts - (u.points || 0);
        db.prepare('UPDATE users SET points = ? WHERE id = ?').run(nextPts, u.id);
        if (diff !== 0) {
          recordAssetTransaction({
            userId: u.id,
            assetType: 'POINT',
            amount: diff,
            category: '일괄 포인트 조정',
            description: reason ? `[전체 일괄 조정] ${reason}` : `랭킹 관리자에 의한 전체 플레이어 포인트 일괄 증감`,
            actor: req.user,
            balanceBefore: u.points || 0,
            balanceAfter: nextPts,
            skipWebhook: true
          });
        }
      }
    } else if (action_type === 'add_credits') {
      for (const u of approvedUsers) {
        const nextCreds = Math.max(0, (u.credits || 0) + numVal);
        const diff = nextCreds - (u.credits || 0);
        db.prepare('UPDATE users SET credits = ? WHERE id = ?').run(nextCreds, u.id);
        if (diff !== 0) {
          recordAssetTransaction({
            userId: u.id,
            assetType: 'CREDIT',
            amount: diff,
            category: '일괄 크레딧 조정',
            description: reason ? `[전체 일괄 조정] ${reason}` : `랭킹 관리자에 의한 전체 플레이어 크레딧 일괄 증감`,
            actor: req.user,
            balanceBefore: u.credits || 0,
            balanceAfter: nextCreds,
            skipWebhook: true
          });
        }
      }
    } else {
      throw new Error('올바른 일괄 작업 유형을 선택해주세요.');
    }

    db.exec('COMMIT;');

    const actionLabels = {
      add_season_points: `시즌 포인트 일괄 ${numVal >= 0 ? `+${numVal}` : numVal}P`,
      add_bonus_points: `보너스 포인트 일괄 ${numVal >= 0 ? `+${numVal}` : numVal}P`,
      multiply_season_points: `시즌 포인트 배율 x${numVal}`,
      add_total_points: `누적 연방 포인트 일괄 ${numVal >= 0 ? `+${numVal}` : numVal}P`,
      add_credits: `보유 크레딧 일괄 ${numVal >= 0 ? `+${numVal.toLocaleString()}` : numVal.toLocaleString()}C`
    };
    sendDiscordWebhook('ranking_bulk_adjust', {
      action_label: actionLabels[action_type] || action_type,
      value_text: String(numVal),
      target_count: approvedUsers.length,
      reason: reason || '전체 플레이어 일괄 지급/조정',
      actor_name: `${req.user.nickname || req.user.username} (@${req.user.username})`
    });

    res.json({ message: '전체 플레이어 대상 일괄 수치 조정이 완료되었습니다.' });
  } catch (err) {
    db.exec('ROLLBACK;');
    res.status(400).json({ error: err.message });
  }
});

app.get('/api/seasons', authenticateToken, (req, res) => {
  const seasons = db.prepare('SELECT * FROM seasons ORDER BY id DESC').all();
  res.json(seasons);
});

app.post('/api/seasons', authenticateToken, requireRole(['시즌 관리', '랭킹 관리자']), (req, res) => {
  const { name, start_date, end_date, reward_description, target_points } = req.body;
  if (!name) return res.status(400).json({ error: '시즌 이름을 입력해주세요.' });

  const result = db.prepare(`
    INSERT INTO seasons (name, start_date, end_date, reward_description, target_points, is_active)
    VALUES (?, ?, ?, ?, ?, 0)
  `).run(name, start_date || null, end_date || null, reward_description || '', Number(target_points) || 10000);

  sendDiscordWebhook('season_change', {
    action_label: '신규 시즌 생성',
    season_name: name,
    period: `${start_date || '미정'} ~ ${end_date || '미정'}`,
    description: reward_description || '',
    actor_name: `${req.user.nickname || req.user.username} (@${req.user.username})`
  });

  res.json({ message: '시즌이 추가되었습니다.', id: result.lastInsertRowid });
});

app.put('/api/seasons/:id', authenticateToken, requireRole(['시즌 관리', '랭킹 관리자']), (req, res) => {
  const { name, start_date, end_date, reward_description, target_points } = req.body;
  if (!name) return res.status(400).json({ error: '시즌 이름을 입력해주세요.' });

  db.prepare(`
    UPDATE seasons
    SET name = ?, start_date = ?, end_date = ?, reward_description = ?, target_points = ?
    WHERE id = ?
  `).run(name, start_date || null, end_date || null, reward_description || '', Number(target_points) || 10000, req.params.id);

  res.json({ message: '시즌 상세 정보 및 목표 수치가 수정되었습니다.' });
});

app.delete('/api/seasons/:id', authenticateToken, requireRole(['시즌 관리', '랭킹 관리자']), (req, res) => {
  const target = db.prepare('SELECT * FROM seasons WHERE id = ?').get(req.params.id);
  if (!target) return res.status(404).json({ error: '시즌을 찾을 수 없습니다.' });

  db.prepare('DELETE FROM seasons WHERE id = ?').run(req.params.id);
  res.json({ message: '시즌이 삭제되었습니다.' });
});

app.put('/api/seasons/:id/activate', authenticateToken, requireRole(['시즌 관리', '랭킹 관리자']), (req, res) => {
  db.prepare('UPDATE seasons SET is_active = 0').run();
  db.prepare('UPDATE seasons SET is_active = 1 WHERE id = ?').run(req.params.id);

  const s = db.prepare('SELECT * FROM seasons WHERE id = ?').get(req.params.id);
  if (s) {
    sendDiscordWebhook('season_change', {
      action_label: '시즌 활성화 전환',
      season_name: s.name,
      period: `${s.start_date || '미정'} ~ ${s.end_date || '미정'}`,
      description: s.reward_description || '',
      actor_name: `${req.user.nickname || req.user.username} (@${req.user.username})`
    });
  }

  res.json({ message: '선택한 시즌이 활성화되었습니다.' });
});

// --- 포인트 상점 (Shop) ---
app.get('/api/shop/items', authenticateToken, (req, res) => {
  const items = db.prepare('SELECT * FROM shop_items WHERE is_active = 1 ORDER BY id DESC').all();
  res.json(items);
});

app.post('/api/shop/items', authenticateToken, requireRole('샵 관리'), (req, res) => {
  const { name, category, unit, custom_unit, price, stock, description, image_url } = req.body;
  if (!name || price == null) return res.status(400).json({ error: '상품명과 가격을 입력해주세요.' });

  const finalCategory = (category && String(category).trim()) || '일상, 전투 아이템';
  if (unit === '기타' && (!custom_unit || !String(custom_unit).trim())) {
    return res.status(400).json({ error: '기타 단위를 직접 입력해주세요.' });
  }
  const finalUnit = (unit === '기타' ? String(custom_unit).trim() : (unit && String(unit).trim())) || '개';

  const result = db.prepare(`
    INSERT INTO shop_items (name, category, unit, price, stock, description, image_url)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(name, finalCategory, finalUnit, Number(price), stock == null ? -1 : Number(stock), description || '', image_url || '');

  res.json({ message: '상품이 등록되었습니다.', id: result.lastInsertRowid });
});

app.put('/api/shop/items/:id', authenticateToken, requireRole('샵 관리'), (req, res) => {
  const { name, category, unit, custom_unit, price, stock, description, image_url } = req.body;
  if (!name || price == null) return res.status(400).json({ error: '상품명과 가격을 입력해주세요.' });

  const finalCategory = (category && String(category).trim()) || '일상, 전투 아이템';
  if (unit === '기타' && (!custom_unit || !String(custom_unit).trim())) {
    return res.status(400).json({ error: '기타 단위를 직접 입력해주세요.' });
  }
  const finalUnit = (unit === '기타' ? String(custom_unit).trim() : (unit && String(unit).trim())) || '개';

  db.prepare(`
    UPDATE shop_items
    SET name = ?, category = ?, unit = ?, price = ?, stock = ?, description = ?, image_url = ?
    WHERE id = ?
  `).run(name, finalCategory, finalUnit, Number(price), Number(stock), description || '', image_url || '', req.params.id);

  res.json({ message: '상품 정보가 수정되었습니다.' });
});

app.delete('/api/shop/items/:id', authenticateToken, requireRole('샵 관리'), (req, res) => {
  db.prepare('UPDATE shop_items SET is_active = 0 WHERE id = ?').run(req.params.id);
  res.json({ message: '상품이 삭제되었습니다.' });
});

app.post('/api/shop/purchase', authenticateToken, (req, res) => {
  const { item_id } = req.body;
  const item = db.prepare('SELECT * FROM shop_items WHERE id = ? AND is_active = 1').get(item_id);
  if (!item) return res.status(404).json({ error: '상품을 찾을 수 없습니다.' });

  if (item.stock === 0) return res.status(400).json({ error: '품절된 상품입니다.' });
  if (req.user.points < item.price) return res.status(400).json({ error: '연방 포인트가 부족합니다.' });

  const beforePts = req.user.points || 0;
  db.prepare('UPDATE users SET points = points - ? WHERE id = ?').run(item.price, req.user.id);
  if (item.stock > 0) {
    db.prepare('UPDATE shop_items SET stock = stock - 1 WHERE id = ?').run(item.id);
  }

  const result = db.prepare(`
    INSERT INTO shop_orders (user_id, item_id, item_name, points_spent, status)
    VALUES (?, ?, ?, ?, 'pending')
  `).run(req.user.id, item.id, item.name, item.price);

  const itemCategory = item.category || '일상, 전투 아이템';
  const itemUnit = item.unit || '개';

  recordAssetTransaction({
    userId: req.user.id,
    assetType: 'POINT',
    amount: -item.price,
    category: '포인트 상점 구매',
    description: `[상점 주문 #${result.lastInsertRowid}] [${itemCategory}] '${item.name}' (1${itemUnit}) 구매`,
    referenceType: 'shop_order',
    referenceId: result.lastInsertRowid,
    actor: req.user,
    balanceBefore: beforePts,
    balanceAfter: beforePts - item.price
  });

  sendDiscordWebhook('shop_purchase', {
    order_id: result.lastInsertRowid,
    user_name: req.user.nickname || req.user.username,
    username: req.user.username,
    item_name: item.name,
    category: itemCategory,
    unit: itemUnit,
    points_spent: item.price,
    remaining_points: beforePts - item.price
  });

  res.json({ message: '구매 신청이 완료되었습니다.', order_id: result.lastInsertRowid });
});

app.get('/api/shop/orders', authenticateToken, (req, res) => {
  const canManage = req.user.is_admin === 1 || req.user.roleList.includes('샵 관리');
  let orders;
  if (canManage) {
    orders = db.prepare(`
      SELECT o.*,
             COALESCE(si.category, '일상, 전투 아이템') as item_category,
             COALESCE(si.unit, '개') as item_unit,
             u.username, u.nickname
      FROM shop_orders o
      LEFT JOIN shop_items si ON o.item_id = si.id
      JOIN users u ON o.user_id = u.id
      ORDER BY o.id DESC
    `).all();
  } else {
    orders = db.prepare(`
      SELECT o.*,
             COALESCE(si.category, '일상, 전투 아이템') as item_category,
             COALESCE(si.unit, '개') as item_unit,
             u.username, u.nickname
      FROM shop_orders o
      LEFT JOIN shop_items si ON o.item_id = si.id
      JOIN users u ON o.user_id = u.id
      WHERE o.user_id = ?
      ORDER BY o.id DESC
    `).all(req.user.id);
  }
  res.json(orders);
});

app.put('/api/shop/orders/:id/deliver', authenticateToken, requireRole('샵 관리'), (req, res) => {
  const { status = 'delivered' } = req.body || {};
  const order = db.prepare('SELECT * FROM shop_orders WHERE id = ?').get(req.params.id);
  if (!order) return res.status(404).json({ error: '주문 내역을 찾을 수 없습니다.' });

  const orderUser = db.prepare('SELECT username, nickname, points FROM users WHERE id = ?').get(order.user_id);

  if (status === 'cancelled' && order.status !== 'cancelled') {
    db.prepare('UPDATE users SET points = points + ? WHERE id = ?').run(order.points_spent, order.user_id);
    if (order.item_id) {
      db.prepare('UPDATE shop_items SET stock = stock + 1 WHERE id = ? AND stock >= 0').run(order.item_id);
    }
    recordAssetTransaction({
      userId: order.user_id,
      assetType: 'POINT',
      amount: order.points_spent,
      category: '포인트 상점 환불',
      description: `[상점 주문 #${order.id} 취소] '${order.item_name}' 포인트 환불`,
      referenceType: 'shop_order',
      referenceId: order.id,
      actor: req.user,
      balanceBefore: orderUser?.points || 0,
      balanceAfter: (orderUser?.points || 0) + order.points_spent
    });
    db.prepare("UPDATE shop_orders SET status = 'cancelled' WHERE id = ?").run(req.params.id);

    sendDiscordWebhook('shop_delivery', {
      order_id: order.id,
      user_name: orderUser ? (orderUser.nickname || orderUser.username) : `#${order.user_id}`,
      item_name: order.item_name,
      points_spent: order.points_spent,
      status: 'cancelled',
      reviewer_name: `${req.user.nickname || req.user.username} (@${req.user.username})`
    });

    return res.json({ message: '주문이 취소되었으며 포인트가 환불되었습니다.' });
  }

  db.prepare("UPDATE shop_orders SET status = 'delivered' WHERE id = ?").run(req.params.id);

  sendDiscordWebhook('shop_delivery', {
    order_id: order.id,
    user_name: orderUser ? (orderUser.nickname || orderUser.username) : `#${order.user_id}`,
    item_name: order.item_name,
    points_spent: order.points_spent,
    status: 'delivered',
    reviewer_name: `${req.user.nickname || req.user.username} (@${req.user.username})`
  });

  res.json({ message: '상품 수령/지급 처리가 완료되었습니다.' });
});

app.put('/api/shop/orders/:id/cancel', authenticateToken, (req, res) => {
  const order = db.prepare('SELECT * FROM shop_orders WHERE id = ?').get(req.params.id);
  if (!order) return res.status(404).json({ error: '주문 내역을 찾을 수 없습니다.' });

  const canManage = req.user.is_admin === 1 || req.user.roleList.includes('샵 관리') || order.user_id === req.user.id;
  if (!canManage) return res.status(403).json({ error: '주문을 취소할 권한이 없습니다.' });
  if (order.status !== 'pending') return res.status(400).json({ error: '대기 중인 주문만 취소할 수 있습니다.' });

  const orderUser = db.prepare('SELECT username, nickname, points FROM users WHERE id = ?').get(order.user_id);
  db.prepare('UPDATE users SET points = points + ? WHERE id = ?').run(order.points_spent, order.user_id);
  if (order.item_id) {
    db.prepare('UPDATE shop_items SET stock = stock + 1 WHERE id = ? AND stock >= 0').run(order.item_id);
  }
  db.prepare("UPDATE shop_orders SET status = 'cancelled' WHERE id = ?").run(req.params.id);

  recordAssetTransaction({
    userId: order.user_id,
    assetType: 'POINT',
    amount: order.points_spent,
    category: '포인트 상점 환불',
    description: `[상점 주문 #${order.id} 취소] '${order.item_name}' 포인트 환불`,
    referenceType: 'shop_order',
    referenceId: order.id,
    actor: req.user,
    balanceBefore: orderUser?.points || 0,
    balanceAfter: (orderUser?.points || 0) + order.points_spent
  });

  sendDiscordWebhook('shop_delivery', {
    order_id: order.id,
    user_name: orderUser ? (orderUser.nickname || orderUser.username) : `#${order.user_id}`,
    item_name: order.item_name,
    points_spent: order.points_spent,
    status: 'cancelled',
    reviewer_name: `${req.user.nickname || req.user.username} (@${req.user.username})`
  });

  res.json({ message: '주문이 취소되었으며 포인트가 환불되었습니다.' });
});

// --- 단기 알바 ---
function parseJobWorkers(job) {
  let workers = [];
  try {
    if (job.workers_json) {
      const parsed = JSON.parse(job.workers_json);
      if (Array.isArray(parsed)) workers = parsed;
    }
  } catch (_) {}

  if (workers.length === 0 && job.worker_id) {
    const wu = db.prepare('SELECT id, username, nickname FROM users WHERE id = ?').get(job.worker_id);
    workers = [{
      user_id: job.worker_id,
      username: wu?.username || job.worker_username || '',
      nickname: wu?.nickname || job.worker_name || wu?.username || `#${job.worker_id}`,
      worker_completed: job.worker_completed ? 1 : 0,
      employer_completed: job.employer_completed ? 1 : 0,
      applied_at: job.created_at
    }];
  } else if (workers.length > 0) {
    workers = workers.map(w => {
      const wu = db.prepare('SELECT id, username, nickname FROM users WHERE id = ?').get(w.user_id);
      return {
        ...w,
        username: wu?.username || w.username || '',
        nickname: wu?.nickname || w.nickname || wu?.username || `#${w.user_id}`,
        worker_completed: w.worker_completed ? 1 : 0,
        employer_completed: w.employer_completed ? 1 : (job.employer_completed ? 1 : 0)
      };
    });
  }
  return workers;
}

app.get('/api/jobs', authenticateToken, (req, res) => {
  const jobs = db.prepare(`
    SELECT j.*, eu.nickname as employer_name, eu.username as employer_username,
           wu.nickname as worker_name, wu.username as worker_username
    FROM part_time_jobs j
    JOIN users eu ON j.employer_id = eu.id
    LEFT JOIN users wu ON j.worker_id = wu.id
    ORDER BY j.id DESC
  `).all();

  const enriched = jobs.map(j => {
    const workers = parseJobWorkers(j);
    const maxWorkers = Math.max(1, Number(j.max_workers) || 1);
    return {
      ...j,
      max_workers: maxWorkers,
      workers,
      worker_count: workers.length,
      worker_name: workers.length > 0 ? workers.map(w => w.nickname || w.username).join(', ') : (j.worker_name || null)
    };
  });

  res.json(enriched);
});

app.post('/api/jobs', authenticateToken, requireRole(['사업가', '기업 관리']), (req, res) => {
  const { work_type, custom_work_type, description, pay_credit, max_workers, work_date, duration_text, notes, federation_points } = req.body;
  if (!work_type || !description || pay_credit == null || !work_date || !duration_text) {
    return res.status(400).json({ error: '필수 알바 항목들을 모두 입력해주세요.' });
  }

  const canManageCorp = req.user.is_admin === 1 || req.user.roleList.includes('기업 관리');
  const initialFedPts = canManageCorp && federation_points !== undefined ? Number(federation_points) || 0 : 0;
  const maxWorkers = Math.max(1, Math.floor(Number(max_workers) || 1));

  const result = db.prepare(`
    INSERT INTO part_time_jobs (
      employer_id, work_type, custom_work_type, description, pay_credit, federation_points,
      max_workers, workers_json, work_date, duration_text, notes, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, '[]', ?, ?, ?, 'pending_approval')
  `).run(
    req.user.id,
    work_type,
    custom_work_type || null,
    description,
    Number(pay_credit),
    initialFedPts,
    maxWorkers,
    work_date,
    duration_text,
    notes || null
  );

  sendDiscordWebhook('job_request', {
    id: result.lastInsertRowid,
    employer_name: req.user.nickname || req.user.username,
    employer_username: req.user.username,
    work_type: work_type === '기타' && custom_work_type ? custom_work_type : work_type,
    description,
    pay_credit: Number(pay_credit),
    max_workers: maxWorkers,
    work_date,
    duration_text,
    notes: notes || ''
  });

  res.json({ message: '알바 구인 등록이 신청되었습니다. (기업 관리자의 포인트 책정 승인 대기)', id: result.lastInsertRowid });
});

app.put('/api/jobs/:id/approve', authenticateToken, requireRole('기업 관리'), async (req, res) => {
  const { federation_points, max_workers } = req.body;
  const points = Number(federation_points) || 0;

  if (max_workers !== undefined && max_workers !== null && max_workers !== '') {
    const mw = Math.max(1, Math.floor(Number(max_workers) || 1));
    db.prepare(`
      UPDATE part_time_jobs
      SET federation_points = ?, max_workers = ?, status = 'open', approved_by = ?
      WHERE id = ?
    `).run(points, mw, req.user.id, req.params.id);
  } else {
    db.prepare(`
      UPDATE part_time_jobs
      SET federation_points = ?, status = 'open', approved_by = ?
      WHERE id = ?
    `).run(points, req.user.id, req.params.id);
  }

  const job = db.prepare(`
    SELECT j.*, u.nickname as employer_name
    FROM part_time_jobs j
    JOIN users u ON j.employer_id = u.id
    WHERE j.id = ?
  `).get(req.params.id);

  if (job) {
    sendDiscordWebhook('part_time_job', {
      ...job,
      max_workers: Math.max(1, Number(job.max_workers) || 1),
      work_type: job.work_type === '기타' && job.custom_work_type ? job.custom_work_type : job.work_type
    });
  }

  res.json({ message: '알바 구인이 승인 및 공개되었습니다.' });
});

app.post('/api/jobs/:id/apply', authenticateToken, (req, res) => {
  const job = db.prepare('SELECT * FROM part_time_jobs WHERE id = ?').get(req.params.id);
  if (!job) return res.status(404).json({ error: '알바를 찾을 수 없습니다.' });
  if (job.employer_id === req.user.id) return res.status(400).json({ error: '본인이 등록한 알바에는 지원할 수 없습니다.' });

  const workers = parseJobWorkers(job);
  const maxWorkers = Math.max(1, Number(job.max_workers) || 1);

  if (workers.some(w => Number(w.user_id) === req.user.id)) {
    return res.status(400).json({ error: '이미 지원한 알바입니다.' });
  }
  if (job.status !== 'open' && !(job.status === 'in_progress' && workers.length < maxWorkers)) {
    return res.status(400).json({ error: '모집 중인 알바가 아닙니다.' });
  }
  if (workers.length >= maxWorkers) {
    return res.status(400).json({ error: `모집 정원(${maxWorkers}명)이 모두 마감되었습니다.` });
  }

  workers.push({
    user_id: req.user.id,
    username: req.user.username,
    nickname: req.user.nickname || req.user.username,
    worker_completed: 0,
    employer_completed: 0,
    applied_at: new Date().toISOString()
  });

  const nextStatus = workers.length >= maxWorkers ? 'in_progress' : 'open';
  const primaryWorkerId = job.worker_id || req.user.id;

  db.prepare(`
    UPDATE part_time_jobs
    SET worker_id = ?, workers_json = ?, worker_completed = 0, status = ?
    WHERE id = ?
  `).run(primaryWorkerId, JSON.stringify(workers), nextStatus, req.params.id);

  const employer = db.prepare('SELECT username, nickname FROM users WHERE id = ?').get(job.employer_id);
  sendDiscordWebhook('job_progress', {
    id: job.id,
    job_id: job.id,
    action_label: `구직자 지원 및 채용 (${workers.length}/${maxWorkers}명)`,
    stage_label: `구직자 지원 (${workers.length}/${maxWorkers}명)`,
    work_type: job.work_type === '기타' && job.custom_work_type ? job.custom_work_type : job.work_type,
    employer_name: employer ? (employer.nickname || employer.username) : `#${job.employer_id}`,
    worker_name: req.user.nickname || req.user.username,
    actor_name: `${req.user.nickname || req.user.username} (@${req.user.username})`,
    pay_credit: job.pay_credit,
    federation_points: job.federation_points,
    status_label: nextStatus === 'in_progress' ? `모집 마감 · 작업 진행중 (${workers.length}/${maxWorkers}명)` : `추가 모집중 · 작업 진행 (${workers.length}/${maxWorkers}명)`
  });

  res.json({ message: `알바에 지원 및 채용되었습니다! (${workers.length}/${maxWorkers}명) 작업을 시작하세요.` });
});

app.post('/api/jobs/:id/complete', authenticateToken, (req, res) => {
  const job = db.prepare('SELECT * FROM part_time_jobs WHERE id = ?').get(req.params.id);
  if (!job) return res.status(404).json({ error: '알바를 찾을 수 없습니다.' });

  let workers = parseJobWorkers(job);
  let employerCompleted = job.employer_completed;
  let workerCompleted = job.worker_completed;

  const isEmployer = job.employer_id === req.user.id;
  const workerIdx = workers.findIndex(w => Number(w.user_id) === req.user.id);

  if (isEmployer) {
    if (workers.length === 0) {
      return res.status(400).json({ error: '아직 지원한 구직자가 없습니다.' });
    }
    employerCompleted = 1;
    workers = workers.map(w => ({ ...w, employer_completed: 1 }));
  } else if (workerIdx !== -1) {
    workers[workerIdx].worker_completed = 1;
  } else {
    return res.status(403).json({ error: '해당 알바의 고용주 또는 채용된 구직자만 완료할 수 있습니다.' });
  }

  const allWorkersDone = workers.length > 0 && workers.every(w => w.worker_completed === 1);
  workerCompleted = allWorkersDone ? 1 : 0;

  let newStatus = job.status;
  if (employerCompleted === 1 && workerCompleted === 1) {
    newStatus = 'both_done_pending_review';
  } else if (newStatus === 'open' && allWorkersDone) {
    newStatus = 'in_progress';
  }

  db.prepare(`
    UPDATE part_time_jobs
    SET employer_completed = ?, worker_completed = ?, workers_json = ?, status = ?
    WHERE id = ?
  `).run(employerCompleted, workerCompleted, JSON.stringify(workers), newStatus, req.params.id);

  const employer = db.prepare('SELECT username, nickname FROM users WHERE id = ?').get(job.employer_id);
  const workerNames = workers.length > 0 ? workers.map(w => w.nickname || w.username).join(', ') : '-';
  sendDiscordWebhook('job_progress', {
    id: job.id,
    job_id: job.id,
    action_label: newStatus === 'both_done_pending_review' ? '양측 완료 확인 (최종 정산 대기)' : `${isEmployer ? '고용주' : '구직자'} 완료 확인`,
    stage_label: newStatus === 'both_done_pending_review' ? '양측 완료 확인 (최종 정산 대기)' : `${isEmployer ? '고용주' : '구직자'} 완료 확인`,
    work_type: job.work_type === '기타' && job.custom_work_type ? job.custom_work_type : job.work_type,
    employer_name: employer ? (employer.nickname || employer.username) : `#${job.employer_id}`,
    worker_name: workerNames,
    actor_name: `${req.user.nickname || req.user.username} (@${req.user.username})`,
    pay_credit: job.pay_credit,
    federation_points: job.federation_points,
    status_label: newStatus === 'both_done_pending_review' ? '양측 완료 · 관리자 정산 대기' : '상대방/나머지 구직자 완료 확인 대기'
  });

  res.json({
    message: newStatus === 'both_done_pending_review'
      ? '고용주와 구직자 모두 완료를 확인했습니다. 기업 관리자의 최종 지급 검토 요청으로 전환되었습니다.'
      : '완료 상태가 저장되었습니다. 상대방(또는 나머지 구직자)의 완료 확인을 기다립니다.'
  });
});

app.put('/api/jobs/:id', authenticateToken, requireRole(['사업가', '기업 관리']), (req, res) => {
  const { work_type, custom_work_type, description, pay_credit, federation_points, max_workers, work_date, duration_text, notes, status } = req.body;
  const job = db.prepare('SELECT * FROM part_time_jobs WHERE id = ?').get(req.params.id);
  if (!job) return res.status(404).json({ error: '알바 공고를 찾을 수 없습니다.' });

  const canManageCorp = req.user.is_admin === 1 || req.user.roleList.includes('기업 관리');
  if (!canManageCorp && job.employer_id !== req.user.id) {
    return res.status(403).json({ error: '본인이 등록한 공고 또는 기업 관리자만 수정할 수 있습니다.' });
  }

  const workers = parseJobWorkers(job);
  const nextMaxWorkers = max_workers !== undefined ? Math.max(1, Math.floor(Number(max_workers) || 1)) : Math.max(1, Number(job.max_workers) || 1);
  let nextStatus = canManageCorp && status ? status : job.status;
  if (nextStatus === 'in_progress' && workers.length < nextMaxWorkers) {
    nextStatus = 'open';
  } else if (nextStatus === 'open' && workers.length >= nextMaxWorkers) {
    nextStatus = 'in_progress';
  }

  db.prepare(`
    UPDATE part_time_jobs
    SET work_type = ?, custom_work_type = ?, description = ?, pay_credit = ?,
        federation_points = ?, max_workers = ?, work_date = ?, duration_text = ?, notes = ?, status = ?
    WHERE id = ?
  `).run(
    work_type ?? job.work_type,
    custom_work_type ?? job.custom_work_type,
    description ?? job.description,
    pay_credit !== undefined ? Number(pay_credit) : job.pay_credit,
    canManageCorp && federation_points !== undefined ? Number(federation_points) : job.federation_points,
    nextMaxWorkers,
    work_date ?? job.work_date,
    duration_text ?? job.duration_text,
    notes ?? job.notes,
    nextStatus,
    req.params.id
  );

  res.json({ message: '단기 알바 공고 및 모집 인원/보수 수치가 수정되었습니다.' });
});

app.delete('/api/jobs/:id', authenticateToken, requireRole(['사업가', '기업 관리']), (req, res) => {
  const job = db.prepare('SELECT * FROM part_time_jobs WHERE id = ?').get(req.params.id);
  if (!job) return res.status(404).json({ error: '알바 공고를 찾을 수 없습니다.' });

  const canManageCorp = req.user.is_admin === 1 || req.user.roleList.includes('기업 관리');
  if (!canManageCorp && job.employer_id !== req.user.id) {
    return res.status(403).json({ error: '권한이 없습니다.' });
  }

  db.prepare('DELETE FROM part_time_jobs WHERE id = ?').run(req.params.id);
  res.json({ message: '단기 알바 공고가 삭제되었습니다.' });
});

app.put('/api/jobs/:id/finalize', authenticateToken, requireRole('기업 관리'), (req, res) => {
  const { decision, custom_pay_credit, custom_federation_points } = req.body;
  const job = db.prepare('SELECT * FROM part_time_jobs WHERE id = ?').get(req.params.id);
  if (!job) return res.status(404).json({ error: '알바를 찾을 수 없습니다.' });

  const workers = parseJobWorkers(job);

  if (decision === 'approve') {
    const pointMult = getNumericSetting('point_multiplier', 1.0);
    const creditMult = getNumericSetting('credit_multiplier', 1.0);

    const finalPayCredit = (custom_pay_credit !== undefined && custom_pay_credit !== null && custom_pay_credit !== '')
      ? Math.round(Number(custom_pay_credit))
      : Math.round(job.pay_credit * creditMult);

    const finalFedPoints = (custom_federation_points !== undefined && custom_federation_points !== null && custom_federation_points !== '')
      ? Math.round(Number(custom_federation_points))
      : Math.round(job.federation_points * pointMult);

    const activeSeason = db.prepare('SELECT id FROM seasons WHERE is_active = 1 LIMIT 1').get();

    for (const w of workers) {
      const workerUserId = Number(w.user_id);
      if (!workerUserId) continue;

      const beforeWorker = db.prepare('SELECT points, credits FROM users WHERE id = ?').get(workerUserId);
      if (!beforeWorker) continue;

      db.prepare('UPDATE users SET credits = credits + ?, points = points + ? WHERE id = ?')
        .run(finalPayCredit, finalFedPoints, workerUserId);

      if (finalFedPoints !== 0) {
        recordAssetTransaction({
          userId: workerUserId,
          assetType: 'POINT',
          amount: finalFedPoints,
          category: '단기 알바 완수',
          description: `[단기 알바 #${job.id}] '${job.work_type}' 노동 완수 연방 포인트 지급`,
          referenceType: 'part_time_job',
          referenceId: job.id,
          actor: req.user,
          balanceBefore: beforeWorker.points || 0,
          balanceAfter: (beforeWorker.points || 0) + finalFedPoints
        });
      }

      if (finalPayCredit !== 0) {
        recordAssetTransaction({
          userId: workerUserId,
          assetType: 'CREDIT',
          amount: finalPayCredit,
          category: '단기 알바 보수',
          description: `[단기 알바 #${job.id}] '${job.work_type}' 노동 완수 보수 지급`,
          referenceType: 'part_time_job',
          referenceId: job.id,
          actor: req.user,
          balanceBefore: beforeWorker.credits || 0,
          balanceAfter: (beforeWorker.credits || 0) + finalPayCredit
        });
      }

      if (activeSeason && finalFedPoints !== 0) {
        db.prepare(`
          INSERT INTO user_season_points (season_id, user_id, points)
          VALUES (?, ?, ?)
          ON CONFLICT(season_id, user_id) DO UPDATE SET points = points + excluded.points
        `).run(activeSeason.id, workerUserId, finalFedPoints);
      }
    }

    const updatedWorkers = workers.map(w => ({ ...w, paid: 1 }));
    db.prepare("UPDATE part_time_jobs SET status = 'completed', pay_credit = ?, federation_points = ?, workers_json = ? WHERE id = ?")
      .run(finalPayCredit, finalFedPoints, JSON.stringify(updatedWorkers), req.params.id);

    const employer = db.prepare('SELECT username, nickname FROM users WHERE id = ?').get(job.employer_id);
    const workerNames = workers.length > 0 ? workers.map(w => w.nickname || w.username).join(', ') : '-';
    const workerUsernames = workers.length > 0 ? workers.map(w => w.username).join(', ') : '-';
    sendDiscordWebhook('job_payout', {
      id: job.id,
      job_id: job.id,
      work_type: job.work_type === '기타' && job.custom_work_type ? job.custom_work_type : job.work_type,
      employer_name: employer ? (employer.nickname || employer.username) : `#${job.employer_id}`,
      worker_name: workerNames,
      worker_username: workerUsernames,
      worker_count: workers.length,
      pay_credit: finalPayCredit,
      federation_points: finalFedPoints,
      reviewer_name: `${req.user.nickname || req.user.username} (@${req.user.username})`
    });

    res.json({ message: `최종 승인 및 구직자 ${workers.length}명에게 1인당 포인트(+${finalFedPoints}P)/보수(+${finalPayCredit.toLocaleString()}C) 지급이 완료되었습니다.` });
  } else {
    db.prepare("UPDATE part_time_jobs SET status = 'cancelled' WHERE id = ?").run(req.params.id);

    const employer = db.prepare('SELECT username, nickname FROM users WHERE id = ?').get(job.employer_id);
    const workerNames = workers.length > 0 ? workers.map(w => w.nickname || w.username).join(', ') : '-';
    sendDiscordWebhook('job_progress', {
      id: job.id,
      job_id: job.id,
      action_label: '단기 알바 거절/취소 처리',
      stage_label: '단기 알바 거절/취소 처리',
      work_type: job.work_type === '기타' && job.custom_work_type ? job.custom_work_type : job.work_type,
      employer_name: employer ? (employer.nickname || employer.username) : `#${job.employer_id}`,
      worker_name: workerNames,
      actor_name: `${req.user.nickname || req.user.username} (@${req.user.username})`,
      pay_credit: job.pay_credit,
      federation_points: job.federation_points,
      status_label: '거절/취소됨 (cancelled)'
    });

    res.json({ message: '알바가 거절/취소 처리되었습니다.' });
  }
});

// --- 캘린더 모듈 ---
app.get('/api/schedules', authenticateToken, (req, res) => {
  const list = db.prepare('SELECT * FROM schedules ORDER BY start_date ASC').all();
  res.json(list);
});

app.post('/api/schedules', authenticateToken, requireRole('일정 관리'), (req, res) => {
  const { title, start_date, end_date, start_time, end_time, category, description, color } = req.body;
  if (!title || !start_date) return res.status(400).json({ error: '일정 제목과 시작일을 입력해주세요.' });

  const result = db.prepare(`
    INSERT INTO schedules (title, start_date, end_date, start_time, end_time, category, description, color, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(title, start_date, end_date || start_date, start_time || null, end_time || null, category || '일반', description || '', color || '#3b82f6', req.user.id);

  sendDiscordWebhook('schedule', {
    title,
    start_date,
    end_date,
    start_time,
    end_time,
    category,
    description
  });

  res.json({ message: '일정이 등록되었습니다.', id: result.lastInsertRowid });
});

app.put('/api/schedules/:id', authenticateToken, requireRole('일정 관리'), (req, res) => {
  const { title, start_date, end_date, start_time, end_time, category, description, color } = req.body;
  db.prepare(`
    UPDATE schedules
    SET title = ?, start_date = ?, end_date = ?, start_time = ?, end_time = ?, category = ?, description = ?, color = ?
    WHERE id = ?
  `).run(title, start_date, end_date || start_date, start_time || null, end_time || null, category || '일반', description || '', color || '#3b82f6', req.params.id);

  res.json({ message: '일정이 수정되었습니다.' });
});

app.delete('/api/schedules/:id', authenticateToken, requireRole('일정 관리'), (req, res) => {
  db.prepare('DELETE FROM schedules WHERE id = ?').run(req.params.id);
  res.json({ message: '일정이 삭제되었습니다.' });
});

// --- 퀘스트 모듈 ---
app.get('/api/quests', authenticateToken, (req, res) => {
  const quests = db.prepare('SELECT * FROM quests WHERE is_active = 1 ORDER BY id DESC').all();
  res.json(quests);
});

app.post('/api/quests', authenticateToken, requireRole('퀘스트 관리'), (req, res) => {
  const { title, target_item, reward_text, credit_reward, point_reward, notes } = req.body;
  if (!title) return res.status(400).json({ error: '퀘스트 이름을 입력해주세요.' });

  const result = db.prepare(`
    INSERT INTO quests (title, target_item, reward_text, credit_reward, point_reward, notes, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    title,
    target_item || '',
    reward_text || '',
    Number(credit_reward) || 0,
    Number(point_reward) || 0,
    notes || '',
    req.user.id
  );

  sendDiscordWebhook('quest', {
    title,
    target_item,
    reward_text,
    credit_reward: Number(credit_reward) || 0,
    point_reward: Number(point_reward) || 0,
    notes
  });

  res.json({ message: '퀘스트가 등록되었습니다.', id: result.lastInsertRowid });
});

app.put('/api/quests/:id', authenticateToken, requireRole('퀘스트 관리'), (req, res) => {
  const { title, target_item, reward_text, credit_reward, point_reward, notes } = req.body;
  db.prepare(`
    UPDATE quests
    SET title = ?, target_item = ?, reward_text = ?, credit_reward = ?, point_reward = ?, notes = ?
    WHERE id = ?
  `).run(
    title,
    target_item || '',
    reward_text || '',
    Number(credit_reward) || 0,
    Number(point_reward) || 0,
    notes || '',
    req.params.id
  );
  res.json({ message: '퀘스트가 수정되었습니다.' });
});

app.delete('/api/quests/:id', authenticateToken, requireRole('퀘스트 관리'), (req, res) => {
  db.prepare('UPDATE quests SET is_active = 0 WHERE id = ?').run(req.params.id);
  res.json({ message: '퀘스트가 삭제되었습니다.' });
});

app.get('/api/quests/submissions', authenticateToken, (req, res) => {
  const canManage = req.user.is_admin === 1 || req.user.roleList.includes('퀘스트 관리');
  let list;
  if (canManage) {
    list = db.prepare(`
      SELECT qs.*, q.title as quest_title, q.credit_reward, q.point_reward,
             u.username, u.nickname
      FROM quest_submissions qs
      JOIN quests q ON qs.quest_id = q.id
      JOIN users u ON qs.user_id = u.id
      ORDER BY qs.id DESC
    `).all();
  } else {
    list = db.prepare(`
      SELECT qs.*, q.title as quest_title, q.credit_reward, q.point_reward,
             u.username, u.nickname
      FROM quest_submissions qs
      JOIN quests q ON qs.quest_id = q.id
      JOIN users u ON qs.user_id = u.id
      WHERE qs.user_id = ?
      ORDER BY qs.id DESC
    `).all(req.user.id);
  }
  res.json(list);
});

app.post('/api/quests/:id/submit', authenticateToken, upload.single('proof_image'), (req, res) => {
  const { proof_text } = req.body;
  const proof_image = req.file ? `/uploads/${req.file.filename}` : null;

  const result = db.prepare(`
    INSERT INTO quest_submissions (quest_id, user_id, proof_text, proof_image, status)
    VALUES (?, ?, ?, ?, 'pending')
  `).run(req.params.id, req.user.id, proof_text || '', proof_image);

  const qRow = db.prepare('SELECT title FROM quests WHERE id = ?').get(req.params.id);
  sendDiscordWebhook('quest_submission', {
    submission_id: result.lastInsertRowid,
    user_name: req.user.nickname || req.user.username,
    username: req.user.username,
    quest_title: qRow?.title || `퀘스트 #${req.params.id}`,
    proof_text: proof_text || ''
  });

  res.json({ message: '퀘스트 완료 제출이 완료되었습니다.', id: result.lastInsertRowid });
});

app.put('/api/quests/submissions/:id/review', authenticateToken, requireRole('퀘스트 관리'), (req, res) => {
  const { status, admin_comment, custom_points, custom_credits } = req.body;
  if (!['approved', 'rejected'].includes(status)) {
    return res.status(400).json({ error: '올바른 승인/거절 상태를 지정하세요.' });
  }

  const sub = db.prepare(`
    SELECT qs.*, q.title as quest_title, q.point_reward, q.credit_reward, u.username, u.nickname
    FROM quest_submissions qs
    JOIN quests q ON qs.quest_id = q.id
    JOIN users u ON qs.user_id = u.id
    WHERE qs.id = ?
  `).get(req.params.id);

  if (!sub) return res.status(404).json({ error: '신청 내역을 찾을 수 없습니다.' });
  if (sub.status !== 'pending') return res.status(400).json({ error: '이미 처리된 제출입니다.' });

  let finalPoints = 0;
  let finalCredits = 0;

  if (status === 'approved') {
    const pointMult = getNumericSetting('point_multiplier', 1.0);
    const creditMult = getNumericSetting('credit_multiplier', 1.0);

    finalPoints = (custom_points !== undefined && custom_points !== null && custom_points !== '')
      ? Math.round(Number(custom_points))
      : Math.round(sub.point_reward * pointMult);

    finalCredits = (custom_credits !== undefined && custom_credits !== null && custom_credits !== '')
      ? Math.round(Number(custom_credits))
      : Math.round(sub.credit_reward * creditMult);

    const beforeUser = db.prepare('SELECT points, credits FROM users WHERE id = ?').get(sub.user_id);
    db.prepare('UPDATE users SET points = points + ?, credits = credits + ? WHERE id = ?')
      .run(finalPoints, finalCredits, sub.user_id);

    if (finalPoints !== 0) {
      recordAssetTransaction({
        userId: sub.user_id,
        assetType: 'POINT',
        amount: finalPoints,
        category: '공통 퀘스트 완수',
        description: `[퀘스트 승인 #${sub.id}] '${sub.quest_title}' 완수 연방 포인트 보상`,
        referenceType: 'quest_submission',
        referenceId: sub.id,
        actor: req.user,
        balanceBefore: beforeUser?.points || 0,
        balanceAfter: (beforeUser?.points || 0) + finalPoints
      });
    }

    if (finalCredits !== 0) {
      recordAssetTransaction({
        userId: sub.user_id,
        assetType: 'CREDIT',
        amount: finalCredits,
        category: '공통 퀘스트 완수',
        description: `[퀘스트 승인 #${sub.id}] '${sub.quest_title}' 완수 크레딧 보상`,
        referenceType: 'quest_submission',
        referenceId: sub.id,
        actor: req.user,
        balanceBefore: beforeUser?.credits || 0,
        balanceAfter: (beforeUser?.credits || 0) + finalCredits
      });
    }

    const activeSeason = db.prepare('SELECT id FROM seasons WHERE is_active = 1 LIMIT 1').get();
    if (activeSeason && finalPoints !== 0) {
      db.prepare(`
        INSERT INTO user_season_points (season_id, user_id, points)
        VALUES (?, ?, ?)
        ON CONFLICT(season_id, user_id) DO UPDATE SET points = points + excluded.points
      `).run(activeSeason.id, sub.user_id, finalPoints);
    }
  }

  db.prepare(`
    UPDATE quest_submissions
    SET status = ?, admin_comment = ?, custom_points = ?, custom_credits = ?, reviewed_by = ?
    WHERE id = ?
  `).run(status, admin_comment || '', finalPoints, finalCredits, req.user.id, req.params.id);

  if (status === 'approved') {
    sendDiscordWebhook('quest_reward', {
      submission_id: sub.id,
      user_name: sub.nickname || sub.username,
      username: sub.username,
      quest_title: sub.quest_title,
      points_earned: finalPoints,
      credits_earned: finalCredits,
      admin_comment: admin_comment || '',
      reviewer_name: `${req.user.nickname || req.user.username} (@${req.user.username})`
    });
  } else {
    sendDiscordWebhook('quest_rejected', {
      submission_id: sub.id,
      user_name: sub.nickname || sub.username,
      username: sub.username,
      quest_title: sub.quest_title,
      admin_comment: admin_comment || '',
      reviewer_name: `${req.user.nickname || req.user.username} (@${req.user.username})`
    });
  }

  res.json({ message: `퀘스트 신청이 ${status === 'approved' ? `승인 (+${finalPoints}P, +${finalCredits.toLocaleString()}C)` : '거절'}되었습니다.` });
});

// --- 크레딧 환전 & 충전 모듈 ---
app.get('/api/credits/config', authenticateToken, (req, res) => {
  const rows = db.prepare(`SELECT key, value FROM settings WHERE key IN ('exchange_rate', 'min_exchange_amount', 'exchange_fee_percent', 'credit_charge_notice')`).all();
  const cfg = {
    exchange_rate: '1.0',
    min_exchange_amount: '100',
    exchange_fee_percent: '0',
    credit_charge_notice: '인게임에서 국가 계좌로 송금하거나 납품/이벤트 보상으로 입금한 증빙 스크린샷과 일시를 첨부하여 크레딧 충전을 신청하세요.'
  };
  rows.forEach(r => { cfg[r.key] = r.value; });
  res.json(cfg);
});

app.put('/api/credits/config', authenticateToken, requireRole('크레딧 관리'), (req, res) => {
  const allowed = ['exchange_rate', 'min_exchange_amount', 'exchange_fee_percent', 'credit_charge_notice'];
  const stmt = db.prepare(`INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`);
  for (const k of allowed) {
    if (req.body[k] !== undefined) {
      stmt.run(k, String(req.body[k]));
    }
  }
  res.json({ message: '크레딧 충전/환전 정책 및 수치 설정이 저장되었습니다.' });
});

app.get('/api/credits/exchanges', authenticateToken, (req, res) => {
  const canManage = req.user.is_admin === 1 || req.user.roleList.includes('크레딧 관리');
  let list;
  if (canManage) {
    list = db.prepare(`
      SELECT ce.*, u.username, u.nickname
      FROM credit_exchanges ce
      JOIN users u ON ce.user_id = u.id
      ORDER BY ce.id DESC
    `).all();
  } else {
    list = db.prepare(`
      SELECT ce.*, u.username, u.nickname
      FROM credit_exchanges ce
      JOIN users u ON ce.user_id = u.id
      WHERE ce.user_id = ?
      ORDER BY ce.id DESC
    `).all(req.user.id);
  }
  res.json(list);
});

app.post('/api/credits/exchanges', authenticateToken, (req, res) => {
  const { amount, in_game_name } = req.body;
  const numAmount = Number(amount);
  const minAmount = getNumericSetting('min_exchange_amount', 1);

  if (!numAmount || numAmount <= 0) return res.status(400).json({ error: '환전할 크레딧 금액을 올바르게 입력해주세요.' });
  if (numAmount < minAmount) return res.status(400).json({ error: `최소 환전 신청 가능 금액은 ${minAmount.toLocaleString()} C 입니다.` });
  if (!in_game_name) return res.status(400).json({ error: '인게임 닉네임을 입력해주세요.' });

  if (req.user.credits < numAmount) {
    return res.status(400).json({ error: '보유 크레딧이 부족합니다.' });
  }

  const beforeCredits = req.user.credits || 0;
  db.prepare('UPDATE users SET credits = credits - ? WHERE id = ?').run(numAmount, req.user.id);

  const result = db.prepare(`
    INSERT INTO credit_exchanges (user_id, amount, in_game_name, status)
    VALUES (?, ?, ?, 'pending')
  `).run(req.user.id, numAmount, in_game_name);

  recordAssetTransaction({
    userId: req.user.id,
    assetType: 'CREDIT',
    amount: -numAmount,
    category: '크레딧 환전 신청',
    description: `[환전 신청 #${result.lastInsertRowid}] 인게임 닉네임 '${in_game_name}' 앞으로 ${numAmount.toLocaleString()} C 환전 출금 신청`,
    referenceType: 'credit_exchange',
    referenceId: result.lastInsertRowid,
    actor: req.user,
    balanceBefore: beforeCredits,
    balanceAfter: beforeCredits - numAmount
  });

  sendDiscordWebhook('credit_exchange_request', {
    id: result.lastInsertRowid,
    user_name: req.user.nickname || req.user.username,
    username: req.user.username,
    in_game_name,
    amount: numAmount,
    remaining_credits: beforeCredits - numAmount
  });

  res.json({ message: '인게임 원화 환전 요청이 접수되었습니다.', id: result.lastInsertRowid });
});

app.put('/api/credits/exchanges/:id/review', authenticateToken, requireRole('크레딧 관리'), (req, res) => {
  const { status, admin_comment } = req.body;
  if (!['completed', 'rejected'].includes(status)) {
    return res.status(400).json({ error: '올바른 완료/거절 상태를 지정하세요.' });
  }

  const ex = db.prepare(`
    SELECT ce.*, u.username, u.nickname
    FROM credit_exchanges ce
    JOIN users u ON ce.user_id = u.id
    WHERE ce.id = ?
  `).get(req.params.id);
  if (!ex) return res.status(404).json({ error: '환전 내역을 찾을 수 없습니다.' });
  if (ex.status !== 'pending') return res.status(400).json({ error: '이미 처리된 요청입니다.' });

  if (status === 'rejected') {
    const beforeUser = db.prepare('SELECT credits FROM users WHERE id = ?').get(ex.user_id);
    db.prepare('UPDATE users SET credits = credits + ? WHERE id = ?').run(ex.amount, ex.user_id);

    recordAssetTransaction({
      userId: ex.user_id,
      assetType: 'CREDIT',
      amount: ex.amount,
      category: '크레딧 환전 거절 환불',
      description: `[환전 거절 환불 #${ex.id}] ${admin_comment ? `사유: ${admin_comment}` : '관리자 반려로 인한 크레딧 반환'}`,
      referenceType: 'credit_exchange',
      referenceId: ex.id,
      actor: req.user,
      balanceBefore: beforeUser?.credits || 0,
      balanceAfter: (beforeUser?.credits || 0) + ex.amount
    });
  }

  db.prepare(`
    UPDATE credit_exchanges
    SET status = ?, admin_comment = ?, processed_by = ?, processed_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(status, admin_comment || '', req.user.id, req.params.id);

  sendDiscordWebhook('credit_exchange_review', {
    id: ex.id,
    status,
    user_name: ex.nickname || ex.username,
    username: ex.username,
    in_game_name: ex.in_game_name,
    amount: ex.amount,
    admin_comment: admin_comment || '',
    reviewer_name: `${req.user.nickname || req.user.username} (@${req.user.username})`
  });

  res.json({ message: `크레딧 환전 요청이 ${status === 'completed' ? '완료' : '거절(환불)'} 처리되었습니다.` });
});

// --- 크레딧 충전 신청 창구 ---
app.get('/api/credits/charges', authenticateToken, (req, res) => {
  const canManage = req.user.is_admin === 1 || req.user.roleList.includes('크레딧 관리');
  let list;
  if (canManage) {
    list = db.prepare(`
      SELECT cc.*, u.username, u.nickname as user_nickname
      FROM credit_charges cc
      JOIN users u ON cc.user_id = u.id
      ORDER BY cc.id DESC
    `).all();
  } else {
    list = db.prepare(`
      SELECT cc.*, u.username, u.nickname as user_nickname
      FROM credit_charges cc
      JOIN users u ON cc.user_id = u.id
      WHERE cc.user_id = ?
      ORDER BY cc.id DESC
    `).all(req.user.id);
  }
  res.json(list);
});

app.post('/api/credits/charges', authenticateToken, upload.single('proof_image'), (req, res) => {
  const { nickname, amount, charge_datetime, notes } = req.body;
  const numAmount = Number(amount);

  if (!nickname || !nickname.trim()) {
    return res.status(400).json({ error: '인게임 닉네임을 입력해주세요.' });
  }
  if (!numAmount || numAmount <= 0) {
    return res.status(400).json({ error: '충전할 크레딧 수량을 올바르게 입력해주세요.' });
  }
  if (!charge_datetime || !charge_datetime.trim()) {
    return res.status(400).json({ error: '송금/충전 일시를 입력해주세요.' });
  }

  const proof_image = req.file ? `/uploads/${req.file.filename}` : null;

  const result = db.prepare(`
    INSERT INTO credit_charges (user_id, nickname, amount, proof_image, charge_datetime, notes, status)
    VALUES (?, ?, ?, ?, ?, ?, 'pending')
  `).run(req.user.id, nickname.trim(), numAmount, proof_image, charge_datetime.trim(), notes || '');

  sendDiscordWebhook('credit_charge_request', {
    id: result.lastInsertRowid,
    user_name: req.user.nickname || req.user.username,
    username: req.user.username,
    in_game_name: nickname.trim(),
    amount: numAmount,
    charge_datetime: charge_datetime.trim(),
    notes: notes || ''
  });

  res.json({
    message: '크레딧 충전 신청이 접수되었습니다! 크레딧 관리자가 확인 후 충전 처리합니다.',
    id: result.lastInsertRowid
  });
});

app.put('/api/credits/charges/:id/review', authenticateToken, requireRole('크레딧 관리'), (req, res) => {
  const { status, admin_comment, custom_amount, bonus_points } = req.body;
  if (!['approved', 'rejected'].includes(status)) {
    return res.status(400).json({ error: '올바른 승인/거절 상태를 지정하세요.' });
  }

  const charge = db.prepare(`
    SELECT cc.*, u.username, u.nickname as user_nickname
    FROM credit_charges cc
    JOIN users u ON cc.user_id = u.id
    WHERE cc.id = ?
  `).get(req.params.id);
  if (!charge) return res.status(404).json({ error: '충전 신청 내역을 찾을 수 없습니다.' });
  if (charge.status !== 'pending') return res.status(400).json({ error: '이미 처리된 충전 신청입니다.' });

  let finalCredit = 0;
  let finalBonusPts = 0;

  if (status === 'approved') {
    finalCredit = (custom_amount !== undefined && custom_amount !== null && custom_amount !== '')
      ? Math.round(Number(custom_amount))
      : Number(charge.amount);
    finalBonusPts = (bonus_points !== undefined && bonus_points !== null && bonus_points !== '')
      ? Math.round(Number(bonus_points))
      : 0;

    const beforeUser = db.prepare('SELECT points, credits FROM users WHERE id = ?').get(charge.user_id);
    db.prepare('UPDATE users SET credits = credits + ?, points = points + ? WHERE id = ?')
      .run(finalCredit, finalBonusPts, charge.user_id);

    if (finalCredit !== 0) {
      recordAssetTransaction({
        userId: charge.user_id,
        assetType: 'CREDIT',
        amount: finalCredit,
        category: '크레딧 충전 승인',
        description: `[크레딧 충전 #${charge.id}] 닉네임 '${charge.nickname}' (일시: ${charge.charge_datetime}) 충전 승인${admin_comment ? ` - ${admin_comment}` : ''}`,
        referenceType: 'credit_charge',
        referenceId: charge.id,
        actor: req.user,
        balanceBefore: beforeUser?.credits || 0,
        balanceAfter: (beforeUser?.credits || 0) + finalCredit
      });
    }

    if (finalBonusPts !== 0) {
      recordAssetTransaction({
        userId: charge.user_id,
        assetType: 'POINT',
        amount: finalBonusPts,
        category: '크레딧 충전 보너스',
        description: `[크레딧 충전 #${charge.id}] 충전 승인 특별 보너스 연방 포인트 지급`,
        referenceType: 'credit_charge',
        referenceId: charge.id,
        actor: req.user,
        balanceBefore: beforeUser?.points || 0,
        balanceAfter: (beforeUser?.points || 0) + finalBonusPts
      });

      const activeSeason = db.prepare('SELECT id FROM seasons WHERE is_active = 1 LIMIT 1').get();
      if (activeSeason) {
        db.prepare(`
          INSERT INTO user_season_points (season_id, user_id, points)
          VALUES (?, ?, ?)
          ON CONFLICT(season_id, user_id) DO UPDATE SET points = points + excluded.points
        `).run(activeSeason.id, charge.user_id, finalBonusPts);
      }
    }
  }

  db.prepare(`
    UPDATE credit_charges
    SET status = ?, approved_amount = ?, bonus_points = ?, admin_comment = ?, processed_by = ?, processed_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(status, finalCredit, finalBonusPts, admin_comment || '', req.user.id, req.params.id);

  sendDiscordWebhook('credit_charge_review', {
    id: charge.id,
    status,
    user_name: charge.user_nickname || charge.username,
    username: charge.username,
    in_game_name: charge.nickname,
    approved_amount: status === 'approved' ? finalCredit : charge.amount,
    bonus_points: finalBonusPts,
    admin_comment: admin_comment || '',
    reviewer_name: `${req.user.nickname || req.user.username} (@${req.user.username})`
  });

  res.json({
    message: status === 'approved'
      ? `크레딧 충전이 승인되어 +${finalCredit.toLocaleString()} C${finalBonusPts ? ` (+${finalBonusPts} P)` : ''}가 지급되었습니다.`
      : '크레딧 충전 신청이 거절되었습니다.'
  });
});

// --- 연방 포인트 / 크레딧 입출금 상세 원장 & 데이터 관리 (CSV / XLSX 다운로드) ---
app.get('/api/transactions', authenticateToken, (req, res) => {
  const canManageData = req.user.is_admin === 1 || req.user.roleList.includes('데이터 관리') || req.user.roleList.includes('크레딧 관리') || req.user.roleList.includes('랭킹 관리자');
  const { asset_type, tx_type, category, user_id, search, start_date, end_date, limit = 300 } = req.query;

  const whereClauses = [];
  const params = [];

  if (!canManageData) {
    whereClauses.push('t.user_id = ?');
    params.push(req.user.id);
  } else if (user_id) {
    whereClauses.push('t.user_id = ?');
    params.push(Number(user_id));
  }

  if (asset_type && asset_type !== 'ALL') {
    const normalizedAsset = asset_type === 'POINTS' ? 'POINT' : (asset_type === 'CREDITS' ? 'CREDIT' : asset_type);
    whereClauses.push('t.asset_type = ?');
    params.push(normalizedAsset);
  }
  if (tx_type && tx_type !== 'ALL') {
    const normalizedTx = tx_type === 'DEPOSIT' ? 'IN' : (tx_type === 'WITHDRAW' ? 'OUT' : tx_type);
    whereClauses.push('t.tx_type = ?');
    params.push(normalizedTx);
  }
  if (category && category !== 'ALL') {
    whereClauses.push('t.category = ?');
    params.push(category);
  }
  if (start_date) {
    whereClauses.push('date(t.created_at) >= date(?)');
    params.push(start_date);
  }
  if (end_date) {
    whereClauses.push('date(t.created_at) <= date(?)');
    params.push(end_date);
  }
  if (search && search.trim()) {
    whereClauses.push('(t.username LIKE ? OR t.nickname LIKE ? OR t.description LIKE ? OR t.category LIKE ? OR t.actor_name LIKE ?)');
    const q = `%${search.trim()}%`;
    params.push(q, q, q, q, q);
  }

  const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';
  const maxLimit = Math.min(2000, Math.max(10, Number(limit) || 300));

  const rows = db.prepare(`
    SELECT t.*
    FROM asset_transactions t
    ${whereSql}
    ORDER BY t.id DESC
    LIMIT ?
  `).all(...params, maxLimit);

  // 요약 통계
  const summary = db.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN asset_type = 'POINT' AND tx_type = 'IN' THEN amount ELSE 0 END), 0) as total_point_in,
      COALESCE(SUM(CASE WHEN asset_type = 'POINT' AND tx_type = 'OUT' THEN amount ELSE 0 END), 0) as total_point_out,
      COALESCE(SUM(CASE WHEN asset_type = 'CREDIT' AND tx_type = 'IN' THEN amount ELSE 0 END), 0) as total_credit_in,
      COALESCE(SUM(CASE WHEN asset_type = 'CREDIT' AND tx_type = 'OUT' THEN amount ELSE 0 END), 0) as total_credit_out,
      COUNT(*) as total_count
    FROM asset_transactions t
    ${whereSql}
  `).get(...params);

  res.json({ transactions: rows, summary });
});

// 수동 원장 기록 추가 / 입출금 직접 발생 ('데이터 관리' 또는 슈퍼관리자)
app.post('/api/transactions/manual', authenticateToken, requireRole('데이터 관리'), (req, res) => {
  const { user_id, asset_type, tx_type, amount, category, description, apply_to_balance = true } = req.body;
  const targetUser = db.prepare('SELECT * FROM users WHERE id = ?').get(Number(user_id));
  if (!targetUser) return res.status(404).json({ error: '대상 사용자를 찾을 수 없습니다.' });

  const rawAmt = Number(amount) || 0;
  const numAmt = Math.abs(rawAmt);
  if (numAmt <= 0) return res.status(400).json({ error: '0이 아닌 수량을 입력해주세요.' });

  const normalizedAsset = (asset_type === 'POINT' || asset_type === 'POINTS') ? 'POINT' : 'CREDIT';
  const isOut = tx_type === 'OUT' || tx_type === 'WITHDRAW' || (!tx_type && rawAmt < 0);
  const signedAmt = isOut ? -numAmt : numAmt;
  const currentBal = normalizedAsset === 'POINT' ? (targetUser.points || 0) : (targetUser.credits || 0);
  const nextBal = apply_to_balance ? (currentBal + signedAmt) : currentBal;

  if (apply_to_balance) {
    if (normalizedAsset === 'POINT') {
      db.prepare('UPDATE users SET points = ? WHERE id = ?').run(nextBal, targetUser.id);
    } else {
      db.prepare('UPDATE users SET credits = ? WHERE id = ?').run(nextBal, targetUser.id);
    }
  }

  recordAssetTransaction({
    userId: targetUser.id,
    assetType: normalizedAsset,
    amount: signedAmt,
    category: category || '데이터 관리자 수기 기록',
    description: description || '데이터 관리자에 의한 수동 입출금 기록',
    referenceType: 'manual_ledger',
    actor: req.user,
    balanceBefore: currentBal,
    balanceAfter: nextBal
  });

  sendDiscordWebhook('manual_adjust', {
    target_name: targetUser.nickname || targetUser.username,
    target_username: targetUser.username,
    point_diff: normalizedAsset === 'POINT' ? signedAmt : 0,
    credit_diff: normalizedAsset === 'CREDIT' ? signedAmt : 0,
    points_after: normalizedAsset === 'POINT' ? nextBal : (targetUser.points || 0),
    credits_after: normalizedAsset === 'CREDIT' ? nextBal : (targetUser.credits || 0),
    category: category || '데이터 관리자 수기 기록',
    reason: description || '데이터 관리자에 의한 수동 입출금 기록',
    actor_name: `${req.user.nickname || req.user.username} (@${req.user.username})`
  });

  res.json({ message: '입출금 상세 기록이 성공적으로 등록되었습니다.' });
});

// 순수 Node.js 기반 표준 .xlsx (OpenXML ZIP 컨테이너) 생성기 (외부 패키지 설치 불필요)
function createXlsxBuffer(sheetName, headers, rows) {
  const escapeXml = (val) => String(val ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

  const colLetter = (idx) => {
    let s = '';
    let n = idx + 1;
    while (n > 0) {
      const rem = (n - 1) % 26;
      s = String.fromCharCode(65 + rem) + s;
      n = Math.floor((n - 1) / 26);
    }
    return s;
  };

  let sheetDataXml = '';
  // Header Row (Row 1)
  sheetDataXml += `<row r="1">`;
  headers.forEach((h, cIdx) => {
    const ref = `${colLetter(cIdx)}1`;
    sheetDataXml += `<c r="${ref}" t="inlineStr"><is><t>${escapeXml(h)}</t></is></c>`;
  });
  sheetDataXml += `</row>`;

  // Data Rows
  rows.forEach((row, rIdx) => {
    const rowNum = rIdx + 2;
    sheetDataXml += `<row r="${rowNum}">`;
    row.forEach((cellVal, cIdx) => {
      const ref = `${colLetter(cIdx)}${rowNum}`;
      if (typeof cellVal === 'number' && !isNaN(cellVal)) {
        sheetDataXml += `<c r="${ref}"><v>${cellVal}</v></c>`;
      } else {
        sheetDataXml += `<c r="${ref}" t="inlineStr"><is><t>${escapeXml(cellVal)}</t></is></c>`;
      }
    });
    sheetDataXml += `</row>`;
  });

  const contentTypesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
</Types>`;

  const relsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;

  const workbookXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>
    <sheet name="${escapeXml(sheetName || 'Sheet1')}" sheetId="1" r:id="rId1"/>
  </sheets>
</workbook>`;

  const workbookRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
</Relationships>`;

  const worksheetXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>${sheetDataXml}</sheetData>
</worksheet>`;

  const files = [
    { name: '[Content_Types].xml', data: Buffer.from(contentTypesXml, 'utf8') },
    { name: '_rels/.rels', data: Buffer.from(relsXml, 'utf8') },
    { name: 'xl/workbook.xml', data: Buffer.from(workbookXml, 'utf8') },
    { name: 'xl/_rels/workbook.xml.rels', data: Buffer.from(workbookRelsXml, 'utf8') },
    { name: 'xl/worksheets/sheet1.xml', data: Buffer.from(worksheetXml, 'utf8') }
  ];

  // CRC32 Table
  const crcTable = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    }
    crcTable[i] = c >>> 0;
  }
  const crc32 = (buf) => {
    let crc = 0xFFFFFFFF;
    for (let i = 0; i < buf.length; i++) {
      crc = crcTable[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8);
    }
    return (crc ^ 0xFFFFFFFF) >>> 0;
  };

  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const file of files) {
    const nameBuf = Buffer.from(file.name, 'utf8');
    const crc = crc32(file.data);
    const size = file.data.length;

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0); // signature
    localHeader.writeUInt16LE(20, 4); // version needed
    localHeader.writeUInt16LE(0x0800, 6); // UTF-8 flag
    localHeader.writeUInt16LE(0, 8); // store method (0 = uncompressed)
    localHeader.writeUInt16LE(0, 10); // mod time
    localHeader.writeUInt16LE(0, 12); // mod date
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(size, 18);
    localHeader.writeUInt32LE(size, 22);
    localHeader.writeUInt16LE(nameBuf.length, 26);
    localHeader.writeUInt16LE(0, 28);

    localParts.push(localHeader, nameBuf, file.data);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0); // central dir signature
    centralHeader.writeUInt16LE(20, 4); // version made by
    centralHeader.writeUInt16LE(20, 6); // version needed
    centralHeader.writeUInt16LE(0x0800, 8); // UTF-8 flag
    centralHeader.writeUInt16LE(0, 10); // store method
    centralHeader.writeUInt16LE(0, 12);
    centralHeader.writeUInt16LE(0, 14);
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(size, 20);
    centralHeader.writeUInt32LE(size, 24);
    centralHeader.writeUInt16LE(nameBuf.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(offset, 42);

    centralParts.push(centralHeader, nameBuf);
    offset += 30 + nameBuf.length + size;
  }

  const centralDirBuf = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(centralDirBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, centralDirBuf, eocd]);
}

// '데이터 관리' 권한자 또는 슈퍼관리자 전용 CSV / XLSX 다운로드
app.get('/api/transactions/export', authenticateToken, requireRole('데이터 관리'), (req, res) => {
  try {
    const { format = 'csv', asset_type, tx_type, category, user_id, search, start_date, end_date } = req.query;

    const whereClauses = [];
    const params = [];

    if (user_id) {
      whereClauses.push('t.user_id = ?');
      params.push(Number(user_id));
    }
    if (asset_type && asset_type !== 'ALL') {
      const normalizedAsset = asset_type === 'POINTS' ? 'POINT' : (asset_type === 'CREDITS' ? 'CREDIT' : asset_type);
      whereClauses.push('t.asset_type = ?');
      params.push(normalizedAsset);
    }
    if (tx_type && tx_type !== 'ALL') {
      const normalizedTx = tx_type === 'DEPOSIT' ? 'IN' : (tx_type === 'WITHDRAW' ? 'OUT' : tx_type);
      whereClauses.push('t.tx_type = ?');
      params.push(normalizedTx);
    }
    if (category && category !== 'ALL') {
      whereClauses.push('t.category = ?');
      params.push(category);
    }
    if (start_date) {
      whereClauses.push('date(t.created_at) >= date(?)');
      params.push(start_date);
    }
    if (end_date) {
      whereClauses.push('date(t.created_at) <= date(?)');
      params.push(end_date);
    }
    if (search && search.trim()) {
      whereClauses.push('(t.username LIKE ? OR t.nickname LIKE ? OR t.description LIKE ? OR t.category LIKE ? OR t.actor_name LIKE ?)');
      const q = `%${search.trim()}%`;
      params.push(q, q, q, q, q);
    }

    const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';
    const rows = db.prepare(`
      SELECT t.*
      FROM asset_transactions t
      ${whereSql}
      ORDER BY t.id DESC
    `).all(...params);

    const headers = [
      '기록번호(ID)',
      '일시(Created At)',
      '유저ID',
      '아이디(Username)',
      '닉네임(Nickname)',
      '재화종류( 포인트/크레딧 )',
      '입출금구분(입금/출금)',
      '상세분류(Category)',
      '변동수량(Amount)',
      '변동전잔액(Before)',
      '변동후잔액(After)',
      '상세내역설명(Description)',
      '연관모듈(Ref Type)',
      '연관번호(Ref ID)',
      '처리자/실행자(Actor)'
    ];

    const dataRows = rows.map(r => [
      r.id,
      r.created_at,
      r.user_id,
      r.username || '',
      r.nickname || '',
      r.asset_type === 'POINT' ? '연방 포인트(P)' : '크레딧(C)',
      r.tx_type === 'IN' ? '입금(+)' : '출금(-)',
      r.category || '',
      r.tx_type === 'IN' ? Number(r.amount) : -Number(r.amount),
      Number(r.balance_before),
      Number(r.balance_after),
      r.description || '',
      r.reference_type || '',
      r.reference_id ?? '',
      r.actor_name || '시스템'
    ]);

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

    if (String(format).toLowerCase() === 'xlsx') {
      const xlsxBuf = createXlsxBuffer('포인트_크레딧_입출금원장', headers, dataRows);
      const filename = `federation-asset-ledger-${timestamp}.xlsx`;
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      return res.send(xlsxBuf);
    } else {
      const escapeCsv = (val) => {
        const s = String(val ?? '');
        if (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r')) {
          return `"${s.replace(/"/g, '""')}"`;
        }
        return s;
      };
      const csvLines = [
        headers.map(escapeCsv).join(','),
        ...dataRows.map(r => r.map(escapeCsv).join(','))
      ];
      // UTF-8 BOM 추가 (엑셀에서 한글 깨짐 방지)
      const csvContent = '\uFEFF' + csvLines.join('\r\n');
      const filename = `federation-asset-ledger-${timestamp}.csv`;
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      return res.send(csvContent);
    }
  } catch (err) {
    console.error('[Transactions Export Error]', err);
    res.status(500).json({ error: `데이터 내보내기 오류: ${err.message}` });
  }
});

// --- 시스템 설정 (디스코드 웹훅 및 전역 수치 조절 등) ---
app.get('/api/settings', authenticateToken, (req, res) => {
  const canManage = req.user.is_admin === 1 || req.user.roleList.includes('랭킹 관리자') || req.user.roleList.includes('크레딧 관리') || req.user.roleList.includes('데이터 관리');
  if (!canManage) return res.status(403).json({ error: '권한이 필요합니다.' });

  const rows = db.prepare('SELECT * FROM settings').all();
  const settingsObj = {};
  rows.forEach(r => { settingsObj[r.key] = r.value; });
  res.json(settingsObj);
});

app.post('/api/settings', authenticateToken, (req, res) => {
  const canManage = req.user.is_admin === 1 || req.user.roleList.includes('랭킹 관리자') || req.user.roleList.includes('크레딧 관리');
  if (!canManage) return res.status(403).json({ error: '권한이 필요합니다.' });

  const { key, value, settings } = req.body;
  const upsert = db.prepare(`
    INSERT INTO settings (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `);

  if (settings && typeof settings === 'object') {
    for (const [k, v] of Object.entries(settings)) {
      if (['system_title', 'nation_name', 'server_logo_text'].includes(k) && req.user.is_admin !== 1 && req.user.username !== 'admin') continue;
      upsert.run(k, String(v ?? ''));
    }
    return res.json({ message: '시스템 세부 수치 및 정책 설정이 일괄 저장되었습니다.' });
  }

  if (key) {
    if (['system_title', 'nation_name', 'server_logo_text'].includes(key) && req.user.is_admin !== 1 && req.user.username !== 'admin') {
      return res.status(403).json({ error: '국가 및 시스템 이름은 슈퍼관리자 계정에서만 수정할 수 있습니다.' });
    }
    upsert.run(key, String(value ?? ''));
  }
  res.json({ message: '설정이 저장되었습니다.' });
});

app.post('/api/settings/test-webhook', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const whRes = await sendDiscordWebhook('schedule', {
      title: '테스트 알림',
      description: '웹훅 연동이 정상적으로 작동합니다!',
      category: '시스템 테스트',
      start_date: new Date().toISOString().split('T')[0]
    }, { isTest: true });
    res.json({
      message: '웹훅 테스트 발송을 완료했습니다.',
      fallback_webhooks: whRes?.fallback_webhook ? [whRes.fallback_webhook] : undefined
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 서버 공유 IP가 HTTP 429로 제한되었을 때 브라우저에서 대기 중인 웹훅을 대신 전송하기 위한 드레인 엔드포인트
app.get('/api/webhooks/pending-fallbacks', authenticateToken, (req, res) => {
  const items = drainPendingWebhookFallbacks();
  res.json({ fallback_webhooks: items });
});

// --- 디스코드 웹훅 개별 이벤트 상세 설정 관리 (지급 기록 포함 26종 전체) ---
app.get('/api/webhooks', authenticateToken, requireAdmin, (req, res) => {
  const globalRow = db.prepare("SELECT value FROM settings WHERE key = 'discord_webhook_url'").get();
  const configs = getAllWebhookConfigs();
  res.json({
    global_webhook_url: globalRow ? globalRow.value : '',
    configs,
    catalog: WEBHOOK_EVENT_CATALOG
  });
});

app.put('/api/webhooks', authenticateToken, requireAdmin, (req, res) => {
  const { global_webhook_url, configs } = req.body || {};

  db.exec('BEGIN TRANSACTION;');
  try {
    if (global_webhook_url !== undefined) {
      db.prepare(`
        INSERT INTO settings (key, value) VALUES ('discord_webhook_url', ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
      `).run(String(global_webhook_url || '').trim());
    }

    if (Array.isArray(configs)) {
      const upsertStmt = db.prepare(`
        INSERT INTO webhook_configs (event_key, enabled, webhook_url, mention_type, custom_mention, embed_color, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(event_key) DO UPDATE SET
          enabled = excluded.enabled,
          webhook_url = excluded.webhook_url,
          mention_type = excluded.mention_type,
          custom_mention = excluded.custom_mention,
          embed_color = excluded.embed_color,
          updated_at = CURRENT_TIMESTAMP
      `);

      for (const item of configs) {
        if (!item || !item.event_key) continue;
        const meta = WEBHOOK_EVENT_CATALOG.find(c => c.event_key === item.event_key);
        const colorVal = String(item.custom_color || item.embed_color || meta?.default_color || '#3b82f6').trim();
        upsertStmt.run(
          item.event_key,
          item.enabled ? 1 : 0,
          String(item.webhook_url || '').trim(),
          String(item.mention_type || 'none').trim(),
          String(item.custom_mention || '').trim(),
          colorVal
        );
      }
    }

    db.exec('COMMIT;');
    res.json({
      message: '웹훅 상세 설정이 저장되었습니다.',
      configs: getAllWebhookConfigs()
    });
  } catch (err) {
    try { db.exec('ROLLBACK;'); } catch (_) {}
    res.status(500).json({ error: `웹훅 설정 저장 실패: ${err.message}` });
  }
});

app.put('/api/webhooks/:eventKey', authenticateToken, requireAdmin, (req, res) => {
  const { eventKey } = req.params;
  const { enabled, webhook_url, mention_type, custom_mention, custom_color, embed_color } = req.body || {};
  const meta = WEBHOOK_EVENT_CATALOG.find(c => c.event_key === eventKey);
  if (!meta) return res.status(404).json({ error: '존재하지 않는 웹훅 이벤트 키입니다.' });

  const existing = db.prepare('SELECT * FROM webhook_configs WHERE event_key = ?').get(eventKey);
  const nextColor = custom_color !== undefined
    ? (String(custom_color).trim() || meta.default_color || '#3b82f6')
    : (embed_color !== undefined
      ? (String(embed_color).trim() || meta.default_color || '#3b82f6')
      : (existing ? existing.embed_color : (meta.default_color || '#3b82f6')));

  db.prepare(`
    INSERT INTO webhook_configs (event_key, enabled, webhook_url, mention_type, custom_mention, embed_color, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(event_key) DO UPDATE SET
      enabled = excluded.enabled,
      webhook_url = excluded.webhook_url,
      mention_type = excluded.mention_type,
      custom_mention = excluded.custom_mention,
      embed_color = excluded.embed_color,
      updated_at = CURRENT_TIMESTAMP
  `).run(
    eventKey,
    enabled !== undefined ? (enabled ? 1 : 0) : (existing ? existing.enabled : (meta.default_enabled ? 1 : 0)),
    webhook_url !== undefined ? String(webhook_url).trim() : (existing ? existing.webhook_url : ''),
    mention_type !== undefined ? String(mention_type).trim() : (existing ? existing.mention_type : 'none'),
    custom_mention !== undefined ? String(custom_mention).trim() : (existing ? existing.custom_mention : ''),
    nextColor
  );

  res.json({
    message: `[${meta.name}] 웹훅 설정이 업데이트되었습니다.`,
    configs: getAllWebhookConfigs()
  });
});

app.post('/api/webhooks/:eventKey/test', authenticateToken, requireAdmin, async (req, res) => {
  const { eventKey } = req.params;
  const { custom_url } = req.body || {};
  const meta = WEBHOOK_EVENT_CATALOG.find(c => c.event_key === eventKey);
  if (!meta) return res.status(404).json({ error: '존재하지 않는 웹훅 이벤트입니다.' });

  try {
    const result = await sendTestEventWebhook(eventKey, custom_url ? { webhook_url: custom_url } : {}, req.user);
    if (!result || !result.success) {
      return res.status(400).json({ error: result?.error || '웹훅 테스트 발송에 실패했습니다.' });
    }
    res.json({
      message: `[${meta.name}] 테스트 웹훅이 디스코드 채널로 발송되었습니다!`,
      fallback_webhooks: result?.fallback_webhook ? [result.fallback_webhook] : undefined
    });
  } catch (err) {
    res.status(400).json({ error: err.message || '웹훅 테스트 발송에 실패했습니다.' });
  }
});

// --- 슈퍼관리자 전용 데이터 백업 및 복원 (JSON) ---
const DB_TABLES = [
  'settings',
  'webhook_configs',
  'users',
  'roles',
  'user_roles',
  'seasons',
  'user_season_points',
  'ranking_tiers',
  'supplies',
  'supply_requests',
  'notices',
  'shop_items',
  'shop_orders',
  'part_time_jobs',
  'schedules',
  'quests',
  'quest_submissions',
  'credit_exchanges',
  'credit_charges',
  'asset_transactions'
];

// 1. 데이터 JSON으로 추출 (Export)
app.get('/api/admin/export', authenticateToken, requireAdmin, (req, res) => {
  try {
    const exportData = {
      version: '1.0',
      system: 'minecraft-platform',
      exported_at: new Date().toISOString(),
      exported_by: {
        id: req.user.id,
        username: req.user.username,
        nickname: req.user.nickname
      },
      counts: {},
      data: {}
    };

    for (const table of DB_TABLES) {
      const rows = db.prepare(`SELECT * FROM ${table}`).all();
      exportData.data[table] = rows;
      exportData.counts[table] = rows.length;
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const filename = `minecraft-platform-backup-${timestamp}.json`;

    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(JSON.stringify(exportData, null, 2));
  } catch (err) {
    console.error('[Export Error]', err);
    res.status(500).json({ error: `데이터 추출 중 오류가 발생했습니다: ${err.message}` });
  }
});

// 2. 데이터 JSON으로 불러오기 (Import / Restore)
app.post('/api/admin/import', authenticateToken, requireAdmin, upload.single('backup_file'), (req, res) => {
  try {
    let importPayload;
    if (req.file) {
      const fileContent = fs.readFileSync(req.file.path, 'utf-8');
      try {
        importPayload = JSON.parse(fileContent);
      } catch (parseErr) {
        fs.unlinkSync(req.file.path);
        return res.status(400).json({ error: '업로드된 파일이 유효한 JSON 형식이 아닙니다.' });
      }
      fs.unlinkSync(req.file.path);
    } else if (req.body.data || typeof req.body === 'object') {
      importPayload = req.body;
    } else {
      return res.status(400).json({ error: '복원할 JSON 데이터 또는 파일이 전달되지 않았습니다.' });
    }

    const tablesData = importPayload.data || importPayload;
    if (!tablesData || typeof tablesData !== 'object') {
      return res.status(400).json({ error: '유효한 JSON 백업 데이터 형식이 아닙니다.' });
    }

    const currentSuperAdmin = req.user;
    // 복원 데이터에 현재 관리자가 없을 경우를 대비해, 비우기 전에 비밀번호 해시를 보관
    const savedAdminPassword = db.prepare('SELECT password FROM users WHERE id = ?').get(currentSuperAdmin.id)?.password;
    const restoredCounts = {};

    // SQLite 외래키 제약 임시 해제 및 트랜잭션 수행
    db.exec('PRAGMA foreign_keys = OFF;');
    db.exec('BEGIN TRANSACTION;');

    try {
      // 1) 역순으로 테이블 데이터 비우기
      const reversedTables = [...DB_TABLES].reverse();
      for (const table of reversedTables) {
        if (tablesData[table] && Array.isArray(tablesData[table])) {
          db.prepare(`DELETE FROM ${table}`).run();
        }
      }

      // 2) 순서대로 테이블 데이터 복원
      for (const table of DB_TABLES) {
        const rows = tablesData[table];
        if (Array.isArray(rows) && rows.length > 0) {
          restoredCounts[table] = 0;
          const firstRow = rows[0];
          const columns = Object.keys(firstRow);
          const placeholders = columns.map(() => '?').join(', ');
          const insertStmt = db.prepare(`INSERT OR REPLACE INTO ${table} (${columns.join(', ')}) VALUES (${placeholders})`);

          for (const row of rows) {
            const values = columns.map(col => row[col] === undefined ? null : row[col]);
            insertStmt.run(...values);
            restoredCounts[table]++;
          }
        } else {
          restoredCounts[table] = 0;
        }
      }

      // 3) 안전장치: 현재 슈퍼관리자 계정이 삭제되지 않도록 보장
      const checkAdmin = db.prepare('SELECT id, is_admin FROM users WHERE id = ?').get(currentSuperAdmin.id);
      if (!checkAdmin) {
        const pw = savedAdminPassword;
        db.prepare(`
          INSERT OR REPLACE INTO users (id, username, password, nickname, is_admin, roles, status)
          VALUES (?, ?, ?, ?, 1, '[]', 'approved')
        `).run(
          currentSuperAdmin.id,
          currentSuperAdmin.username,
          pw || bcrypt.hashSync('admin', 10),
          currentSuperAdmin.nickname || '슈퍼관리자'
        );
      } else if (checkAdmin.is_admin !== 1) {
        db.prepare('UPDATE users SET is_admin = 1 WHERE id = ?').run(currentSuperAdmin.id);
      }

      db.exec('COMMIT;');
    } catch (innerError) {
      db.exec('ROLLBACK;');
      throw innerError;
    } finally {
      db.exec('PRAGMA foreign_keys = ON;');
    }

    // 예전 형식 백업(users.roles 에 권한 문자열 저장)을 복원한 경우 역할 시스템으로 변환
    initDatabase();
    migrateLegacyUserPermissions();
    normalizeRolePositions();

    res.json({
      message: '데이터베이스 복원이 성공적으로 완료되었습니다.',
      restoredCounts
    });
  } catch (err) {
    console.error('[Import Error]', err);
    res.status(500).json({ error: `데이터 불러오기 중 오류가 발생했습니다: ${err.message}` });
  }
});

// 2-1. 무료 클라우드 서버 컨테이너 재배포/재시작(write_count === '0') 시 브라우저 로컬 스냅샷 즉시 복구
app.post('/api/admin/auto-restore', (req, res) => {
  try {
    const writeCountRow = db.prepare("SELECT value FROM settings WHERE key = 'write_count'").get();
    const isFreshContainer = !writeCountRow || String(writeCountRow.value) === '0';
    if (!isFreshContainer) {
      return res.status(409).json({ error: '서버에 이미 데이터가 존재하여 초기 자동 복원을 건너뜁니다.' });
    }

    const importPayload = req.body;
    const tablesData = importPayload?.data || importPayload;
    if (!tablesData || typeof tablesData !== 'object' || !Array.isArray(tablesData.users) || tablesData.users.length === 0) {
      return res.status(400).json({ error: '유효한 스냅샷 데이터가 아닙니다.' });
    }

    const restoredCounts = {};
    db.exec('PRAGMA foreign_keys = OFF;');
    db.exec('BEGIN TRANSACTION;');
    try {
      const reversedTables = [...DB_TABLES].reverse();
      for (const table of reversedTables) {
        if (tablesData[table] && Array.isArray(tablesData[table])) {
          db.prepare(`DELETE FROM ${table}`).run();
        }
      }

      for (const table of DB_TABLES) {
        const rows = tablesData[table];
        if (Array.isArray(rows) && rows.length > 0) {
          restoredCounts[table] = 0;
          const firstRow = rows[0];
          const columns = Object.keys(firstRow);
          const placeholders = columns.map(() => '?').join(', ');
          const insertStmt = db.prepare(`INSERT OR REPLACE INTO ${table} (${columns.join(', ')}) VALUES (${placeholders})`);
          for (const row of rows) {
            const values = columns.map(col => row[col] === undefined ? null : row[col]);
            insertStmt.run(...values);
            restoredCounts[table]++;
          }
        } else {
          restoredCounts[table] = 0;
        }
      }

      db.exec('COMMIT;');
    } catch (innerErr) {
      db.exec('ROLLBACK;');
      throw innerErr;
    } finally {
      db.exec('PRAGMA foreign_keys = ON;');
    }

    initDatabase();
    migrateLegacyUserPermissions();
    normalizeRolePositions();

    res.json({
      message: '컨테이너 초기 상태 감지: 브라우저 스냅샷으로부터 데이터베이스가 자동 복원되었습니다.',
      restoredCounts
    });
  } catch (err) {
    console.error('[AutoRestore Error]', err);
    res.status(500).json({ error: `자동 복원 중 오류 발생: ${err.message}` });
  }
});

// 3. 데이터베이스 초기화 (전체 리셋 또는 운영 내역·재화 리셋)
app.post('/api/admin/reset', authenticateToken, requireAdmin, (req, res) => {
  try {
    const mode = req.body?.mode === 'activity' ? 'activity' : 'all';
    const resetAdminPassword = Boolean(req.body?.resetAdminPassword);
    const result = resetDatabase(mode, { resetAdminPassword, uploadDir });
    res.json({
      message: mode === 'activity'
        ? '모든 운영 내역(납품·퀘스트·알바·상점·원장·시즌)과 전 플레이어 보유 재화(P/C)가 0으로 초기화되었습니다.'
        : '데이터베이스가 깨끗한 초기 상태(공장 초기화)로 리셋되었습니다.',
      ...result
    });
  } catch (err) {
    console.error('[Reset Error]', err);
    res.status(500).json({ error: `데이터 초기화 중 오류가 발생했습니다: ${err.message}` });
  }
});

// 국가 및 시스템 브랜딩 (공개 조회 + DB 동기화 메타데이터 포함)
app.get('/api/settings/branding', (req, res) => {
  const rows = db.prepare("SELECT key, value FROM settings WHERE key IN ('system_title', 'nation_name', 'server_logo_text', 'login_subtitle', 'login_message', 'db_epoch', 'write_count')").all();
  const branding = {
    system_title: 'FEDERATION',
    nation_name: '마인크래프트 전쟁 관리',
    server_logo_text: 'M',
    login_subtitle: '',
    login_message: '',
    db_epoch: '1',
    write_count: '0'
  };
  rows.forEach(r => { branding[r.key] = r.value; });
  res.json(branding);
});

// 국가 및 시스템 브랜딩 · 초기 로그인 화면 메시지 수정
app.put('/api/settings/branding', authenticateToken, (req, res) => {
  const isSuperAdmin = req.user.is_admin === 1 || req.user.username === 'admin';
  const canManageNotice = isSuperAdmin || (Array.isArray(req.user.roleList) && req.user.roleList.includes('공지 관리'));
  if (!canManageNotice) {
    return res.status(403).json({ error: '국가/시스템 브랜딩 및 로그인 화면 메시지 수정 권한이 없습니다.' });
  }

  const { system_title, nation_name, server_logo_text, login_subtitle, login_message } = req.body || {};
  if (isSuperAdmin) {
    if (system_title !== undefined && String(system_title).trim()) {
      db.prepare("INSERT INTO settings (key, value) VALUES ('system_title', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(String(system_title).trim());
    }
    if (nation_name !== undefined && String(nation_name).trim()) {
      db.prepare("INSERT INTO settings (key, value) VALUES ('nation_name', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(String(nation_name).trim());
    }
    if (server_logo_text !== undefined && String(server_logo_text).trim()) {
      db.prepare("INSERT INTO settings (key, value) VALUES ('server_logo_text', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(String(server_logo_text).trim());
    }
  }
  if (login_subtitle !== undefined) {
    db.prepare("INSERT INTO settings (key, value) VALUES ('login_subtitle', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(String(login_subtitle).trim());
  }
  if (login_message !== undefined) {
    db.prepare("INSERT INTO settings (key, value) VALUES ('login_message', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(String(login_message));
  }

  res.json({ message: '시스템 브랜딩 및 초기 로그인 화면 메시지가 성공적으로 저장되었습니다.' });
});

// 프론트엔드 정적 파일 서빙 지원 (배포 패키지용 public 또는 ../frontend/dist)
const publicDir = path.join(__dirname, 'public');
const distDir = path.join(__dirname, '../frontend/dist');
const clientDist = fs.existsSync(publicDir) ? publicDir : (fs.existsSync(distDir) ? distDir : null);

if (clientDist) {
  app.use(express.static(clientDist));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/uploads')) {
      return next();
    }
    res.sendFile(path.join(clientDist, 'index.html'));
  });
}

// 서버 실행
app.listen(PORT, () => {
  console.log(`[Backend] Minecraft Platform Server running on port ${PORT}`);

  // Render 등 무료 클라우드 서버 15분 절전(슬립) 방지를 위한 자체 Keep-Alive 타이머 (4분 주기)
  const selfUrl = process.env.RENDER_EXTERNAL_URL || process.env.SELF_URL || (process.env.RENDER ? 'https://conmanage.onrender.com' : '');
  if (selfUrl) {
    setInterval(() => {
      fetch(`${selfUrl.replace(/\/$/, '')}/api/health`).catch(() => {});
    }, 4 * 60 * 1000);
  }
});
