import React, { useState, useEffect } from 'react';
import { apiRequest } from '../api';
import { Coins, ArrowRightLeft, CheckCircle, XCircle, AlertCircle, Clock } from 'lucide-react';

export default function CreditTab({ user, refreshUser }) {
  const [exchanges, setExchanges] = useState([]);
  const [amount, setAmount] = useState('');
  const [inGameName, setInGameName] = useState(user.nickname || user.username || '');
  const [loading, setLoading] = useState(true);
  const [adminComment, setAdminComment] = useState({});

  const canManageCredit = user.is_admin || user.roles?.includes('크레딧 관리');

  const loadData = async () => {
    try {
      setLoading(true);
      const data = await apiRequest('/credits/exchanges');
      setExchanges(data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleRequestExchange = async (e) => {
    e.preventDefault();
    const num = Number(amount);
    if (!num || num <= 0) {
      alert('환전할 크레딧 금액을 올바르게 입력해주세요.');
      return;
    }
    if (num > (user.credits || 0)) {
      alert('보유 중인 크레딧보다 많은 금액을 환전할 수 없습니다.');
      return;
    }
    if (!inGameName) {
      alert('수령할 인게임 닉네임을 입력해주세요.');
      return;
    }

    try {
      await apiRequest('/credits/exchanges', {
        method: 'POST',
        body: JSON.stringify({ amount: num, in_game_name: inGameName })
      });
      alert('인게임 원화(₩) 환전 신청이 완료되었습니다! 크레딧 관리자가 인게임으로 직접 지급 후 처리합니다.');
      setAmount('');
      loadData();
      if (refreshUser) refreshUser();
    } catch (err) {
      alert(err.message);
    }
  };

  const handleReview = async (id, status) => {
    const comment = adminComment[id] || '';
    if (!confirm(`이 환전 신청을 인게임 송금 확인 후 [${status === 'completed' ? '지급 완료' : '거절(환불)'}] 처리하시겠습니까?`)) return;

    try {
      await apiRequest(`/credits/exchanges/${id}/review`, {
        method: 'PUT',
        body: JSON.stringify({ status, admin_comment: comment })
      });
      alert(`환전 요청이 ${status === 'completed' ? '지급 완료' : '거절(크레딧 환불)'} 처리되었습니다.`);
      loadData();
      if (refreshUser) refreshUser();
    } catch (err) {
      alert(err.message);
    }
  };

  return (
    <div>
      <div style={{ marginBottom: 24 }}>
        <h2 style={{ fontSize: 20, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 10 }}>
          <Coins color="#34d399" size={24} />
          <span>크레딧 ↔ 인게임 화폐('원') 환전소</span>
        </h2>
        <p style={{ color: '#94a3b8', fontSize: 13, marginTop: 4 }}>
          웹사이트에서 획득한 임시 크레딧을 인게임 공식 화폐인 '원'으로 환전 신청하세요.
        </p>
      </div>

      {/* 보유 크레딧 카드 & 환전 신청 폼 */}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(300px, 380px) 1fr', gap: 24, marginBottom: 36 }}>
        {/* 잔액 표시 */}
        <div className="card" style={{ background: '#ffffff', border: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', boxShadow: 'var(--shadow-sm)' }}>
          <div>
            <span style={{ fontSize: 13, color: 'var(--text-muted)', fontWeight: 600 }}>내 보유 크레딧 잔액</span>
            <div style={{ fontSize: 32, fontWeight: 800, color: 'var(--point-emerald)', margin: '8px 0 16px' }}>
              {user.credits?.toLocaleString() || 0} <span style={{ fontSize: 18 }}>Credit</span>
            </div>
            <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
              💡 1 크레딧은 인게임 화폐 1원(₩)에 상응합니다.<br />
              환전 신청 시 관리자가 확인 후 인게임에서 직접 페이합니다.
            </div>
          </div>

          <div style={{ marginTop: 24, padding: 14, borderRadius: 'var(--radius-md)', background: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', fontSize: 13, color: 'var(--text-secondary)' }}>
            연계 인게임 닉네임: <strong style={{ color: 'var(--text-main)' }}>{user.nickname || user.username}</strong>
          </div>
        </div>

        {/* 환전 신청 폼 */}
        <div className="card">
          <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-main)' }}>
            <ArrowRightLeft size={18} color="var(--primary)" />
            <span>인게임 화폐 변경 신청</span>
          </h3>
          <form onSubmit={handleRequestExchange}>
            <div className="form-group">
              <label className="form-label">환전 요청 크레딧 수량</label>
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  type="number"
                  min="1"
                  max={user.credits || 0}
                  className="input"
                  placeholder="환전할 크레딧 입력"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  required
                />
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setAmount(user.credits || 0)}
                  style={{ whiteSpace: 'nowrap' }}
                >
                  전액
                </button>
              </div>
            </div>

            <div className="form-group">
              <label className="form-label">지급받을 인게임 닉네임</label>
              <input
                type="text"
                className="input"
                placeholder="인게임 닉네임 입력"
                value={inGameName}
                onChange={(e) => setInGameName(e.target.value)}
                required
              />
            </div>

            <button
              type="submit"
              className="btn btn-primary"
              style={{ width: '100%', marginTop: 8 }}
              disabled={(user.credits || 0) <= 0}
            >
              인게임 '원' 환전 요청 제출
            </button>
          </form>
        </div>
      </div>

      {/* 환전 신청 내역 및 심사 목록 */}
      <div className="card">
        <div className="card-header">
          <div className="card-title">
            <Clock size={20} color="#34d399" />
            <span>{canManageCredit ? '크레딧 환전 요청 심사 및 직접 페이 대기열' : '내 환전 신청 내역'}</span>
          </div>
        </div>

        <div className="table-container">
          <table className="table">
            <thead>
              <tr>
                <th>요청 번호</th>
                <th>신청자</th>
                <th>인게임 닉네임</th>
                <th>환전 요청 금액</th>
                <th>신청 일시</th>
                <th>상태</th>
                {canManageCredit && <th>직접 페이 처리</th>}
              </tr>
            </thead>
            <tbody>
              {exchanges.length === 0 ? (
                <tr>
                  <td colSpan={canManageCredit ? 7 : 6} style={{ textAlign: 'center', padding: 24, color: '#64748b' }}>
                    환전 신청 내역이 없습니다.
                  </td>
                </tr>
              ) : (
                exchanges.map((ex) => (
                  <tr key={ex.id}>
                    <td>#{ex.id}</td>
                    <td>
                      <span style={{ fontWeight: 600 }}>{ex.nickname || ex.username}</span>
                      <div style={{ fontSize: 11, color: '#64748b' }}>@{ex.username}</div>
                    </td>
                    <td><span style={{ fontWeight: 600, color: '#38bdf8' }}>{ex.in_game_name}</span></td>
                    <td><span style={{ color: '#34d399', fontWeight: 700, fontSize: 15 }}>{ex.amount.toLocaleString()} 원</span></td>
                    <td style={{ fontSize: 13, color: '#94a3b8' }}>{ex.created_at}</td>
                    <td>
                      {ex.status === 'pending' && <span className="badge badge-pending">송금 대기중</span>}
                      {ex.status === 'completed' && <span className="badge badge-approved">페이 완료</span>}
                      {ex.status === 'rejected' && <span className="badge badge-rejected">거절(환불됨)</span>}
                      {ex.admin_comment && (
                        <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 4 }}>
                          비고: {ex.admin_comment}
                        </div>
                      )}
                    </td>
                    {canManageCredit && (
                      <td>
                        {ex.status === 'pending' ? (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 160 }}>
                            <input
                              type="text"
                              className="input"
                              placeholder="지급 메모/계좌 (선택)"
                              style={{ padding: '4px 8px', fontSize: 12 }}
                              value={adminComment[ex.id] || ''}
                              onChange={(e) => setAdminComment({ ...adminComment, [ex.id]: e.target.value })}
                            />
                            <div style={{ display: 'flex', gap: 6 }}>
                              <button className="btn btn-success btn-sm" style={{ flex: 1 }} onClick={() => handleReview(ex.id, 'completed')}>
                                <CheckCircle size={13} /> 직접 페이 완료
                              </button>
                              <button className="btn btn-danger btn-sm" style={{ flex: 1 }} onClick={() => handleReview(ex.id, 'rejected')}>
                                <XCircle size={13} /> 거절
                              </button>
                            </div>
                          </div>
                        ) : (
                          <span style={{ fontSize: 12, color: '#64748b' }}>처리 완료</span>
                        )}
                      </td>
                    )}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
