import React, { useState, useEffect } from 'react';
import { apiRequest } from '../api';
import { Trophy, Medal, Crown, Calendar, Plus, Check } from 'lucide-react';

export default function RankingTab({ user }) {
  const [seasons, setSeasons] = useState([]);
  const [selectedSeason, setSelectedSeason] = useState('all');
  const [ranking, setRanking] = useState([]);
  const [loading, setLoading] = useState(true);

  // 시즌 추가 모달 (슈퍼관리자)
  const [showSeasonModal, setShowSeasonModal] = useState(false);
  const [newSeason, setNewSeason] = useState({ name: '', start_date: '', end_date: '' });

  const loadData = async () => {
    try {
      setLoading(true);
      const seasonsData = await apiRequest('/seasons');
      setSeasons(seasonsData);

      // 활성 시즌이 있으면 기본값으로 설정
      if (selectedSeason === 'all') {
        const active = seasonsData.find(s => s.is_active === 1);
        if (active) setSelectedSeason(active.id.toString());
      }

      await loadRanking(selectedSeason === 'all' ? (seasonsData.find(s => s.is_active === 1)?.id?.toString() || 'all') : selectedSeason);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const loadRanking = async (seasonId) => {
    try {
      const data = await apiRequest(`/ranking?season_id=${seasonId}`);
      setRanking(data);
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
    loadRanking(val);
  };

  const handleCreateSeason = async (e) => {
    e.preventDefault();
    try {
      await apiRequest('/seasons', {
        method: 'POST',
        body: JSON.stringify(newSeason)
      });
      alert('새 시즌이 등록되었습니다.');
      setShowSeasonModal(false);
      setNewSeason({ name: '', start_date: '', end_date: '' });
      loadData();
    } catch (err) {
      alert(err.message);
    }
  };

  const handleActivateSeason = async (id) => {
    try {
      await apiRequest(`/seasons/${id}/activate`, { method: 'PUT' });
      alert('활성 시즌으로 지정되었습니다.');
      loadData();
    } catch (err) {
      alert(err.message);
    }
  };

  const getRankBadge = (index) => {
    if (index === 0) return <div style={{ width: 28, height: 28, borderRadius: '50%', background: '#f59e0b', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 13 }}><Crown size={16} /></div>;
    if (index === 1) return <div style={{ width: 28, height: 28, borderRadius: '50%', background: '#94a3b8', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 13 }}>2</div>;
    if (index === 2) return <div style={{ width: 28, height: 28, borderRadius: '50%', background: '#d97706', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 13 }}>3</div>;
    return <div style={{ width: 28, height: 28, borderRadius: '50%', background: 'var(--bg-tertiary)', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 12 }}>{index + 1}</div>;
  };

  const maxPoints = ranking.length > 0 ? Math.max(...ranking.map(r => r.points || 0), 1) : 1;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div>
          <h2 style={{ fontSize: 20, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 10 }}>
            <Trophy color="#f59e0b" size={24} />
            <span>연방 기여도 시즌 랭킹</span>
          </h2>
          <p style={{ color: '#94a3b8', fontSize: 13, marginTop: 4 }}>
            납품, 단기 알바, 퀘스트를 통해 획득한 연방 포인트 순위입니다.
          </p>
        </div>

        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <select
            className="select"
            value={selectedSeason}
            onChange={handleSeasonChange}
            style={{ width: 220 }}
          >
            <option value="all">🌐 전 시즌 통합 누적</option>
            {seasons.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} {s.is_active === 1 ? '(현재 진행 중)' : ''}
              </option>
            ))}
          </select>

          {user.is_admin && (
            <button className="btn btn-secondary" onClick={() => setShowSeasonModal(true)}>
              <Plus size={16} /> 시즌 관리
            </button>
          )}
        </div>
      </div>

      {/* Top 3 포디움 */}
      {ranking.length >= 3 && (
        <div style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1.2fr 1fr',
          gap: 16,
          marginBottom: 32,
          alignItems: 'flex-end'
        }}>
          {/* 2위 */}
          <div className="card" style={{ textAlign: 'center', padding: '24px 16px', background: 'rgba(30, 41, 59, 0.4)', borderTop: '3px solid #94a3b8' }}>
            <div style={{ width: 44, height: 44, borderRadius: '50%', background: '#94a3b8', margin: '0 auto 10px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 800 }}>
              2위
            </div>
            <h3 style={{ fontSize: 16, fontWeight: 700 }}>{ranking[1].nickname || ranking[1].username}</h3>
            <span style={{ fontSize: 12, color: '#64748b' }}>@{ranking[1].username}</span>
            <div className="asset-pill point" style={{ justifyContent: 'center', marginTop: 12 }}>
              {ranking[1].points.toLocaleString()} P
            </div>
          </div>

          {/* 1위 */}
          <div className="card" style={{ textAlign: 'center', padding: '32px 16px', background: 'rgba(245, 158, 11, 0.08)', border: '1px solid rgba(245, 158, 11, 0.3)', borderTop: '4px solid #f59e0b' }}>
            <Crown size={32} color="#f59e0b" style={{ margin: '0 auto 8px' }} />
            <div style={{ width: 50, height: 50, borderRadius: '50%', background: '#f59e0b', margin: '0 auto 10px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 800, fontSize: 18 }}>
              1위
            </div>
            <h3 style={{ fontSize: 18, fontWeight: 800, color: '#fbbf24' }}>{ranking[0].nickname || ranking[0].username}</h3>
            <span style={{ fontSize: 12, color: '#94a3b8' }}>@{ranking[0].username}</span>
            <div className="asset-pill point" style={{ justifyContent: 'center', marginTop: 14, fontSize: 15, fontWeight: 700 }}>
              {ranking[0].points.toLocaleString()} P
            </div>
          </div>

          {/* 3위 */}
          <div className="card" style={{ textAlign: 'center', padding: '20px 16px', background: 'rgba(30, 41, 59, 0.4)', borderTop: '3px solid #d97706' }}>
            <div style={{ width: 44, height: 44, borderRadius: '50%', background: '#d97706', margin: '0 auto 10px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 800 }}>
              3위
            </div>
            <h3 style={{ fontSize: 16, fontWeight: 700 }}>{ranking[2].nickname || ranking[2].username}</h3>
            <span style={{ fontSize: 12, color: '#64748b' }}>@{ranking[2].username}</span>
            <div className="asset-pill point" style={{ justifyContent: 'center', marginTop: 12 }}>
              {ranking[2].points.toLocaleString()} P
            </div>
          </div>
        </div>
      )}

      {/* 전체 순위 리스트 */}
      <div className="card">
        <div className="table-container">
          <table className="table">
            <thead>
              <tr>
                <th style={{ width: 80 }}>순위</th>
                <th>플레이어</th>
                <th>기여도 그래프</th>
                <th style={{ textAlign: 'right', width: 140 }}>연방 포인트</th>
              </tr>
            </thead>
            <tbody>
              {ranking.length === 0 ? (
                <tr>
                  <td colSpan={4} style={{ textAlign: 'center', padding: 30, color: '#64748b' }}>
                    등록된 기여도 데이터가 없습니다.
                  </td>
                </tr>
              ) : (
                ranking.map((row, idx) => {
                  const percent = Math.max(5, Math.min(100, (row.points / maxPoints) * 100));
                  const isMe = row.id === user.id;

                  return (
                    <tr key={row.id} style={{ background: isMe ? 'rgba(59, 130, 246, 0.08)' : undefined }}>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          {getRankBadge(idx)}
                        </div>
                      </td>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <div>
                            <span style={{ fontWeight: 600, color: isMe ? 'var(--primary)' : 'var(--text-main)' }}>
                              {row.nickname || row.username} {isMe ? '(나)' : ''}
                            </span>
                            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>@{row.username}</div>
                          </div>
                        </div>
                      </td>
                      <td>
                        <div style={{ width: '100%', height: 8, background: 'var(--bg-tertiary)', borderRadius: 4, overflow: 'hidden' }}>
                          <div style={{ width: `${percent}%`, height: '100%', background: idx === 0 ? '#f59e0b' : 'var(--primary)', borderRadius: 4, transition: 'width 0.4s ease' }} />
                        </div>
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <span style={{ fontWeight: 700, color: 'var(--point-gold)', fontSize: 15 }}>
                          {row.points.toLocaleString()} P
                        </span>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* 시즌 관리 모달 (슈퍼관리자) */}
      {showSeasonModal && (
        <div className="modal-overlay">
          <div className="modal-content" style={{ maxWidth: 650 }}>
            <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 16 }}>
              🏆 시즌 관리 (슈퍼 관리자)
            </h2>

            <div style={{ marginBottom: 24 }}>
              <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 8, color: 'var(--text-secondary)' }}>
                기존 시즌 목록
              </h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {seasons.map((s) => (
                  <div key={s.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--bg-tertiary)', padding: '12px 16px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)' }}>
                    <div>
                      <span style={{ fontWeight: 600 }}>{s.name}</span>
                      <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                        {s.start_date || '미정'} ~ {s.end_date || '미정'}
                      </div>
                    </div>
                    <div>
                      {s.is_active === 1 ? (
                        <span className="badge badge-approved">현재 활성 시즌</span>
                      ) : (
                        <button className="btn btn-secondary btn-sm" onClick={() => handleActivateSeason(s.id)}>
                          활성화
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <form onSubmit={handleCreateSeason}>
              <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 10, color: '#94a3b8' }}>
                새 시즌 추가
              </h3>
              <div className="form-group">
                <label className="form-label">시즌명</label>
                <input
                  type="text"
                  className="input"
                  placeholder="예: 제2회 연방 대전쟁 시즌"
                  value={newSeason.name}
                  onChange={(e) => setNewSeason({ ...newSeason, name: e.target.value })}
                  required
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div className="form-group">
                  <label className="form-label">시작일</label>
                  <input
                    type="date"
                    className="input"
                    value={newSeason.start_date}
                    onChange={(e) => setNewSeason({ ...newSeason, start_date: e.target.value })}
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">종료일</label>
                  <input
                    type="date"
                    className="input"
                    value={newSeason.end_date}
                    onChange={(e) => setNewSeason({ ...newSeason, end_date: e.target.value })}
                  />
                </div>
              </div>

              <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
                <button type="button" className="btn btn-secondary" onClick={() => setShowSeasonModal(false)} style={{ flex: 1 }}>
                  닫기
                </button>
                <button type="submit" className="btn btn-primary" style={{ flex: 1 }}>
                  시즌 생성하기
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
