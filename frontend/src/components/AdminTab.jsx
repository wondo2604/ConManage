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
  Edit2
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
  const [testingNoticeWebhook, setTestingNoticeWebhook] = useState(false);

  const fileInputRef = useRef(null);

  // 브랜딩 수정 폼 (최초 admin만 가능)
  const [brandingForm, setBrandingForm] = useState({
    system_title: branding?.system_title || 'FEDERATION',
    nation_name: branding?.nation_name || '마인크래프트 전쟁 관리',
    server_logo_text: branding?.server_logo_text || 'M'
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

  const isInitialAdmin = user.username === 'admin';
  const canManageAccounts = user.is_admin || user.permissions?.includes('계정 관리');
  const canManageRoles = user.is_admin || user.permissions?.includes('역할 관리');
  const canManageNotices = user.is_admin || user.permissions?.includes('공지 관리');
  const canManageData = user.is_admin || user.permissions?.includes('데이터 관리');
  const canManageRanking = user.is_admin || user.permissions?.includes('랭킹 관리자') || user.permissions?.includes('시즌 관리');

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

  const loadData = async () => {
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

      if (rankCfg || creditCfg) {
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
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
    if (branding) {
      setBrandingForm({
        system_title: branding.system_title,
        nation_name: branding.nation_name,
        server_logo_text: branding.server_logo_text
      });
    }
  }, [branding]);

  // 브랜딩 저장 (오직 최초 admin만 가능)
  const handleSaveBranding = async (e) => {
    e.preventDefault();
    if (!isInitialAdmin) {
      alert('국가 및 시스템 이름은 최초 admin 계정에서만 수정할 수 있습니다.');
      return;
    }

    try {
      const res = await apiRequest('/settings/branding', {
        method: 'PUT',
        body: JSON.stringify(brandingForm)
      });
      alert(res.message);
      if (refreshBranding) refreshBranding();
    } catch (err) {
      alert(err.message);
    }
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

  const handleSaveGlobalNumericConfig = async (e) => {
    e.preventDefault();
    try {
      await Promise.all([
        apiRequest('/ranking/config', {
          method: 'PUT',
          body: JSON.stringify({
            point_multiplier: globalNumericConfig.point_multiplier,
            credit_multiplier: globalNumericConfig.credit_multiplier,
            ranking_board_notice: globalNumericConfig.ranking_board_notice
          })
        }),
        user.is_admin
          ? apiRequest('/credits/config', {
              method: 'PUT',
              body: JSON.stringify({
                exchange_rate: globalNumericConfig.exchange_rate,
                min_exchange_amount: globalNumericConfig.min_exchange_amount,
                exchange_fee_percent: globalNumericConfig.exchange_fee_percent
              })
            })
          : Promise.resolve()
      ]);
      alert('전역 수치 및 배율 설정이 저장되었습니다.');
      loadData();
    } catch (err) {
      alert(err.message);
    }
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

  const handleSaveWebhook = async (e) => {
    e.preventDefault();
    try {
      await apiRequest('/settings', {
        method: 'POST',
        body: JSON.stringify({ key: 'discord_webhook_url', value: settings.discord_webhook_url || '' })
      });
      alert('디스코드 웹훅 URL이 저장되었습니다.');
      loadData();
    } catch (err) {
      alert(err.message);
    }
  };

  const handleTestWebhook = async () => {
    try {
      const res = await apiRequest('/settings/test-webhook', { method: 'POST' });
      alert(res.message);
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

  // 공지사항 웹훅 및 양식 저장
  const handleSaveNoticeWebhook = async (e, sendNow = false) => {
    if (e && e.preventDefault) e.preventDefault();
    try {
      const res = await apiRequest(`/notices/${selectedNoticeCategory}`, {
        method: 'PUT',
        body: JSON.stringify({
          ...noticeWebhookForm,
          send_now: sendNow
        })
      });
      alert(res.message || '공지사항 및 웹훅 설정이 저장되었습니다.');
      loadData();
    } catch (err) {
      alert(err.message);
    }
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

  const pendingUsers = users.filter(u => u.status === 'pending');
  const approvedUsers = users.filter(u => u.status !== 'pending');

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div>
          <h2 style={{ fontSize: 20, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 10 }}>
            <ShieldCheck color="#f59e0b" size={24} />
            <span>{user.is_admin ? '슈퍼 관리자 시스템 제어 패널' : '계정 관리 패널'}</span>
          </h2>
          <p style={{ color: '#94a3b8', fontSize: 13, marginTop: 4 }}>
            신규 가입자 승인 심사, 슈퍼 관리자 생성 및 디스코드 스타일의 세분화된 역할을 관리합니다.
          </p>
        </div>

        {/* 슈퍼 관리자만 새 슈퍼관리자 생성 가능 */}
        {user.is_admin && (
          <button className="btn btn-primary" onClick={() => setShowSuperAdminModal(true)}>
            <Crown size={16} /> 새 슈퍼 관리자 계정 생성
          </button>
        )}
      </div>

      {/* 🏛️ 1. 국가 및 시스템 브랜딩 설정 (오직 최초 admin 계정에서만 표시 및 수정 가능) */}
      {isInitialAdmin ? (
        <div className="card" style={{ border: '1px solid var(--border-color)', background: '#ffffff', marginBottom: 28, boxShadow: 'var(--shadow-sm)' }}>
          <div className="card-header">
            <div className="card-title">
              <Globe size={20} color="var(--primary)" />
              <span>국가 및 시스템 이름 설정 (최초 admin 전용)</span>
            </div>
            <span className="badge badge-approved">👑 최초 admin 권한 인증됨</span>
          </div>
          <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 16, lineHeight: 1.5 }}>
            웹사이트 전역(사이드바, 헤더, 로그인 화면)에 노출되는 국가 이름, 시스템 타이틀, 로고 심볼을 오직 최초 admin 계정에서만 변경할 수 있습니다.
          </p>

          <form onSubmit={handleSaveBranding}>
            <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1.5fr 1fr', gap: 16 }}>
              <div className="form-group">
                <label className="form-label">시스템 이름 (영문/한글)</label>
                <input
                  type="text"
                  className="input"
                  placeholder="예: FEDERATION, ARCADIA"
                  value={brandingForm.system_title}
                  onChange={(e) => setBrandingForm({ ...brandingForm, system_title: e.target.value })}
                  required
                />
              </div>

              <div className="form-group">
                <label className="form-label">국가 이름 (한글)</label>
                <input
                  type="text"
                  className="input"
                  placeholder="예: 마인크래프트 연방 국가, 아르카디아 제국"
                  value={brandingForm.nation_name}
                  onChange={(e) => setBrandingForm({ ...brandingForm, nation_name: e.target.value })}
                  required
                />
              </div>

              <div className="form-group">
                <label className="form-label">서버 로고 심볼 (1~2글자)</label>
                <input
                  type="text"
                  maxLength="4"
                  className="input"
                  placeholder="예: M, ⚔️, A"
                  value={brandingForm.server_logo_text}
                  onChange={(e) => setBrandingForm({ ...brandingForm, server_logo_text: e.target.value })}
                  required
                />
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
              <button type="submit" className="btn btn-primary">
                국가 & 시스템 이름 저장 적용
              </button>
            </div>
          </form>
        </div>
      ) : (
        user.is_admin && (
          <div style={{ padding: '12px 16px', background: 'var(--bg-tertiary)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)', marginBottom: 24, fontSize: 13, color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: 8 }}>
            <span>🔒 국가 및 시스템 브랜딩(이름/로고) 변경은 보안 정책에 따라 <strong>최초 admin</strong> 계정에서만 수정할 수 있습니다.</span>
          </div>
        )
      )}

      {/* 2. 가입 승인 대기열 (계정 관리 권한 또는 슈퍼관리자) */}
      <div className="card" style={{ border: pendingUsers.length > 0 ? '1px solid rgba(245, 158, 11, 0.4)' : undefined }}>
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

      {/* 3. 디스코드 웹훅 통합 & 개별 상세 설정 센터 (지급 기록 포함 26종 전체) */}
      {user.is_admin && <WebhookManager />}

      {/* 💾 4. 데이터베이스 백업 & 복원 (JSON) - 슈퍼관리자 전용 */}
      {user.is_admin && (
        <div className="card" style={{ marginBottom: 28, border: '1px solid rgba(56, 189, 248, 0.3)', background: 'linear-gradient(180deg, rgba(15, 23, 42, 0.4) 0%, rgba(30, 41, 59, 0.2) 100%)' }}>
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
      )}

      {/* 📢 5. 공지사항 디스코드 웹훅 개별설정 및 메시지 양식 설정 (슈퍼관리자 & 공지 관리) */}
      {(user.is_admin || canManageNotices) && (
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
                <label className="form-label">공지사항 제목</label>
                <input
                  type="text"
                  className="input"
                  value={noticeWebhookForm.title}
                  onChange={(e) => setNoticeWebhookForm({ ...noticeWebhookForm, title: e.target.value })}
                  placeholder="공지사항 제목"
                  required
                />
              </div>

              <div className="form-group">
                <label className="form-label">공지사항 전용 디스코드 웹훅 URL</label>
                <input
                  type="url"
                  className="input"
                  placeholder="https://discord.com/api/webhooks/... (비워두면 전역 기본 웹훅 사용)"
                  value={noticeWebhookForm.webhook_url}
                  onChange={(e) => setNoticeWebhookForm({ ...noticeWebhookForm, webhook_url: e.target.value })}
                />
              </div>
            </div>

            <div className="form-group">
              <label className="form-label">공지사항 본문 내용</label>
              <textarea
                className="textarea"
                rows="4"
                value={noticeWebhookForm.content}
                onChange={(e) => setNoticeWebhookForm({ ...noticeWebhookForm, content: e.target.value })}
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
                    onChange={(e) => setNoticeWebhookForm({ ...noticeWebhookForm, webhook_enabled: e.target.checked ? 1 : 0 })}
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
                    onChange={(e) => setNoticeWebhookForm({ ...noticeWebhookForm, mention_type: e.target.value })}
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
                      onChange={(e) => setNoticeWebhookForm({ ...noticeWebhookForm, embed_color: e.target.value })}
                      style={{ width: 42, height: 38, padding: 2, borderRadius: 6, cursor: 'pointer', border: '1px solid var(--border-color)', background: 'transparent' }}
                    />
                    <input
                      type="text"
                      className="input"
                      value={noticeWebhookForm.embed_color || '#3b82f6'}
                      onChange={(e) => setNoticeWebhookForm({ ...noticeWebhookForm, embed_color: e.target.value })}
                      style={{ flex: 1 }}
                    />
                  </div>
                </div>
              </div>

              <div className="form-group" style={{ marginBottom: 6 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                  <label className="form-label" style={{ fontSize: 12, marginBottom: 0 }}>
                    메시지 본문 양식 (커스텀 템플릿)
                  </label>
                  <div style={{ display: 'flex', gap: 4 }}>
                    {['{title}', '{content}', '{author}', '{date}'].map((tag) => (
                      <button
                        key={tag}
                        type="button"
                        className="btn btn-secondary btn-sm"
                        style={{ padding: '2px 6px', fontSize: 11 }}
                        onClick={() => setNoticeWebhookForm({ ...noticeWebhookForm, message_template: (noticeWebhookForm.message_template || '') + tag })}
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
                  onChange={(e) => setNoticeWebhookForm({ ...noticeWebhookForm, message_template: e.target.value })}
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
        </div>
      )}

      {/* 🎛️ 전역 수치 및 보상 배율 정밀 제어 센터 (슈퍼관리자 & 랭킹 관리자) */}
      {(user.is_admin || canManageRanking) && (
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
                <label className="form-label" style={{ fontSize: 12 }}>전역 포인트 획득 배율 (x배)</label>
                <input
                  type="number"
                  step="0.1"
                  className="input"
                  value={globalNumericConfig.point_multiplier}
                  onChange={(e) => setGlobalNumericConfig({ ...globalNumericConfig, point_multiplier: e.target.value })}
                />
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label" style={{ fontSize: 12 }}>전역 크레딧 획득 배율 (x배)</label>
                <input
                  type="number"
                  step="0.1"
                  className="input"
                  value={globalNumericConfig.credit_multiplier}
                  onChange={(e) => setGlobalNumericConfig({ ...globalNumericConfig, credit_multiplier: e.target.value })}
                />
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label" style={{ fontSize: 12 }}>1 C당 인게임 원화 환전비</label>
                <input
                  type="number"
                  step="any"
                  className="input"
                  disabled={!user.is_admin}
                  value={globalNumericConfig.exchange_rate}
                  onChange={(e) => setGlobalNumericConfig({ ...globalNumericConfig, exchange_rate: e.target.value })}
                />
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label" style={{ fontSize: 12 }}>최소 환전 가능 크레딧 (C)</label>
                <input
                  type="number"
                  className="input"
                  disabled={!user.is_admin}
                  value={globalNumericConfig.min_exchange_amount}
                  onChange={(e) => setGlobalNumericConfig({ ...globalNumericConfig, min_exchange_amount: e.target.value })}
                />
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 3fr', gap: 12, alignItems: 'end' }}>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label" style={{ fontSize: 12 }}>환전 수수료율 (%)</label>
                <input
                  type="number"
                  step="0.1"
                  className="input"
                  disabled={!user.is_admin}
                  value={globalNumericConfig.exchange_fee_percent}
                  onChange={(e) => setGlobalNumericConfig({ ...globalNumericConfig, exchange_fee_percent: e.target.value })}
                />
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label" style={{ fontSize: 12 }}>랭킹 보드 상단 안내 문구</label>
                <input
                  type="text"
                  className="input"
                  value={globalNumericConfig.ranking_board_notice || ''}
                  onChange={(e) => setGlobalNumericConfig({ ...globalNumericConfig, ranking_board_notice: e.target.value })}
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

      {/* 📊 SQLite 연방 포인트/크레딧 입출금 상세 원장 & CSV/XLSX 다운로드 ('데이터 관리' 권한 전용) */}
      {canManageData && (
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

          <div className="table-container" style={{ maxHeight: 360, overflowY: 'auto' }}>
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

      {/* 🛡️ 디스코드 스타일 역할 생성·권한·위계 순서 관리 스튜디오 */}
      {(user.is_admin || canManageRoles || canManageAccounts) && (
        <RoleManager
          user={user}
          users={approvedUsers}
          refreshKey={roleRefreshKey}
          onChanged={() => {
            loadData();
            if (refreshUser) refreshUser();
          }}
        />
      )}

      {/* 4. 승인된 사용자 및 개인별 디스코드 역할(랭크) 부여 */}
      <div className="card">
        <div className="card-header">
          <div className="card-title">
            <Users size={20} color="#60a5fa" />
            <span>사용자 목록 및 개인별 역할(랭크) 부여</span>
          </div>
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            각 사용자에게 디스코드처럼 역할을 클릭해 부여하거나 해제할 수 있습니다 (위쪽 서열 역할부터 표시)
          </span>
        </div>

        <div className="table-container">
          <table className="table">
            <thead>
              <tr>
                <th>사용자 & 대표 역할</th>
                <th>상태</th>
                {user.is_admin && <th>슈퍼관리자</th>}
                <th>보유 재화</th>
                <th>개인별 부여 역할 (클릭하여 토글)</th>
                <th>작업</th>
              </tr>
            </thead>
            <tbody>
              {approvedUsers.map((u) => {
                const topRole = u.roles?.[0];
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
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, maxWidth: 580 }}>
                      {allRoles.length === 0 ? (
                        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                          위 [역할 관리]에서 역할을 먼저 만들어 주세요.
                        </span>
                      ) : (
                        allRoles.map((roleObj) => {
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
                        })
                      )}
                    </div>
                    {u.permissions?.length > 0 && (
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6 }}>
                        활성 권한: {u.permissions.join(' · ')}
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
              })}
            </tbody>
          </table>
        </div>
      </div>

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
