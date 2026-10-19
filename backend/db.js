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

export const ALL_ROLES = [
  '납품 등록',
  '납품 관리',
  '공지 관리',
  '시즌 관리',
  '샵 관리',
  '사업가',
  '기업 관리',
  '일정 관리',
  '퀘스트 관리',
  '크레딧 관리',
  '계정 관리'
];

export function initDatabase() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      nickname TEXT,
      points INTEGER DEFAULT 0,
      credits INTEGER DEFAULT 0,
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
      is_active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS user_season_points (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      season_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      points INTEGER DEFAULT 0,
      UNIQUE(season_id, user_id),
      FOREIGN KEY(season_id) REFERENCES seasons(id) ON DELETE CASCADE,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
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
      supply_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      amount INTEGER NOT NULL,
      chest_location TEXT NOT NULL,
      proof_image TEXT,
      status TEXT DEFAULT 'pending',
      admin_comment TEXT,
      points_earned INTEGER DEFAULT 0,
      credits_earned INTEGER DEFAULT 0,
      reviewed_by INTEGER,
      reviewed_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(supply_id) REFERENCES supplies(id),
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

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );
  `);

  // 마이그레이션 확인
  try { db.exec(`ALTER TABLE users ADD COLUMN status TEXT DEFAULT 'approved';`); } catch (e) {}
  try { db.exec(`ALTER TABLE schedules ADD COLUMN start_time TEXT;`); } catch (e) {}
  try { db.exec(`ALTER TABLE schedules ADD COLUMN end_time TEXT;`); } catch (e) {}
  try { db.exec(`ALTER TABLE notices ADD COLUMN webhook_url TEXT DEFAULT '';`); } catch (e) {}
  try { db.exec(`ALTER TABLE notices ADD COLUMN webhook_enabled INTEGER DEFAULT 0;`); } catch (e) {}
  try { db.exec(`ALTER TABLE notices ADD COLUMN mention_type TEXT DEFAULT 'none';`); } catch (e) {}
  try { db.exec(`ALTER TABLE notices ADD COLUMN embed_color TEXT DEFAULT '#3b82f6';`); } catch (e) {}
  try { db.exec(`ALTER TABLE notices ADD COLUMN message_template TEXT DEFAULT '';`); } catch (e) {}

  // 기본 브랜딩 설정 초기화
  const titleCheck = db.prepare("SELECT value FROM settings WHERE key = 'system_title'").get();
  if (!titleCheck) {
    db.prepare("INSERT INTO settings (key, value) VALUES ('system_title', 'FEDERATION')").run();
    db.prepare("INSERT INTO settings (key, value) VALUES ('nation_name', '마인크래프트 전쟁 관리')").run();
    db.prepare("INSERT INTO settings (key, value) VALUES ('server_logo_text', 'M')").run();
  }

  // 초기 관리자 계정 생성 (기획서: admin / admin)
  const adminCheck = db.prepare('SELECT id FROM users WHERE username = ?').get('admin');
  const allRolesJson = JSON.stringify(ALL_ROLES);

  if (!adminCheck) {
    const defaultHash = bcrypt.hashSync('admin', 10);
    db.prepare(`
      INSERT INTO users (username, password, nickname, points, credits, must_change_password, is_admin, roles, status)
      VALUES (?, ?, ?, 1000, 50000, 1, 1, ?, 'approved')
    `).run('admin', defaultHash, '슈퍼관리자', allRolesJson);
  }

  // 초기 기본 활성 시즌 생성
  const seasonCheck = db.prepare('SELECT id FROM seasons LIMIT 1').get();
  if (!seasonCheck) {
    db.prepare(`
      INSERT INTO seasons (name, start_date, end_date, is_active)
      VALUES ('제1회 연방 시즌', date('now'), date('now', '+30 day'), 1)
    `).run();
  }

  // 기본 납품 안내문 공지 생성
  const noticeCheck = db.prepare('SELECT id FROM notices WHERE category = ?').get('supply');
  if (!noticeCheck) {
    db.prepare(`
      INSERT INTO notices (category, title, content)
      VALUES ('supply', '납품 안내 사항', '1. 상자 위치를 정확히 기재해 주세요.\n2. 상자 내부 인벤토리가 잘 보이는 스크린샷을 첨부하세요.\n3. 허위 납품 시 제재를 받을 수 있습니다.')
    `).run();
  }
}
