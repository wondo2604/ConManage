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
  Sparkles,
  PanelLeftClose,
  PanelLeftOpen,
  Settings
} from 'lucide-react';

export const DEFAULT_NAV_LABELS = {
  supply: '물자 납품',
  ranking: '시즌 랭킹',
  shop: '포인트 상점',
  gig: '단기 알바',
  calendar: '일정 캘린더',
  quest: '공통 퀘스트',
  credit: '크레딧 환전',
  admin: '슈퍼 관리자'
};

export default function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('supply');
  const [adminSubTabRequest, setAdminSubTabRequest] = useState(null);
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(() => {
    try {
      return localStorage.getItem('mc_sidebar_open') !== 'false';
    } catch {
      return true;
    }
  });

  const toggleSidebar = () => {
    setIsSidebarOpen(prev => {
      const next = !prev;
      try {
        localStorage.setItem('mc_sidebar_open', String(next));
      } catch (_) {}
      return next;
    });
  };

  // 국가 & 시스템 브랜딩 상태 (PlanetEarth 기본값)
  const [branding, setBranding] = useState({
    browser_tab_title: 'PlanetEarth 국가 통합 관리 플랫폼',
    system_title: 'PLANET EARTH',
    nation_name: '플래닛어스 국가 관리',
    server_logo_text: '🌍',
    login_title: 'PlanetEarth 국가 통합 플랫폼',
    login_subtitle: 'PLANET EARTH - 마인크래프트 플래닛어스 서버 국가·경제·작전 통합 시스템',
    login_message: '🌍 마인크래프트 PlanetEarth 국가 통합 관리 플랫폼에 오신 것을 환영합니다!\n신규 국민은 하단의 [새로운 플레이어 등록]을 눌러 인게임 닉네임으로 가입을 신청해 주세요.',
    sidebar_footer_text: 'PlanetEarth Server · Towny & Nation',
    webhook_footer_text: 'PlanetEarth 국가 통합 관리 플랫폼',
    nav_labels_json: '',
    db_epoch: '1',
    write_count: '0'
  });
  const autoBackupTimerRef = useRef(null);
  const autoRestoreInProgressRef = useRef(false);

  // 브라우저 탭 타이틀(document.title) 실시간 동기화
  useEffect(() => {
    const customTabTitle = branding?.browser_tab_title && String(branding.browser_tab_title).trim();
    const fallbackTitle = `${branding?.nation_name || '플래닛어스 국가 관리'} - ${branding?.system_title || 'PLANET EARTH'}`;
    document.title = customTabTitle || fallbackTitle;
  }, [branding?.browser_tab_title, branding?.nation_name, branding?.system_title]);

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
    (async () => {
      const latestBranding = await refreshBranding();
      // 서버가 컨테이너 재배포/재시작으로 초기 상태(write_count === '0')인 경우 로그인 전이라도 로컬 스냅샷 즉시 복구
      if (latestBranding && Number(latestBranding.write_count || 0) === 0) {
        try {
          const raw = localStorage.getItem('mc_platform_auto_backup_v1') || localStorage.getItem('mc_platform_auto_backup_prev_v1');
          const saved = raw ? JSON.parse(raw) : null;
          if (saved?.payload && Number(saved.write_count || 0) > 0) {
            autoRestoreInProgressRef.current = true;
            await apiRequest('/admin/auto-restore', {
              method: 'POST',
              body: JSON.stringify(saved.payload)
            });
            await refreshBranding();
            autoRestoreInProgressRef.current = false;
          }
        } catch (_) {
          autoRestoreInProgressRef.current = false;
        }
      }
      await refreshUser();
    })();

    // 무료 클라우드 서버 절전(슬립) 방지를 위한 주기적 Keep-Alive 핑 (4분 간격)
    const keepAliveTimer = setInterval(() => {
      fetch('/api/health').catch(() => {});
    }, 4 * 60 * 1000);
    return () => clearInterval(keepAliveTimer);
  }, []);

  // 무료 서버 컨테이너 재시작·재배포 시 브라우저 로컬 스냅샷 자동 동기화 및 복구 (슈퍼관리자 전용)
  useEffect(() => {
    if (!user?.is_admin) return;

    const getSavedSnapshot = () => {
      try {
        const raw = localStorage.getItem('mc_platform_auto_backup_v1');
        return raw ? JSON.parse(raw) : null;
      } catch (_) {
        return null;
      }
    };

    const tryAutoRestoreIfServerReset = async () => {
      if (autoRestoreInProgressRef.current) return false;
      try {
        const saved = getSavedSnapshot();
        if (!saved?.payload || !(Number(saved.write_count) > 0)) return false;

        const latestBranding = await refreshBranding();
        if (!latestBranding) return false;
        const serverEpoch = String(latestBranding.db_epoch || '1');
        const serverWrites = Number(latestBranding.write_count || 0);
        const savedEpoch = String(saved.db_epoch || '1');
        const savedWrites = Number(saved.write_count || 0);

        // 1) 서버가 재배포/재시작되어 write_count === 0 초기 상태로 돌아간 경우 (epoch가 같거나 로컬 스냅샷 epoch가 더 최신인 경우)
        // 2) 또는 동일 epoch 내에서 서버 write_count가 로컬 스냅샷보다 작아진 경우(백그라운드 재배포 직후 1~2회 쓰기 발생)
        const isFreshContainerReset = serverWrites === 0 && Number(savedEpoch) >= Number(serverEpoch);
        const isSameEpochRollback = savedEpoch === serverEpoch && serverWrites < savedWrites;

        if (isFreshContainerReset || isSameEpochRollback) {
          autoRestoreInProgressRef.current = true;
          await apiRequest('/admin/import', {
            method: 'POST',
            body: JSON.stringify(saved.payload)
          });
          await refreshBranding();
          await refreshUser();
          autoRestoreInProgressRef.current = false;
          return true;
        }
      } catch (_) {
        autoRestoreInProgressRef.current = false;
      }
      return false;
    };

    const saveSnapshotToLocal = async () => {
      if (autoRestoreInProgressRef.current) return;
      try {
        // 저장 전 혹시 백그라운드에서 컨테이너가 초기화된 상태인지 먼저 점검
        const restored = await tryAutoRestoreIfServerReset();
        if (restored) return;

        const payload = await apiRequest('/admin/export');
        const settingsRows = payload?.data?.settings || [];
        const epochRow = settingsRows.find(r => r.key === 'db_epoch');
        const writeRow = settingsRows.find(r => r.key === 'write_count');
        const db_epoch = String(epochRow?.value || '1');
        const write_count = Number(writeRow?.value || 0);

        if (write_count > 0) {
          const prev = getSavedSnapshot();
          // 만약 기존 스냅샷의 write_count가 현재보다 더 크다면 안전을 위해 이전 백업 슬롯에 보존
          if (prev?.payload && Number(prev.write_count || 0) > write_count) {
            localStorage.setItem('mc_platform_auto_backup_prev_v1', JSON.stringify(prev));
          }
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

    const handleWindowFocus = () => {
      tryAutoRestoreIfServerReset();
    };

    window.addEventListener('mc-db-mutated', handleDbMutated);
    window.addEventListener('focus', handleWindowFocus);

    tryAutoRestoreIfServerReset();

    return () => {
      window.removeEventListener('mc-db-mutated', handleDbMutated);
      window.removeEventListener('focus', handleWindowFocus);
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

  let customNavLabels = {};
  if (branding.nav_labels_json) {
    try {
      const parsed = JSON.parse(branding.nav_labels_json);
      if (parsed && typeof parsed === 'object') {
        customNavLabels = parsed;
      }
    } catch {
      customNavLabels = {};
    }
  }
  const getNavLabel = (id, fallback) => {
    const val = customNavLabels[id];
    return val && String(val).trim() ? String(val).trim() : (fallback || DEFAULT_NAV_LABELS[id] || id);
  };

  const navItems = [
    { id: 'supply', label: getNavLabel('supply'), icon: Package },
    { id: 'ranking', label: getNavLabel('ranking'), icon: Trophy },
    { id: 'shop', label: getNavLabel('shop'), icon: ShoppingBag },
    { id: 'gig', label: getNavLabel('gig'), icon: Briefcase },
    { id: 'calendar', label: getNavLabel('calendar'), icon: Calendar },
    { id: 'quest', label: getNavLabel('quest'), icon: Compass },
    { id: 'credit', label: getNavLabel('credit'), icon: Coins }
  ];

  const canAccessAdmin = user.is_admin || ['계정 관리', '역할 관리', '데이터 관리', '랭킹 관리자', '공지 관리'].some(p => user.permissions?.includes(p));
  const canEditBranding = user.is_admin || user.permissions?.includes('공지 관리');

  if (canAccessAdmin) {
    navItems.push({
      id: 'admin',
      label: getNavLabel('admin', user.is_admin ? '슈퍼 관리자' : '관리자·데이터 센터'),
      icon: ShieldCheck,
      isAdmin: true
    });
  }

  return (
    <div className="app-container">
      {/* 좌측 사이드바 (열기/닫기 토글 지원) */}
      <aside className={`sidebar ${isSidebarOpen ? 'open' : 'closed'}`}>
        <div className="sidebar-inner">
          <div className="sidebar-header" style={{ justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0, flex: 1 }}>
              <div className="server-logo" style={{ flexShrink: 0 }}>{branding.server_logo_text || '🌍'}</div>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div className="server-title" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {branding.system_title || 'PLANET EARTH'}
                </div>
                <div className="server-subtitle" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {branding.nation_name || '플래닛어스 국가 관리'}
                </div>
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
              {canEditBranding && (
                <button
                  type="button"
                  onClick={() => {
                    setActiveTab('admin');
                    setAdminSubTabRequest('system');
                  }}
                  title="사이트 이름·탭 이름·로고 직접 설정"
                  style={{
                    background: 'rgba(255,255,255,0.06)',
                    border: '1px solid rgba(255,255,255,0.1)',
                    color: '#cbd5e1',
                    width: 28,
                    height: 28,
                    borderRadius: 6,
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    cursor: 'pointer'
                  }}
                >
                  <Settings size={14} />
                </button>
              )}
              <button
                type="button"
                onClick={toggleSidebar}
                title="왼쪽 메뉴 탭 닫기"
                style={{
                  background: 'rgba(255,255,255,0.06)',
                  border: '1px solid rgba(255,255,255,0.1)',
                  color: '#cbd5e1',
                  width: 28,
                  height: 28,
                  borderRadius: 6,
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer'
                }}
              >
                <PanelLeftClose size={15} />
              </button>
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
            <div style={{ fontWeight: 600 }}>서버: {branding.nation_name || '플래닛어스 국가 관리'}</div>
            <div style={{ marginTop: 2 }}>{branding.sidebar_footer_text || 'PlanetEarth Server · Towny & Nation'}</div>
          </div>
        </div>
      </aside>

      {/* 메인 콘텐츠 영역 */}
      <div className="main-wrapper">
        {/* 상단 헤더 */}
        <header className="top-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <button
              type="button"
              onClick={toggleSidebar}
              className="sidebar-toggle-btn"
              title={isSidebarOpen ? '왼쪽 메뉴 탭 접기' : '왼쪽 메뉴 탭 열기'}
            >
              {isSidebarOpen ? <PanelLeftClose size={18} /> : <PanelLeftOpen size={18} />}
            </button>
            {!isSidebarOpen && (
              <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--primary)', padding: '3px 8px', background: '#eff6ff', borderRadius: 6, border: '1px solid #bfdbfe' }}>
                {branding.server_logo_text || '🌍'} {branding.system_title || 'PLANET EARTH'}
              </span>
            )}
            <span style={{ fontSize: 17, fontWeight: 700, color: 'var(--text-main)', letterSpacing: '-0.3px' }}>
              {navItems.find(i => i.id === activeTab)?.label}
            </span>
          </div>

          <div className="header-user-info">
            {/* 자산 뱃지 */}
            <div className="asset-pill point" title="국가 기여 포인트 (P)">
              <Sparkles size={14} />
              <span>{user.points?.toLocaleString() || 0} P</span>
            </div>

            <div className="asset-pill credit" title="크레딧 (PlanetEarth 인게임 화폐 환전 가능)">
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
              requestedSubTab={adminSubTabRequest}
              onClearSubTabRequest={() => setAdminSubTabRequest(null)}
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
