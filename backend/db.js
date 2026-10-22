import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import bcrypt from 'bcryptjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dataDir = process.env.DATA_DIR || __dirname;
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}
const dbPath = path.join(dataDir, 'database.sqlite');
export const db = new DatabaseSync(dbPath);

// 외래키 및 WAL 모드 활성화
db.exec(`PRAGMA journal_mode = WAL;`);
db.exec(`PRAGMA foreign_keys = ON;`);

// 권한(Permission) 카탈로그 — 디스코드처럼 '역할(Role)'에 이 권한들을 묶어서 부여한다.
// key 문자열은 서버 전역의 권한 체크(requireRole 등)에서 그대로 사용되므로 변경 시 주의.
export const PERMISSION_CATALOG = [
  { key: '역할 관리', group: '관리', description: '역할 생성·수정·삭제·순서 변경 및 사용자에게 역할 부여 (자신의 최상위 역할보다 아래 역할만)' },
  { key: '계정 관리', group: '관리', description: '가입 승인/거절, 프로필 수정, 비밀번호 초기화, 계정 삭제' },
  { key: '데이터 관리', group: '관리', description: '포인트/크레딧 입출금 원장 조회·수동 기록·엑셀 추출' },
  { key: '공지 관리', group: '관리', description: '공지사항(납품 안내문 등) 및 공지 웹훅 설정' },
  { key: '납품 등록', group: '납품', description: '납품 상품 등록·수정·삭제' },
  { key: '납품 관리', group: '납품', description: '납품 신청 승인/거절' },
  { key: '시즌 관리', group: '랭킹', description: '시즌 생성·수정·삭제·활성화' },
  { key: '랭킹 관리자', group: '랭킹', description: '랭킹 수치 조정, 계급(티어) 편집, 랭킹 초기화' },
  { key: '샵 관리', group: '상점', description: '포인트 상점 상품 등록·수정·삭제 및 주문 처리' },
  { key: '사업가', group: '단기 알바', description: '단기 알바 구인 등록 신청' },
  { key: '기업 관리', group: '단기 알바', description: '알바 구인 승인 및 완료 확인 후 포인트 지급' },
  { key: '일정 관리', group: '캘린더', description: '일정 생성·수정·삭제' },
  { key: '퀘스트 관리', group: '퀘스트', description: '퀘스트 생성·수정·삭제 및 제출 심사' },
  { key: '크레딧 관리', group: '크레딧', description: '크레딧 환전/충전 요청 처리' }
];

export const ALL_PERMISSIONS = PERMISSION_CATALOG.map(p => p.key);
// 하위 호환용 별칭
export const ALL_ROLES = ALL_PERMISSIONS;

