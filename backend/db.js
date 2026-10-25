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

// 외래키, WAL 모드 및 무료 서버 강제 종료 대비 즉시 디스크 동기화 활성화
db.exec(`PRAGMA journal_mode = WAL;`);
db.exec(`PRAGMA synchronous = FULL;`);
db.exec(`PRAGMA wal_autocheckpoint = 1;`);
db.exec(`PRAGMA foreign_keys = ON;`);

// SQLite WAL 버퍼를 본 데이터베이스 파일(database.sqlite)로 즉시 플러시
export function flushDatabase(mode = 'TRUNCATE') {
  try {
    db.exec(`PRAGMA wal_checkpoint(${mode});`);
  } catch (err) {
    console.error('[SQLite Checkpoint Error]', err.message);
  }
}

// 무료 서버 슬립/종료 시그널 발생 시 WAL 데이터를 즉시 본 파일로 병합
for (const sig of ['SIGTERM', 'SIGINT', 'beforeExit']) {
  process.on(sig, () => {
    flushDatabase('TRUNCATE');
  });
}

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

// 개별 디스코드 웹훅 이벤트 카탈로그 (지급 기록, 납품, 퀘스트, 알바, 상점, 크레딧, 일정, 시즌, 계정/역할 등 26종)
export const WEBHOOK_EVENT_CATALOG = [
  // 1. 지급 및 재화 입출금 기록 (지급 기록 / 원장 로그)
  {
    event_key: 'asset_payout',
    name: '통합 포인트·크레딧 지급(+) 원장 기록',
    category: '지급 및 재화 기록',
    description: '플레이어에게 연방 포인트(P) 또는 크레딧(C)이 지급(입금 +)될 때마다 원장 번호, 대상자, 지급량, 지급 전→후 잔액, 사유, 처리자를 전송합니다.',
    default_enabled: 1,
    default_mention: 'none',
    default_color: '#10b981'
  },
  {
    event_key: 'asset_deduct',
    name: '통합 포인트·크레딧 차감/사용(-) 원장 기록',
    category: '지급 및 재화 기록',
    description: '플레이어의 연방 포인트(P) 또는 크레딧(C)이 차감·소비(출금 -)될 때마다 원장 번호, 대상자, 차감량, 잔액 변화, 사유, 처리자를 전송합니다.',
    default_enabled: 1,
    default_mention: 'none',
    default_color: '#ef4444'
  },
  {
    event_key: 'manual_adjust',
    name: '관리자 수동 재화 지급·차감 및 수기 정산',
    category: '지급 및 재화 기록',
    description: '관리자·데이터 관리자가 플레이어의 포인트/크레딧 수치를 직접 조정하거나 수동 입출금 내역을 정산 기록했을 때 전송합니다.',
    default_enabled: 1,
    default_mention: 'none',
    default_color: '#f59e0b'
  },
  {
    event_key: 'supply_reward',
    name: '물자 납품 승인 및 보상 지급 기록',
    category: '지급 및 재화 기록',
    description: '물자 납품(지정/자율)이 승인되어 포인트·크레딧 보상이 지급되었을 때(사후 지급 수치 정정 포함) 전송합니다.',
    default_enabled: 1,
    default_mention: 'none',
    default_color: '#3b82f6'
  },
  {
    event_key: 'quest_reward',
    name: '퀘스트 완수 승인 및 보상 지급 기록',
    category: '지급 및 재화 기록',
    description: '공통 퀘스트 인증 제출이 승인되어 보상 포인트·크레딧이 지급되었을 때 전송합니다.',
    default_enabled: 1,
    default_mention: 'none',
    default_color: '#8b5cf6'
  },
  {
    event_key: 'job_payout',
    name: '단기 알바 완료 승인 및 보수·포인트 지급 기록',
    category: '지급 및 재화 기록',
    description: '단기 알바 작업이 최종 승인되어 근로자에게 크레딧 보수와 연방 포인트가 지급되었을 때 전송합니다.',
    default_enabled: 1,
    default_mention: 'none',
    default_color: '#06b6d4'
  },
  {
    event_key: 'ranking_bulk_adjust',
    name: '전체 플레이어 일괄 포인트·크레딧 지급/조정',
    category: '지급 및 재화 기록',
    description: '랭킹 관리자가 전체 플레이어를 대상으로 포인트·보너스·크레딧을 일괄 지급하거나 조정했을 때 전송합니다.',
    default_enabled: 1,
    default_mention: 'none',
    default_color: '#ec4899'
  },

  // 2. 크레딧 충전 & 환전 (금융 창구)
  {
    event_key: 'credit_charge_request',
    name: '크레딧 충전 신청 접수',
    category: '크레딧 충전 & 환전',
    description: '플레이어가 인게임 송금 증빙과 함께 크레딧 충전을 신청했을 때 전송합니다.',
    default_enabled: 1,
    default_mention: 'none',
    default_color: '#38bdf8'
  },
  {
    event_key: 'credit_charge_review',
    name: '크레딧 충전 승인(지급) 및 반려 처리',
    category: '크레딧 충전 & 환전',
    description: '크레딧 충전 신청이 승인되어 크레딧·보너스 포인트가 지급되거나 반려(거절)되었을 때 전송합니다.',
    default_enabled: 1,
    default_mention: 'none',
    default_color: '#10b981'
  },
  {
    event_key: 'credit_exchange_request',
    name: '크레딧 환전(출금) 신청 접수',
    category: '크레딧 충전 & 환전',
    description: '플레이어가 보유 크레딧을 인게임 화폐로 환전(출금) 신청했을 때 전송합니다.',
    default_enabled: 1,
    default_mention: 'none',
    default_color: '#f97316'
  },
  {
    event_key: 'credit_exchange_review',
    name: '크레딧 환전 지급 완료 및 반려(환불) 처리',
    category: '크레딧 충전 & 환전',
    description: '크레딧 환전 요청이 지급 완료 처리되거나 거절(크레딧 환불)되었을 때 전송합니다.',
    default_enabled: 1,
    default_mention: 'none',
    default_color: '#14b8a6'
  },

  // 3. 물자 납품 & 포인트 상점
  {
    event_key: 'supply_request',
    name: '신규 물자 납품 신청 접수',
    category: '물자 납품 & 상점',
    description: '플레이어가 지정 물자 또는 자율 품목 납품을 신청했을 때 품목·수량·상자 위치를 전송합니다.',
    default_enabled: 1,
    default_mention: 'none',
    default_color: '#2563eb'
  },
  {
    event_key: 'supply_rejected',
    name: '물자 납품 반려(거절) 처리',
    category: '물자 납품 & 상점',
    description: '물자 납품 신청이 반려(거절)되었을 때 사유와 함께 전송합니다.',
    default_enabled: 1,
    default_mention: 'none',
    default_color: '#dc2626'
  },
  {
    event_key: 'supply_item_created',
    name: '신규 납품 대상 품목 등록',
    category: '물자 납품 & 상점',
    description: '납품 관리자가 새로운 납품 물자 품목과 단가(포인트/크레딧)를 등록했을 때 전송합니다.',
    default_enabled: 1,
    default_mention: 'none',
    default_color: '#60a5fa'
  },
  {
    event_key: 'shop_purchase',
    name: '포인트 상점 아이템 구매 신청',
    category: '물자 납품 & 상점',
    description: '플레이어가 연방 포인트로 상점 아이템을 구매 신청했을 때 전송합니다.',
    default_enabled: 1,
    default_mention: 'none',
    default_color: '#a855f7'
  },
  {
    event_key: 'shop_delivery',
    name: '포인트 상점 상품 지급 완료 및 주문 취소(환불)',
    category: '물자 납품 & 상점',
    description: '상점 주문 아이템이 인게임 지급 완료 처리되거나 주문 취소(포인트 환불)되었을 때 전송합니다.',
    default_enabled: 1,
    default_mention: 'none',
    default_color: '#22c55e'
  },

  // 4. 퀘스트 & 단기 알바
  {
    event_key: 'quest',
    name: '신규 공통 퀘스트 등록',
    category: '퀘스트 & 단기 알바',
    description: '새로운 공통 퀘스트가 등록되었을 때 목표 품목과 보상 정보를 전송합니다.',
    default_enabled: 1,
    default_mention: 'none',
    default_color: '#f59e0b'
  },
  {
    event_key: 'quest_submission',
    name: '퀘스트 완료 인증 제출 접수',
    category: '퀘스트 & 단기 알바',
    description: '플레이어가 퀘스트 완료 증빙을 제출했을 때 전송합니다.',
    default_enabled: 1,
    default_mention: 'none',
    default_color: '#fbbf24'
  },
  {
    event_key: 'quest_rejected',
    name: '퀘스트 완료 인증 반려(거절) 처리',
    category: '퀘스트 & 단기 알바',
    description: '퀘스트 완료 인증 제출이 반려(거절)되었을 때 사유와 함께 전송합니다.',
    default_enabled: 1,
    default_mention: 'none',
    default_color: '#ef4444'
  },
  {
    event_key: 'part_time_job',
    name: '단기 알바 구인 승인 및 공개 모집',
    category: '퀘스트 & 단기 알바',
    description: '기업 관리자가 단기 알바 구인을 승인하여 공개 모집이 시작될 때 전송합니다.',
    default_enabled: 1,
    default_mention: 'none',
    default_color: '#3b82f6'
  },
  {
    event_key: 'job_request',
    name: '단기 알바 구인 등록 신청 (승인 대기)',
    category: '퀘스트 & 단기 알바',
    description: '사업가가 새로운 단기 알바 구인을 등록 신청했을 때 전송합니다.',
    default_enabled: 1,
    default_mention: 'none',
    default_color: '#64748b'
  },
  {
    event_key: 'job_progress',
    name: '단기 알바 지원 채용 및 작업 완료 보고',
    category: '퀘스트 & 단기 알바',
    description: '구직자가 알바에 지원·채용되었거나 고용주/구직자 작업 완료가 보고되었을 때 전송합니다.',
    default_enabled: 1,
    default_mention: 'none',
    default_color: '#0ea5e9'
  },

  // 5. 일정 · 시즌 · 계정/역할 관리
  {
    event_key: 'schedule',
    name: '캘린더 신규 일정 등록',
    category: '일정 · 시즌 · 계정 관리',
    description: '캘린더에 새로운 국가 일정이 등록되었을 때 전송합니다.',
    default_enabled: 1,
    default_mention: 'everyone',
    default_color: '#10b981'
  },
  {
    event_key: 'season_change',
    name: '시즌 시작·활성화 및 랭킹/재화 초기화',
    category: '일정 · 시즌 · 계정 관리',
    description: '새 시즌 생성·활성화 또는 시즌/전체 랭킹·재화 초기화가 실행되었을 때 전송합니다.',
    default_enabled: 1,
    default_mention: 'none',
    default_color: '#e11d48'
  },
  {
    event_key: 'user_register',
    name: '신규 회원가입 신청 및 가입 승인·거절',
    category: '일정 · 시즌 · 계정 관리',
    description: '신규 플레이어가 가입을 신청하거나 관리자가 가입을 승인/거절했을 때 전송합니다.',
    default_enabled: 1,
    default_mention: 'none',
    default_color: '#6366f1'
  },
  {
    event_key: 'role_change',
    name: '개인별 역할(랭크) 부여 및 역할 설정 변경',
    category: '일정 · 시즌 · 계정 관리',
    description: '플레이어에게 디스코드 역할이 부여/해제되거나 역할 및 권한 구성이 변경되었을 때 전송합니다.',
    default_enabled: 1,
    default_mention: 'none',
    default_color: '#8b5cf6'
  }
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

    -- 이벤트별 개별 디스코드 웹훅 설정 테이블
    CREATE TABLE IF NOT EXISTS webhook_configs (
      event_key TEXT PRIMARY KEY,
      enabled INTEGER DEFAULT 1,
      webhook_url TEXT DEFAULT '',
      mention_type TEXT DEFAULT 'none',
      custom_mention TEXT DEFAULT '',
      embed_color TEXT DEFAULT '#3b82f6',
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
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
    allow_custom_supply: '1',
    db_epoch: '1',
    write_count: '0'
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
      VALUES (?, ?, ?, 0, 0, 1, 1, '[]', 'approved')
    `).run('admin', defaultHash, '슈퍼관리자');
  }

  migrateLegacyUserPermissions();

  // 역할 테이블이 비어 있을 때 기본 디스코드 스타일 역할(개인 랭크 & 직책) 프리셋 생성
  const roleCount = db.prepare('SELECT COUNT(*) as cnt FROM roles').get()?.cnt || 0;
  if (roleCount === 0) {
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

  // 이벤트별 개별 디스코드 웹훅 기본 설정 시딩 (이미 설정된 값은 유지)
  const insertWebhookCfg = db.prepare(`
    INSERT OR IGNORE INTO webhook_configs (event_key, enabled, webhook_url, mention_type, custom_mention, embed_color)
    VALUES (?, ?, '', ?, '', ?)
  `);
  for (const item of WEBHOOK_EVENT_CATALOG) {
    insertWebhookCfg.run(item.event_key, item.default_enabled ?? 1, item.default_mention || 'none', item.default_color || '#3b82f6');
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
  roles.forEach(r => {
    r.permissions.forEach(p => perms.add(p));
  });

  // 혹시 legacy users.roles 컬럼에 남아있는 권한 문자열이 있다면 함께 합산
  try {
    const legacyRow = db.prepare('SELECT roles FROM users WHERE id = ?').get(userId);
    if (legacyRow?.roles) {
      sanitizePermissions(parseJsonArray(legacyRow.roles)).forEach(p => perms.add(p));
    }
  } catch (_) {}

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

let onAssetTransactionRecorded = null;

export function setAssetTransactionHook(fn) {
  onAssetTransactionRecorded = fn;
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
  balanceAfter = null,
  skipWebhook = false
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

    const result = db.prepare(`
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

    if (!skipWebhook && typeof onAssetTransactionRecorded === 'function') {
      try {
        onAssetTransactionRecorded({
          id: result.lastInsertRowid,
          user_id: targetUser.id,
          username: targetUser.username,
          nickname: targetUser.nickname || targetUser.username,
          asset_type: assetType,
          tx_type: txType,
          category,
          amount: Math.abs(numAmount),
          balance_before: beforeVal,
          balance_after: afterVal,
          description,
          reference_type: referenceType || '',
          reference_id: referenceId || null,
          actor_name: actorName
        });
      } catch (hookErr) {
        console.error('[AssetTransactionHook Error]', hookErr.message);
      }
    }
  } catch (err) {
    console.error('[recordAssetTransaction Error]', err);
  }
}

