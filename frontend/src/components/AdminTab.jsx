import React, { useState, useEffect, useRef } from 'react';
import { apiRequest, getAuthToken } from '../api';
import {
  ShieldCheck,
  Users,
  Key,
  DollarSign,
  Settings,
  Send,
  UserCheck,
  UserX,
  UserPlus,
  Trash2,
  Clock,
  Crown,
  Flag,
  Globe,
  Download,
  Upload,
  Database,
  Bell,
  Palette,
  FileJson,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  FileSpreadsheet,
  Sliders,
  Plus,
  History,
  Edit2,
  Shield,
  Search,
  Layers,
  X
} from 'lucide-react';
import RoleManager from './RoleManager';
import WebhookManager from './WebhookManager';

export default function AdminTab({ user, refreshUser, branding, refreshBranding }) {
  const [users, setUsers] = useState([]);
  const [allRoles, setAllRoles] = useState([]);
  const [roleRefreshKey, setRoleRefreshKey] = useState(0);
  const [settings, setSettings] = useState({ discord_webhook_url: '' });
  const [notices, setNotices] = useState([]);
  const [selectedNoticeCategory, setSelectedNoticeCategory] = useState('supply');
  const [noticeWebhookForm, setNoticeWebhookForm] = useState({
    title: '',
    content: '',
    webhook_url: '',
    webhook_enabled: 0,
    mention_type: 'none',
    embed_color: '#3b82f6',
    message_template: ''
  });
  const [loading, setLoading] = useState(true);
  const [backupLoading, setBackupLoading] = useState(false);
  const [restoreLoading, setRestoreLoading] = useState(false);
  const [resetLoading, setResetLoading] = useState(false);
  const [testingNoticeWebhook, setTestingNoticeWebhook] = useState(false);

  // 사용자 검색 및 역할 표시 방식 상태
  const [userSearch, setUserSearch] = useState('');
  const [roleViewMode, setRoleViewMode] = useState('select'); // 'select' (드롭다운 선택형) | 'buttons' (전체 버튼 나열형)
  const [autoSaveStatus, setAutoSaveStatus] = useState('💾 SQLite 실시간 자동저장');

  const fileInputRef = useRef(null);
  const brandingTimerRef = useRef(null);
  const numericTimerRef = useRef(null);
  const noticeTimerRef = useRef(null);

  // 브랜딩 및 초기 로그인 화면 메시지 수정 폼
  const [brandingForm, setBrandingForm] = useState({
    system_title: branding?.system_title || 'FEDERATION',
    nation_name: branding?.nation_name || '마인크래프트 전쟁 관리',
    server_logo_text: branding?.server_logo_text || 'M',
    login_subtitle: branding?.login_subtitle || '',
    login_message: branding?.login_message || ''
  });

  // 모달 상태
  const [showAssetModal, setShowAssetModal] = useState(false);
  const [selectedUser, setSelectedUser] = useState(null);
  const [assetForm, setAssetForm] = useState({
    points: 0,
    credits: 0,
    nickname: '',
    custom_title: '',
    reason: '',
    sync_active_season: true
  });

  // 새 슈퍼 관리자 생성 모달
  const [showSuperAdminModal, setShowSuperAdminModal] = useState(false);
  const [superAdminForm, setSuperAdminForm] = useState({ username: '', password: '', nickname: '' });

  // 전역 배율 및 수치 설정 상태
  const [globalNumericConfig, setGlobalNumericConfig] = useState({
    point_multiplier: '1.0',
    credit_multiplier: '1.0',
    ranking_board_notice: '',
    exchange_rate: '1.0',
    min_exchange_amount: '100',
    exchange_fee_percent: '0'
  });

  // 입출금 원장 & 데이터 관리 상태
  const [transactions, setTransactions] = useState([]);
  const [txFilter, setTxFilter] = useState({ asset_type: 'ALL', tx_type: 'ALL', category: 'ALL', search: '' });
  const [showManualTxModal, setShowManualTxModal] = useState(false);
  const [manualTxForm, setManualTxForm] = useState({
    user_id: '',
    asset_type: 'POINT',
    amount: 0,
    category: '관리자 수동 정산',
    description: ''
  });

  const isInitialAdmin = Boolean(user.is_admin || user.username === 'admin');
  const canManageAccounts = user.is_admin || user.permissions?.includes('계정 관리');
  const canManageRoles = user.is_admin || user.permissions?.includes('역할 관리');
  const canManageNotices = user.is_admin || user.permissions?.includes('공지 관리');
  const canManageData = user.is_admin || user.permissions?.includes('데이터 관리');
  const canManageRanking = user.is_admin || user.permissions?.includes('랭킹 관리자') || user.permissions?.includes('시즌 관리');

  const pendingUsers = users.filter(u => u.status === 'pending');
  const approvedUsers = users.filter(u => u.status !== 'pending');

  // 권한에 따라 접근 가능한 서브 탭 구성
  const availableTabs = [
    {
      id: 'users',
      label: '계정 · 가입 관리',
      shortLabel: '계정·승인',
      icon: Users,
      badge: pendingUsers.length > 0 ? `대기 ${pendingUsers.length}` : `${approvedUsers.length}명`,
      badgeAlert: pendingUsers.length > 0,
      desc: '신규 가입 승인 심사, 전체 사용자 조회, 역할 선택 부여 및 개인별 보유 재화·칭호를 관리합니다.',
      visible: user.is_admin || canManageAccounts || canManageRoles
    },
    {
      id: 'roles',
      label: '역할 · 권한 설정',
      shortLabel: '역할·권한',
      icon: Shield,
      badge: `${allRoles.length}개`,
      badgeAlert: false,
      desc: '디스코드 스타일의 역할 생성, 서열(위계) 순서 배치 및 세부 권한을 관리합니다.',
      visible: user.is_admin || canManageRoles || canManageAccounts
    },
    {
      id: 'economy',
      label: '전역 수치 · 배율',
      shortLabel: '수치·배율',
      icon: Sliders,
      badge: `x${globalNumericConfig.point_multiplier || '1.0'}`,
      badgeAlert: false,
      desc: '서버 내 포인트·크레딧 획득 배율, 크레딧 환전 비율 및 수수료율, 랭킹 안내 문구를 정밀 제어합니다.',
      visible: user.is_admin || canManageRanking
    },
    {
      id: 'ledger',
      label: '입출금 상세 원장',
      shortLabel: '입출금 원장',
      icon: FileSpreadsheet,
      badge: `${transactions.length}건`,
      badgeAlert: false,
      desc: '연방 포인트 및 크레딧의 모든 입출금 기록을 조회하고 수동 정산 및 CSV/XLSX 엑셀 추출을 수행합니다.',
      visible: canManageData
    },
    {
      id: 'notices',
      label: '공지사항 · 양식',
      shortLabel: '공지·양식',
      icon: Palette,
      badge: `${notices.length || 1}종`,
      badgeAlert: false,
      desc: '납품 안내문 등 공지사항 본문과 전용 디스코드 웹훅 채널, 메시지 템플릿을 설정합니다.',
      visible: user.is_admin || canManageNotices
    },
    {
      id: 'webhooks',
      label: '디스코드 웹훅 (26종)',
      shortLabel: '웹훅 센터',
      icon: Bell,
      badge: '26종',
      badgeAlert: false,
      desc: '플랫폼 내 26종 이벤트별 디스코드 웹훅 ON/OFF, 개별 채널 URL, 멘션, 임베드 색상을 통합 제어합니다.',
      visible: user.is_admin
    },
    {
      id: 'system',
      label: '시스템 · 백업 · 브랜딩',
      shortLabel: '시스템·백업',
      icon: Database,
      badge: 'JSON',
      badgeAlert: false,
      desc: '국가 및 시스템 타이틀·로고 브랜딩 설정과 전체 데이터베이스(14개 테이블) JSON 백업·복원을 수행합니다.',
      visible: user.is_admin
    }
  ].filter(t => t.visible);

  const [activeSubTab, setActiveSubTab] = useState(() => availableTabs[0]?.id || 'users');

  useEffect(() => {
    if (availableTabs.length > 0 && !availableTabs.some(t => t.id === activeSubTab)) {
      setActiveSubTab(availableTabs[0].id);
    }
  }, [availableTabs.map(t => t.id).join(',')]);

  const currentTabInfo = availableTabs.find(t => t.id === activeSubTab) || availableTabs[0];

  const loadTransactions = async (customFilter = txFilter) => {
    if (!canManageData) return;
    try {
      const params = new URLSearchParams();
      if (customFilter.asset_type && customFilter.asset_type !== 'ALL') params.set('asset_type', customFilter.asset_type);
      if (customFilter.tx_type && customFilter.tx_type !== 'ALL') params.set('tx_type', customFilter.tx_type);
      if (customFilter.category && customFilter.category !== 'ALL') params.set('category', customFilter.category);
      if (customFilter.search) params.set('search', customFilter.search);
      params.set('limit', '300');
      const data = await apiRequest(`/transactions?${params.toString()}`);
      setTransactions(Array.isArray(data) ? data : (data?.transactions || []));
    } catch (err) {
      console.error(err);
      setTransactions([]);
    }
  };

  const refreshRolesAndUsers = async () => {
    try {
      const [usersData, rolesData] = await Promise.all([
        (canManageAccounts || canManageRoles || canManageData || canManageRanking) ? apiRequest('/users').catch(() => []) : Promise.resolve([]),
        apiRequest('/roles').catch(() => [])
      ]);
      setUsers(Array.isArray(usersData) ? usersData : []);
      setAllRoles(Array.isArray(rolesData) ? rolesData : []);
    } catch (err) {
      console.error(err);
    }
  };

  const loadData = async (isInitial = false) => {
    try {
      setLoading(true);
      const [usersData, rolesData, settingsData, noticesData, rankCfg, creditCfg] = await Promise.all([
        (canManageAccounts || canManageRoles || canManageData || canManageRanking) ? apiRequest('/users').catch(() => []) : Promise.resolve([]),
        apiRequest('/roles').catch(() => []),
        user.is_admin ? apiRequest('/settings').catch(() => ({})) : Promise.resolve({}),
        canManageNotices ? apiRequest('/notices').catch(() => []) : Promise.resolve([]),
        (user.is_admin || canManageRanking) ? apiRequest('/ranking/config').catch(() => null) : Promise.resolve(null),
        user.is_admin ? apiRequest('/credits/config').catch(() => null) : Promise.resolve(null)
      ]);
      setUsers(Array.isArray(usersData) ? usersData : []);
      setAllRoles(Array.isArray(rolesData) ? rolesData : []);
      setSettings(settingsData || {});
      setNotices(Array.isArray(noticesData) ? noticesData : []);

      if ((isInitial || !numericTimerRef.current) && (rankCfg || creditCfg)) {
        setGlobalNumericConfig(prev => ({
          ...prev,
          ...(rankCfg || {}),
          ...(creditCfg || {})
        }));
      }

      if (canManageData) {
        await loadTransactions();
      }

      // 기본 선택 공지 폼 설정 (supply)
      if (isInitial || !noticeTimerRef.current) {
        const currentNotice = (noticesData || []).find(n => n.category === selectedNoticeCategory) || (noticesData || [])[0];
        if (currentNotice) {
          setNoticeWebhookForm({
            title: currentNotice.title || '',
            content: currentNotice.content || '',
            webhook_url: currentNotice.webhook_url || '',
            webhook_enabled: currentNotice.webhook_enabled ? 1 : 0,
            mention_type: currentNotice.mention_type || 'none',
            embed_color: currentNotice.embed_color || '#3b82f6',
            message_template: currentNotice.message_template || ''
          });
        }
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData(true);
  }, []);

  useEffect(() => {
    if (branding && !brandingTimerRef.current) {
      setBrandingForm({
        system_title: branding.system_title || 'FEDERATION',
        nation_name: branding.nation_name || '마인크래프트 전쟁 관리',
        server_logo_text: branding.server_logo_text || 'M',
        login_subtitle: branding.login_subtitle || '',
        login_message: branding.login_message || ''
      });
    }
  }, [branding?.system_title, branding?.nation_name, branding?.server_logo_text, branding?.login_subtitle, branding?.login_message]);

  // 브랜딩 · 로그인 화면 메시지 저장 - 입력 즉시 SQLite 자동 저장 지원
  const handleSaveBranding = async (e, customData = null, isAuto = false) => {
    if (e && e.preventDefault) e.preventDefault();
    if (!isInitialAdmin && !canManageNotices) {
      if (!isAuto) alert('국가/시스템 브랜딩 및 로그인 화면 메시지 수정 권한이 없습니다.');
      return;
    }
    if (!isAuto && brandingTimerRef.current) {
      clearTimeout(brandingTimerRef.current);
      brandingTimerRef.current = null;
    }

    const payload = customData || brandingForm;
    if (isInitialAdmin && (!payload.system_title?.trim() || !payload.nation_name?.trim() || !payload.server_logo_text?.trim())) {
      return;
    }

    try {
      setAutoSaveStatus('⏳ 브랜딩 · 로그인 메시지 SQLite 저장 중...');
      const res = await apiRequest('/settings/branding', {
        method: 'PUT',
        body: JSON.stringify(payload)
      });
      brandingTimerRef.current = null;
      setAutoSaveStatus(`✅ 자동 저장됨 (${new Date().toLocaleTimeString('ko-KR', { hour12: false })})`);
      if (!isAuto) alert(res.message);
      if (refreshBranding) refreshBranding();
    } catch (err) {
      brandingTimerRef.current = null;
      setAutoSaveStatus('⚠️ 저장 오류');
      if (!isAuto) alert(err.message);
    }
  };

  const updateBrandingAutoSave = (patch) => {
    const next = { ...brandingForm, ...patch };
    setBrandingForm(next);
    if (!isInitialAdmin && !canManageNotices) return;
    if (brandingTimerRef.current) clearTimeout(brandingTimerRef.current);
    setAutoSaveStatus('⏳ 브랜딩 · 로그인 메시지 변경 감지 · 자동 저장 대기...');
    brandingTimerRef.current = setTimeout(() => {
      handleSaveBranding(null, next, true);
    }, 600);
  };

  // 가입 승인 / 거절
  const handleUpdateStatus = async (targetUser, status) => {
    if (!confirm(`'${targetUser.nickname || targetUser.username}' 사용자의 가입을 ${status === 'approved' ? '승인' : '거절'}하시겠습니까?`)) return;

    try {
      await apiRequest(`/users/${targetUser.id}/status`, {
        method: 'PUT',
        body: JSON.stringify({ status })
      });
      alert(`계정이 ${status === 'approved' ? '승인' : '거절'}되었습니다.`);
      loadData();
    } catch (err) {
      alert(err.message);
    }
  };

  // 계정 삭제
  const handleDeleteUser = async (targetUser) => {
    if (!confirm(`'${targetUser.username}' 계정을 완전히 삭제하시겠습니까?`)) return;

    try {
      await apiRequest(`/users/${targetUser.id}`, { method: 'DELETE' });
      alert('계정이 삭제되었습니다.');
      loadData();
    } catch (err) {
      alert(err.message);
    }
  };

  // 슈퍼 관리자 계정 생성 (슈퍼 관리자만 가능)
  const handleCreateSuperAdmin = async (e) => {
    e.preventDefault();
    try {
      const res = await apiRequest('/users/super-admin', {
        method: 'POST',
        body: JSON.stringify(superAdminForm)
      });
      alert(res.message);
      setShowSuperAdminModal(false);
      setSuperAdminForm({ username: '', password: '', nickname: '' });
      loadData();
    } catch (err) {
      alert(err.message);
    }
  };

  const handleToggleRole = async (targetUser, roleObj) => {
    const currentRoleIds = (targetUser.roles || []).map(r => r.id);
    const updatedRoleIds = currentRoleIds.includes(roleObj.id)
      ? currentRoleIds.filter(id => id !== roleObj.id)
      : [...currentRoleIds, roleObj.id];

    try {
      await apiRequest(`/users/${targetUser.id}/roles`, {
        method: 'PUT',
        body: JSON.stringify({ role_ids: updatedRoleIds })
      });
      await loadData();
      setRoleRefreshKey(k => k + 1);
      if (refreshUser && targetUser.id === user.id) refreshUser();
    } catch (err) {
      alert(err.message);
    }
  };

  const handleToggleAdmin = async (targetUser) => {
    if (targetUser.username === 'admin' && targetUser.is_admin) {
      alert('기본 슈퍼관리자 admin 계정의 관리자 권한은 해제할 수 없습니다.');
      return;
    }

    try {
      await apiRequest(`/users/${targetUser.id}/admin`, {
        method: 'PUT',
        body: JSON.stringify({ is_admin: !targetUser.is_admin })
      });
      loadData();
      if (refreshUser && targetUser.id === user.id) refreshUser();
    } catch (err) {
      alert(err.message);
    }
  };

  const handleResetPassword = async (targetUser) => {
    const newPass = prompt(`'${targetUser.username}'의 새 임시 비밀번호를 입력하세요 (비워두면 1234):`, '1234');
    if (newPass === null) return;

    try {
      const res = await apiRequest(`/users/${targetUser.id}/reset-password`, {
        method: 'POST',
        body: JSON.stringify({ newPassword: newPass || '1234' })
      });
      alert(res.message);
      loadData();
    } catch (err) {
      alert(err.message);
    }
  };

  const handleSaveAssets = async (e) => {
    e.preventDefault();
    try {
      await apiRequest(`/users/${selectedUser.id}/assets`, {
        method: 'PUT',
        body: JSON.stringify(assetForm)
      });
      if (assetForm.nickname !== (selectedUser.nickname || '') || assetForm.custom_title !== (selectedUser.custom_title || '')) {
        await apiRequest(`/users/${selectedUser.id}/profile`, {
          method: 'PUT',
          body: JSON.stringify({
            nickname: assetForm.nickname,
            custom_title: assetForm.custom_title
          })
        });
      }
      alert('사용자 프로필 및 재화 수치가 정밀 수정되었습니다.');
      setShowAssetModal(false);
      loadData();
      if (refreshUser && selectedUser.id === user.id) refreshUser();
    } catch (err) {
      alert(err.message);
    }
  };

  const handleSaveGlobalNumericConfig = async (e, customCfg = null, isAuto = false) => {
    if (e && e.preventDefault) e.preventDefault();
    if (!isAuto && numericTimerRef.current) {
      clearTimeout(numericTimerRef.current);
      numericTimerRef.current = null;
    }
    const cfg = customCfg || globalNumericConfig;
    try {
      setAutoSaveStatus('⏳ 전역 수치 SQLite 저장 중...');
      await Promise.all([
        apiRequest('/ranking/config', {
          method: 'PUT',
          body: JSON.stringify({
            point_multiplier: cfg.point_multiplier,
            credit_multiplier: cfg.credit_multiplier,
            ranking_board_notice: cfg.ranking_board_notice
          })
        }),
        user.is_admin
          ? apiRequest('/credits/config', {
              method: 'PUT',
              body: JSON.stringify({
                exchange_rate: cfg.exchange_rate,
                min_exchange_amount: cfg.min_exchange_amount,
                exchange_fee_percent: cfg.exchange_fee_percent
              })
            })
          : Promise.resolve()
      ]);
      numericTimerRef.current = null;
      setAutoSaveStatus(`✅ 수치 자동 저장됨 (${new Date().toLocaleTimeString('ko-KR', { hour12: false })})`);
      if (!isAuto) {
        alert('전역 수치 및 배율 설정이 저장되었습니다.');
        loadData();
      }
    } catch (err) {
      numericTimerRef.current = null;
      setAutoSaveStatus('⚠️ 저장 오류');
      if (!isAuto) alert(err.message);
    }
  };

  const updateNumericConfigAutoSave = (patch) => {
    const next = { ...globalNumericConfig, ...patch };
    setGlobalNumericConfig(next);
    if (numericTimerRef.current) clearTimeout(numericTimerRef.current);
    setAutoSaveStatus('⏳ 수치 변경 감지 · 자동 저장 대기...');
    numericTimerRef.current = setTimeout(() => {
      handleSaveGlobalNumericConfig(null, next, true);
    }, 550);
  };

  const handleDownloadLedger = async (format = 'csv') => {
    try {
      const token = getAuthToken();
      const params = new URLSearchParams();
      params.set('format', format);
      if (txFilter.asset_type && txFilter.asset_type !== 'ALL') params.set('asset_type', txFilter.asset_type);
      if (txFilter.tx_type && txFilter.tx_type !== 'ALL') params.set('tx_type', txFilter.tx_type);
      if (txFilter.category && txFilter.category !== 'ALL') params.set('category', txFilter.category);
      if (txFilter.search) params.set('search', txFilter.search);

      const res = await fetch(`/api/transactions/export?${params.toString()}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || '다운로드 실패');
      }
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `federation_transactions_${new Date().toISOString().slice(0, 10)}.${format}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      alert(err.message);
    }
  };

  const handleCreateManualTx = async (e) => {
    e.preventDefault();
    try {
      const res = await apiRequest('/transactions/manual', {
        method: 'POST',
        body: JSON.stringify(manualTxForm)
      });
      alert(res.message);
      setShowManualTxModal(false);
      setManualTxForm({ user_id: '', asset_type: 'POINT', amount: 0, category: '관리자 수동 정산', description: '' });
      loadData();
      if (refreshUser) refreshUser();
    } catch (err) {
      alert(err.message);
    }
  };

  // 💾 슈퍼관리자 전용: 데이터 JSON 추출 (Export)
  const handleExportData = async () => {
    try {
      setBackupLoading(true);
      const token = getAuthToken();
      const res = await fetch('/api/admin/export', {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => null);
        throw new Error(errJson?.error || `추출 실패 (HTTP ${res.status})`);
      }

      const blob = await res.blob();
      const disposition = res.headers.get('Content-Disposition');
      let filename = 'minecraft-platform-backup.json';
      if (disposition && disposition.includes('filename=')) {
        const matches = disposition.match(/filename="?([^"]+)"?/);
        if (matches && matches[1]) filename = matches[1];
      }

      const downloadUrl = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = downloadUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(downloadUrl);
      a.remove();
      alert(`✅ 전체 데이터베이스가 성공적으로 JSON 파일로 추출되었습니다.\n파일명: ${filename}`);
    } catch (err) {
      alert(`데이터 추출 오류: ${err.message}`);
    } finally {
      setBackupLoading(false);
    }
  };

  // 📥 슈퍼관리자 전용: 데이터 JSON 불러오기 (Import)
  const handleImportFileSelect = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.name.endsWith('.json')) {
      alert('오직 .json 형식의 백업 파일만 불러올 수 있습니다.');
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }

    const confirmRestore = confirm(
      `⚠️ [데이터베이스 복원 경고]\n\n` +
      `선택한 파일: ${file.name} (${(file.size / 1024).toFixed(1)} KB)\n\n` +
      `현재 데이터베이스의 모든 데이터(사용자, 퀘스트, 물자, 랭킹, 공지사항, 설정 등)가\n` +
      `선택한 JSON 파일의 내용으로 완전히 교체(복원)됩니다.\n\n` +
      `정말로 복원을 진행하시겠습니까?`
    );

    if (!confirmRestore) {
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }

    try {
      setRestoreLoading(true);
      const formData = new FormData();
      formData.append('backup_file', file);

      const res = await apiRequest('/admin/import', {
        method: 'POST',
        body: formData
      });

      let summary = '';
      if (res.restoredCounts) {
        summary = Object.entries(res.restoredCounts)
          .map(([k, v]) => `${k}: ${v}건`)
          .join(', ');
      }

      alert(`🎉 데이터베이스 복원이 성공적으로 완료되었습니다!\n\n복원 내역:\n${summary}\n\n화면을 새로고침합니다.`);
      window.location.reload();
    } catch (err) {
      alert(`복원 실패: ${err.message}`);
    } finally {
      setRestoreLoading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  // 🧹 슈퍼관리자 전용: 데이터베이스 초기화 (리셋)
  const handleResetDatabase = async (mode = 'all') => {
    const isAll = mode === 'all';
    const confirmMsg = isAll
      ? '⚠️ [전체 데이터베이스 공장 초기화 확인]\n\n모든 계정(슈퍼관리자 admin 제외), 납품/퀘스트/알바/상점/원장 기록, 브랜딩 및 설정이 초기 상태로 완전히 리셋됩니다.\n(현재 admin 계정의 로그인 비밀번호는 그대로 유지되며 보유 포인트·크레딧은 0으로 초기화됩니다.)\n\n정말로 전체 초기화를 진행하시겠습니까?'
      : '⚠️ [운영 내역 및 재화 초기화 확인]\n\n회원 계정·역할·웹훅·브랜딩 설정은 유지하고, 모든 납품/퀘스트/알바/상점/원장/시즌 기록과 전 플레이어의 보유 포인트(P)·크레딧(C)을 0으로 초기화합니다.\n\n정말로 진행하시겠습니까?';

    if (!confirm(confirmMsg)) return;

    try {
      setResetLoading(true);
      try {
        localStorage.removeItem('mc_platform_auto_backup_v1');
      } catch (_) {}
      const res = await apiRequest('/admin/reset', {
        method: 'POST',
        body: JSON.stringify({ mode })
      });
      alert(res.message || '초기화가 완료되었습니다.');
      if (refreshBranding) await refreshBranding();
      if (refreshUser) await refreshUser();
      await loadData(true);
      setRoleRefreshKey(k => k + 1);
    } catch (err) {
      alert(`초기화 실패: ${err.message}`);
    } finally {
      setResetLoading(false);
    }
  };

  // 공지사항 선택 변경
  const handleSelectNoticeCategory = (cat) => {
    setSelectedNoticeCategory(cat);
    const found = notices.find(n => n.category === cat);
    if (found) {
      setNoticeWebhookForm({
        title: found.title || '',
        content: found.content || '',
        webhook_url: found.webhook_url || '',
        webhook_enabled: found.webhook_enabled ? 1 : 0,
        mention_type: found.mention_type || 'none',
        embed_color: found.embed_color || '#3b82f6',
        message_template: found.message_template || ''
      });
    } else {
      setNoticeWebhookForm({
        title: '',
        content: '',
        webhook_url: '',
        webhook_enabled: 0,
        mention_type: 'none',
        embed_color: '#3b82f6',
        message_template: ''
      });
    }
  };

  // 공지사항 웹훅 및 양식 저장 (입력 시 SQLite 자동 저장 지원)
  const handleSaveNoticeWebhook = async (e, sendNow = false, customForm = null, isAuto = false) => {
    if (e && e.preventDefault) e.preventDefault();
    if (!isAuto && noticeTimerRef.current) {
      clearTimeout(noticeTimerRef.current);
      noticeTimerRef.current = null;
    }
    const payload = customForm || noticeWebhookForm;
    if (!payload.title?.trim() || !payload.content?.trim()) return;
    try {
      setAutoSaveStatus('⏳ 공지사항 SQLite 저장 중...');
      const res = await apiRequest(`/notices/${selectedNoticeCategory}`, {
        method: 'PUT',
        body: JSON.stringify({
          ...payload,
          send_now: sendNow,
          auto_save: isAuto
        })
      });
      noticeTimerRef.current = null;
      setNotices(prev =>
        prev.map(n => (n.category === selectedNoticeCategory ? { ...n, ...payload } : n))
      );
      setAutoSaveStatus(`✅ 공지 자동 저장됨 (${new Date().toLocaleTimeString('ko-KR', { hour12: false })})`);
      if (!isAuto) {
        alert(res.message || '공지사항 및 웹훅 설정이 저장되었습니다.');
        loadData();
      }
    } catch (err) {
      noticeTimerRef.current = null;
      setAutoSaveStatus('⚠️ 저장 오류');
      if (!isAuto) alert(err.message);
    }
  };

  const updateNoticeFormAutoSave = (patch) => {
    const next = { ...noticeWebhookForm, ...patch };
    setNoticeWebhookForm(next);
    if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current);
    setAutoSaveStatus('⏳ 공지 변경 감지 · 자동 저장 대기...');
    noticeTimerRef.current = setTimeout(() => {
      handleSaveNoticeWebhook(null, false, next, true);
    }, 600);
  };

  // 공지사항 웹훅 테스트
  const handleTestNoticeWebhookFromAdmin = async () => {
    try {
      setTestingNoticeWebhook(true);
      const res = await apiRequest(`/notices/${selectedNoticeCategory}/test-webhook`, {
        method: 'POST',
        body: JSON.stringify(noticeWebhookForm)
      });
      alert(res.message || '공지사항 디스코드 테스트 웹훅이 성공적으로 발송되었습니다!');
    } catch (err) {
      alert(`웹훅 발송 실패: ${err.message}`);
    } finally {
      setTestingNoticeWebhook(false);
    }
  };

  const filteredApprovedUsers = approvedUsers.filter(u => {
    const q = userSearch.trim().toLowerCase();
    if (!q) return true;
    const matchName = (u.nickname || '').toLowerCase().includes(q) || (u.username || '').toLowerCase().includes(q);
    const matchTitle = (u.custom_title || '').toLowerCase().includes(q);
    const matchRole = (u.roles || []).some(r => (r.name || '').toLowerCase().includes(q));
    return matchName || matchTitle || matchRole;
  });

  return (
    <div>
      {/* 상단 타이틀 & 우측 탭 선택 컨트롤 바 */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          marginBottom: 18,
          flexWrap: 'wrap',
          gap: 16
        }}
      >
        <div>
          <h2 style={{ fontSize: 20, fontWeight: 800, display: 'flex', alignItems: 'center', gap: 10 }}>
            <ShieldCheck color="#f59e0b" size={24} />
            <span>{user.is_admin ? '슈퍼 관리자 시스템 제어 패널' : '관리자 · 데이터 제어 센터'}</span>
          </h2>
          <p style={{ color: 'var(--text-secondary)', fontSize: 13, marginTop: 4 }}>
            {currentTabInfo?.desc || '우측 탭 또는 선택 메뉴를 통해 원하는 관리 카테고리로 빠르게 이동하세요.'}
          </p>
        </div>

        {/* 오른쪽: 실시간 자동저장 상태 + 빠른 탭 선택 드롭다운 & 새 슈퍼관리자 생성 버튼 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <span
            className="badge badge-approved"
            style={{ padding: '7px 12px', fontSize: 12, fontWeight: 700 }}
            title="수정하는 모든 항목이 SQLite 데이터베이스에 실시간으로 자동 저장됩니다."
          >
            {autoSaveStatus}
          </span>

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              background: '#ffffff',
              padding: '6px 12px',
              borderRadius: 'var(--radius-pill)',
              border: '1px solid var(--border-color)',
              boxShadow: 'var(--shadow-sm)'
            }}
          >
            <Layers size={15} color="var(--primary)" />
            <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
              관리 탭 선택:
            </span>
            <select
              className="select"
              value={activeSubTab}
              onChange={(e) => setActiveSubTab(e.target.value)}
              style={{
                border: 'none',
                background: 'var(--bg-tertiary)',
                padding: '5px 12px',
                borderRadius: 'var(--radius-pill)',
                fontSize: 13,
                fontWeight: 700,
                color: 'var(--text-main)',
                width: 'auto',
                minWidth: 190,
                cursor: 'pointer'
              }}
            >
              {availableTabs.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label} ({t.badge})
                </option>
              ))}
            </select>
          </div>

          {user.is_admin && (
            <button className="btn btn-primary" onClick={() => setShowSuperAdminModal(true)}>
              <Crown size={16} /> 새 슈퍼 관리자 생성
            </button>
          )}
        </div>
      </div>

      {/* 카테고리 탭 네비게이션 바 (우측 정렬/반응형 탭 스위치) */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 10,
          marginBottom: 24,
          padding: '8px 10px',
          background: '#ffffff',
          borderRadius: 'var(--radius-lg)',
          border: '1px solid var(--border-color)',
          boxShadow: 'var(--shadow-sm)',
          flexWrap: 'wrap'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', flex: 1 }}>
          {availableTabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeSubTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveSubTab(tab.id)}
                className={`btn btn-sm ${isActive ? 'btn-primary' : 'btn-secondary'}`}
                style={{
                  padding: '8px 14px',
                  fontSize: 13,
                  fontWeight: isActive ? 700 : 600,
                  border: isActive ? 'none' : '1px solid transparent',
                  background: isActive ? 'var(--primary)' : 'transparent',
                  color: isActive ? '#ffffff' : 'var(--text-secondary)'
                }}
              >
                <Icon size={15} />
                <span>{tab.label}</span>
                {tab.badge && (
                  <span
                    style={{
                      fontSize: 11,
                      padding: '1px 7px',
                      borderRadius: 999,
                      fontWeight: 700,
                      background: isActive
                        ? 'rgba(255, 255, 255, 0.22)'
                        : tab.badgeAlert
                        ? '#fef3c7'
                        : 'var(--bg-tertiary)',
                      color: isActive
                        ? '#ffffff'
                        : tab.badgeAlert
                        ? '#b45309'
                        : 'var(--text-muted)'
                    }}
                  >
                    {tab.badge}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        <button
          type="button"
          className="btn btn-secondary btn-sm"
          onClick={loadData}
          disabled={loading}
          title="데이터 새로고침"
        >
          <RefreshCw size={13} className={loading ? 'spin' : ''} />
          <span>새로고침</span>
        </button>
      </div>

      {/* ===================================================================== */}
      {/* 탭 1: 계정 · 가입 관리 (신규 가입 승인 대기열 + 사용자 목록 및 역할 부여) */}
      {/* ===================================================================== */}
      {activeSubTab === 'users' && (user.is_admin || canManageAccounts || canManageRoles) && (
        <div>
          {/* 1-1. 신규 회원가입 승인 대기열 */}
          <div className="card" style={{ border: pendingUsers.length > 0 ? '1px solid rgba(245, 158, 11, 0.5)' : undefined }}>
            <div className="card-header">
              <div className="card-title">
                <Clock size={20} color="#fbbf24" />
                <span>신규 회원가입 승인 대기열</span>
                {pendingUsers.length > 0 && (
                  <span className="badge badge-pending" style={{ marginLeft: 6 }}>
                    {pendingUsers.length}명 대기 중
                  </span>
                )}
              </div>
            </div>

            <div className="table-container">
              <table className="table">
                <thead>
                  <tr>
                    <th>신청 번호</th>
                    <th>아이디</th>
                    <th>인게임 닉네임</th>
                    <th>신청 일시</th>
                    <th>승인 심사</th>
                  </tr>
                </thead>
                <tbody>
                  {pendingUsers.length === 0 ? (
                    <tr>
                      <td colSpan={5} style={{ textAlign: 'center', padding: 24, color: '#64748b' }}>
                        가입 승인 대기 중인 사용자가 없습니다.
                      </td>
                    </tr>
                  ) : (
                    pendingUsers.map((pu) => (
                      <tr key={pu.id}>
                        <td>#{pu.id}</td>
                        <td><span style={{ fontWeight: 600 }}>{pu.username}</span></td>
                        <td><span style={{ color: '#38bdf8', fontWeight: 600 }}>{pu.nickname || '-'}</span></td>
                        <td style={{ fontSize: 13, color: '#94a3b8' }}>{pu.created_at}</td>
                        <td>
                          <div style={{ display: 'flex', gap: 6 }}>
                            <button
                              className="btn btn-success btn-sm"
                              onClick={() => handleUpdateStatus(pu, 'approved')}
                            >
                              <UserCheck size={14} /> 가입 승인
                            </button>
                            <button
                              className="btn btn-danger btn-sm"
                              onClick={() => handleUpdateStatus(pu, 'rejected')}
                            >
                              <UserX size={14} /> 거절
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* 1-2. 승인된 사용자 목록 및 개인별 디스코드 역할(랭크) 선택 부여 */}
          <div className="card">
            <div className="card-header" style={{ flexWrap: 'wrap', gap: 12 }}>
              <div>
                <div className="card-title">
                  <Users size={20} color="#60a5fa" />
                  <span>사용자 목록 및 개인별 역할(랭크) 부여 ({filteredApprovedUsers.length}명)</span>
                </div>
                <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
                  오른쪽 역할 선택창에서 부여할 역할을 선택해 추가하거나, 부여된 역할 태그를 클릭해 해제할 수 있습니다.
                </p>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <div style={{ position: 'relative' }}>
                  <Search size={14} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                  <input
                    type="text"
                    className="input"
                    placeholder="닉네임, 아이디, 역할 검색..."
                    value={userSearch}
                    onChange={(e) => setUserSearch(e.target.value)}
                    style={{ paddingLeft: 32, height: 34, width: 220, fontSize: 13 }}
                  />
                </div>

                <div
                  style={{
                    display: 'flex',
                    background: 'var(--bg-tertiary)',
                    padding: 3,
                    borderRadius: 'var(--radius-pill)',
                    border: '1px solid var(--border-color)'
                  }}
                >
                  <button
                    type="button"
                    className={`btn btn-sm ${roleViewMode === 'select' ? 'btn-primary' : ''}`}
                    style={{
                      padding: '4px 10px',
                      fontSize: 11,
                      background: roleViewMode === 'select' ? undefined : 'transparent',
                      color: roleViewMode === 'select' ? undefined : 'var(--text-secondary)'
                    }}
                    onClick={() => setRoleViewMode('select')}
                  >
                    드롭다운 선택형
                  </button>
                  <button
                    type="button"
                    className={`btn btn-sm ${roleViewMode === 'buttons' ? 'btn-primary' : ''}`}
                    style={{
                      padding: '4px 10px',
                      fontSize: 11,
                      background: roleViewMode === 'buttons' ? undefined : 'transparent',
                      color: roleViewMode === 'buttons' ? undefined : 'var(--text-secondary)'
                    }}
                    onClick={() => setRoleViewMode('buttons')}
                  >
                    전체 탭 나열형
                  </button>
                </div>
              </div>
            </div>

            <div className="table-container">
              <table className="table">
                <thead>
                  <tr>
                    <th>사용자 & 대표 역할</th>
                    <th>상태</th>
                    {user.is_admin && <th>슈퍼관리자</th>}
                    <th>보유 재화</th>
                    <th>개인별 부여 역할 (선택 추가 / 클릭 해제)</th>
                    <th>작업</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredApprovedUsers.length === 0 ? (
                    <tr>
                      <td colSpan={user.is_admin ? 6 : 5} style={{ textAlign: 'center', padding: 24, color: '#64748b' }}>
                        검색 조건에 일치하는 사용자가 없습니다.
                      </td>
                    </tr>
                  ) : (
                    filteredApprovedUsers.map((u) => {
                      const topRole = u.roles?.[0];
                      const assignedRoles = u.roles || [];
                      const unassignedRoles = allRoles.filter(
                        roleObj => !assignedRoles.some(r => r.id === roleObj.id)
                      );

                      return (
                        <tr key={u.id}>
                          <td>
                            <div>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                                <span style={{ fontWeight: 700, color: topRole?.color && topRole.color !== '#99aab5' ? topRole.color : undefined }}>
                                  {u.nickname || u.username}
                                </span>
                                {topRole && (
                                  <span
                                    className="badge"
                                    style={{
                                      background: `${topRole.color}20`,
                                      color: topRole.color,
                                      border: `1px solid ${topRole.color}55`,
                                      fontSize: 10,
                                      fontWeight: 700
                                    }}
                                  >
                                    ● {topRole.name}
                                  </span>
                                )}
                                {u.custom_title && (
                                  <span className="badge" style={{ background: '#eff6ff', color: '#1d4ed8', fontSize: 10 }}>
                                    {u.custom_title}
                                  </span>
                                )}
                              </div>
                              <div style={{ fontSize: 11, color: '#64748b' }}>@{u.username}</div>
                              {u.must_change_password && (
                                <span style={{ fontSize: 11, color: '#f59e0b' }}>⚠️ 비번 변경 필요</span>
                              )}
                            </div>
                          </td>
                          <td>
                            {u.status === 'approved' && <span className="badge badge-approved">승인됨</span>}
                            {u.status === 'rejected' && <span className="badge badge-rejected">거절됨</span>}
                          </td>
                          {user.is_admin && (
                            <td>
                              <button
                                onClick={() => handleToggleAdmin(u)}
                                className={`btn btn-sm ${u.is_admin ? 'btn-primary' : 'btn-secondary'}`}
                                style={{ fontSize: 11 }}
                              >
                                {u.is_admin ? '👑 슈퍼관리자' : '일반'}
                              </button>
                            </td>
                          )}
                          <td>
                            <div style={{ fontSize: 12 }}>
                              <span style={{ color: '#fbbf24', fontWeight: 600 }}>{(u.points ?? 0).toLocaleString()} P</span>
                              <br />
                              <span style={{ color: '#34d399', fontWeight: 600 }}>{(u.credits ?? 0).toLocaleString()} C</span>
                            </div>
                          </td>
                          <td>
                            {allRoles.length === 0 ? (
                              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                                [역할 · 권한 설정] 탭에서 역할을 먼저 만들어 주세요.
                              </span>
                            ) : roleViewMode === 'select' ? (
                              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxWidth: 520 }}>
                                <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}>
                                  {assignedRoles.length === 0 ? (
                                    <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>부여된 역할 없음</span>
                                  ) : (
                                    assignedRoles.map((userRole) => {
                                      const fullRole = allRoles.find(r => r.id === userRole.id) || userRole;
                                      const canRemove = (user.is_admin || canManageRoles) && (fullRole.manageable ?? true) && (!u.is_admin || user.is_admin);
                                      const roleColor = fullRole.color || '#64748b';
                                      return (
                                        <button
                                          key={userRole.id}
                                          type="button"
                                          disabled={!canRemove}
                                          onClick={() => handleToggleRole(u, fullRole)}
                                          title={
                                            canRemove
                                              ? `클릭하여 [${fullRole.name}] 역할 해제`
                                              : '해제 권한 없음'
                                          }
                                          style={{
                                            display: 'inline-flex',
                                            alignItems: 'center',
                                            gap: 5,
                                            padding: '4px 10px',
                                            borderRadius: 999,
                                            fontSize: 11,
                                            fontWeight: 700,
                                            cursor: canRemove ? 'pointer' : 'default',
                                            border: `1.5px solid ${roleColor}`,
                                            background: `${roleColor}18`,
                                            color: roleColor
                                          }}
                                        >
                                          <span style={{ width: 7, height: 7, borderRadius: '50%', background: roleColor }} />
                                          <span>{fullRole.name}</span>
                                          {canRemove && <X size={11} />}
                                        </button>
                                      );
                                    })
                                  )}

                                  {/* 드롭다운으로 깔끔하게 역할 선택 추가 */}
                                  {(user.is_admin || canManageRoles) && (!u.is_admin || user.is_admin) && unassignedRoles.length > 0 && (
                                    <select
                                      className="select"
                                      value=""
                                      onChange={(e) => {
                                        const roleId = Number(e.target.value);
                                        const targetRole = allRoles.find(r => r.id === roleId);
                                        if (targetRole) handleToggleRole(u, targetRole);
                                      }}
                                      style={{
                                        width: 'auto',
                                        minWidth: 145,
                                        height: 28,
                                        padding: '2px 10px',
                                        fontSize: 11,
                                        fontWeight: 600,
                                        borderRadius: 999,
                                        background: 'var(--bg-tertiary)',
                                        cursor: 'pointer'
                                      }}
                                    >
                                      <option value="">+ 역할 선택 부여...</option>
                                      {unassignedRoles.map((roleObj) => {
                                        const manageable = user.is_admin || roleObj.manageable;
                                        return (
                                          <option key={roleObj.id} value={roleObj.id} disabled={!manageable}>
                                            {roleObj.name}
                                            {roleObj.permissions?.length ? ` (권한 ${roleObj.permissions.length}개)` : ''}
                                            {!manageable ? ' [권한 부족]' : ''}
                                          </option>
                                        );
                                      })}
                                    </select>
                                  )}
                                </div>

                                {u.permissions?.length > 0 && (
                                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                                    활성 권한: {u.permissions.join(' · ')}
                                  </div>
                                )}
                              </div>
                            ) : (
                              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, maxWidth: 580 }}>
                                {allRoles.map((roleObj) => {
                                  const hasRole = u.roles?.some(r => r.id === roleObj.id);
                                  const canToggle = (user.is_admin || canManageRoles) && roleObj.manageable && (!u.is_admin || user.is_admin);
                                  const roleColor = roleObj.color || '#64748b';
                                  return (
                                    <button
                                      key={roleObj.id}
                                      type="button"
                                      disabled={!canToggle}
                                      onClick={() => handleToggleRole(u, roleObj)}
                                      title={
                                        roleObj.permissions?.length
                                          ? `포함 권한: ${roleObj.permissions.join(', ')}`
                                          : '권한 없음 (순수 랭크/칭호 역할)'
                                      }
                                      style={{
                                        display: 'inline-flex',
                                        alignItems: 'center',
                                        gap: 5,
                                        padding: '4px 10px',
                                        borderRadius: 999,
                                        fontSize: 11,
                                        fontWeight: 700,
                                        cursor: canToggle ? 'pointer' : 'default',
                                        border: hasRole ? `1.5px solid ${roleColor}` : '1px solid var(--border-color)',
                                        background: hasRole ? `${roleColor}22` : 'var(--bg-secondary)',
                                        color: hasRole ? roleColor : 'var(--text-muted)',
                                        opacity: !canToggle && !hasRole ? 0.55 : 1,
                                        transition: 'all 0.15s ease'
                                      }}
                                    >
                                      <span style={{ width: 8, height: 8, borderRadius: '50%', background: roleColor }} />
                                      <span>{hasRole ? `✓ ${roleObj.name}` : `+ ${roleObj.name}`}</span>
                                    </button>
                                  );
                                })}
                                {u.permissions?.length > 0 && (
                                  <div style={{ width: '100%', fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                                    활성 권한: {u.permissions.join(' · ')}
                                  </div>
                                )}
                              </div>
                            )}
                          </td>
                          <td>
                            <div style={{ display: 'flex', gap: 6 }}>
                              {(user.is_admin || canManageAccounts) && (
                                <button
                                  className="btn btn-secondary btn-sm"
                                  onClick={() => {
                                    setSelectedUser(u);
                                    setAssetForm({
                                      points: u.points,
                                      credits: u.credits,
                                      nickname: u.nickname || u.username,
                                      custom_title: u.custom_title || '',
                                      reason: '',
                                      sync_active_season: true
                                    });
                                    setShowAssetModal(true);
                                  }}
                                  title="프로필 및 포인트/크레딧 정밀 수정"
                                >
                                  <DollarSign size={13} /> 수치·칭호 수정
                                </button>
                              )}
                              <button
                                className="btn btn-secondary btn-sm"
                                onClick={() => handleResetPassword(u)}
                                title="비밀번호 초기화"
                              >
                                <Key size={13} />
                              </button>
                              {u.username !== 'admin' && (
                                <button
                                  className="btn btn-danger btn-sm"
                                  onClick={() => handleDeleteUser(u)}
                                  title="계정 삭제"
                                >
                                  <Trash2 size={13} />
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ===================================================================== */}
      {/* 탭 2: 역할 · 권한 설정 (디스코드 스타일 역할 생성·권한·위계 관리) */}
      {/* ===================================================================== */}
      {activeSubTab === 'roles' && (user.is_admin || canManageRoles || canManageAccounts) && (
        <RoleManager
          user={user}
          users={approvedUsers}
          refreshKey={roleRefreshKey}
          onChanged={() => {
            refreshRolesAndUsers();
            if (refreshUser) refreshUser();
          }}
        />
      )}

      {/* ===================================================================== */}
      {/* 탭 3: 전역 수치 · 배율 제어 센터 */}
      {/* ===================================================================== */}
      {activeSubTab === 'economy' && (user.is_admin || canManageRanking) && (
        <div className="card" style={{ marginBottom: 28, border: '1px solid #bfdbfe', background: '#f8fafc' }}>
          <div className="card-header">
            <div className="card-title">
              <Sliders size={20} color="#2563eb" />
              <span>전역 수치 & 보상 배율 정밀 컨트롤 센터</span>
            </div>
            <span className="badge badge-approved">⚡ 실시간 수치 제어</span>
          </div>
          <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 16 }}>
            납품, 퀘스트, 단기 알바, 크레딧 환전 비율 등 서버 내 모든 경제 및 포인트 수치를 소수점 배율과 정확한 값으로 즉시 조절합니다.
          </p>

          <form onSubmit={handleSaveGlobalNumericConfig}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 12 }}>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label" style={{ fontSize: 12 }}>전역 포인트 획득 배율 (x배 · 자동저장)</label>
                <input
                  type="number"
                  step="0.1"
                  className="input"
                  value={globalNumericConfig.point_multiplier}
                  onChange={(e) => updateNumericConfigAutoSave({ point_multiplier: e.target.value })}
                />
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label" style={{ fontSize: 12 }}>전역 크레딧 획득 배율 (x배 · 자동저장)</label>
                <input
                  type="number"
                  step="0.1"
                  className="input"
                  value={globalNumericConfig.credit_multiplier}
                  onChange={(e) => updateNumericConfigAutoSave({ credit_multiplier: e.target.value })}
                />
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label" style={{ fontSize: 12 }}>1 C당 인게임 원화 환전비 (자동저장)</label>
                <input
                  type="number"
                  step="any"
                  className="input"
                  disabled={!user.is_admin}
                  value={globalNumericConfig.exchange_rate}
                  onChange={(e) => updateNumericConfigAutoSave({ exchange_rate: e.target.value })}
                />
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label" style={{ fontSize: 12 }}>최소 환전 가능 크레딧 (C · 자동저장)</label>
                <input
                  type="number"
                  className="input"
                  disabled={!user.is_admin}
                  value={globalNumericConfig.min_exchange_amount}
                  onChange={(e) => updateNumericConfigAutoSave({ min_exchange_amount: e.target.value })}
                />
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 3fr', gap: 12, alignItems: 'end' }}>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label" style={{ fontSize: 12 }}>환전 수수료율 (% · 자동저장)</label>
                <input
                  type="number"
                  step="0.1"
                  className="input"
                  disabled={!user.is_admin}
                  value={globalNumericConfig.exchange_fee_percent}
                  onChange={(e) => updateNumericConfigAutoSave({ exchange_fee_percent: e.target.value })}
                />
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label" style={{ fontSize: 12 }}>랭킹 보드 상단 안내 문구 (자동저장)</label>
                <input
                  type="text"
                  className="input"
                  value={globalNumericConfig.ranking_board_notice || ''}
                  onChange={(e) => updateNumericConfigAutoSave({ ranking_board_notice: e.target.value })}
                />
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 14 }}>
              <button type="submit" className="btn btn-primary">
                전역 수치 및 배율 일괄 적용
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ===================================================================== */}
      {/* 탭 4: 연방 포인트/크레딧 입출금 상세 원장 */}
      {/* ===================================================================== */}
      {activeSubTab === 'ledger' && canManageData && (
        <div className="card" style={{ marginBottom: 28, border: '1px solid #a7f3d0' }}>
          <div className="card-header" style={{ flexWrap: 'wrap', gap: 10 }}>
            <div className="card-title">
              <FileSpreadsheet size={20} color="#059669" />
              <span>연방 포인트/크레딧 입출금 상세 원장 (SQLite DB & CSV/XLSX 추출)</span>
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => setShowManualTxModal(true)}
              >
                <Plus size={14} /> 수동 입출금 내역 추가/정산
              </button>
              <button
                type="button"
                className="btn btn-success btn-sm"
                onClick={() => handleDownloadLedger('csv')}
              >
                <Download size={14} /> CSV 다운로드 (.csv)
              </button>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={() => handleDownloadLedger('xlsx')}
              >
                <FileSpreadsheet size={14} /> 엑셀 다운로드 (.xlsx)
              </button>
            </div>
          </div>

          <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 14 }}>
            내장 SQLite 데이터베이스(`asset_transactions`)에 기록된 모든 연방 포인트 및 크레딧 입금·출금·조정 내역입니다. 필터링 후 <strong>CSV</strong> 또는 <strong>XLSX(엑셀)</strong> 파일로 즉시 다운로드할 수 있습니다.
          </p>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1.5fr auto', gap: 10, marginBottom: 14, padding: 12, background: 'var(--bg-secondary)', borderRadius: 10 }}>
            <select
              className="input"
              value={txFilter.asset_type}
              onChange={(e) => {
                const next = { ...txFilter, asset_type: e.target.value };
                setTxFilter(next);
                loadTransactions(next);
              }}
            >
              <option value="ALL">전체 자산 (포인트 + 크레딧)</option>
              <option value="POINT">연방 포인트 (P)</option>
              <option value="CREDIT">크레딧 (C)</option>
            </select>

            <select
              className="input"
              value={txFilter.tx_type}
              onChange={(e) => {
                const next = { ...txFilter, tx_type: e.target.value };
                setTxFilter(next);
                loadTransactions(next);
              }}
            >
              <option value="ALL">전체 구분 (입금 + 출금)</option>
              <option value="IN">입금 (+)</option>
              <option value="OUT">출금 (-)</option>
            </select>

            <input
              type="text"
              className="input"
              placeholder="닉네임, 아이디, 사유, 처리자 검색..."
              value={txFilter.search}
              onChange={(e) => setTxFilter({ ...txFilter, search: e.target.value })}
            />

            <button type="button" className="btn btn-primary" onClick={() => loadTransactions(txFilter)}>
              조회
            </button>
          </div>

          <div className="table-container" style={{ maxHeight: 480, overflowY: 'auto' }}>
            <table className="table">
              <thead>
                <tr>
                  <th>번호</th>
                  <th>일시</th>
                  <th>대상 유저</th>
                  <th>자산</th>
                  <th>구분</th>
                  <th>변동 수량</th>
                  <th>변동 전 → 후</th>
                  <th>카테고리 & 상세 사유</th>
                  <th>처리자</th>
                </tr>
              </thead>
              <tbody>
                {transactions.length === 0 ? (
                  <tr>
                    <td colSpan={9} style={{ textAlign: 'center', padding: 24, color: '#64748b' }}>
                      조건에 해당하는 입출금 기록이 없습니다.
                    </td>
                  </tr>
                ) : (
                  transactions.map((t) => {
                    const isPoint = t.asset_type === 'POINT' || t.asset_type === 'POINTS';
                    const isPositive = t.tx_type ? t.tx_type === 'IN' : (t.amount >= 0);
                    return (
                      <tr key={t.id}>
                        <td style={{ fontSize: 12, color: '#64748b' }}>#{t.id}</td>
                        <td style={{ fontSize: 12, color: '#64748b', whiteSpace: 'nowrap' }}>{t.created_at}</td>
                        <td>
                          <span style={{ fontWeight: 700 }}>{t.nickname || t.username}</span>
                          <div style={{ fontSize: 11, color: '#64748b' }}>@{t.username}</div>
                        </td>
                        <td>
                          <span className="badge" style={{ background: isPoint ? '#fef3c7' : '#d1fae5', color: isPoint ? '#b45309' : '#047857' }}>
                            {isPoint ? '포인트(P)' : '크레딧(C)'}
                          </span>
                        </td>
                        <td>
                          <span className={`badge ${isPositive ? 'badge-approved' : 'badge-rejected'}`}>
                            {isPositive ? '입금(+)' : '출금(-)'}
                          </span>
                        </td>
                        <td>
                          <span style={{ fontWeight: 800, color: isPositive ? '#059669' : '#dc2626' }}>
                            {isPositive ? '+' : '-'}{Math.abs(Number(t.amount) || 0).toLocaleString()} {isPoint ? 'P' : 'C'}
                          </span>
                        </td>
                        <td style={{ fontSize: 12, color: '#64748b', whiteSpace: 'nowrap' }}>
                          {Number(t.balance_before || 0).toLocaleString()} → <strong>{Number(t.balance_after || 0).toLocaleString()}</strong>
                        </td>
                        <td style={{ fontSize: 12 }}>
                          <span style={{ fontWeight: 700, color: '#1e293b', marginRight: 6 }}>[{t.category}]</span>
                          <span>{t.description}</span>
                        </td>
                        <td style={{ fontSize: 12, color: '#475569' }}>{t.actor_name || '시스템'}</td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ===================================================================== */}
      {/* 탭 5: 공지사항 디스코드 웹훅 개별설정 & 메시지 양식 */}
      {/* ===================================================================== */}
      {activeSubTab === 'notices' && (user.is_admin || canManageNotices) && (
        <div className="card" style={{ marginBottom: 28 }}>
          <div className="card-header">
            <div className="card-title">
              <Bell size={20} color="#38bdf8" />
              <span>공지사항 디스코드 웹훅 개별설정 & 메시지 양식</span>
            </div>
            <span className="badge badge-approved">📢 공지 관리자 / 슈퍼관리자</span>
          </div>

          <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 20 }}>
            각각의 공지사항(납품 안내문 등)마다 <strong>전용 디스코드 웹훅 채널</strong>과 <strong>메시지 양식(템플릿, 멘션 여부, 임베드 테두리 색상)</strong>을 개별적으로 커스터마이징할 수 있습니다.
          </p>

          {/* 공지 카테고리 탭 선택 */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 20, borderBottom: '1px solid var(--border-color)', paddingBottom: 12 }}>
            <button
              type="button"
              className={`btn btn-sm ${selectedNoticeCategory === 'supply' ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => handleSelectNoticeCategory('supply')}
            >
              📦 납품 안내문 (공지)
            </button>
            {notices.filter(n => n.category !== 'supply').map(n => (
              <button
                key={n.category}
                type="button"
                className={`btn btn-sm ${selectedNoticeCategory === n.category ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => handleSelectNoticeCategory(n.category)}
              >
                📢 {n.title || n.category}
              </button>
            ))}
          </div>

          <form onSubmit={handleSaveNoticeWebhook}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              <div className="form-group">
                <label className="form-label">공지사항 제목 (수정 시 SQLite 자동저장)</label>
                <input
                  type="text"
                  className="input"
                  value={noticeWebhookForm.title}
                  onChange={(e) => updateNoticeFormAutoSave({ title: e.target.value })}
                  placeholder="공지사항 제목"
                  required
                />
              </div>

              <div className="form-group">
                <label className="form-label">공지사항 전용 디스코드 웹훅 URL (수정 시 자동저장)</label>
                <input
                  type="url"
                  className="input"
                  placeholder="https://discord.com/api/webhooks/... (비워두면 전역 기본 웹훅 사용)"
                  value={noticeWebhookForm.webhook_url}
                  onChange={(e) => updateNoticeFormAutoSave({ webhook_url: e.target.value })}
                />
              </div>
            </div>

            <div className="form-group">
              <label className="form-label">공지사항 본문 내용 (수정 시 SQLite 자동저장)</label>
              <textarea
                className="textarea"
                rows="4"
                value={noticeWebhookForm.content}
                onChange={(e) => updateNoticeFormAutoSave({ content: e.target.value })}
                placeholder="공지사항 본문 내용을 입력하세요."
                required
              />
            </div>

            <div style={{
              padding: 16,
              background: 'var(--bg-tertiary)',
              borderRadius: 'var(--radius-md)',
              border: '1px solid var(--border-color)',
              marginBottom: 16
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <div style={{ fontWeight: 700, fontSize: 13, color: '#38bdf8', display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Palette size={15} />
                  <span>디스코드 메시지 양식 & 발송 옵션</span>
                </div>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={noticeWebhookForm.webhook_enabled === 1}
                    onChange={(e) => updateNoticeFormAutoSave({ webhook_enabled: e.target.checked ? 1 : 0 })}
                  />
                  <span style={{ fontWeight: 600, color: noticeWebhookForm.webhook_enabled ? 'var(--primary)' : 'var(--text-secondary)' }}>
                    공지 저장 시 디스코드 자동 발송
                  </span>
                </label>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 14 }}>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label" style={{ fontSize: 12 }}>멘션 호출</label>
                  <select
                    className="input"
                    value={noticeWebhookForm.mention_type}
                    onChange={(e) => updateNoticeFormAutoSave({ mention_type: e.target.value })}
                  >
                    <option value="none">멘션 없음 (알림만 전송)</option>
                    <option value="everyone">@everyone (서버 전체 멘션)</option>
                    <option value="here">@here (현재 온라인 사용자 멘션)</option>
                  </select>
                </div>

                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label" style={{ fontSize: 12 }}>디스코드 임베드 테두리 색상</label>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <input
                      type="color"
                      value={noticeWebhookForm.embed_color || '#3b82f6'}
                      onChange={(e) => updateNoticeFormAutoSave({ embed_color: e.target.value })}
                      style={{ width: 42, height: 38, padding: 2, borderRadius: 6, cursor: 'pointer', border: '1px solid var(--border-color)', background: 'transparent' }}
                    />
                    <input
                      type="text"
                      className="input"
                      value={noticeWebhookForm.embed_color || '#3b82f6'}
                      onChange={(e) => updateNoticeFormAutoSave({ embed_color: e.target.value })}
                      style={{ flex: 1 }}
                    />
                  </div>
                </div>
              </div>

              <div className="form-group" style={{ marginBottom: 6 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                  <label className="form-label" style={{ fontSize: 12, marginBottom: 0 }}>
                    메시지 본문 양식 (커스텀 템플릿 · 자동저장)
                  </label>
                  <div style={{ display: 'flex', gap: 4 }}>
                    {['{title}', '{content}', '{author}', '{date}'].map((tag) => (
                      <button
                        key={tag}
                        type="button"
                        className="btn btn-secondary btn-sm"
                        style={{ padding: '2px 6px', fontSize: 11 }}
                        onClick={() => updateNoticeFormAutoSave({ message_template: (noticeWebhookForm.message_template || '') + tag })}
                      >
                        +{tag}
                      </button>
                    ))}
                  </div>
                </div>
                <textarea
                  className="textarea"
                  rows="3"
                  placeholder="비워두면 기본 공지 내용이 디스코드 본문으로 전송됩니다. 예: 📢 **[공지] {title}**&#10;&#10;{content}&#10;&#10;— 작성자: {author}"
                  value={noticeWebhookForm.message_template}
                  onChange={(e) => updateNoticeFormAutoSave({ message_template: e.target.value })}
                />
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                  템플릿 태그: <code>{'{title}'}</code>(제목), <code>{'{content}'}</code>(내용), <code>{'{author}'}</code>(작성자), <code>{'{date}'}</code>(발송일시)
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={handleTestNoticeWebhookFromAdmin}
                disabled={testingNoticeWebhook}
                style={{ display: 'flex', alignItems: 'center', gap: 6 }}
              >
                <Send size={14} />
                <span>{testingNoticeWebhook ? '테스트 발송 중...' : '디스코드 테스트 발송'}</span>
              </button>

              <div style={{ display: 'flex', gap: 10 }}>
                <button
                  type="button"
                  className="btn btn-warning"
                  onClick={(e) => handleSaveNoticeWebhook(e, true)}
                  style={{ display: 'flex', alignItems: 'center', gap: 6 }}
                >
                  <Send size={14} /> 설정 저장 & 디스코드 즉시 알림
                </button>
                <button type="submit" className="btn btn-primary">
                  공지 및 웹훅 설정 저장
                </button>
              </div>
            </div>
          </form>

          {/* 초기 로그인 화면 메시지 설정 (공지 관리자 / 슈퍼관리자 공통) */}
          <div style={{ marginTop: 28, paddingTop: 24, borderTop: '1px solid var(--border-color)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700, fontSize: 15, color: 'var(--text-main)' }}>
                <Globe size={18} color="var(--primary)" />
                <span>초기 로그인 화면 메시지 설정</span>
              </div>
              <span className="badge badge-approved">로그인 화면 실시간 반영</span>
            </div>
            <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 14 }}>
              플레이어가 처음 접속하는 로그인/회원가입 화면의 부제목(슬로건)과 안내 공지 박스를 자유롭게 설정할 수 있습니다.
            </p>
            <form onSubmit={handleSaveBranding}>
              <div className="form-group">
                <label className="form-label">로그인 화면 부제목 / 슬로건 (비워두면 기본 시스템 부제목 표시 · 자동저장)</label>
                <input
                  type="text"
                  className="input"
                  placeholder={`기본값: ${brandingForm.system_title || 'FEDERATION'} - 연방 국가전쟁 통합 관리 시스템`}
                  value={brandingForm.login_subtitle || ''}
                  onChange={(e) => updateBrandingAutoSave({ login_subtitle: e.target.value })}
                />
              </div>

              <div className="form-group">
                <label className="form-label">초기 로그인 화면 안내/환영 메시지 (비워두면 메시지 박스 숨김 · 줄바꿈 지원 · 자동저장)</label>
                <textarea
                  className="textarea"
                  rows="3"
                  placeholder="예: 📢 환영합니다! 신규 대원은 [새로운 플레이어 등록] 버튼을 눌러 인게임 닉네임으로 가입을 신청해 주세요.&#10;가입 신청 후 디스코드 인증 채널에 알려주시면 빠르게 승인됩니다."
                  value={brandingForm.login_message || ''}
                  onChange={(e) => updateBrandingAutoSave({ login_message: e.target.value })}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                {(brandingForm.login_subtitle || brandingForm.login_message) && (
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => updateBrandingAutoSave({ login_subtitle: '', login_message: '' })}
                  >
                    초기화 (비우기)
                  </button>
                )}
                <button type="submit" className="btn btn-primary">
                  로그인 화면 메시지 저장
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ===================================================================== */}
      {/* 탭 6: 디스코드 웹훅 통합 & 개별 상세 설정 센터 (26종 이벤트) */}
      {/* ===================================================================== */}
      {activeSubTab === 'webhooks' && user.is_admin && <WebhookManager />}

      {/* ===================================================================== */}
      {/* 탭 7: 시스템 · 백업 · 브랜딩 (국가 이름 설정 + 전체 DB JSON 백업/복원) */}
      {/* ===================================================================== */}
      {activeSubTab === 'system' && user.is_admin && (
        <div>
          {/* 7-1. 국가 및 시스템 브랜딩 설정 */}
          {isInitialAdmin ? (
            <div className="card" style={{ border: '1px solid var(--border-color)', background: '#ffffff', marginBottom: 24, boxShadow: 'var(--shadow-sm)' }}>
              <div className="card-header">
                <div className="card-title">
                  <Globe size={20} color="var(--primary)" />
                  <span>국가 및 시스템 이름 · 초기 로그인 화면 메시지 설정 (최초 admin 전용)</span>
                </div>
                <span className="badge badge-approved">👑 최초 admin 권한 인증됨</span>
              </div>
              <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 16, lineHeight: 1.5 }}>
                웹사이트 전역(사이드바, 헤더, 로그인 화면)에 노출되는 국가 이름, 시스템 타이틀, 로고 심볼 및 초기 로그인 화면의 안내 메시지를 설정할 수 있습니다.
              </p>

              <form onSubmit={handleSaveBranding}>
                <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1.5fr 1fr', gap: 16 }}>
                  <div className="form-group">
                    <label className="form-label">시스템 이름 (영문/한글 · 자동저장)</label>
                    <input
                      type="text"
                      className="input"
                      placeholder="예: FEDERATION, ARCADIA"
                      value={brandingForm.system_title}
                      onChange={(e) => updateBrandingAutoSave({ system_title: e.target.value })}
                      required
                    />
                  </div>

                  <div className="form-group">
                    <label className="form-label">국가 이름 (한글 · 자동저장)</label>
                    <input
                      type="text"
                      className="input"
                      placeholder="예: 마인크래프트 연방 국가, 아르카디아 제국"
                      value={brandingForm.nation_name}
                      onChange={(e) => updateBrandingAutoSave({ nation_name: e.target.value })}
                      required
                    />
                  </div>

                  <div className="form-group">
                    <label className="form-label">서버 로고 심볼 (1~2글자 · 자동저장)</label>
                    <input
                      type="text"
                      maxLength="4"
                      className="input"
                      placeholder="예: M, ⚔️, A"
                      value={brandingForm.server_logo_text}
                      onChange={(e) => updateBrandingAutoSave({ server_logo_text: e.target.value })}
                      required
                    />
                  </div>
                </div>

                <div className="form-group" style={{ marginTop: 4 }}>
                  <label className="form-label">로그인 화면 부제목 / 슬로건 (비워두면 기본 시스템 부제목 표시 · 자동저장)</label>
                  <input
                    type="text"
                    className="input"
                    placeholder={`기본값: ${brandingForm.system_title || 'FEDERATION'} - 연방 국가전쟁 통합 관리 시스템`}
                    value={brandingForm.login_subtitle || ''}
                    onChange={(e) => updateBrandingAutoSave({ login_subtitle: e.target.value })}
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">초기 로그인 화면 안내/환영 메시지 (비워두면 메시지 박스 숨김 · 줄바꿈 지원 · 자동저장)</label>
                  <textarea
                    className="textarea"
                    rows="3"
                    placeholder="예: 📢 환영합니다! 신규 대원은 [새로운 플레이어 등록] 버튼을 눌러 인게임 닉네임으로 가입을 신청해 주세요.&#10;가입 신청 후 디스코드 인증 채널에 알려주시면 빠르게 승인됩니다."
                    value={brandingForm.login_message || ''}
                    onChange={(e) => updateBrandingAutoSave({ login_message: e.target.value })}
                  />
                </div>

                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
                  {(brandingForm.login_subtitle || brandingForm.login_message) && (
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={() => updateBrandingAutoSave({ login_subtitle: '', login_message: '' })}
                    >
                      로그인 메시지 초기화
                    </button>
                  )}
                  <button type="submit" className="btn btn-primary">
                    국가 브랜딩 & 로그인 메시지 저장 적용
                  </button>
                </div>
              </form>
            </div>
          ) : (
            <div style={{ padding: '12px 16px', background: 'var(--bg-tertiary)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)', marginBottom: 24, fontSize: 13, color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: 8 }}>
              <span>🔒 국가 및 시스템 브랜딩(이름/로고) 변경은 보안 정책에 따라 <strong>최초 admin</strong> 계정에서만 수정할 수 있습니다.</span>
            </div>
          )}

          {/* 7-2. 데이터베이스 백업 & 복원 (JSON) */}
          <div className="card" style={{ marginBottom: 28, border: '1px solid rgba(56, 189, 248, 0.3)' }}>
            <div className="card-header">
              <div className="card-title">
                <Database size={20} color="#38bdf8" />
                <span>데이터베이스 백업 & 복원 (JSON 추출 및 불러오기)</span>
              </div>
              <span className="badge badge-approved">🔒 슈퍼관리자 전용</span>
            </div>

            <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 20, lineHeight: 1.6 }}>
              플랫폼의 모든 데이터(사용자 계정, 역할/권한, 재화, 물자 목록, 납품 신청 기록, 상점 및 주문, 공지사항, 디스코드 웹훅 설정, 단기 알바, 일정, 퀘스트, 시스템 브랜딩 등 14개 테이블 전체)를 <strong>JSON 파일 하나로 즉시 추출</strong>하거나 <strong>원클릭으로 복원</strong>할 수 있습니다. Render 클라우드 이전이나 주기적인 데이터 백업 시 안전하게 활용하세요.
            </p>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              {/* 백업 (내보내기) */}
              <div style={{ padding: 16, background: 'var(--bg-tertiary)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700, fontSize: 15, marginBottom: 8, color: '#38bdf8' }}>
                    <Download size={18} />
                    <span>데이터 JSON으로 추출 (다운로드)</span>
                  </div>
                  <p style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5, marginBottom: 16 }}>
                    현재 시점의 전체 데이터베이스를 타임스탬프가 포함된 <code>.json</code> 파일로 다운로드합니다. 민감한 비밀번호 해시와 모든 테이블 관계가 정합성을 유지한 채 보관됩니다.
                  </p>
                </div>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={handleExportData}
                  disabled={backupLoading}
                  style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
                >
                  {backupLoading ? <RefreshCw size={16} className="spin" /> : <Download size={16} />}
                  <span>{backupLoading ? '데이터 추출 및 패키징 중...' : '전체 데이터 JSON 내보내기 (백업)'}</span>
                </button>
              </div>

              {/* 복원 (불러오기) */}
              <div style={{ padding: 16, background: 'var(--bg-tertiary)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700, fontSize: 15, marginBottom: 8, color: '#f59e0b' }}>
                    <Upload size={18} />
                    <span>데이터 JSON으로 불러오기 (복원)</span>
                  </div>
                  <p style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5, marginBottom: 16 }}>
                    기존에 내보낸 백업 <code>.json</code> 파일을 선택하여 데이터베이스를 그대로 복원합니다. 복원 시 기존 데이터가 안전하게 교체되며 복원 실행 전 확인 대화창이 팝업됩니다.
                  </p>
                </div>

                <input
                  type="file"
                  ref={fileInputRef}
                  accept=".json,application/json"
                  style={{ display: 'none' }}
                  onChange={handleImportFileSelect}
                />

                <button
                  type="button"
                  className="btn btn-warning"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={restoreLoading}
                  style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
                >
                  {restoreLoading ? <RefreshCw size={16} className="spin" /> : <Upload size={16} />}
                  <span>{restoreLoading ? '데이터베이스 복원 적용 중...' : 'JSON 백업 파일 선택 및 불러오기'}</span>
                </button>
              </div>
            </div>
          </div>

          {/* 7-3. 데이터베이스 초기화 (리셋 센터) */}
          <div className="card" style={{ marginBottom: 28, border: '1px solid rgba(239, 68, 68, 0.35)' }}>
            <div className="card-header">
              <div className="card-title">
                <AlertTriangle size={20} color="#ef4444" />
                <span>데이터베이스 초기화 (리셋 센터)</span>
              </div>
              <span className="badge badge-rejected">⚠️ 슈퍼관리자 전용</span>
            </div>

            <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 20, lineHeight: 1.6 }}>
              새 시즌/서버 오픈을 위해 테스트 데이터를 정리하거나 전체 데이터베이스를 초기 상태로 되돌릴 수 있습니다.
            </p>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              <div style={{ padding: 16, background: 'var(--bg-tertiary)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700, fontSize: 15, marginBottom: 8, color: '#f59e0b' }}>
                    <RefreshCw size={18} />
                    <span>운영 내역 & 전 플레이어 재화 초기화</span>
                  </div>
                  <p style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5, marginBottom: 16 }}>
                    가입된 플레이어 계정, 역할/권한, 웹훅 설정, 국가 브랜딩은 그대로 유지하고, 모든 납품·퀘스트·알바·상점·원장 기록과 보유 포인트(P)/크레딧(C)을 0으로 초기화합니다.
                  </p>
                </div>
                <button
                  type="button"
                  className="btn btn-warning"
                  onClick={() => handleResetDatabase('activity')}
                  disabled={resetLoading}
                  style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
                >
                  <RefreshCw size={16} />
                  <span>{resetLoading ? '초기화 진행 중...' : '운영 내역 & 재화만 0으로 초기화'}</span>
                </button>
              </div>

              <div style={{ padding: 16, background: '#fef2f2', borderRadius: 'var(--radius-md)', border: '1px solid #fecaca', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700, fontSize: 15, marginBottom: 8, color: '#dc2626' }}>
                    <Trash2 size={18} />
                    <span>전체 데이터베이스 공장 초기화 (Full Reset)</span>
                  </div>
                  <p style={{ fontSize: 12, color: '#7f1d1d', lineHeight: 1.5, marginBottom: 16 }}>
                    슈퍼관리자(<code>admin</code>) 계정만 남기고 테스트 계정, 물자, 납품, 퀘스트, 알바, 상점, 원장, 설정 등 모든 테이블을 처음 설치 상태로 깨끗하게 비웁니다.
                  </p>
                </div>
                <button
                  type="button"
                  className="btn btn-danger"
                  onClick={() => handleResetDatabase('all')}
                  disabled={resetLoading}
                  style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
                >
                  <Trash2 size={16} />
                  <span>{resetLoading ? '전체 초기화 진행 중...' : '전체 데이터베이스 공장 초기화'}</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 새 슈퍼 관리자 생성 모달 */}
      {showSuperAdminModal && (
        <div className="modal-overlay">
          <div className="modal-content">
            <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
              <Crown color="#f59e0b" size={22} />
              <span>새 슈퍼 관리자 계정 생성</span>
            </h2>
            <p style={{ fontSize: 13, color: '#94a3b8', marginBottom: 16 }}>
              슈퍼 관리자 권한과 모든 세부 역할 권한이 부여된 새로운 관리자 계정을 생성합니다.
            </p>

            <form onSubmit={handleCreateSuperAdmin}>
              <div className="form-group">
                <label className="form-label">아이디</label>
                <input
                  type="text"
                  className="input"
                  placeholder="새 슈퍼관리자 아이디"
                  value={superAdminForm.username}
                  onChange={(e) => setSuperAdminForm({ ...superAdminForm, username: e.target.value })}
                  required
                />
              </div>

              <div className="form-group">
                <label className="form-label">초기 비밀번호</label>
                <input
                  type="password"
                  className="input"
                  placeholder="초기 비밀번호 (접속 시 변경 요청)"
                  value={superAdminForm.password}
                  onChange={(e) => setSuperAdminForm({ ...superAdminForm, password: e.target.value })}
                  required
                />
              </div>

              <div className="form-group">
                <label className="form-label">관리자 닉네임</label>
                <input
                  type="text"
                  className="input"
                  placeholder="예: 부관리자, 전술사령관"
                  value={superAdminForm.nickname}
                  onChange={(e) => setSuperAdminForm({ ...superAdminForm, nickname: e.target.value })}
                  required
                />
              </div>

              <div style={{ display: 'flex', gap: 10, marginTop: 24 }}>
                <button type="button" className="btn btn-secondary" onClick={() => setShowSuperAdminModal(false)} style={{ flex: 1 }}>
                  취소
                </button>
                <button type="submit" className="btn btn-primary" style={{ flex: 1 }}>
                  슈퍼 관리자 생성
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 재화 및 프로필 정밀 수정 모달 */}
      {showAssetModal && selectedUser && (
        <div className="modal-overlay">
          <div className="modal-content">
            <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 16 }}>
              [{selectedUser.nickname || selectedUser.username}] 재화 및 프로필 정밀 조정
            </h2>
            <form onSubmit={handleSaveAssets}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div className="form-group">
                  <label className="form-label">인게임 닉네임</label>
                  <input
                    type="text"
                    className="input"
                    value={assetForm.nickname}
                    onChange={(e) => setAssetForm({ ...assetForm, nickname: e.target.value })}
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">전역 커스텀 칭호</label>
                  <input
                    type="text"
                    className="input"
                    placeholder="예: 국가 영웅, 재정관"
                    value={assetForm.custom_title}
                    onChange={(e) => setAssetForm({ ...assetForm, custom_title: e.target.value })}
                  />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div className="form-group">
                  <label className="form-label">보유 연방 포인트 (P)</label>
                  <input
                    type="number"
                    className="input"
                    value={assetForm.points}
                    onChange={(e) => setAssetForm({ ...assetForm, points: e.target.value })}
                    required
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">보유 크레딧 (C)</label>
                  <input
                    type="number"
                    className="input"
                    value={assetForm.credits}
                    onChange={(e) => setAssetForm({ ...assetForm, credits: e.target.value })}
                    required
                  />
                </div>
              </div>

              <div className="form-group">
                <label className="form-label">조정 사유 (SQLite 입출금 원장에 상세 기록됨)</label>
                <input
                  type="text"
                  className="input"
                  placeholder="예: 이벤트 보상 지급, 오지급 정정 등"
                  value={assetForm.reason}
                  onChange={(e) => setAssetForm({ ...assetForm, reason: e.target.value })}
                />
              </div>

              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer', marginBottom: 16 }}>
                <input
                  type="checkbox"
                  checked={assetForm.sync_active_season}
                  onChange={(e) => setAssetForm({ ...assetForm, sync_active_season: e.target.checked })}
                />
                <span>포인트 변동분을 현재 활성 시즌 랭킹 점수에도 함께 반영</span>
              </label>

              <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
                <button type="button" className="btn btn-secondary" onClick={() => setShowAssetModal(false)} style={{ flex: 1 }}>
                  취소
                </button>
                <button type="submit" className="btn btn-primary" style={{ flex: 1 }}>
                  저장 및 원장 기록
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 수동 입출금 내역 추가/정산 모달 */}
      {showManualTxModal && (
        <div className="modal-overlay">
          <div className="modal-content">
            <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 16 }}>
              수동 포인트/크레딧 입출금 원장 기록 및 정산
            </h2>
            <form onSubmit={handleCreateManualTx}>
              <div className="form-group">
                <label className="form-label">대상 유저 선택</label>
                <select
                  className="input"
                  value={manualTxForm.user_id}
                  onChange={(e) => setManualTxForm({ ...manualTxForm, user_id: e.target.value })}
                  required
                >
                  <option value="">-- 유저를 선택하세요 --</option>
                  {approvedUsers.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.nickname || u.username} (@{u.username}) - 보유: {u.points.toLocaleString()}P / {u.credits.toLocaleString()}C
                    </option>
                  ))}
                </select>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div className="form-group">
                  <label className="form-label">자산 종류</label>
                  <select
                    className="input"
                    value={manualTxForm.asset_type}
                    onChange={(e) => setManualTxForm({ ...manualTxForm, asset_type: e.target.value })}
                  >
                    <option value="POINT">연방 포인트 (P)</option>
                    <option value="CREDIT">크레딧 (C)</option>
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">입출금 수량 (+입금 / -출금)</label>
                  <input
                    type="number"
                    className="input"
                    placeholder="예: 500 또는 -200"
                    value={manualTxForm.amount}
                    onChange={(e) => setManualTxForm({ ...manualTxForm, amount: e.target.value })}
                    required
                  />
                </div>
              </div>

              <div className="form-group">
                <label className="form-label">카테고리</label>
                <input
                  type="text"
                  className="input"
                  value={manualTxForm.category}
                  onChange={(e) => setManualTxForm({ ...manualTxForm, category: e.target.value })}
                  required
                />
              </div>

              <div className="form-group">
                <label className="form-label">상세 내역 설명</label>
                <input
                  type="text"
                  className="input"
                  placeholder="예: 전쟁 승리 특별 포상금 지급"
                  value={manualTxForm.description}
                  onChange={(e) => setManualTxForm({ ...manualTxForm, description: e.target.value })}
                  required
                />
              </div>

              <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
                <button type="button" className="btn btn-secondary" onClick={() => setShowManualTxModal(false)} style={{ flex: 1 }}>
                  취소
                </button>
                <button type="submit" className="btn btn-primary" style={{ flex: 1 }}>
                  반영 및 원장 기록
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
