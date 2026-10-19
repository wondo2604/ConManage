import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { db, initDatabase, ALL_ROLES } from './db.js';
import { sendDiscordWebhook, sendNoticeDiscordWebhook, getGlobalWebhookUrl } from './discord.js';

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
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use('/uploads', express.static(uploadDir));

// --- Auth 미들웨어 ---
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ error: '인증 토큰이 필요합니다.' });

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ error: '유효하지 않거나 만료된 토큰입니다.' });
    const freshUser = db.prepare('SELECT id, username, nickname, points, credits, must_change_password, is_admin, roles, status FROM users WHERE id = ?').get(user.id);
    if (!freshUser) return res.status(404).json({ error: '존재하지 않는 유저입니다.' });

    freshUser.roleList = JSON.parse(freshUser.roles || '[]');
    req.user = freshUser;
    next();
  });
}

function requireRole(roleName) {
  return (req, res, next) => {
    if (req.user.is_admin === 1) return next();
    if (req.user.roleList.includes(roleName)) return next();
    return res.status(403).json({ error: `'${roleName}' 권한이 필요합니다.` });
  };
}

function requireAdmin(req, res, next) {
  if (req.user.is_admin === 1) return next();
  return res.status(403).json({ error: '슈퍼관리자 권한이 필요합니다.' });
}

// --- 인증 라우트 ---
app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: '아이디와 비밀번호를 입력해주세요.' });
  }

  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user || !bcrypt.compareSync(password, user.password)) {
    return res.status(401).json({ error: '아이디 또는 비밀번호가 올바르지 않습니다.' });
  }

  // 가입 승인 상태 체크
  if (user.status === 'pending') {
    return res.status(403).json({ error: '가입 승인 대기 중입니다. "계정 관리" 관리자의 승인 후 로그인하실 수 있습니다.' });
  }
  if (user.status === 'rejected') {
    return res.status(403).json({ error: '가입 승인이 거절된 계정입니다. 관리자에게 문의하세요.' });
  }

  const roleList = JSON.parse(user.roles || '[]');
  const token = jwt.sign(
    { id: user.id, username: user.username, is_admin: user.is_admin },
    JWT_SECRET,
    { expiresIn: '7d' }
  );

  res.json({
    token,
    user: {
      id: user.id,
      username: user.username,
      nickname: user.nickname,
      points: user.points,
      credits: user.credits,
      must_change_password: user.must_change_password === 1,
      is_admin: user.is_admin === 1,
      roles: roleList,
      status: user.status
    }
  });
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
  res.json({
    user: {
      id: req.user.id,
      username: req.user.username,
      nickname: req.user.nickname,
      points: req.user.points,
      credits: req.user.credits,
      must_change_password: req.user.must_change_password === 1,
      is_admin: req.user.is_admin === 1,
      roles: req.user.roleList,
      status: req.user.status
    }
  });
});

// 회원가입: 즉시 가입되지 않고 'pending' 상태로 등록
app.post('/api/auth/register', (req, res) => {
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

  res.json({
    message: '회원가입 신청이 성공적으로 접수되었습니다! "계정 관리" 관리자의 승인 후 로그인할 수 있습니다.',
    pending: true
  });
});

// --- 유저 & 계정 관리 ---
app.get('/api/users', authenticateToken, (req, res) => {
  const canManage = req.user.is_admin === 1 || req.user.roleList.includes('계정 관리');
  if (!canManage) {
    return res.status(403).json({ error: '"계정 관리" 또는 슈퍼관리자 권한이 필요합니다.' });
  }

  const users = db.prepare(`
    SELECT id, username, nickname, points, credits, must_change_password, is_admin, roles, status, created_at
    FROM users ORDER BY id ASC
  `).all();
  const parsed = users.map(u => ({
    ...u,
    roles: JSON.parse(u.roles || '[]'),
    must_change_password: u.must_change_password === 1,
    is_admin: u.is_admin === 1
  }));
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

  db.prepare('UPDATE users SET status = ? WHERE id = ?').run(status, req.params.id);
  res.json({ message: `계정이 ${status === 'approved' ? '승인' : '거절'}되었습니다.` });
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
  const allRolesJson = JSON.stringify(ALL_ROLES);

  const result = db.prepare(`
    INSERT INTO users (username, password, nickname, points, credits, must_change_password, is_admin, roles, status)
    VALUES (?, ?, ?, 1000, 50000, 1, 1, ?, 'approved')
  `).run(username, hash, nickname || '슈퍼관리자', allRolesJson);

  res.json({
    message: '새로운 슈퍼 관리자 계정이 생성되었습니다. (접속 시 비밀번호 변경 요청)',
    id: result.lastInsertRowid
  });
});

