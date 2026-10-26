import React, { useState, useEffect, useRef } from 'react';
import { apiRequest, setAuthToken, getAuthToken } from './api';
import LoginView from './components/LoginView';
import ChangePasswordModal from './components/ChangePasswordModal';
import SupplyTab from './components/SupplyTab';
import RankingTab from './components/RankingTab';
import ShopTab from './components/ShopTab';
import GigTab from './components/GigTab';
import CalendarTab from './components/CalendarTab';
import QuestTab from './components/QuestTab';
import CreditTab from './components/CreditTab';
import AdminTab from './components/AdminTab';

import {
  Package,
  Trophy,
  ShoppingBag,
  Briefcase,
  Calendar,
  Compass,
  Coins,
  ShieldCheck,
  LogOut,
  KeyRound,
  ShieldAlert,
  Sparkles
} from 'lucide-react';

export default function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('supply');
  const [showPasswordModal, setShowPasswordModal] = useState(false);

  // 국가 & 시스템 브랜딩 상태
  const [branding, setBranding] = useState({
    system_title: 'FEDERATION',
    nation_name: '마인크래프트 전쟁 관리',
    server_logo_text: 'M',
    login_subtitle: '',
    login_message: '',
    db_epoch: '1',
    write_count: '0'
  });
  const autoBackupTimerRef = useRef(null);
  const autoRestoreInProgressRef = useRef(false);

  const refreshBranding = async () => {
    try {
      const data = await apiRequest('/settings/branding');
      if (data) setBranding(data);
      return data;
    } catch (err) {
      console.error('Branding fetch error:', err);
      return null;
    }
  };

  // 현재 사용자 정보 불러오기
  const refreshUser = async () => {
    try {
      if (!getAuthToken()) {
        setUser(null);
        return;
      }
      const data = await apiRequest('/auth/me');
      setUser(data.user);
      if (data.user.must_change_password) {
        setShowPasswordModal(true);
      }
    } catch (err) {
      console.error(err);
      setAuthToken(null);
      setUser(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refreshBranding();
    refreshUser();

    // 무료 클라우드 서버 절전(슬립) 방지를 위한 주기적 Keep-Alive 핑 (4분 간격)
    const keepAliveTimer = setInterval(() => {
      fetch('/api/health').catch(() => {});
    }, 4 * 60 * 1000);
    return () => clearInterval(keepAliveTimer);
  }, []);

  // 무료 서버 컨테이너 재시작 시 브라우저 로컬 스냅샷 자동 동기화 및 복구 (슈퍼관리자 전용)
  useEffect(() => {
    if (!user?.is_admin) return;

    const saveSnapshotToLocal = async () => {
      if (autoRestoreInProgressRef.current) return;
      try {
        const payload = await apiRequest('/admin/export');
        const settingsRows = payload?.data?.settings || [];
        const epochRow = settingsRows.find(r => r.key === 'db_epoch');
        const writeRow = settingsRows.find(r => r.key === 'write_count');
        const db_epoch = epochRow?.value || '1';
        const write_count = Number(writeRow?.value || 0);
        if (write_count > 0) {
          localStorage.setItem('mc_platform_auto_backup_v1', JSON.stringify({
            db_epoch,
            write_count,
            saved_at: new Date().toISOString(),
            payload
          }));
        }
      } catch (_) {}
    };

    const handleDbMutated = () => {
      if (autoBackupTimerRef.current) clearTimeout(autoBackupTimerRef.current);
      autoBackupTimerRef.current = setTimeout(saveSnapshotToLocal, 1200);
    };

    window.addEventListener('mc-db-mutated', handleDbMutated);

    // 서버가 컨테이너 재시작으로 인해 초기 상태(write_count === 0)로 돌아간 경우 자동 복원
    (async () => {
      try {
        const raw = localStorage.getItem('mc_platform_auto_backup_v1');
        if (!raw) return;
        const saved = JSON.parse(raw);
        const latestBranding = await refreshBranding();
        if (!latestBranding) return;
        const serverEpoch = String(latestBranding.db_epoch || '1');
        const serverWrites = Number(latestBranding.write_count || 0);

        if (saved?.payload && String(saved.db_epoch) === serverEpoch && Number(saved.write_count) > 0 && serverWrites === 0) {
          autoRestoreInProgressRef.current = true;
          await apiRequest('/admin/import', {
            method: 'POST',
            body: JSON.stringify(saved.payload)
          });
          await refreshBranding();
          await refreshUser();
          autoRestoreInProgressRef.current = false;
        }
      } catch (_) {
        autoRestoreInProgressRef.current = false;
      }
    })();

    return () => {
      window.removeEventListener('mc-db-mutated', handleDbMutated);
      if (autoBackupTimerRef.current) clearTimeout(autoBackupTimerRef.current);
    };
  }, [user?.is_admin]);

  const handleLogout = () => {
    if (confirm('로그아웃 하시겠습니까?')) {
      setAuthToken(null);
      setUser(null);
    }
  };

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-primary)', color: 'var(--text-secondary)', fontWeight: 500 }}>
        플랫폼 리소스를 불러오는 중입니다...
      </div>
    );
  }

  // 로그인하지 않은 경우
  if (!user) {
    return (
      <LoginView
        branding={branding}
        onLoginSuccess={(loggedUser) => {
          setUser(loggedUser);
          if (loggedUser.must_change_password) {
            setShowPasswordModal(true);
          }
        }}
      />
    );
  }

  const navItems = [
    { id: 'supply', label: '물자 납품', icon: Package },
    { id: 'ranking', label: '시즌 랭킹', icon: Trophy },
    { id: 'shop', label: '포인트 상점', icon: ShoppingBag },
    { id: 'gig', label: '단기 알바', icon: Briefcase },
    { id: 'calendar', label: '일정 캘린더', icon: Calendar },
    { id: 'quest', label: '공통 퀘스트', icon: Compass },
    { id: 'credit', label: '크레딧 환전', icon: Coins }
  ];

  const canAccessAdmin = user.is_admin || ['계정 관리', '역할 관리', '데이터 관리', '랭킹 관리자', '공지 관리'].some(p => user.permissions?.includes(p));

  if (canAccessAdmin) {
    navItems.push({
      id: 'admin',
      label: user.is_admin ? '슈퍼 관리자' : '관리자·데이터 센터',
      icon: ShieldCheck,
      isAdmin: true
    });
  }

  return (
    <div className="app-container">
      {/* 좌측 사이드바 */}
      <aside className="sidebar">
        <div className="sidebar-header">
          <div className="server-logo">{branding.server_logo_text || 'M'}</div>
          <div>
            <div className="server-title">{branding.system_title || 'FEDERATION'}</div>
            <div className="server-subtitle">{branding.nation_name || '마인크래프트 전쟁 관리'}</div>
          </div>
        </div>

        <nav className="nav-menu">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => {
                  setActiveTab(item.id);
                  refreshUser();
                }}
                className={`nav-item ${isActive ? 'active' : ''} ${item.isAdmin ? 'admin-nav' : ''}`}
              >
                <Icon size={18} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>

        {/* 사이드바 하단 정보 */}
        <div style={{ padding: '16px 20px', borderTop: '1px solid var(--border-color)', fontSize: 12, color: 'var(--text-muted)' }}>
          <div style={{ fontWeight: 600 }}>서버: {branding.nation_name || '마인크래프트 전쟁'}</div>
          <div style={{ marginTop: 2 }}>v1.0.0 Production</div>
        </div>
      </aside>

      {/* 메인 콘텐츠 영역 */}
      <div className="main-wrapper">
        {/* 상단 헤더 */}
        <header className="top-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ fontSize: 17, fontWeight: 700, color: 'var(--text-main)', letterSpacing: '-0.3px' }}>
              {navItems.find(i => i.id === activeTab)?.label}
            </span>
          </div>

          <div className="header-user-info">
            {/* 자산 뱃지 */}
            <div className="asset-pill point" title="연방 포인트 (기여도)">
              <Sparkles size={14} />
              <span>{user.points?.toLocaleString() || 0} P</span>
            </div>

            <div className="asset-pill credit" title="크레딧 (인게임 원 환전 가능)">
              <Coins size={14} />
              <span>{user.credits?.toLocaleString() || 0} C</span>
            </div>

            {/* 유저 프로필 */}
            <div className="user-badge">
              <div className="avatar-circle">
                {(user.nickname || user.username).substring(0, 1).toUpperCase()}
              </div>
              <div style={{ fontSize: 13 }}>
                <span style={{ fontWeight: 600, color: user.roles?.[0]?.color && user.roles[0].color !== '#99aab5' ? user.roles[0].color : undefined }}>{user.nickname || user.username}</span>
                {user.is_admin && <span style={{ marginLeft: 6, color: '#fbbf24', fontSize: 11, fontWeight: 700 }}>[ADMIN]</span>}
                {!user.is_admin && user.roles?.[0] && (
                  <span style={{ marginLeft: 6, fontSize: 11, fontWeight: 700, color: user.roles[0].color }}>● {user.roles[0].name}</span>
                )}
              </div>
            </div>

            {/* 비밀번호 변경 버튼 */}
            <button
              onClick={() => setShowPasswordModal(true)}
              className="btn btn-secondary btn-sm"
              title="비밀번호 변경"
              style={{ position: 'relative' }}
            >
              <KeyRound size={14} />
              {user.must_change_password && (
                <span style={{ position: 'absolute', top: -4, right: -4, width: 8, height: 8, background: '#f59e0b', borderRadius: '50%' }} />
              )}
            </button>

            {/* 로그아웃 버튼 */}
            <button
              onClick={handleLogout}
              className="btn btn-secondary btn-sm"
              title="로그아웃"
            >
              <LogOut size={14} />
            </button>
          </div>
        </header>

        {/* 첫 접속 비밀번호 변경 권고 경고 배너 */}
        {user.must_change_password && (
          <div style={{
            background: 'var(--warning-container)',
            borderBottom: '1px solid #fde68a',
            padding: '12px 32px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            fontSize: 13,
            color: 'var(--on-warning-container)',
            fontWeight: 500
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <ShieldAlert size={18} />
              <span>현재 초기 임시 비밀번호를 사용 중입니다. 안전을 위해 즉시 비밀번호를 변경해 주세요.</span>
            </div>
            <button
              className="btn btn-sm btn-primary"
              onClick={() => setShowPasswordModal(true)}
            >
              비밀번호 변경하기
            </button>
          </div>
        )}

        {/* 본문 콘텐츠 바디 */}
        <main className="content-body">
          {activeTab === 'supply' && <SupplyTab user={user} refreshUser={refreshUser} />}
          {activeTab === 'ranking' && <RankingTab user={user} refreshUser={refreshUser} />}
          {activeTab === 'shop' && <ShopTab user={user} refreshUser={refreshUser} />}
          {activeTab === 'gig' && <GigTab user={user} refreshUser={refreshUser} />}
          {activeTab === 'calendar' && <CalendarTab user={user} />}
          {activeTab === 'quest' && <QuestTab user={user} refreshUser={refreshUser} />}
          {activeTab === 'credit' && <CreditTab user={user} refreshUser={refreshUser} />}
          {activeTab === 'admin' && canAccessAdmin && (
            <AdminTab
              user={user}
              refreshUser={refreshUser}
              branding={branding}
              refreshBranding={refreshBranding}
            />
          )}
        </main>
      </div>

      {/* 비밀번호 변경 모달 */}
      <ChangePasswordModal
        isOpen={showPasswordModal}
        isForced={user.must_change_password}
        onClose={() => setShowPasswordModal(false)}
        onSuccess={refreshUser}
      />
    </div>
  );
}