export function incrementWriteCount() {
  try {
    db.prepare(`
      INSERT INTO settings (key, value) VALUES ('write_count', '1')
      ON CONFLICT(key) DO UPDATE SET value = CAST(COALESCE(value, '0') AS INTEGER) + 1
    `).run();
  } catch (_) {}
}

/**
 * 데이터베이스 초기화 헬퍼
 * @param {'all'|'activity'} mode - 'all': 전체 공장 초기화 (슈퍼관리자 계정만 유지), 'activity': 운영 내역·재화만 초기화 (계정/역할/웹훅/브랜딩 유지)
 * @param {{ resetAdminPassword?: boolean, uploadDir?: string }} options
 */
export function resetDatabase(mode = 'all', options = {}) {
  const newEpoch = String(Date.now());
  const existingAdmin = db.prepare("SELECT * FROM users WHERE username = 'admin' ORDER BY id ASC LIMIT 1").get();

  db.exec('PRAGMA foreign_keys = OFF;');
  db.exec('BEGIN TRANSACTION;');
  try {
    const activityTables = [
      'asset_transactions',
      'credit_charges',
      'credit_exchanges',
      'quest_submissions',
      'quests',
      'schedules',
      'part_time_jobs',
      'shop_orders',
      'shop_items',
      'supply_requests',
      'supplies',
      'user_season_points',
      'seasons'
    ];

    for (const t of activityTables) {
      db.prepare(`DELETE FROM ${t}`).run();
      try { db.prepare(`DELETE FROM sqlite_sequence WHERE name = ?`).run(t); } catch (_) {}
    }

    if (mode === 'activity') {
      db.prepare(`UPDATE users SET points = 0, credits = 0, custom_title = ''`).run();
    } else {
      const fullResetTables = [
        'notices',
        'ranking_tiers',
        'user_roles',
        'roles',
        'webhook_configs',
        'settings',
        'users'
      ];
      for (const t of fullResetTables) {
        db.prepare(`DELETE FROM ${t}`).run();
        try { db.prepare(`DELETE FROM sqlite_sequence WHERE name = ?`).run(t); } catch (_) {}
      }

      const adminPw = (!options.resetAdminPassword && existingAdmin?.password)
        ? existingAdmin.password
        : bcrypt.hashSync('admin', 10);
      const mustChange = options.resetAdminPassword ? 1 : (existingAdmin ? (existingAdmin.must_change_password ?? 0) : 0);

      db.prepare(`
        INSERT INTO users (id, username, password, nickname, points, credits, custom_title, must_change_password, is_admin, roles, status)
        VALUES (1, 'admin', ?, '슈퍼관리자', 0, 0, '', ?, 1, '[]', 'approved')
      `).run(adminPw, mustChange);
    }

    db.exec('COMMIT;');
  } catch (err) {
    try { db.exec('ROLLBACK;'); } catch (_) {}
    throw err;
  } finally {
    try { db.exec('PRAGMA foreign_keys = ON;'); } catch (_) {}
  }

  // 기본 시드 데이터 재생성
  initDatabase();

  // 새 에포크 및 쓰기 카운트 기록
  db.prepare(`INSERT INTO settings (key, value) VALUES ('db_epoch', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(newEpoch);
  db.prepare(`INSERT INTO settings (key, value) VALUES ('write_count', '0') ON CONFLICT(key) DO UPDATE SET value = '0'`).run();

  if (options.uploadDir && fs.existsSync(options.uploadDir)) {
    try {
      for (const f of fs.readdirSync(options.uploadDir)) {
        if (f === '.gitkeep') continue;
        const fp = path.join(options.uploadDir, f);
        if (fs.statSync(fp).isFile()) {
          fs.unlinkSync(fp);
        }
      }
    } catch (_) {}
  }

  flushDatabase('TRUNCATE');
  return { mode, db_epoch: newEpoch, write_count: 0 };
}