app.put('/api/users/:id/roles', authenticateToken, requireAdmin, (req, res) => {
  const { roles, is_admin } = req.body;
  const rolesJson = JSON.stringify(roles || []);
  const isAdminVal = is_admin ? 1 : 0;

  db.prepare('UPDATE users SET roles = ?, is_admin = ? WHERE id = ?').run(rolesJson, isAdminVal, req.params.id);
  res.json({ message: '역할이 업데이트되었습니다.' });
});

app.put('/api/users/:id/assets', authenticateToken, requireAdmin, (req, res) => {
  const { points, credits } = req.body;
  db.prepare('UPDATE users SET points = ?, credits = ? WHERE id = ?').run(Number(points) || 0, Number(credits) || 0, req.params.id);
  res.json({ message: '재화가 업데이트되었습니다.' });
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
  // 즉시 전송 요청이 있거나 자동 웹훅이 활성화된 경우 디스코드 발송
  if (send_now || webhook_enabled) {
    try {
      await sendNoticeDiscordWebhook({
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
      webhookMessage = ' (디스코드 웹훅 알림이 성공적으로 전송되었습니다.)';
    } catch (err) {
      console.error('[Notice Webhook Error]', err.message);
      webhookMessage = ` (디스코드 웹훅 전송 오류: ${err.message})`;
    }
  }

  res.json({ message: `안내문이 업데이트되었습니다.${webhookMessage}`, id: noticeId });
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

    await sendNoticeDiscordWebhook({
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

    res.json({ message: '디스코드 테스트 웹훅 발송이 성공했습니다!' });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// --- 납품 모듈 ---
app.get('/api/supplies', authenticateToken, (req, res) => {
  const items = db.prepare('SELECT * FROM supplies WHERE is_active = 1 ORDER BY id DESC').all();
  res.json(items);
});

app.post('/api/supplies', authenticateToken, requireRole('납품 등록'), (req, res) => {
  const { name, unit, points_per_unit, credits_per_unit, description } = req.body;
  if (!name) return res.status(400).json({ error: '상품명을 입력해주세요.' });

  const result = db.prepare(`
    INSERT INTO supplies (name, unit, points_per_unit, credits_per_unit, description, created_by)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(name, unit || '개', Number(points_per_unit) || 0, Number(credits_per_unit) || 0, description || '', req.user.id);

  res.json({ message: '납품 상품이 등록되었습니다.', id: result.lastInsertRowid });
});

app.delete('/api/supplies/:id', authenticateToken, requireRole('납품 등록'), (req, res) => {
  db.prepare('UPDATE supplies SET is_active = 0 WHERE id = ?').run(req.params.id);
  res.json({ message: '납품 상품이 삭제되었습니다.' });
});

app.get('/api/supplies/requests', authenticateToken, (req, res) => {
  const canManage = req.user.is_admin === 1 || req.user.roleList.includes('납품 관리');
  let list;
  if (canManage) {
    list = db.prepare(`
      SELECT sr.*, s.name as supply_name, s.unit, s.points_per_unit, s.credits_per_unit,
             u.username, u.nickname
      FROM supply_requests sr
      JOIN supplies s ON sr.supply_id = s.id
      JOIN users u ON sr.user_id = u.id
      ORDER BY sr.id DESC
    `).all();
  } else {
    list = db.prepare(`
      SELECT sr.*, s.name as supply_name, s.unit, s.points_per_unit, s.credits_per_unit,
             u.username, u.nickname
      FROM supply_requests sr
      JOIN supplies s ON sr.supply_id = s.id
      JOIN users u ON sr.user_id = u.id
      WHERE sr.user_id = ?
      ORDER BY sr.id DESC
    `).all(req.user.id);
  }
  res.json(list);
});

app.post('/api/supplies/requests', authenticateToken, upload.single('proof_image'), (req, res) => {
  const { supply_id, amount, chest_location } = req.body;
  if (!supply_id || !amount || !chest_location) {
    return res.status(400).json({ error: '모든 필수 항목(물품, 수량, 상자 위치)을 입력해주세요.' });
  }

  const proof_image = req.file ? `/uploads/${req.file.filename}` : null;
  const result = db.prepare(`
    INSERT INTO supply_requests (supply_id, user_id, amount, chest_location, proof_image, status)
    VALUES (?, ?, ?, ?, ?, 'pending')
  `).run(supply_id, req.user.id, Number(amount), chest_location, proof_image);

  res.json({ message: '납품 신청이 접수되었습니다.', id: result.lastInsertRowid });
});

app.put('/api/supplies/requests/:id/review', authenticateToken, requireRole('납품 관리'), (req, res) => {
  const { status, admin_comment } = req.body;
  if (!['approved', 'rejected'].includes(status)) {
    return res.status(400).json({ error: '올바른 승인/거절 상태를 지정하세요.' });
  }

  const reqItem = db.prepare(`
    SELECT sr.*, s.points_per_unit, s.credits_per_unit
    FROM supply_requests sr
    JOIN supplies s ON sr.supply_id = s.id
    WHERE sr.id = ?
  `).get(req.params.id);

  if (!reqItem) return res.status(404).json({ error: '신청 내역을 찾을 수 없습니다.' });
  if (reqItem.status !== 'pending') return res.status(400).json({ error: '이미 처리된 신청입니다.' });

  let earnedPoints = 0;
  let earnedCredits = 0;

  if (status === 'approved') {
    earnedPoints = reqItem.amount * reqItem.points_per_unit;
    earnedCredits = reqItem.amount * reqItem.credits_per_unit;

    db.prepare('UPDATE users SET points = points + ?, credits = credits + ? WHERE id = ?')
      .run(earnedPoints, earnedCredits, reqItem.user_id);

    const activeSeason = db.prepare('SELECT id FROM seasons WHERE is_active = 1 LIMIT 1').get();
    if (activeSeason) {
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

  res.json({ message: `납품 신청이 ${status === 'approved' ? '승인' : '거절'}되었습니다.` });
});

// --- 랭킹 & 시즌 ---
app.get('/api/ranking', authenticateToken, (req, res) => {
  const { season_id } = req.query;
  let ranking;

  if (season_id && season_id !== 'all') {
    ranking = db.prepare(`
      SELECT u.id, u.username, u.nickname, COALESCE(usp.points, 0) as points
      FROM users u
      LEFT JOIN user_season_points usp ON u.id = usp.user_id AND usp.season_id = ?
      WHERE u.status = 'approved'
      ORDER BY points DESC, u.id ASC
      LIMIT 100
    `).all(Number(season_id));
  } else {
    ranking = db.prepare(`
      SELECT id, username, nickname, points
      FROM users
      WHERE status = 'approved'
      ORDER BY points DESC, id ASC
      LIMIT 100
    `).all();
  }

  res.json(ranking);
});

app.get('/api/seasons', authenticateToken, (req, res) => {
  const seasons = db.prepare('SELECT * FROM seasons ORDER BY id DESC').all();
  res.json(seasons);
});

app.post('/api/seasons', authenticateToken, requireAdmin, (req, res) => {
  const { name, start_date, end_date } = req.body;
  if (!name) return res.status(400).json({ error: '시즌 이름을 입력해주세요.' });

  const result = db.prepare(`
    INSERT INTO seasons (name, start_date, end_date, is_active)
    VALUES (?, ?, ?, 0)
  `).run(name, start_date || null, end_date || null);

  res.json({ message: '시즌이 추가되었습니다.', id: result.lastInsertRowid });
});

app.put('/api/seasons/:id/activate', authenticateToken, requireAdmin, (req, res) => {
  db.prepare('UPDATE seasons SET is_active = 0').run();
  db.prepare('UPDATE seasons SET is_active = 1 WHERE id = ?').run(req.params.id);
  res.json({ message: '선택한 시즌이 활성화되었습니다.' });
});

// --- 포인트 상점 (Shop) ---
app.get('/api/shop/items', authenticateToken, (req, res) => {
  const items = db.prepare('SELECT * FROM shop_items WHERE is_active = 1 ORDER BY id DESC').all();
  res.json(items);
});

app.post('/api/shop/items', authenticateToken, requireRole('샵 관리'), (req, res) => {
  const { name, price, stock, description, image_url } = req.body;
  if (!name || price == null) return res.status(400).json({ error: '상품명과 가격을 입력해주세요.' });

  const result = db.prepare(`
    INSERT INTO shop_items (name, price, stock, description, image_url)
    VALUES (?, ?, ?, ?, ?)
  `).run(name, Number(price), stock == null ? -1 : Number(stock), description || '', image_url || '');

  res.json({ message: '상품이 등록되었습니다.', id: result.lastInsertRowid });
});

app.put('/api/shop/items/:id', authenticateToken, requireRole('샵 관리'), (req, res) => {
  const { name, price, stock, description, image_url } = req.body;
  db.prepare(`
    UPDATE shop_items
    SET name = ?, price = ?, stock = ?, description = ?, image_url = ?
    WHERE id = ?
  `).run(name, Number(price), Number(stock), description || '', image_url || '', req.params.id);

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

  db.prepare('UPDATE users SET points = points - ? WHERE id = ?').run(item.price, req.user.id);
  if (item.stock > 0) {
    db.prepare('UPDATE shop_items SET stock = stock - 1 WHERE id = ?').run(item.id);
  }

  const result = db.prepare(`
    INSERT INTO shop_orders (user_id, item_id, item_name, points_spent, status)
    VALUES (?, ?, ?, ?, 'pending')
  `).run(req.user.id, item.id, item.name, item.price);

  res.json({ message: '구매 신청이 완료되었습니다.', order_id: result.lastInsertRowid });
});

app.get('/api/shop/orders', authenticateToken, (req, res) => {
  const canManage = req.user.is_admin === 1 || req.user.roleList.includes('샵 관리');
  let orders;
  if (canManage) {
    orders = db.prepare(`
      SELECT o.*, u.username, u.nickname
      FROM shop_orders o
      JOIN users u ON o.user_id = u.id
      ORDER BY o.id DESC
    `).all();
  } else {
    orders = db.prepare(`
      SELECT o.*, u.username, u.nickname
      FROM shop_orders o
      JOIN users u ON o.user_id = u.id
      WHERE o.user_id = ?
      ORDER BY o.id DESC
    `).all(req.user.id);
  }
  res.json(orders);
});

app.put('/api/shop/orders/:id/deliver', authenticateToken, requireRole('샵 관리'), (req, res) => {
  db.prepare("UPDATE shop_orders SET status = 'delivered' WHERE id = ?").run(req.params.id);
  res.json({ message: '상품 수령/지급 처리가 완료되었습니다.' });
});

// --- 단기 알바 ---
app.get('/api/jobs', authenticateToken, (req, res) => {
  const jobs = db.prepare(`
    SELECT j.*, eu.nickname as employer_name, eu.username as employer_username,
           wu.nickname as worker_name, wu.username as worker_username
    FROM part_time_jobs j
    JOIN users eu ON j.employer_id = eu.id
    LEFT JOIN users wu ON j.worker_id = wu.id
    ORDER BY j.id DESC
  `).all();
  res.json(jobs);
});

app.post('/api/jobs', authenticateToken, requireRole('사업가'), (req, res) => {
  const { work_type, custom_work_type, description, pay_credit, work_date, duration_text, notes } = req.body;
  if (!work_type || !description || pay_credit == null || !work_date || !duration_text) {
    return res.status(400).json({ error: '필수 알바 항목들을 모두 입력해주세요.' });
  }

  const result = db.prepare(`
    INSERT INTO part_time_jobs (
      employer_id, work_type, custom_work_type, description, pay_credit,
      work_date, duration_text, notes, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending_approval')
  `).run(
    req.user.id,
    work_type,
    custom_work_type || null,
    description,
    Number(pay_credit),
    work_date,
    duration_text,
    notes || null
  );

  res.json({ message: '알바 구인 등록이 신청되었습니다. (기업 관리자의 포인트 책정 승인 대기)', id: result.lastInsertRowid });
});

app.put('/api/jobs/:id/approve', authenticateToken, requireRole('기업 관리'), async (req, res) => {
  const { federation_points } = req.body;
  const points = Number(federation_points) || 0;

  db.prepare(`
    UPDATE part_time_jobs
    SET federation_points = ?, status = 'open', approved_by = ?
    WHERE id = ?
  `).run(points, req.user.id, req.params.id);

  const job = db.prepare(`
    SELECT j.*, u.nickname as employer_name
    FROM part_time_jobs j
    JOIN users u ON j.employer_id = u.id
    WHERE j.id = ?
  `).get(req.params.id);

  if (job) {
    sendDiscordWebhook('part_time_job', {
      ...job,
      work_type: job.work_type === '기타' && job.custom_work_type ? job.custom_work_type : job.work_type
    });
  }

  res.json({ message: '알바 구인이 승인 및 공개되었습니다.' });
});

app.post('/api/jobs/:id/apply', authenticateToken, (req, res) => {
  const job = db.prepare('SELECT * FROM part_time_jobs WHERE id = ?').get(req.params.id);
  if (!job) return res.status(404).json({ error: '알바를 찾을 수 없습니다.' });
  if (job.status !== 'open') return res.status(400).json({ error: '모집 중인 알바가 아닙니다.' });
  if (job.employer_id === req.user.id) return res.status(400).json({ error: '본인이 등록한 알바에는 지원할 수 없습니다.' });

  db.prepare("UPDATE part_time_jobs SET worker_id = ?, status = 'in_progress' WHERE id = ?").run(req.user.id, req.params.id);
  res.json({ message: '알바에 지원 및 채용되었습니다! 작업을 시작하세요.' });
});

app.post('/api/jobs/:id/complete', authenticateToken, (req, res) => {
  const job = db.prepare('SELECT * FROM part_time_jobs WHERE id = ?').get(req.params.id);
  if (!job) return res.status(404).json({ error: '알바를 찾을 수 없습니다.' });

  let employerCompleted = job.employer_completed;
  let workerCompleted = job.worker_completed;

  if (job.employer_id === req.user.id) {
    employerCompleted = 1;
  } else if (job.worker_id === req.user.id) {
    workerCompleted = 1;
  } else {
    return res.status(403).json({ error: '해당 알바의 고용주 또는 구직자만 완료할 수 있습니다.' });
  }

  let newStatus = job.status;
  if (employerCompleted === 1 && workerCompleted === 1) {
    newStatus = 'both_done_pending_review';
  }

  db.prepare(`
    UPDATE part_time_jobs
    SET employer_completed = ?, worker_completed = ?, status = ?
    WHERE id = ?
  `).run(employerCompleted, workerCompleted, newStatus, req.params.id);

  res.json({
    message: newStatus === 'both_done_pending_review'
      ? '양측 모두 완료를 확인했습니다. 기업 관리자의 최종 지급 검토 요청으로 전환되었습니다.'
      : '완료 상태가 저장되었습니다. 상대방의 완료 확인을 기다립니다.'
  });
});

app.put('/api/jobs/:id/finalize', authenticateToken, requireRole('기업 관리'), (req, res) => {
  const { decision } = req.body;
  const job = db.prepare('SELECT * FROM part_time_jobs WHERE id = ?').get(req.params.id);
  if (!job) return res.status(404).json({ error: '알바를 찾을 수 없습니다.' });

  if (decision === 'approve') {
    if (job.worker_id) {
      db.prepare('UPDATE users SET credits = credits + ?, points = points + ? WHERE id = ?')
        .run(job.pay_credit, job.federation_points, job.worker_id);

      const activeSeason = db.prepare('SELECT id FROM seasons WHERE is_active = 1 LIMIT 1').get();
      if (activeSeason && job.federation_points > 0) {
        db.prepare(`
          INSERT INTO user_season_points (season_id, user_id, points)
          VALUES (?, ?, ?)
          ON CONFLICT(season_id, user_id) DO UPDATE SET points = points + excluded.points
        `).run(activeSeason.id, job.worker_id, job.federation_points);
      }
    }

    db.prepare("UPDATE part_time_jobs SET status = 'completed' WHERE id = ?").run(req.params.id);
    res.json({ message: '최종 승인 및 포인트/보수 지급이 완료되었습니다.' });
  } else {
    db.prepare("UPDATE part_time_jobs SET status = 'cancelled' WHERE id = ?").run(req.params.id);
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

  res.json({ message: '퀘스트 완료 제출이 완료되었습니다.', id: result.lastInsertRowid });
});

app.put('/api/quests/submissions/:id/review', authenticateToken, requireRole('퀘스트 관리'), (req, res) => {
  const { status } = req.body;
  if (!['approved', 'rejected'].includes(status)) {
    return res.status(400).json({ error: '올바른 승인/거절 상태를 지정하세요.' });
  }

  const sub = db.prepare(`
    SELECT qs.*, q.point_reward, q.credit_reward
    FROM quest_submissions qs
    JOIN quests q ON qs.quest_id = q.id
    WHERE qs.id = ?
  `).get(req.params.id);

  if (!sub) return res.status(404).json({ error: '신청 내역을 찾을 수 없습니다.' });
  if (sub.status !== 'pending') return res.status(400).json({ error: '이미 처리된 제출입니다.' });

  if (status === 'approved') {
    db.prepare('UPDATE users SET points = points + ?, credits = credits + ? WHERE id = ?')
      .run(sub.point_reward, sub.credit_reward, sub.user_id);

    const activeSeason = db.prepare('SELECT id FROM seasons WHERE is_active = 1 LIMIT 1').get();
    if (activeSeason && sub.point_reward > 0) {
      db.prepare(`
        INSERT INTO user_season_points (season_id, user_id, points)
        VALUES (?, ?, ?)
        ON CONFLICT(season_id, user_id) DO UPDATE SET points = points + excluded.points
      `).run(activeSeason.id, sub.user_id, sub.point_reward);
    }
  }

  db.prepare(`
    UPDATE quest_submissions
    SET status = ?, reviewed_by = ?
    WHERE id = ?
  `).run(status, req.user.id, req.params.id);

  res.json({ message: `퀘스트 신청이 ${status === 'approved' ? '승인' : '거절'}되었습니다.` });
});

// --- 크레딧 환전 모듈 ---
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
  if (!numAmount || numAmount <= 0) return res.status(400).json({ error: '환전할 크레딧 금액을 올바르게 입력해주세요.' });
  if (!in_game_name) return res.status(400).json({ error: '인게임 닉네임을 입력해주세요.' });

  if (req.user.credits < numAmount) {
    return res.status(400).json({ error: '보유 크레딧이 부족합니다.' });
  }

  db.prepare('UPDATE users SET credits = credits - ? WHERE id = ?').run(numAmount, req.user.id);

  const result = db.prepare(`
    INSERT INTO credit_exchanges (user_id, amount, in_game_name, status)
    VALUES (?, ?, ?, 'pending')
  `).run(req.user.id, numAmount, in_game_name);

  res.json({ message: '인게임 원화 환전 요청이 접수되었습니다.', id: result.lastInsertRowid });
});

app.put('/api/credits/exchanges/:id/review', authenticateToken, requireRole('크레딧 관리'), (req, res) => {
  const { status, admin_comment } = req.body;
  if (!['completed', 'rejected'].includes(status)) {
    return res.status(400).json({ error: '올바른 완료/거절 상태를 지정하세요.' });
  }

  const ex = db.prepare('SELECT * FROM credit_exchanges WHERE id = ?').get(req.params.id);
  if (!ex) return res.status(404).json({ error: '환전 내역을 찾을 수 없습니다.' });
  if (ex.status !== 'pending') return res.status(400).json({ error: '이미 처리된 요청입니다.' });

  if (status === 'rejected') {
    db.prepare('UPDATE users SET credits = credits + ? WHERE id = ?').run(ex.amount, ex.user_id);
  }

  db.prepare(`
    UPDATE credit_exchanges
    SET status = ?, admin_comment = ?, processed_by = ?, processed_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(status, admin_comment || '', req.user.id, req.params.id);

  res.json({ message: `크레딧 환전 요청이 ${status === 'completed' ? '완료' : '거절(환불)'} 처리되었습니다.` });
});

// --- 시스템 설정 (디스코드 웹훅 등) ---
app.get('/api/settings', authenticateToken, requireAdmin, (req, res) => {
  const rows = db.prepare('SELECT * FROM settings').all();
  const settingsObj = {};
  rows.forEach(r => { settingsObj[r.key] = r.value; });
  res.json(settingsObj);
});

app.post('/api/settings', authenticateToken, requireAdmin, (req, res) => {
  const { key, value } = req.body;
  db.prepare(`
    INSERT INTO settings (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(key, value);
  res.json({ message: '설정이 저장되었습니다.' });
});

app.post('/api/settings/test-webhook', authenticateToken, requireAdmin, async (req, res) => {
  try {
    await sendDiscordWebhook('schedule', {
      title: '테스트 알림',
      description: '웹훅 연동이 정상적으로 작동합니다!',
      category: '시스템 테스트',
      start_date: new Date().toISOString().split('T')[0]
    });
    res.json({ message: '웹훅 테스트 발송을 완료했습니다.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- 슈퍼관리자 전용 데이터 백업 및 복원 (JSON) ---
const DB_TABLES = [
  'settings',
  'users',
  'seasons',
  'user_season_points',
  'supplies',
  'supply_requests',
  'notices',
  'shop_items',
  'shop_orders',
  'part_time_jobs',
  'schedules',
  'quests',
  'quest_submissions',
  'credit_exchanges'
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
        db.prepare(`
          INSERT OR REPLACE INTO users (id, username, password, nickname, is_admin, roles, status)
          VALUES (?, ?, ?, ?, 1, ?, 'approved')
        `).run(
          currentSuperAdmin.id,
          currentSuperAdmin.username,
          currentSuperAdmin.password || bcrypt.hashSync('admin', 10),
          currentSuperAdmin.nickname || '슈퍼관리자',
          JSON.stringify(ALL_ROLES)
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

    res.json({
      message: '데이터베이스 복원이 성공적으로 완료되었습니다.',
      restoredCounts
    });
  } catch (err) {
    console.error('[Import Error]', err);
    res.status(500).json({ error: `데이터 불러오기 중 오류가 발생했습니다: ${err.message}` });
  }
});

// 국가 및 시스템 브랜딩 (공개 조회)
app.get('/api/settings/branding', (req, res) => {
  const rows = db.prepare("SELECT key, value FROM settings WHERE key IN ('system_title', 'nation_name', 'server_logo_text')").all();
  const branding = {
    system_title: 'FEDERATION',
    nation_name: '마인크래프트 전쟁 관리',
    server_logo_text: 'M'
  };
  rows.forEach(r => { branding[r.key] = r.value; });
  res.json(branding);
});

// 국가 및 시스템 브랜딩 수정 (오직 최초 admin 계정에서만 수정 가능!)
app.put('/api/settings/branding', authenticateToken, (req, res) => {
  if (req.user.username !== 'admin') {
    return res.status(403).json({ error: '국가 및 시스템 이름은 최초 admin 계정에서만 수정할 수 있습니다.' });
  }

  const { system_title, nation_name, server_logo_text } = req.body;
  if (system_title) {
    db.prepare("INSERT INTO settings (key, value) VALUES ('system_title', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(system_title.trim());
  }
  if (nation_name) {
    db.prepare("INSERT INTO settings (key, value) VALUES ('nation_name', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(nation_name.trim());
  }
  if (server_logo_text) {
    db.prepare("INSERT INTO settings (key, value) VALUES ('server_logo_text', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(server_logo_text.trim());
  }

  res.json({ message: '국가 및 시스템 이름이 성공적으로 변경되었습니다.' });
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
});