export function initDatabase() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      nickname TEXT,
      points INTEGER DEFAULT 0,
      credits INTEGER DEFAULT 0,
      custom_title TEXT DEFAULT '',
      must_change_password INTEGER DEFAULT 0,
      is_admin INTEGER DEFAULT 0,
      roles TEXT DEFAULT '[]',
      status TEXT DEFAULT 'pending',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS seasons (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      start_date TEXT,
      end_date TEXT,
      reward_description TEXT DEFAULT '',
      target_points INTEGER DEFAULT 10000,
      is_active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS user_season_points (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      season_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      points INTEGER DEFAULT 0,
      bonus_points INTEGER DEFAULT 0,
      custom_title TEXT DEFAULT '',
      admin_memo TEXT DEFAULT '',
      is_hidden INTEGER DEFAULT 0,
      UNIQUE(season_id, user_id),
      FOREIGN KEY(season_id) REFERENCES seasons(id) ON DELETE CASCADE,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS ranking_tiers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      min_points INTEGER NOT NULL,
      badge_color TEXT DEFAULT '#3b82f6',
      icon_emoji TEXT DEFAULT '⚔️',
      perk_description TEXT DEFAULT '',
      sort_order INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS supplies (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      unit TEXT DEFAULT '개',
      points_per_unit INTEGER DEFAULT 0,
      credits_per_unit INTEGER DEFAULT 0,
      description TEXT,
      is_active INTEGER DEFAULT 1,
      created_by INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS supply_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      supply_id INTEGER,
      is_custom INTEGER DEFAULT 0,
      custom_item_name TEXT,
      custom_unit TEXT DEFAULT '개',
      custom_items_json TEXT,
      user_id INTEGER NOT NULL,
      amount INTEGER NOT NULL,
      chest_location TEXT NOT NULL,
      notes TEXT DEFAULT '',
      proof_image TEXT,
      status TEXT DEFAULT 'pending',
      admin_comment TEXT,
      points_earned INTEGER DEFAULT 0,
      credits_earned INTEGER DEFAULT 0,
      reviewed_by INTEGER,
      reviewed_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS notices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      category TEXT NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      webhook_url TEXT DEFAULT '',
      webhook_enabled INTEGER DEFAULT 0,
      mention_type TEXT DEFAULT 'none',
      embed_color TEXT DEFAULT '#3b82f6',
      message_template TEXT DEFAULT '',
      updated_by INTEGER,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS shop_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      price INTEGER NOT NULL,
      stock INTEGER DEFAULT -1,
      description TEXT,
      image_url TEXT,
      is_active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS shop_orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      item_id INTEGER NOT NULL,
      item_name TEXT NOT NULL,
      points_spent INTEGER NOT NULL,
      status TEXT DEFAULT 'pending',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(user_id) REFERENCES users(id),
      FOREIGN KEY(item_id) REFERENCES shop_items(id)
    );

    CREATE TABLE IF NOT EXISTS part_time_jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      employer_id INTEGER NOT NULL,
      work_type TEXT NOT NULL,
      custom_work_type TEXT,
      description TEXT NOT NULL,
      pay_credit INTEGER NOT NULL,
      work_date TEXT NOT NULL,
      duration_text TEXT NOT NULL,
      notes TEXT,
      federation_points INTEGER DEFAULT 0,
      status TEXT DEFAULT 'pending_approval',
      worker_id INTEGER,
      employer_completed INTEGER DEFAULT 0,
      worker_completed INTEGER DEFAULT 0,
      approved_by INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(employer_id) REFERENCES users(id),
      FOREIGN KEY(worker_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS schedules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      start_date TEXT NOT NULL,
      end_date TEXT,
      start_time TEXT,
      end_time TEXT,
      category TEXT DEFAULT '일반',
      description TEXT,
      color TEXT DEFAULT '#3b82f6',
      created_by INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS quests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      target_item TEXT,
      reward_text TEXT,
      credit_reward INTEGER DEFAULT 0,
      point_reward INTEGER DEFAULT 0,
      notes TEXT,
      is_active INTEGER DEFAULT 1,
      created_by INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS quest_submissions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      quest_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      proof_text TEXT,
      proof_image TEXT,
      status TEXT DEFAULT 'pending',
      admin_comment TEXT DEFAULT '',
      custom_points INTEGER,
      custom_credits INTEGER,
      reviewed_by INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(quest_id) REFERENCES quests(id),
      FOREIGN KEY(user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS credit_exchanges (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      amount INTEGER NOT NULL,
      in_game_name TEXT NOT NULL,
      status TEXT DEFAULT 'pending',
      admin_comment TEXT,
      processed_by INTEGER,
      processed_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS credit_charges (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      nickname TEXT NOT NULL,
      amount INTEGER NOT NULL,
      proof_image TEXT,
      charge_datetime TEXT NOT NULL,
      notes TEXT DEFAULT '',
      status TEXT DEFAULT 'pending',
      approved_amount INTEGER DEFAULT 0,
      bonus_points INTEGER DEFAULT 0,
      admin_comment TEXT DEFAULT '',
      processed_by INTEGER,
      processed_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS asset_transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      username TEXT,
      nickname TEXT,
      asset_type TEXT NOT NULL,
      tx_type TEXT NOT NULL,
      category TEXT NOT NULL,
      amount INTEGER NOT NULL,
      balance_before INTEGER NOT NULL,
      balance_after INTEGER NOT NULL,
      description TEXT NOT NULL,
      reference_type TEXT DEFAULT '',
      reference_id INTEGER,
      actor_id INTEGER,
      actor_name TEXT DEFAULT '',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );

    -- 디스코드 스타일 역할: position 값이 클수록 위계가 높다
    CREATE TABLE IF NOT EXISTS roles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      color TEXT DEFAULT '#99aab5',
      position INTEGER NOT NULL DEFAULT 0,
      permissions TEXT DEFAULT '[]',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS user_roles (
      user_id INTEGER NOT NULL,
      role_id INTEGER NOT NULL,
      PRIMARY KEY(user_id, role_id),
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY(role_id) REFERENCES roles(id) ON DELETE CASCADE
    );
  `);

  // 마이그레이션 확인
  try { db.exec(`ALTER TABLE users ADD COLUMN status TEXT DEFAULT 'approved';`); } catch (e) {}
  try { db.exec(`ALTER TABLE users ADD COLUMN custom_title TEXT DEFAULT '';`); } catch (e) {}
  try { db.exec(`ALTER TABLE seasons ADD COLUMN reward_description TEXT DEFAULT '';`); } catch (e) {}
  try { db.exec(`ALTER TABLE seasons ADD COLUMN target_points INTEGER DEFAULT 10000;`); } catch (e) {}
  try { db.exec(`ALTER TABLE user_season_points ADD COLUMN bonus_points INTEGER DEFAULT 0;`); } catch (e) {}
  try { db.exec(`ALTER TABLE user_season_points ADD COLUMN custom_title TEXT DEFAULT '';`); } catch (e) {}
  try { db.exec(`ALTER TABLE user_season_points ADD COLUMN admin_memo TEXT DEFAULT '';`); } catch (e) {}
  try { db.exec(`ALTER TABLE user_season_points ADD COLUMN is_hidden INTEGER DEFAULT 0;`); } catch (e) {}
  try { db.exec(`ALTER TABLE supply_requests ADD COLUMN is_custom INTEGER DEFAULT 0;`); } catch (e) {}
  try { db.exec(`ALTER TABLE supply_requests ADD COLUMN custom_item_name TEXT;`); } catch (e) {}
  try { db.exec(`ALTER TABLE supply_requests ADD COLUMN custom_unit TEXT DEFAULT '개';`); } catch (e) {}
  try { db.exec(`ALTER TABLE supply_requests ADD COLUMN custom_items_json TEXT;`); } catch (e) {}
  try { db.exec(`ALTER TABLE supply_requests ADD COLUMN notes TEXT DEFAULT '';`); } catch (e) {}
  try { db.exec(`ALTER TABLE quest_submissions ADD COLUMN admin_comment TEXT DEFAULT '';`); } catch (e) {}
  try { db.exec(`ALTER TABLE quest_submissions ADD COLUMN custom_points INTEGER;`); } catch (e) {}
  try { db.exec(`ALTER TABLE quest_submissions ADD COLUMN custom_credits INTEGER;`); } catch (e) {}
  try { db.exec(`ALTER TABLE schedules ADD COLUMN start_time TEXT;`); } catch (e) {}
  try { db.exec(`ALTER TABLE schedules ADD COLUMN end_time TEXT;`); } catch (e) {}
  try { db.exec(`ALTER TABLE notices ADD COLUMN webhook_url TEXT DEFAULT '';`); } catch (e) {}
  try { db.exec(`ALTER TABLE notices ADD COLUMN webhook_enabled INTEGER DEFAULT 0;`); } catch (e) {}
  try { db.exec(`ALTER TABLE notices ADD COLUMN mention_type TEXT DEFAULT 'none';`); } catch (e) {}
  try { db.exec(`ALTER TABLE notices ADD COLUMN embed_color TEXT DEFAULT '#3b82f6';`); } catch (e) {}
  try { db.exec(`ALTER TABLE notices ADD COLUMN message_template TEXT DEFAULT '';`); } catch (e) {}

  // supply_requests.supply_id NOT NULL 제약 해제 마이그레이션 (자율 직접 입력 납품 지원)
  try {
    const tableInfo = db.prepare(`PRAGMA table_info(supply_requests)`).all();
    const supplyIdCol = tableInfo.find(c => c.name === 'supply_id');
    if (supplyIdCol && supplyIdCol.notnull === 1) {
      db.exec(`PRAGMA foreign_keys = OFF;`);
      db.exec(`BEGIN TRANSACTION;`);
      db.exec(`
        CREATE TABLE supply_requests_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          supply_id INTEGER,
          is_custom INTEGER DEFAULT 0,
          custom_item_name TEXT,
          custom_unit TEXT DEFAULT '개',
          custom_items_json TEXT,
          user_id INTEGER NOT NULL,
          amount INTEGER NOT NULL,
          chest_location TEXT NOT NULL,
          notes TEXT DEFAULT '',
          proof_image TEXT,
          status TEXT DEFAULT 'pending',
          admin_comment TEXT,
          points_earned INTEGER DEFAULT 0,
          credits_earned INTEGER DEFAULT 0,
          reviewed_by INTEGER,
          reviewed_at DATETIME,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY(user_id) REFERENCES users(id)
        );
        INSERT INTO supply_requests_new (id, supply_id, is_custom, custom_item_name, custom_unit, custom_items_json, user_id, amount, chest_location, notes, proof_image, status, admin_comment, points_earned, credits_earned, reviewed_by, reviewed_at, created_at)
        SELECT id, supply_id, COALESCE(is_custom, 0), custom_item_name, COALESCE(custom_unit, '개'), custom_items_json, user_id, amount, chest_location, COALESCE(notes, ''), proof_image, status, admin_comment, points_earned, credits_earned, reviewed_by, reviewed_at, created_at FROM supply_requests;
        DROP TABLE supply_requests;
        ALTER TABLE supply_requests_new RENAME TO supply_requests;
      `);
      db.exec(`COMMIT;`);
      db.exec(`PRAGMA foreign_keys = ON;`);
    }
  } catch (e) {
    try { db.exec(`ROLLBACK;`); } catch (_) {}
    try { db.exec(`PRAGMA foreign_keys = ON;`); } catch (_) {}
  }

  // 기본 랭킹 티어 초기화
  const tierCheck = db.prepare("SELECT COUNT(*) as cnt FROM ranking_tiers").get();
  if (!tierCheck || tierCheck.cnt === 0) {
    const defaultTiers = [
      { name: '연방 최고사령관 (S+)', min_points: 5000, badge_color: '#e11d48', icon_emoji: '👑', perk_description: '연방 최고 명예 칭호 및 시즌 특별 보상 1순위', sort_order: 1 },
      { name: '연방 대장군 (S)', min_points: 2500, badge_color: '#d97706', icon_emoji: '💎', perk_description: '고급 전략 물자 우선 보급 및 명예 훈장', sort_order: 2 },
      { name: '상급 지휘관 (A)', min_points: 1200, badge_color: '#7c3aed', icon_emoji: '🦅', perk_description: '연방 정예 작전 참여 및 보너스 배율 우대', sort_order: 3 },
      { name: '정예 기사 (B)', min_points: 500, badge_color: '#2563eb', icon_emoji: '⚔️', perk_description: '정식 기사단 자격 및 포인트 상점 우대', sort_order: 4 },
      { name: '연방 정규군 (C)', min_points: 100, badge_color: '#059669', icon_emoji: '🛡️', perk_description: '연방 정규 시민권 및 기본 작전 참여', sort_order: 5 },
      { name: '신병 훈련생 (D)', min_points: 0, badge_color: '#64748b', icon_emoji: '🌱', perk_description: '납품과 퀘스트를 통해 기여도를 쌓아 진급하세요!', sort_order: 6 }
    ];
    const insertTier = db.prepare(`INSERT INTO ranking_tiers (name, min_points, badge_color, icon_emoji, perk_description, sort_order) VALUES (?, ?, ?, ?, ?, ?)`);
    for (const t of defaultTiers) {
      insertTier.run(t.name, t.min_points, t.badge_color, t.icon_emoji, t.perk_description, t.sort_order);
    }
  }

  // 기본 브랜딩 및 수치 설정 초기화
  const defaultSettings = {
    system_title: 'FEDERATION',
    nation_name: '마인크래프트 전쟁 관리',
    server_logo_text: 'M',
    point_multiplier: '1.0',
    credit_multiplier: '1.0',
    exchange_rate: '1.0',
    min_exchange_amount: '100',
    exchange_fee_percent: '0',
    ranking_board_notice: '이번 시즌도 함께 국가를 키워가요! 납품·퀘스트·알바 하나하나가 모두 기여도로 기록됩니다.',
    ranking_show_credit_tab: '1',
    ranking_top_limit: '100',
    allow_custom_supply: '1'
  };
  const upsertSetting = db.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)");
  for (const [k, v] of Object.entries(defaultSettings)) {
    upsertSetting.run(k, v);
  }

  // 예전 '추월/경쟁' 톤의 기본 랭킹 공지를 그대로 쓰고 있다면 새 기본 문구로 교체
  db.prepare(`UPDATE settings SET value = ? WHERE key = 'ranking_board_notice' AND value = ?`).run(
    defaultSettings.ranking_board_notice,
    '🔥 시즌 1위 달성 시 특별 칭호와 네더라이트 풀세트 보상이 지급됩니다! 지금 바로 납품과 퀘스트로 경쟁자를 추월하세요!'
  );

  // 초기 관리자 계정 생성 (기획서: admin / admin)
  // 슈퍼관리자(is_admin=1)는 모든 권한 검사를 통과하므로 별도 역할이 필요 없다.
  const adminCheck = db.prepare('SELECT id FROM users WHERE username = ?').get('admin');
  if (!adminCheck) {
    const defaultHash = bcrypt.hashSync('admin', 10);
    db.prepare(`
      INSERT INTO users (username, password, nickname, points, credits, must_change_password, is_admin, roles, status)
      VALUES (?, ?, ?, 1000, 50000, 1, 1, '[]', 'approved')
    `).run('admin', defaultHash, '슈퍼관리자');
  }

  migrateLegacyUserPermissions();

  // 최초 1회: 역할 테이블이 비어 있을 때 기본 디스코드 스타일 역할(개인 랭크 & 직책) 프리셋 생성
  const rolesSeeded = db.prepare(`SELECT value FROM settings WHERE key = 'roles_seeded'`).get();
  const roleCount = db.prepare('SELECT COUNT(*) as cnt FROM roles').get()?.cnt || 0;
  if (!rolesSeeded && roleCount === 0) {
    const defaultRoles = [
      // 아래에서 위 순서로 position 1..N 부여 (뒤에 있을수록 높은 서열)
      { name: '일반 시민', color: '#64748b', permissions: [] },
      { name: '정예 대원', color: '#06b6d4', permissions: [] },
      { name: '사업가', color: '#10b981', permissions: ['사업가'] },
      { name: '물자 보급관', color: '#3b82f6', permissions: ['납품 등록', '납품 관리', '샵 관리'] },
      { name: '퀘스트·일정 담당관', color: '#f59e0b', permissions: ['퀘스트 관리', '일정 관리', '공지 관리'] },
      { name: '경제·기업 관리관', color: '#ec4899', permissions: ['기업 관리', '크레딧 관리', '데이터 관리'] },
      { name: '총괄 부관리자', color: '#8b5cf6', permissions: ['역할 관리', '계정 관리', '시즌 관리', '랭킹 관리자', '공지 관리'] }
    ];
    const insertDefaultRole = db.prepare('INSERT INTO roles (name, color, position, permissions) VALUES (?, ?, ?, ?)');
    defaultRoles.forEach((r, idx) => {
      insertDefaultRole.run(r.name, r.color, idx + 1, JSON.stringify(r.permissions));
    });
    db.prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES ('roles_seeded', '1')`).run();
  }

  // 초기 기본 활성 시즌 생성
  const seasonCheck = db.prepare('SELECT id FROM seasons LIMIT 1').get();
  if (!seasonCheck) {
    db.prepare(`
      INSERT INTO seasons (name, start_date, end_date, reward_description, target_points, is_active)
      VALUES ('제1회 연방 시즌', date('now'), date('now', '+30 day'), '1위: 황금 왕관 칭호 + 100,000 C / 2위: 50,000 C / 3위: 25,000 C', 10000, 1)
    `).run();
  }

  // 기본 납품 안내문 공지 생성
  const noticeCheck = db.prepare('SELECT id FROM notices WHERE category = ?').get('supply');
  if (!noticeCheck) {
    db.prepare(`
      INSERT INTO notices (category, title, content)
      VALUES ('supply', '납품 안내 사항', '1. 상자 위치를 정확히 기재해 주세요.\n2. 상자 내부 인벤토리가 잘 보이는 스크린샷을 첨부하세요.\n3. 목록에 없는 아이템도 [자율/직접 입력 납품 신청]으로 여러 품목과 수량을 직접 입력해 납품할 수 있습니다.')
    `).run();
  }
}

// ─────────────────────────────────────────────────────────────
// 역할(Role) 시스템 헬퍼
// ─────────────────────────────────────────────────────────────

function parseJsonArray(text) {
  try {
    const v = JSON.parse(text || '[]');
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

export function sanitizePermissions(perms) {
  if (!Array.isArray(perms)) return [];
  return [...new Set(perms.filter(p => ALL_PERMISSIONS.includes(p)))];
}

// 역할 position을 1..N 으로 빈틈없이 재정렬 (위계 순서는 유지)
export function normalizeRolePositions() {
  const rows = db.prepare('SELECT id FROM roles ORDER BY position ASC, id ASC').all();
  const upd = db.prepare('UPDATE roles SET position = ? WHERE id = ?');
  rows.forEach((r, i) => upd.run(i + 1, r.id));
}

export function getUserRoles(userId) {
  return db.prepare(`
    SELECT r.id, r.name, r.color, r.position, r.permissions
    FROM user_roles ur JOIN roles r ON r.id = ur.role_id
    WHERE ur.user_id = ?
    ORDER BY r.position DESC
  `).all(userId).map(r => ({ ...r, permissions: parseJsonArray(r.permissions) }));
}

// 사용자에게 부여된 모든 역할의 권한 합집합 + 최상위 역할 위치
export function getUserAccess(userId) {
  const roles = getUserRoles(userId);
  const perms = new Set();
  roles.forEach(r => r.permissions.forEach(p => perms.add(p)));
  return {
    roles: roles.map(({ id, name, color, position }) => ({ id, name, color, position })),
    permissions: [...perms],
    topPosition: roles.length > 0 ? roles[0].position : 0
  };
}

// 예전 방식(users.roles 컬럼에 권한 문자열 직접 저장)을 역할 시스템으로 이전한다.
// 권한별로 같은 이름의 역할을 만들어 부여 → 기존 권한이 그대로 유지된다. 여러 번 실행해도 안전.
export function migrateLegacyUserPermissions() {
  const legacyUsers = db.prepare(`SELECT id, is_admin, roles FROM users WHERE roles IS NOT NULL AND roles != '[]' AND roles != ''`).all();
  if (legacyUsers.length === 0) return;

  const findRole = db.prepare('SELECT id FROM roles WHERE name = ?');
  const insertRole = db.prepare(`INSERT INTO roles (name, color, position, permissions) VALUES (?, '#99aab5', ?, ?)`);
  const assign = db.prepare('INSERT OR IGNORE INTO user_roles (user_id, role_id) VALUES (?, ?)');
  const clear = db.prepare(`UPDATE users SET roles = '[]' WHERE id = ?`);

  db.exec('BEGIN TRANSACTION;');
  try {
    for (const u of legacyUsers) {
      // 슈퍼관리자는 모든 권한을 우회하므로 역할을 만들어줄 필요 없음
      if (u.is_admin !== 1) {
        for (const perm of sanitizePermissions(parseJsonArray(u.roles))) {
          let role = findRole.get(perm);
          if (!role) {
            const maxPos = db.prepare('SELECT COALESCE(MAX(position), 0) as m FROM roles').get().m;
            const res = insertRole.run(perm, maxPos + 1, JSON.stringify([perm]));
            role = { id: res.lastInsertRowid };
          }
          assign.run(u.id, role.id);
        }
      }
      clear.run(u.id);
    }
    db.exec('COMMIT;');
  } catch (e) {
    db.exec('ROLLBACK;');
    console.error('[migrateLegacyUserPermissions Error]', e);
  }
}

// 연방 포인트 / 크레딧 입출금 상세 원장 기록 헬퍼 함수
export function recordAssetTransaction({
  userId,
  assetType, // 'POINT' | 'CREDIT'
  amount, // 양수(+)면 입금(IN), 음수(-)면 출금(OUT)
  category, // '물자 납품', '자율 납품', '단기 알바', '공통 퀘스트', '포인트 상점', '크레딧 충전', '크레딧 환전', '관리자 조정', '랭킹 초기화' 등
  description,
  referenceType = '',
  referenceId = null,
  actor = null, // { id, username, nickname }
  balanceBefore = null,
  balanceAfter = null
}) {
  try {
    const numAmount = Number(amount);
    if (!numAmount && balanceBefore === balanceAfter) return;

    const targetUser = db.prepare('SELECT id, username, nickname, points, credits FROM users WHERE id = ?').get(userId);
    if (!targetUser) return;

    const currentBal = assetType === 'POINT' ? (targetUser.points || 0) : (targetUser.credits || 0);
    const afterVal = balanceAfter !== null ? Number(balanceAfter) : currentBal;
    const beforeVal = balanceBefore !== null ? Number(balanceBefore) : (afterVal - numAmount);
    const txType = numAmount > 0 ? 'IN' : (numAmount < 0 ? 'OUT' : (afterVal >= beforeVal ? 'IN' : 'OUT'));

    const actorId = actor?.id || null;
    const actorName = actor ? `${actor.nickname || actor.username} (@${actor.username})` : '시스템';

    db.prepare(`
      INSERT INTO asset_transactions (
        user_id, username, nickname, asset_type, tx_type, category,
        amount, balance_before, balance_after, description,
        reference_type, reference_id, actor_id, actor_name
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      targetUser.id,
      targetUser.username,
      targetUser.nickname || targetUser.username,
      assetType,
      txType,
      category,
      Math.abs(numAmount),
      beforeVal,
      afterVal,
      description,
      referenceType || '',
      referenceId || null,
      actorId,
      actorName
    );
  } catch (err) {
    console.error('[recordAssetTransaction Error]', err);
  }
}
