import React, { useState, useEffect } from 'react';
import { apiRequest } from '../api';
import {
  Trophy, Crown, Plus, Flame,
  RotateCcw, Edit2, Sliders,
  Award, Zap, Coins
} from 'lucide-react';

export default function RankingTab({ user, refreshUser }) {
  const [seasons, setSeasons] = useState([]);
  const [selectedSeason, setSelectedSeason] = useState('all');
  const [sortBy, setSortBy] = useState('points'); // 'points' | 'credits'
  const [includeHidden, setIncludeHidden] = useState(false);
  const [ranking, setRanking] = useState([]);
  const [config, setConfig] = useState({
    ranking_board_notice: '',
    ranking_show_credit_tab: '1',
    ranking_top_limit: '100',
    point_multiplier: '1.0',
    credit_multiplier: '1.0'
  });
  const [loading, setLoading] = useState(true);

  // 시즌 관리 모달 상태
  const [showSeasonModal, setShowSeasonModal] = useState(false);
  const [editingSeason, setEditingSeason] = useState(null);
  const [seasonForm, setSeasonForm] = useState({
    name: '',
    start_date: '',
    end_date: '',
    reward_description: ''
  });

  // 랭킹 초기화 모달
  const [showResetModal, setShowResetModal] = useState(false);
  const [resetForm, setResetForm] = useState({
    scope: 'season',
    create_new_season: false,
    new_season_name: '',
    reason: ''
  });

  // 랭킹 관리자 전용: 플레이어 개별 정밀 수정 모달
  const [editingPlayer, setEditingPlayer] = useState(null);
  const [playerForm, setPlayerForm] = useState({
    season_points: 0,
    bonus_points: 0,
    total_points: 0,
    credits: 0,
    custom_title: '',
    admin_memo: '',
    is_hidden: false,
    reason: ''
  });

  // 랭킹 관리자 전용: 설정 모달 (일괄 증감 / 보드 설정)
  const [showAdminStudio, setShowAdminStudio] = useState(false);
  const [studioTab, setStudioTab] = useState('config'); // 'config' | 'bulk'
  const [bulkForm, setBulkForm] = useState({
    action_type: 'add_season_points',
    value: 100,
    reason: ''
  });

  const canManageRanking = user.is_admin || user.permissions?.includes('랭킹 관리자') || user.permissions?.includes('시즌 관리');

  const loadData = async (overrideSeasonId) => {
    try {
      setLoading(true);
      const [seasonsData, cfgData] = await Promise.all([
        apiRequest('/seasons'),
        apiRequest('/ranking/config')
      ]);
      setSeasons(seasonsData || []);
      if (cfgData) setConfig(cfgData);

      let targetSeason = overrideSeasonId !== undefined ? overrideSeasonId : selectedSeason;
      if (overrideSeasonId === undefined && selectedSeason === 'all') {
        const active = (seasonsData || []).find(s => s.is_active === 1);
        if (active) {
          targetSeason = active.id.toString();
          setSelectedSeason(targetSeason);
        }
      }

      await loadRanking(targetSeason, sortBy, includeHidden);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const loadRanking = async (seasonId, sortMode = sortBy, showHiddenFlag = includeHidden) => {
    try {
      const data = await apiRequest(
        `/ranking?season_id=${seasonId}&sort_by=${sortMode}&include_hidden=${showHiddenFlag ? '1' : '0'}`
      );
      setRanking(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleSeasonChange = (e) => {
    const val = e.target.value;
    setSelectedSeason(val);
    loadRanking(val, sortBy, includeHidden);
  };

  const handleSortChange = (mode) => {
    setSortBy(mode);
    loadRanking(selectedSeason, mode, includeHidden);
  };

  const handleToggleHiddenView = (checked) => {
    setIncludeHidden(checked);
    loadRanking(selectedSeason, sortBy, checked);
  };

  // 시즌 저장/수정
  const handleSaveSeason = async (e) => {
    e.preventDefault();
    try {
      if (editingSeason) {
        await apiRequest(`/seasons/${editingSeason.id}`, {
          method: 'PUT',
          body: JSON.stringify(seasonForm)
        });
        alert('시즌 정보가 수정되었습니다.');
      } else {
        await apiRequest('/seasons', {
          method: 'POST',
          body: JSON.stringify(seasonForm)
        });
        alert('새 시즌이 생성되었습니다.');
      }
      setEditingSeason(null);
      setSeasonForm({ name: '', start_date: '', end_date: '', reward_description: '' });
      loadData(selectedSeason);
    } catch (err) {
      alert(err.message);
    }
  };

  const handleDeleteSeason = async (id) => {
    if (!confirm('이 시즌을 삭제하시겠습니까? 해당 시즌의 랭킹 기록도 함께 삭제됩니다.')) return;
    try {
      await apiRequest(`/seasons/${id}`, { method: 'DELETE' });
      loadData('all');
    } catch (err) {
      alert(err.message);
    }
  };

  const handleActivateSeason = async (id) => {
    try {
      await apiRequest(`/seasons/${id}/activate`, { method: 'PUT' });
      alert('해당 시즌이 현재 진행 시즌으로 활성화되었습니다.');
      setSelectedSeason(id.toString());
      loadData(id.toString());
    } catch (err) {
      alert(err.message);
    }
  };

  // 랭킹 초기화 실행
  const handleExecuteReset = async (e) => {
    e.preventDefault();
    const scopeLabels = {
      season: '현재 선택된 시즌 랭킹 포인트 초기화',
      all_seasons: '전 시즌 랭킹 포인트 전체 초기화',
      total_points: '모든 플레이어 누적 연방 포인트 + 현재 시즌 0P 초기화',
      credits: '모든 플레이어 보유 크레딧 0C 초기화',
      everything: '전체 연방 포인트 + 전체 크레딧 + 전 시즌 기록 완전 초기화'
    };

    if (!confirm(`⚠️ [랭킹 초기화 확인]\n\n선택한 범위: ${scopeLabels[resetForm.scope]}\n\n정말로 초기화를 실행하시겠습니까? (모든 내역은 입출금 원장에 안전하게 기록됩니다)`)) {
      return;
    }

    try {
      const res = await apiRequest('/ranking/reset', {
        method: 'POST',
        body: JSON.stringify({
          ...resetForm,
          season_id: selectedSeason
        })
      });
      alert(res.message);
      setShowResetModal(false);
      setResetForm({ scope: 'season', create_new_season: false, new_season_name: '', reason: '' });
      if (res.createdSeasonId) {
        setSelectedSeason(res.createdSeasonId.toString());
        loadData(res.createdSeasonId.toString());
      } else {
        loadData(selectedSeason);
      }
      if (refreshUser) refreshUser();
    } catch (err) {
      alert(err.message);
    }
  };

  // 플레이어 개별 정밀 수정 저장
  const handleSavePlayerEdit = async (e) => {
    e.preventDefault();
    if (!editingPlayer) return;
    try {
      const res = await apiRequest(`/ranking/users/${editingPlayer.id}`, {
        method: 'PUT',
        body: JSON.stringify({
          ...playerForm,
          season_id: selectedSeason
        })
      });
      alert(res.message);
      setEditingPlayer(null);
      loadData(selectedSeason);
      if (refreshUser) refreshUser();
    } catch (err) {
      alert(err.message);
    }
  };

  // 일괄 수치 조정
  const handleExecuteBulkAdjust = async (e) => {
    e.preventDefault();
    if (!confirm('전체 승인 플레이어를 대상으로 일괄 수치 조정을 실행하시겠습니까?')) return;
    try {
      const res = await apiRequest('/ranking/bulk-adjust', {
        method: 'POST',
        body: JSON.stringify({
          ...bulkForm,
          season_id: selectedSeason
        })
      });
      alert(res.message);
      loadData(selectedSeason);
      if (refreshUser) refreshUser();
    } catch (err) {
      alert(err.message);
    }
  };

  // 랭킹 보드/배율 설정 저장
  const handleSaveConfig = async (e) => {
    e.preventDefault();
    try {
      const res = await apiRequest('/ranking/config', {
        method: 'PUT',
        body: JSON.stringify(config)
      });
      alert(res.message);
      loadData(selectedSeason);
    } catch (err) {
      alert(err.message);
    }
  };

  const currentSeasonObj = seasons.find(s => s.id.toString() === selectedSeason) || seasons.find(s => s.is_active === 1);
  const myIndex = ranking.findIndex(r => r.id === user.id);
  const myRow = myIndex >= 0 ? ranking[myIndex] : null;
  const myPoints = myRow ? (myRow.points || 0) : (user.points || 0);

  const getRankBadge = (index) => {
    if (index === 0) return <div style={{ width: 30, height: 30, borderRadius: '50%', background: 'linear-gradient(135deg, #f59e0b, #d97706)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, boxShadow: '0 4px 10px rgba(245, 158, 11, 0.4)' }}><Crown size={16} /></div>;
    if (index === 1) return <div style={{ width: 30, height: 30, borderRadius: '50%', background: 'linear-gradient(135deg, #94a3b8, #64748b)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 13 }}>2</div>;
    if (index === 2) return <div style={{ width: 30, height: 30, borderRadius: '50%', background: 'linear-gradient(135deg, #d97706, #92400e)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 13 }}>3</div>;
    return <div style={{ width: 30, height: 30, borderRadius: '50%', background: 'var(--bg-tertiary)', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 12 }}>{index + 1}</div>;
  };

  return (
    <div>
      {/* 상단 헤더 & 컨트롤 바 */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20, flexWrap: 'wrap', gap: 14 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Trophy color="#f59e0b" size={26} />
            <h2 style={{ fontSize: 22, fontWeight: 800 }}>시즌 랭킹</h2>
            {(Number(config.point_multiplier) !== 1 || Number(config.credit_multiplier) !== 1) && (
              <span className="badge" style={{ background: '#fee2e2', color: '#991b1b', fontWeight: 800 }}>
                <Zap size={13} /> 배율 적용중 (포인트 x{config.point_multiplier} / 크레딧 x{config.credit_multiplier})
              </span>
            )}
          </div>
          <p style={{ color: 'var(--text-muted)', fontSize: 13, marginTop: 4 }}>
            시즌별 연방 포인트 순위를 안내합니다.
          </p>
        </div>

        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          {/* 랭킹 기준 전환 (포인트 vs 크레딧) */}
          {config.ranking_show_credit_tab !== '0' && (
            <div style={{ display: 'flex', background: 'var(--bg-tertiary)', padding: 3, borderRadius: 'var(--radius-pill)', border: '1px solid var(--border-color)' }}>
              <button
                type="button"
                className={`btn btn-sm ${sortBy === 'points' ? 'btn-primary' : ''}`}
                style={{ background: sortBy === 'points' ? undefined : 'transparent', color: sortBy === 'points' ? undefined : 'var(--text-secondary)' }}
                onClick={() => handleSortChange('points')}
              >
                <Trophy size={13} /> 포인트(P) 순위
              </button>
              <button
                type="button"
                className={`btn btn-sm ${sortBy === 'credits' ? 'btn-primary' : ''}`}
                style={{ background: sortBy === 'credits' ? undefined : 'transparent', color: sortBy === 'credits' ? undefined : 'var(--text-secondary)' }}
                onClick={() => handleSortChange('credits')}
              >
                <Coins size={13} /> 크레딧(C) 순위
              </button>
            </div>
          )}

          <select
            className="select"
            value={selectedSeason}
            onChange={handleSeasonChange}
            style={{ width: 220 }}
          >
            <option value="all">🌐 전 시즌 통합 누적</option>
            {seasons.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} {s.is_active === 1 ? '🔥(진행중)' : ''}
              </option>
            ))}
          </select>

          {canManageRanking && (
            <>
              <button className="btn btn-secondary btn-sm" onClick={() => setShowSeasonModal(true)}>
                <Plus size={14} /> 시즌 관리
              </button>
              <button className="btn btn-primary btn-sm" onClick={() => setShowAdminStudio(true)}>
                <Sliders size={14} /> 랭킹 설정
              </button>
              <button
                className="btn btn-danger btn-sm"
                onClick={() => setShowResetModal(true)}
                title="시즌 또는 전체 랭킹 초기화"
              >
                <RotateCcw size={14} /> 랭킹 초기화
              </button>
            </>
          )}
        </div>
      </div>

      {/* 시즌 안내 & 나의 현재 순위 요약 배너 */}
      <div className="card" style={{
        background: 'linear-gradient(135deg, #fffbeb 0%, #ffffff 65%, #f8fafc 100%)',
        border: '1px solid #fde68a',
        marginBottom: 24,
        padding: '18px 22px'
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 16 }}>
          <div style={{ flex: 1, minWidth: 260 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <span className="badge" style={{ background: '#f59e0b', color: '#fff', fontWeight: 800 }}>
                <Flame size={13} /> {currentSeasonObj ? currentSeasonObj.name : '통합 시즌'}
              </span>
              {currentSeasonObj?.start_date && (
                <span style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 600 }}>
                  📅 {currentSeasonObj.start_date} ~ {currentSeasonObj.end_date || '상시'}
                </span>
              )}
            </div>
            {config.ranking_board_notice && (
              <div style={{ fontSize: 14, fontWeight: 700, color: '#92400e', lineHeight: 1.5 }}>
                {config.ranking_board_notice}
              </div>
            )}
            {currentSeasonObj?.reward_description && (
              <div style={{ fontSize: 12, color: '#b45309', marginTop: 4, fontWeight: 600 }}>
                🎁 시즌 보상 안내: {currentSeasonObj.reward_description}
              </div>
            )}
          </div>

          {/* 내 현재 순위 심플 표시 */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 18,
            background: '#ffffff',
            padding: '12px 18px',
            borderRadius: 12,
            border: '1px solid var(--border-color)'
          }}>
            <div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 700 }}>나의 현재 순위</div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginTop: 2 }}>
                <span style={{ fontSize: 22, fontWeight: 900, color: 'var(--primary)' }}>
                  {myIndex >= 0 ? `${myIndex + 1}위` : '-'}
                </span>
                <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--point-gold)' }}>
                  ({myPoints.toLocaleString()} P)
                </span>
              </div>
            </div>
            <div style={{ borderLeft: '1px solid var(--border-color)', paddingLeft: 16, fontSize: 12, color: 'var(--text-secondary)', fontWeight: 600 }}>
              <div>📦 납품 {myRow?.supply_count || 0}회</div>
              <div style={{ marginTop: 2 }}>⚔️ 퀘스트 {myRow?.quest_count || 0}회 · ⛏️ 알바 {myRow?.job_count || 0}회</div>
            </div>
          </div>
        </div>
      </div>

      {/* Top 3 순위 포디움 */}
      {ranking.length >= 3 && (
        <div style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1.2fr 1fr',
          gap: 18,
          marginBottom: 28,
          alignItems: 'flex-end'
        }}>
          {/* 2위 */}
          <div className="card" style={{ textAlign: 'center', padding: '22px 16px', background: 'linear-gradient(180deg, #f8fafc 0%, #ffffff 100%)', borderTop: '4px solid #94a3b8', marginBottom: 0 }}>
            <div style={{ width: 44, height: 44, borderRadius: '50%', background: '#94a3b8', margin: '0 auto 10px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 800 }}>
              🥈 2위
            </div>
            {ranking[1].roles?.[0] && (
              <div style={{ fontSize: 11, fontWeight: 700, color: ranking[1].roles[0].color, marginBottom: 2 }}>
                ● {ranking[1].roles[0].name}
              </div>
            )}
            <h3 style={{ fontSize: 17, fontWeight: 800 }}>{ranking[1].nickname || ranking[1].username}</h3>
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>@{ranking[1].username}</span>
            <div className={`asset-pill ${sortBy === 'credits' ? 'credit' : 'point'}`} style={{ justifyContent: 'center', marginTop: 12, fontSize: 14 }}>
              {sortBy === 'credits' ? `${(ranking[1].credits || 0).toLocaleString()} C` : `${ranking[1].points.toLocaleString()} P`}
            </div>
          </div>

          {/* 1위 */}
          <div className="card" style={{
            textAlign: 'center',
            padding: '28px 18px',
            background: 'linear-gradient(180deg, #fffbeb 0%, #ffffff 100%)',
            border: '2px solid #f59e0b',
            borderTop: '6px solid #f59e0b',
            boxShadow: '0 10px 24px -6px rgba(245, 158, 11, 0.22)',
            marginBottom: 0
          }}>
            <Crown size={34} color="#f59e0b" style={{ margin: '0 auto 6px' }} />
            <div style={{ display: 'inline-block', padding: '3px 12px', borderRadius: 999, background: '#f59e0b', color: '#fff', fontWeight: 800, fontSize: 12, marginBottom: 8 }}>
              👑 1위
            </div>
            {ranking[0].roles?.[0] && (
              <div style={{ fontSize: 12, fontWeight: 800, color: ranking[0].roles[0].color, marginBottom: 2 }}>
                ● {ranking[0].roles[0].name}
              </div>
            )}
            <h3 style={{ fontSize: 20, fontWeight: 900, color: '#b45309' }}>{ranking[0].nickname || ranking[0].username}</h3>
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>@{ranking[0].username}</span>
            <div className={`asset-pill ${sortBy === 'credits' ? 'credit' : 'point'}`} style={{ justifyContent: 'center', marginTop: 12, fontSize: 16, fontWeight: 800 }}>
              {sortBy === 'credits' ? `${(ranking[0].credits || 0).toLocaleString()} C` : `${ranking[0].points.toLocaleString()} P`}
            </div>
          </div>

          {/* 3위 */}
          <div className="card" style={{ textAlign: 'center', padding: '20px 16px', background: 'linear-gradient(180deg, #fff7ed 0%, #ffffff 100%)', borderTop: '4px solid #d97706', marginBottom: 0 }}>
            <div style={{ width: 44, height: 44, borderRadius: '50%', background: '#d97706', margin: '0 auto 10px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 800 }}>
              🥉 3위
            </div>
            {ranking[2].roles?.[0] && (
              <div style={{ fontSize: 11, fontWeight: 700, color: ranking[2].roles[0].color, marginBottom: 2 }}>
                ● {ranking[2].roles[0].name}
              </div>
            )}
            <h3 style={{ fontSize: 17, fontWeight: 800 }}>{ranking[2].nickname || ranking[2].username}</h3>
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>@{ranking[2].username}</span>
            <div className={`asset-pill ${sortBy === 'credits' ? 'credit' : 'point'}`} style={{ justifyContent: 'center', marginTop: 12, fontSize: 14 }}>
              {sortBy === 'credits' ? `${(ranking[2].credits || 0).toLocaleString()} C` : `${ranking[2].points.toLocaleString()} P`}
            </div>
          </div>
        </div>
      )}

      {/* 전체 순위 리스트 */}
      <div className="card">
        <div className="card-header" style={{ flexWrap: 'wrap', gap: 10 }}>
          <div className="card-title">
            <Award size={20} color="var(--primary)" />
            <span>전체 순위표</span>
          </div>

          {canManageRanking && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, cursor: 'pointer', color: 'var(--text-secondary)', fontWeight: 600 }}>
                <input
                  type="checkbox"
                  checked={includeHidden}
                  onChange={(e) => handleToggleHiddenView(e.target.checked)}
                />
                <span>숨김 처리된 플레이어 포함 보기 (관리자 전용)</span>
              </label>
            </div>
          )}
        </div>

        <div className="table-container">
          <table className="table">
            <thead>
              <tr>
                <th style={{ width: 70 }}>순위</th>
                <th>플레이어</th>
                <th>역할</th>
                <th>활동 기록</th>
                <th style={{ textAlign: 'right' }}>시즌 포인트</th>
                <th style={{ textAlign: 'right' }}>보유 크레딧</th>
                {canManageRanking && <th style={{ textAlign: 'center' }}>관리</th>}
              </tr>
            </thead>
            <tbody>
              {ranking.length === 0 ? (
                <tr>
                  <td colSpan={canManageRanking ? 7 : 6} style={{ textAlign: 'center', padding: 30, color: 'var(--text-muted)' }}>
                    등록된 랭킹 데이터가 없습니다.
                  </td>
                </tr>
              ) : (
                ranking.map((row, idx) => {
                  const isMe = row.id === user.id;

                  return (
                    <tr
                      key={row.id}
                      style={{
                        background: isMe ? '#fef2f2' : row.is_hidden ? '#f1f5f9' : undefined,
                        opacity: row.is_hidden ? 0.65 : 1
                      }}
                    >
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          {getRankBadge(idx)}
                        </div>
                      </td>
                      <td>
                        <div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                            <span style={{ fontWeight: 800, color: isMe ? 'var(--primary)' : (row.roles?.[0]?.color && row.roles[0].color !== '#99aab5' ? row.roles[0].color : 'var(--text-main)'), fontSize: 15 }}>
                              {row.nickname || row.username} {isMe ? '(나)' : ''}
                            </span>
                            {row.custom_title && (
                              <span className="badge" style={{ background: '#fef3c7', color: '#b45309', border: '1px solid #fde68a', fontSize: 11 }}>
                                🏅 {row.custom_title}
                              </span>
                            )}
                            {row.is_hidden === 1 && (
                              <span className="badge badge-rejected" style={{ fontSize: 10 }}>숨김됨</span>
                            )}
                          </div>
                          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                            @{row.username}
                            {canManageRanking && row.admin_memo && (
                              <span style={{ marginLeft: 8, color: '#d97706', fontWeight: 600 }}>[메모: {row.admin_memo}]</span>
                            )}
                          </div>
                        </div>
                      </td>
                      <td>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                          {(row.roles || []).length === 0 ? (
                            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>-</span>
                          ) : (
                            (row.roles || []).map((r) => (
                              <span
                                key={r.id}
                                className="badge"
                                style={{
                                  background: `${r.color || '#64748b'}18`,
                                  color: r.color || '#64748b',
                                  border: `1px solid ${r.color || '#64748b'}45`,
                                  fontWeight: 700,
                                  fontSize: 11
                                }}
                              >
                                ● {r.name}
                              </span>
                            ))
                          )}
                        </div>
                      </td>
                      <td>
                        <div style={{ fontSize: 12, color: 'var(--text-secondary)', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                          <span title="승인된 납품 횟수">📦 납품 {row.supply_count || 0}</span>
                          <span title="승인된 퀘스트 횟수">⚔️ 퀘스트 {row.quest_count || 0}</span>
                          <span title="완수한 알바 횟수">⛏️ 알바 {row.job_count || 0}</span>
                        </div>
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <div style={{ fontWeight: 800, color: 'var(--point-gold)', fontSize: 15 }}>
                          {(row.points || 0).toLocaleString()} P
                        </div>
                        {row.bonus_points !== 0 && (
                          <div style={{ fontSize: 11, color: row.bonus_points > 0 ? '#059669' : '#dc2626', fontWeight: 600 }}>
                            (기본 {(row.base_points || 0).toLocaleString()} {row.bonus_points > 0 ? `+보너스 ${row.bonus_points}` : `페널티 ${row.bonus_points}`})
                          </div>
                        )}
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <span style={{ fontWeight: 700, color: 'var(--point-emerald)', fontSize: 14 }}>
                          {(row.credits || 0).toLocaleString()} C
                        </span>
                      </td>
                      {canManageRanking && (
                        <td style={{ textAlign: 'center' }}>
                          <button
                            className="btn btn-secondary btn-sm"
                            onClick={() => {
                              setEditingPlayer(row);
                              setPlayerForm({
                                season_points: row.base_points ?? row.points ?? 0,
                                bonus_points: row.bonus_points ?? 0,
                                total_points: row.total_points_all_time ?? row.base_points ?? row.points ?? 0,
                                credits: row.credits ?? 0,
                                custom_title: row.custom_title || '',
                                admin_memo: row.admin_memo || '',
                                is_hidden: row.is_hidden === 1,
                                reason: ''
                              });
                            }}
                          >
                            <Edit2 size={12} /> 수정
                          </button>
                        </td>
                      )}
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* 🛠️ 1. 플레이어 개별 랭킹/수치 정밀 수정 모달 */}
      {editingPlayer && (
        <div className="modal-overlay">
          <div className="modal-content" style={{ maxWidth: 600 }}>
            <h2 style={{ fontSize: 18, fontWeight: 800, marginBottom: 6, display: 'flex', alignItems: 'center', gap: 8 }}>
              <Sliders size={20} color="var(--primary)" />
              <span>[{editingPlayer.nickname || editingPlayer.username}] 랭킹 & 재화 수치 조절</span>
            </h2>
            <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 18 }}>
              해당 플레이어의 시즌 점수, 가산/감산 보너스, 전체 누적 포인트, 크레딧, 칭호, 랭킹 노출 여부를 조정합니다.
            </p>

            <form onSubmit={handleSavePlayerEdit}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div className="form-group">
                  <label className="form-label">현재 시즌 기본 포인트 (P)</label>
                  <input
                    type="number"
                    className="input"
                    value={playerForm.season_points}
                    onChange={(e) => setPlayerForm({ ...playerForm, season_points: e.target.value })}
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">시즌 보너스 / 페널티 가감점 (음수 가능)</label>
                  <input
                    type="number"
                    className="input"
                    placeholder="예: +200 또는 -100"
                    value={playerForm.bonus_points}
                    onChange={(e) => setPlayerForm({ ...playerForm, bonus_points: e.target.value })}
                  />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div className="form-group">
                  <label className="form-label">전체 누적(상점 가용) 연방 포인트 (P)</label>
                  <input
                    type="number"
                    className="input"
                    value={playerForm.total_points}
                    onChange={(e) => setPlayerForm({ ...playerForm, total_points: e.target.value })}
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">보유 크레딧 잔액 (C)</label>
                  <input
                    type="number"
                    className="input"
                    value={playerForm.credits}
                    onChange={(e) => setPlayerForm({ ...playerForm, credits: e.target.value })}
                  />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div className="form-group">
                  <label className="form-label">커스텀 칭호 (선택)</label>
                  <input
                    type="text"
                    className="input"
                    placeholder="예: 납품왕"
                    value={playerForm.custom_title}
                    onChange={(e) => setPlayerForm({ ...playerForm, custom_title: e.target.value })}
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">관리자 메모 (비공개)</label>
                  <input
                    type="text"
                    className="input"
                    placeholder="예: 이벤트 가산점 부여"
                    value={playerForm.admin_memo}
                    onChange={(e) => setPlayerForm({ ...playerForm, admin_memo: e.target.value })}
                  />
                </div>
              </div>

              <div className="form-group">
                <label className="form-label">원장 기록 사유</label>
                <input
                  type="text"
                  className="input"
                  placeholder="예: 이벤트 포상 지급"
                  value={playerForm.reason}
                  onChange={(e) => setPlayerForm({ ...playerForm, reason: e.target.value })}
                />
              </div>

              <div style={{ padding: 12, background: 'var(--bg-tertiary)', borderRadius: 10, marginBottom: 18 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>
                  <input
                    type="checkbox"
                    checked={playerForm.is_hidden}
                    onChange={(e) => setPlayerForm({ ...playerForm, is_hidden: e.target.checked })}
                  />
                  <span>이 플레이어를 일반 랭킹 순위표에서 숨기기</span>
                </label>
              </div>

              <div style={{ display: 'flex', gap: 10 }}>
                <button type="button" className="btn btn-secondary" onClick={() => setEditingPlayer(null)} style={{ flex: 1 }}>
                  취소
                </button>
                <button type="submit" className="btn btn-primary" style={{ flex: 1 }}>
                  저장 적용
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 🔄 2. 랭킹 초기화 모달 */}
      {showResetModal && (
        <div className="modal-overlay">
          <div className="modal-content" style={{ maxWidth: 560 }}>
            <h2 style={{ fontSize: 18, fontWeight: 800, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 8, color: 'var(--danger)' }}>
              <RotateCcw size={20} />
              <span>시즌 및 랭킹 수치 초기화</span>
            </h2>
            <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 16 }}>
              원하는 범위를 선택하여 시즌 랭킹, 누적 포인트, 또는 크레딧을 초기화할 수 있습니다.
            </p>

            <form onSubmit={handleExecuteReset}>
              <div className="form-group">
                <label className="form-label">초기화 범위 선택</label>
                <select
                  className="select"
                  value={resetForm.scope}
                  onChange={(e) => setResetForm({ ...resetForm, scope: e.target.value })}
                >
                  <option value="season">1) 현재 선택된 시즌의 랭킹 점수만 0점으로 초기화 (상점 가용 포인트 유지)</option>
                  <option value="all_seasons">2) 모든 시즌의 랭킹 점수를 0점으로 초기화 (상점 가용 포인트 유지)</option>
                  <option value="total_points">3) 전체 플레이어의 누적 연방 포인트 + 현재 시즌 점수 모두 0P 초기화</option>
                  <option value="credits">4) 전체 플레이어의 보유 크레딧(C) 잔액만 0C로 초기화</option>
                  <option value="everything">5) [전체 리셋] 모든 시즌 점수 + 누적 포인트 + 보유 크레딧 완전 초기화</option>
                </select>
              </div>

              <div style={{ padding: 14, background: 'var(--bg-tertiary)', borderRadius: 10, marginBottom: 16 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13, fontWeight: 700 }}>
                  <input
                    type="checkbox"
                    checked={resetForm.create_new_season}
                    onChange={(e) => setResetForm({ ...resetForm, create_new_season: e.target.checked })}
                  />
                  <span>초기화와 동시에 새로운 시즌을 즉시 생성하고 활성화하기</span>
                </label>

                {resetForm.create_new_season && (
                  <div className="form-group" style={{ marginTop: 10, marginBottom: 0 }}>
                    <label className="form-label">새로 시작할 시즌 이름</label>
                    <input
                      type="text"
                      className="input"
                      placeholder="예: 제2회 연방 시즌"
                      value={resetForm.new_season_name}
                      onChange={(e) => setResetForm({ ...resetForm, new_season_name: e.target.value })}
                      required={resetForm.create_new_season}
                    />
                  </div>
                )}
              </div>

              <div className="form-group">
                <label className="form-label">초기화 사유 (원장 기록용)</label>
                <input
                  type="text"
                  className="input"
                  placeholder="예: 시즌 종료 및 새 시즌 개막"
                  value={resetForm.reason}
                  onChange={(e) => setResetForm({ ...resetForm, reason: e.target.value })}
                />
              </div>

              <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
                <button type="button" className="btn btn-secondary" onClick={() => setShowResetModal(false)} style={{ flex: 1 }}>
                  취소
                </button>
                <button type="submit" className="btn btn-danger" style={{ flex: 1 }}>
                  초기화 즉시 실행
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 🎛️ 3. 랭킹 설정 모달 (보드 설정 / 일괄 증감) */}
      {showAdminStudio && (
        <div className="modal-overlay">
          <div className="modal-content" style={{ maxWidth: 640 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <h2 style={{ fontSize: 18, fontWeight: 800, display: 'flex', alignItems: 'center', gap: 8 }}>
                <Sliders size={20} color="var(--primary)" />
                <span>랭킹 설정 및 일괄 조절</span>
              </h2>
              <button className="btn btn-secondary btn-sm" onClick={() => setShowAdminStudio(false)}>닫기</button>
            </div>

            <div style={{ display: 'flex', gap: 8, marginBottom: 20, borderBottom: '1px solid var(--border-color)', paddingBottom: 12 }}>
              <button
                type="button"
                className={`btn btn-sm ${studioTab === 'config' ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => setStudioTab('config')}
              >
                📢 안내 문구 & 획득 배율
              </button>
              <button
                type="button"
                className={`btn btn-sm ${studioTab === 'bulk' ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => setStudioTab('bulk')}
              >
                ⚡ 전 플레이어 일괄 수치 가감
              </button>
            </div>

            {studioTab === 'bulk' && (
              <form onSubmit={handleExecuteBulkAdjust}>
                <div className="form-group">
                  <label className="form-label">일괄 조절 작업 유형</label>
                  <select
                    className="select"
                    value={bulkForm.action_type}
                    onChange={(e) => setBulkForm({ ...bulkForm, action_type: e.target.value })}
                  >
                    <option value="add_season_points">현재 시즌 기본 점수 일괄 증감 (+ / -)</option>
                    <option value="add_bonus_points">현재 시즌 보너스 점수 일괄 증감 (+ / -)</option>
                    <option value="multiply_season_points">현재 시즌 점수 일괄 배율 곱하기 (예: 1.5배, 0.5배)</option>
                    <option value="add_total_points">모든 플레이어 누적 연방 포인트(상점 가용) 일괄 지급/차감</option>
                    <option value="add_credits">모든 플레이어 보유 크레딧(C) 일괄 지급/차감</option>
                  </select>
                </div>

                <div className="form-group">
                  <label className="form-label">적용할 수치 (차감 시 음수 - 입력, 배율 시 소수점 가능)</label>
                  <input
                    type="number"
                    step="any"
                    className="input"
                    value={bulkForm.value}
                    onChange={(e) => setBulkForm({ ...bulkForm, value: e.target.value })}
                    required
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">일괄 지급/조정 사유 (원장 기록용)</label>
                  <input
                    type="text"
                    className="input"
                    placeholder="예: 이벤트 전원 보상 지급"
                    value={bulkForm.reason}
                    onChange={(e) => setBulkForm({ ...bulkForm, reason: e.target.value })}
                  />
                </div>

                <button type="submit" className="btn btn-primary" style={{ width: '100%' }}>
                  전체 플레이어 일괄 수치 적용하기
                </button>
              </form>
            )}

            {studioTab === 'config' && (
              <form onSubmit={handleSaveConfig}>
                <div className="form-group">
                  <label className="form-label">시즌 랭킹 상단 안내 문구</label>
                  <textarea
                    className="textarea"
                    rows="2"
                    value={config.ranking_board_notice}
                    onChange={(e) => setConfig({ ...config, ranking_board_notice: e.target.value })}
                  />
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
                  <div className="form-group">
                    <label className="form-label">글로벌 포인트 획득 배율 (x배)</label>
                    <input
                      type="number"
                      step="0.1"
                      min="0.1"
                      className="input"
                      value={config.point_multiplier}
                      onChange={(e) => setConfig({ ...config, point_multiplier: e.target.value })}
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">글로벌 크레딧 획득 배율 (x배)</label>
                    <input
                      type="number"
                      step="0.1"
                      min="0.1"
                      className="input"
                      value={config.credit_multiplier}
                      onChange={(e) => setConfig({ ...config, credit_multiplier: e.target.value })}
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">랭킹 표시 최대 인원수</label>
                    <input
                      type="number"
                      min="10"
                      max="500"
                      className="input"
                      value={config.ranking_top_limit}
                      onChange={(e) => setConfig({ ...config, ranking_top_limit: e.target.value })}
                    />
                  </div>
                </div>

                <div className="form-group">
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>
                    <input
                      type="checkbox"
                      checked={config.ranking_show_credit_tab !== '0'}
                      onChange={(e) => setConfig({ ...config, ranking_show_credit_tab: e.target.checked ? '1' : '0' })}
                    />
                    <span>랭킹 화면에서 [크레딧(C) 순위] 탭 전환 허용</span>
                  </label>
                </div>

                <button type="submit" className="btn btn-primary" style={{ width: '100%' }}>
                  안내 문구 & 글로벌 수치 배율 저장
                </button>
              </form>
            )}
          </div>
        </div>
      )}

      {/* 🏆 4. 시즌 관리 모달 */}
      {showSeasonModal && (
        <div className="modal-overlay">
          <div className="modal-content" style={{ maxWidth: 640 }}>
            <h2 style={{ fontSize: 18, fontWeight: 800, marginBottom: 16 }}>
              🏆 시즌 생성 · 수정 · 관리
            </h2>

            <div style={{ marginBottom: 24, maxHeight: 240, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
              {seasons.map((s) => (
                <div key={s.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--bg-tertiary)', padding: '12px 16px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)' }}>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontWeight: 700 }}>{s.name}</span>
                      {s.is_active === 1 && <span className="badge badge-approved">현재 활성 시즌</span>}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                      기간: {s.start_date || '미정'} ~ {s.end_date || '미정'}
                    </div>
                    {s.reward_description && (
                      <div style={{ fontSize: 11, color: '#b45309', marginTop: 2 }}>보상: {s.reward_description}</div>
                    )}
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    {s.is_active !== 1 && (
                      <button className="btn btn-success btn-sm" onClick={() => handleActivateSeason(s.id)}>
                        활성화
                      </button>
                    )}
                    <button
                      className="btn btn-secondary btn-sm"
                      onClick={() => {
                        setEditingSeason(s);
                        setSeasonForm({
                          name: s.name,
                          start_date: s.start_date || '',
                          end_date: s.end_date || '',
                          reward_description: s.reward_description || ''
                        });
                      }}
                    >
                      수정
                    </button>
                    <button className="btn btn-danger btn-sm" onClick={() => handleDeleteSeason(s.id)}>
                      삭제
                    </button>
                  </div>
                </div>
              ))}
            </div>

            <form onSubmit={handleSaveSeason} style={{ borderTop: '1px solid var(--border-color)', paddingTop: 16 }}>
              <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 12 }}>
                {editingSeason ? `시즌 수정: ${editingSeason.name}` : '새 시즌 추가'}
              </h3>
              <div className="form-group">
                <label className="form-label">시즌명</label>
                <input
                  type="text"
                  className="input"
                  placeholder="예: 제2회 연방 시즌"
                  value={seasonForm.name}
                  onChange={(e) => setSeasonForm({ ...seasonForm, name: e.target.value })}
                  required
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div className="form-group">
                  <label className="form-label">시작일</label>
                  <input
                    type="date"
                    className="input"
                    value={seasonForm.start_date}
                    onChange={(e) => setSeasonForm({ ...seasonForm, start_date: e.target.value })}
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">종료일</label>
                  <input
                    type="date"
                    className="input"
                    value={seasonForm.end_date}
                    onChange={(e) => setSeasonForm({ ...seasonForm, end_date: e.target.value })}
                  />
                </div>
              </div>

              <div className="form-group">
                <label className="form-label">시즌 보상 안내 문구 (선택)</label>
                <input
                  type="text"
                  className="input"
                  placeholder="예: 1위 10만 크레딧 / 2위 5만 크레딧"
                  value={seasonForm.reward_description}
                  onChange={(e) => setSeasonForm({ ...seasonForm, reward_description: e.target.value })}
                />
              </div>

              <div style={{ display: 'flex', gap: 10, marginTop: 18 }}>
                <button type="button" className="btn btn-secondary" onClick={() => { setShowSeasonModal(false); setEditingSeason(null); }} style={{ flex: 1 }}>
                  닫기
                </button>
                {editingSeason && (
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => {
                      setEditingSeason(null);
                      setSeasonForm({ name: '', start_date: '', end_date: '', reward_description: '' });
                    }}
                  >
                    신규 등록 전환
                  </button>
                )}
                <button type="submit" className="btn btn-primary" style={{ flex: 1 }}>
                  {editingSeason ? '시즌 수정 저장' : '시즌 생성하기'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
