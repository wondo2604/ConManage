import React, { useState, useEffect } from 'react';
import { apiRequest, getAuthToken } from '../api';
import {
  Coins, ArrowRightLeft, CheckCircle, XCircle, Clock, PlusCircle,
  Image, FileSpreadsheet, Download, Search, Filter, Sliders, Sparkles, Plus
} from 'lucide-react';

export default function CreditTab({ user, refreshUser }) {
  const [subTab, setSubTab] = useState('charge'); // 'charge' | 'exchange' | 'ledger'
  const [charges, setCharges] = useState([]);
  const [exchanges, setExchanges] = useState([]);
  const [transactions, setTransactions] = useState([]);
  const [txSummary, setTxSummary] = useState({
    total_point_in: 0,
    total_point_out: 0,
    total_credit_in: 0,
    total_credit_out: 0,
    total_count: 0
  });
  const [config, setConfig] = useState({
    exchange_rate: '1.0',
    min_exchange_amount: '100',
    exchange_fee_percent: '0',
    credit_charge_notice: ''
  });
  const [loading, setLoading] = useState(true);

  // 1) 크레딧 충전 신청 폼 (닉네임, 충전할 크레딧, 증거 사진, 일시, 기타 사항)
  const [chargeForm, setChargeForm] = useState({
    nickname: user.nickname || user.username || '',
    amount: '',
    charge_datetime: new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16).replace('T', ' '),
    notes: '',
    proof_image: null
  });

  // 충전 심사 상태 (지급 크레딧, 보너스 포인트, 코멘트)
  const [chargeReviewAmount, setChargeReviewAmount] = useState({});
  const [chargeReviewBonusPts, setChargeReviewBonusPts] = useState({});
  const [chargeReviewComment, setChargeReviewComment] = useState({});

  // 2) 크레딧 환전 신청 폼
  const [exchangeAmount, setExchangeAmount] = useState('');
  const [inGameName, setInGameName] = useState(user.nickname || user.username || '');
  const [exchangeAdminComment, setExchangeAdminComment] = useState({});

  // 3) 입출금 상세 원장 필터
  const [txFilters, setTxFilters] = useState({
    asset_type: 'ALL',
    tx_type: 'ALL',
    search: '',
    start_date: '',
    end_date: ''
  });

  // 정책 설정 모달 ('크레딧 관리')
  const [showConfigModal, setShowConfigModal] = useState(false);

  const canManageCredit = user.is_admin || user.permissions?.includes('크레딧 관리');
  const canManageData = user.is_admin || user.permissions?.includes('데이터 관리');

  const loadData = async () => {
    try {
      setLoading(true);
      const [chargesData, exchangesData, cfgData, txData] = await Promise.all([
        apiRequest('/credits/charges'),
        apiRequest('/credits/exchanges'),
        apiRequest('/credits/config'),
        apiRequest(`/transactions?asset_type=${txFilters.asset_type}&tx_type=${txFilters.tx_type}&search=${encodeURIComponent(txFilters.search)}&start_date=${txFilters.start_date}&end_date=${txFilters.end_date}`)
      ]);
      setCharges(chargesData);
      setExchanges(exchangesData);
      setConfig(cfgData);
      setTransactions(txData.transactions || []);
      setTxSummary(txData.summary || {
        total_point_in: 0,
        total_point_out: 0,
        total_credit_in: 0,
        total_credit_out: 0,
        total_count: 0
      });

      const defaultAmts = {};
      chargesData.forEach(c => {
        if (c.status === 'pending') {
          defaultAmts[c.id] = c.amount;
        }
      });
      setChargeReviewAmount(prev => ({ ...defaultAmts, ...prev }));
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const loadLedgerOnly = async (overrideFilters = txFilters) => {
    try {
      const txData = await apiRequest(
        `/transactions?asset_type=${overrideFilters.asset_type}&tx_type=${overrideFilters.tx_type}&search=${encodeURIComponent(overrideFilters.search)}&start_date=${overrideFilters.start_date}&end_date=${overrideFilters.end_date}`
      );
      setTransactions(txData.transactions || []);
      setTxSummary(txData.summary || txSummary);
    } catch (err) {
      console.error(err);
    }
  };

  // 크레딧 충전 신청 제출
  const handleSubmitCharge = async (e) => {
    e.preventDefault();
    const num = Number(chargeForm.amount);
    if (!chargeForm.nickname.trim()) {
      alert('닉네임을 입력해주세요.');
      return;
    }
    if (!num || num <= 0) {
      alert('충전할 크레딧 수량을 올바르게 입력해주세요.');
      return;
    }
    if (!chargeForm.proof_image) {
      alert('증거 사진(스크린샷)을 첨부해주세요.');
      return;
    }
    if (!chargeForm.charge_datetime.trim()) {
      alert('충전/송금 일시를 입력해주세요.');
      return;
    }

    try {
      const formData = new FormData();
      formData.append('nickname', chargeForm.nickname);
      formData.append('amount', num);
      formData.append('charge_datetime', chargeForm.charge_datetime);
      formData.append('notes', chargeForm.notes || '');
      formData.append('proof_image', chargeForm.proof_image);

      const res = await apiRequest('/credits/charges', {
        method: 'POST',
        body: formData
      });
      alert(res.message || '크레딧 충전 신청이 완료되었습니다!');
      setChargeForm({
        ...chargeForm,
        amount: '',
        notes: '',
        proof_image: null
      });
      loadData();
    } catch (err) {
      alert(err.message);
    }
  };

  // 크레딧 충전 심사 ('크레딧 관리')
  const handleReviewCharge = async (chargeItem, status) => {
    const id = chargeItem.id;
    const customAmt = chargeReviewAmount[id] ?? chargeItem.amount;
    const bonusPts = chargeReviewBonusPts[id] || 0;
    const comment = chargeReviewComment[id] || '';

    const msg = status === 'approved'
      ? `이 충전 신청을 승인하시겠습니까?\n충전 크레딧: +${Number(customAmt).toLocaleString()} C${Number(bonusPts) ? ` / 보너스 포인트: +${Number(bonusPts)} P` : ''}`
      : `이 충전 신청을 거절하시겠습니까?`;
    if (!confirm(msg)) return;

    try {
      const res = await apiRequest(`/credits/charges/${id}/review`, {
        method: 'PUT',
        body: JSON.stringify({
          status,
          custom_amount: customAmt,
          bonus_points: bonusPts,
          admin_comment: comment
        })
      });
      alert(res.message);
      loadData();
      if (refreshUser) refreshUser();
    } catch (err) {
      alert(err.message);
    }
  };

  // 크레딧 환전 신청 제출
  const handleRequestExchange = async (e) => {
    e.preventDefault();
    const num = Number(exchangeAmount);
    if (!num || num <= 0) {
      alert('환전할 크레딧 금액을 올바르게 입력해주세요.');
      return;
    }
    if (num > (user.credits || 0)) {
      alert('보유 중인 크레딧보다 많은 금액을 환전할 수 없습니다.');
      return;
    }
    if (!inGameName.trim()) {
      alert('수령할 인게임 닉네임을 입력해주세요.');
      return;
    }

    try {
      await apiRequest('/credits/exchanges', {
        method: 'POST',
        body: JSON.stringify({ amount: num, in_game_name: inGameName })
      });
      alert('인게임 원화(₩) 환전 신청이 완료되었습니다! 크레딧 관리자가 인게임으로 직접 지급 후 처리합니다.');
      setExchangeAmount('');
      loadData();
      if (refreshUser) refreshUser();
    } catch (err) {
      alert(err.message);
    }
  };

  // 크레딧 환전 심사 ('크레딧 관리')
  const handleReviewExchange = async (id, status) => {
    const comment = exchangeAdminComment[id] || '';
    if (!confirm(`이 환전 신청을 [${status === 'completed' ? '지급 완료' : '거절(환불)'}] 처리하시겠습니까?`)) return;

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

  // 정책 설정 저장
  const handleSaveConfig = async (e) => {
    e.preventDefault();
    try {
      const res = await apiRequest('/credits/config', {
        method: 'PUT',
        body: JSON.stringify(config)
      });
      alert(res.message);
      setShowConfigModal(false);
      loadData();
    } catch (err) {
      alert(err.message);
    }
  };

  // '데이터 관리' 권한자 CSV / XLSX 다운로드
  const handleExportLedger = async (format) => {
    try {
      const token = getAuthToken();
      const query = new URLSearchParams({
        format,
        asset_type: txFilters.asset_type,
        tx_type: txFilters.tx_type,
        search: txFilters.search,
        start_date: txFilters.start_date,
        end_date: txFilters.end_date
      }).toString();

      const res = await fetch(`/api/transactions/export?${query}`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new Error(err?.error || `다운로드 실패 (${res.status})`);
      }

      const blob = await res.blob();
      const disposition = res.headers.get('Content-Disposition');
      let filename = `federation-asset-ledger.${format}`;
      if (disposition && disposition.includes('filename=')) {
        const matches = disposition.match(/filename="?([^"]+)"?/);
        if (matches && matches[1]) filename = matches[1];
      }

      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      a.remove();
    } catch (err) {
      alert(err.message);
    }
  };

  return (
    <div>
      {/* 상단 타이틀 & 탭 전환 */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24, flexWrap: 'wrap', gap: 14 }}>
        <div>
          <h2 style={{ fontSize: 20, fontWeight: 800, display: 'flex', alignItems: 'center', gap: 10 }}>
            <Coins color="#059669" size={24} />
            <span>PlanetEarth 크레딧 충전 · 인게임 화폐 환전 · 입출금 원장</span>
          </h2>
          <p style={{ color: 'var(--text-muted)', fontSize: 13, marginTop: 4 }}>
            PlanetEarth 서버 인게임 송금 증빙으로 크레딧을 충전하거나, 보유 크레딧을 인게임 화폐로 환전하고 모든 포인트/크레딧 입출금 기록을 확인하세요.
          </p>
        </div>

        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', background: 'var(--bg-tertiary)', padding: 4, borderRadius: 'var(--radius-pill)', border: '1px solid var(--border-color)' }}>
            <button
              type="button"
              className={`btn btn-sm ${subTab === 'charge' ? 'btn-primary' : ''}`}
              style={{ background: subTab === 'charge' ? undefined : 'transparent', color: subTab === 'charge' ? undefined : 'var(--text-secondary)' }}
              onClick={() => setSubTab('charge')}
            >
              <PlusCircle size={14} /> 크레딧 충전 창구
            </button>
            <button
              type="button"
              className={`btn btn-sm ${subTab === 'exchange' ? 'btn-primary' : ''}`}
              style={{ background: subTab === 'exchange' ? undefined : 'transparent', color: subTab === 'exchange' ? undefined : 'var(--text-secondary)' }}
              onClick={() => setSubTab('exchange')}
            >
              <ArrowRightLeft size={14} /> 인게임 원화 환전소
            </button>
            <button
              type="button"
              className={`btn btn-sm ${subTab === 'ledger' ? 'btn-primary' : ''}`}
              style={{ background: subTab === 'ledger' ? undefined : 'transparent', color: subTab === 'ledger' ? undefined : 'var(--text-secondary)' }}
              onClick={() => setSubTab('ledger')}
            >
              <FileSpreadsheet size={14} /> 포인트/크레딧 입출금 내역
            </button>
          </div>

          {canManageCredit && (
            <button className="btn btn-secondary btn-sm" onClick={() => setShowConfigModal(true)}>
              <Sliders size={14} /> 크레딧 수치/정책 설정
            </button>
          )}
        </div>
      </div>

      {/* 상단 내 보유 자산 요약 배너 */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 16, marginBottom: 28 }}>
        <div className="card" style={{ marginBottom: 0, padding: '18px 22px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <span style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 700 }}>내 보유 크레딧 잔액</span>
            <div style={{ fontSize: 28, fontWeight: 900, color: 'var(--point-emerald)', marginTop: 4 }}>
              {(user.credits || 0).toLocaleString()} <span style={{ fontSize: 15 }}>Credit</span>
            </div>
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)', textAlign: 'right' }}>
            <div>환전 비율: <strong>1 C = {config.exchange_rate || 1} 원(₩)</strong></div>
            <div>최소 환전: <strong>{Number(config.min_exchange_amount || 100).toLocaleString()} C</strong></div>
          </div>
        </div>

        <div className="card" style={{ marginBottom: 0, padding: '18px 22px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <span style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 700 }}>내 보유 국가 기여 포인트</span>
            <div style={{ fontSize: 28, fontWeight: 900, color: 'var(--point-gold)', marginTop: 4 }}>
              {(user.points || 0).toLocaleString()} <span style={{ fontSize: 15 }}>Point</span>
            </div>
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)', textAlign: 'right' }}>
            <div>연계 닉네임: <strong>{user.nickname || user.username}</strong></div>
            <div style={{ color: 'var(--primary)', fontWeight: 600 }}>모든 입출금 DB 실시간 기록 중</div>
          </div>
        </div>
      </div>

      {/* =========================================================
          TAB 1: 크레딧 충전 신청 창구 (닉네임, 충전할 크레딧, 증거 사진, 일시, 기타 사항)
         ========================================================= */}
      {subTab === 'charge' && (
        <div>
          <div className="card" style={{ marginBottom: 28, borderLeft: '4px solid #059669' }}>
            <h3 style={{ fontSize: 17, fontWeight: 800, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 8, color: '#065f46' }}>
              <PlusCircle size={20} color="#059669" />
              <span>크레딧 충전 신청 창구</span>
            </h3>
            <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 20 }}>
              {config.credit_charge_notice || '단기 알바나 납품 외에도 인게임 송금, 이벤트, 특별 거래 등 증거 사진과 일시를 첨부하여 크레딧 충전을 직접 신청할 수 있습니다.'}
            </p>

            <form onSubmit={handleSubmitCharge}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16 }}>
                <div className="form-group">
                  <label className="form-label">1) 인게임 닉네임</label>
                  <input
                    type="text"
                    className="input"
                    placeholder="마인크래프트 닉네임 입력"
                    value={chargeForm.nickname}
                    onChange={(e) => setChargeForm({ ...chargeForm, nickname: e.target.value })}
                    required
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">2) 충전할 크레딧 (C)</label>
                  <input
                    type="number"
                    min="1"
                    className="input"
                    placeholder="예: 10000"
                    value={chargeForm.amount}
                    onChange={(e) => setChargeForm({ ...chargeForm, amount: e.target.value })}
                    required
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">3) 송금 / 발생 일시</label>
                  <input
                    type="text"
                    className="input"
                    placeholder="예: 2026-10-22 22:30"
                    value={chargeForm.charge_datetime}
                    onChange={(e) => setChargeForm({ ...chargeForm, charge_datetime: e.target.value })}
                    required
                  />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                <div className="form-group">
                  <label className="form-label">4) 증거 사진 첨부 (스크린샷 필수)</label>
                  <input
                    type="file"
                    accept="image/*"
                    className="input"
                    onChange={(e) => setChargeForm({ ...chargeForm, proof_image: e.target.files[0] })}
                    required
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">5) 기타 사항 (직접 입력)</label>
                  <input
                    type="text"
                    className="input"
                    placeholder="입금 경위, 입금자명, 특이사항 등 자유 기재"
                    value={chargeForm.notes}
                    onChange={(e) => setChargeForm({ ...chargeForm, notes: e.target.value })}
                  />
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
                <button type="submit" className="btn btn-success" style={{ padding: '11px 28px' }}>
                  <PlusCircle size={16} /> 크레딧 충전 신청 제출하기
                </button>
              </div>
            </form>
          </div>

          {/* 충전 신청 내역 및 관리자 심사 테이블 */}
          <div className="card">
            <div className="card-header">
              <div className="card-title">
                <Clock size={20} color="#059669" />
                <span>{canManageCredit ? '크레딧 충전 신청 심사 및 승인 관리' : '내 크레딧 충전 신청 내역'}</span>
              </div>
            </div>

            <div className="table-container">
              <table className="table">
                <thead>
                  <tr>
                    <th>번호</th>
                    <th>신청 계정 / 닉네임</th>
                    <th>신청 크레딧</th>
                    <th>증거 사진</th>
                    <th>발생 일시</th>
                    <th>기타 사항</th>
                    <th>상태 / 지급 결과</th>
                    {canManageCredit && <th>크레딧 관리자 심사 (수치 조절 가능)</th>}
                  </tr>
                </thead>
                <tbody>
                  {charges.length === 0 ? (
                    <tr>
                      <td colSpan={canManageCredit ? 8 : 7} style={{ textAlign: 'center', padding: 28, color: 'var(--text-muted)' }}>
                        크레딧 충전 신청 내역이 없습니다.
                      </td>
                    </tr>
                  ) : (
                    charges.map((ch) => (
                      <tr key={ch.id}>
                        <td>#{ch.id}</td>
                        <td>
                          <span style={{ fontWeight: 700, color: 'var(--text-main)' }}>{ch.nickname}</span>
                          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>@{ch.username}</div>
                        </td>
                        <td>
                          <span style={{ color: 'var(--point-emerald)', fontWeight: 800, fontSize: 15 }}>
                            +{ch.amount.toLocaleString()} C
                          </span>
                        </td>
                        <td>
                          {ch.proof_image ? (
                            <a href={ch.proof_image} target="_blank" rel="noreferrer" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: 'var(--primary)', fontWeight: 600, fontSize: 13, textDecoration: 'none' }}>
                              <Image size={14} /> 증거 사진 보기
                            </a>
                          ) : (
                            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>없음</span>
                          )}
                        </td>
                        <td style={{ fontSize: 13 }}>{ch.charge_datetime}</td>
                        <td style={{ fontSize: 13, color: 'var(--text-secondary)', maxWidth: 220 }}>{ch.notes || '-'}</td>
                        <td>
                          {ch.status === 'pending' && <span className="badge badge-pending">충전 심사 대기중</span>}
                          {ch.status === 'approved' && (
                            <div>
                              <span className="badge badge-approved">충전 완료 (+{(ch.approved_amount || ch.amount).toLocaleString()} C)</span>
                              {ch.bonus_points > 0 && (
                                <div style={{ fontSize: 11, color: 'var(--point-gold)', fontWeight: 700, marginTop: 2 }}>
                                  +보너스 {ch.bonus_points} P 지급됨
                                </div>
                              )}
                            </div>
                          )}
                          {ch.status === 'rejected' && <span className="badge badge-rejected">거절됨</span>}
                          {ch.admin_comment && (
                            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                              비고: {ch.admin_comment}
                            </div>
                          )}
                        </td>
                        {canManageCredit && (
                          <td>
                            {ch.status === 'pending' ? (
                              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 210 }}>
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
                                  <div>
                                    <label style={{ fontSize: 10, color: 'var(--text-muted)' }}>승인 크레딧(C)</label>
                                    <input
                                      type="number"
                                      className="input"
                                      style={{ padding: '4px 6px', fontSize: 12 }}
                                      value={chargeReviewAmount[ch.id] ?? ch.amount}
                                      onChange={(e) => setChargeReviewAmount({ ...chargeReviewAmount, [ch.id]: e.target.value })}
                                    />
                                  </div>
                                  <div>
                                    <label style={{ fontSize: 10, color: 'var(--text-muted)' }}>보너스 포인트(P)</label>
                                    <input
                                      type="number"
                                      className="input"
                                      style={{ padding: '4px 6px', fontSize: 12 }}
                                      value={chargeReviewBonusPts[ch.id] ?? 0}
                                      onChange={(e) => setChargeReviewBonusPts({ ...chargeReviewBonusPts, [ch.id]: e.target.value })}
                                    />
                                  </div>
                                </div>
                                <input
                                  type="text"
                                  className="input"
                                  placeholder="심사 메모 / 거절 사유 (선택)"
                                  style={{ padding: '4px 8px', fontSize: 12 }}
                                  value={chargeReviewComment[ch.id] || ''}
                                  onChange={(e) => setChargeReviewComment({ ...chargeReviewComment, [ch.id]: e.target.value })}
                                />
                                <div style={{ display: 'flex', gap: 6 }}>
                                  <button className="btn btn-success btn-sm" style={{ flex: 1 }} onClick={() => handleReviewCharge(ch, 'approved')}>
                                    <CheckCircle size={13} /> 충전 승인
                                  </button>
                                  <button className="btn btn-danger btn-sm" style={{ flex: 1 }} onClick={() => handleReviewCharge(ch, 'rejected')}>
                                    <XCircle size={13} /> 거절
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>처리 완료</span>
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
      )}

      {/* =========================================================
          TAB 2: 크레딧 -> 인게임 화폐('원') 환전소
         ========================================================= */}
      {subTab === 'exchange' && (
        <div>
          <div className="card" style={{ marginBottom: 28 }}>
            <h3 style={{ fontSize: 17, fontWeight: 800, marginBottom: 14, display: 'flex', alignItems: 'center', gap: 8 }}>
              <ArrowRightLeft size={19} color="var(--primary)" />
              <span>보유 크레딧 → 인게임 화폐('원') 출금/환전 신청</span>
            </h3>
            <form onSubmit={handleRequestExchange}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: 14, alignItems: 'flex-end' }}>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label">환전 요청 크레딧 수량 (최소 {Number(config.min_exchange_amount || 100).toLocaleString()} C)</label>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <input
                      type="number"
                      min={config.min_exchange_amount || 1}
                      max={user.credits || 0}
                      className="input"
                      placeholder="환전할 크레딧 입력"
                      value={exchangeAmount}
                      onChange={(e) => setExchangeAmount(e.target.value)}
                      required
                    />
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={() => setExchangeAmount(user.credits || 0)}
                      style={{ whiteSpace: 'nowrap' }}
                    >
                      전액
                    </button>
                  </div>
                </div>

                <div className="form-group" style={{ marginBottom: 0 }}>
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
                  style={{ height: 44, padding: '0 24px' }}
                  disabled={(user.credits || 0) <= 0}
                >
                  인게임 '원' 환전 요청 제출
                </button>
              </div>
            </form>
          </div>

          <div className="card">
            <div className="card-header">
              <div className="card-title">
                <Clock size={20} color="var(--primary)" />
                <span>{canManageCredit ? '크레딧 환전 요청 심사 및 직접 페이 대기열' : '내 환전 신청 내역'}</span>
              </div>
            </div>

            <div className="table-container">
              <table className="table">
                <thead>
                  <tr>
                    <th>번호</th>
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
                      <td colSpan={canManageCredit ? 7 : 6} style={{ textAlign: 'center', padding: 24, color: 'var(--text-muted)' }}>
                        환전 신청 내역이 없습니다.
                      </td>
                    </tr>
                  ) : (
                    exchanges.map((ex) => (
                      <tr key={ex.id}>
                        <td>#{ex.id}</td>
                        <td>
                          <span style={{ fontWeight: 600 }}>{ex.nickname || ex.username}</span>
                          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>@{ex.username}</div>
                        </td>
                        <td><span style={{ fontWeight: 700, color: 'var(--primary)' }}>{ex.in_game_name}</span></td>
                        <td><span style={{ color: 'var(--point-emerald)', fontWeight: 800, fontSize: 15 }}>{ex.amount.toLocaleString()} 원</span></td>
                        <td style={{ fontSize: 13, color: 'var(--text-muted)' }}>{ex.created_at}</td>
                        <td>
                          {ex.status === 'pending' && <span className="badge badge-pending">송금 대기중</span>}
                          {ex.status === 'completed' && <span className="badge badge-approved">페이 완료</span>}
                          {ex.status === 'rejected' && <span className="badge badge-rejected">거절(환불됨)</span>}
                          {ex.admin_comment && (
                            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
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
                                  placeholder="지급 메모/사유 (선택)"
                                  style={{ padding: '4px 8px', fontSize: 12 }}
                                  value={exchangeAdminComment[ex.id] || ''}
                                  onChange={(e) => setExchangeAdminComment({ ...exchangeAdminComment, [ex.id]: e.target.value })}
                                />
                                <div style={{ display: 'flex', gap: 6 }}>
                                  <button className="btn btn-success btn-sm" style={{ flex: 1 }} onClick={() => handleReviewExchange(ex.id, 'completed')}>
                                    <CheckCircle size={13} /> 페이 완료
                                  </button>
                                  <button className="btn btn-danger btn-sm" style={{ flex: 1 }} onClick={() => handleReviewExchange(ex.id, 'rejected')}>
                                    <XCircle size={13} /> 거절
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>처리 완료</span>
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
      )}

      {/* =========================================================
          TAB 3: 연방 포인트 / 크레딧 입출금 상세 원장 & CSV/XLSX 다운로드
         ========================================================= */}
      {subTab === 'ledger' && (
        <div>
          {/* 요약 통계 */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12, marginBottom: 20 }}>
            <div className="card" style={{ marginBottom: 0, padding: 16 }}>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 600 }}>포인트 총 입금 (+)</div>
              <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--point-gold)', marginTop: 4 }}>
                +{Number(txSummary.total_point_in || 0).toLocaleString()} P
              </div>
            </div>
            <div className="card" style={{ marginBottom: 0, padding: 16 }}>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 600 }}>포인트 총 출금 (-)</div>
              <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--danger)', marginTop: 4 }}>
                -{Number(txSummary.total_point_out || 0).toLocaleString()} P
              </div>
            </div>
            <div className="card" style={{ marginBottom: 0, padding: 16 }}>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 600 }}>크레딧 총 입금 (+)</div>
              <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--point-emerald)', marginTop: 4 }}>
                +{Number(txSummary.total_credit_in || 0).toLocaleString()} C
              </div>
            </div>
            <div className="card" style={{ marginBottom: 0, padding: 16 }}>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 600 }}>크레딧 총 출금 (-)</div>
              <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--danger)', marginTop: 4 }}>
                -{Number(txSummary.total_credit_out || 0).toLocaleString()} C
              </div>
            </div>
          </div>

          <div className="card">
            <div className="card-header" style={{ flexWrap: 'wrap', gap: 12 }}>
              <div className="card-title">
                <FileSpreadsheet size={20} color="var(--primary)" />
                <span>SQLite DB 기반 국가 기여 포인트 & 크레딧 상세 입출금 기록 ({txSummary.total_count || 0}건)</span>
              </div>

              {canManageData && (
                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => handleExportLedger('csv')}
                  >
                    <Download size={14} /> CSV 다운로드 (데이터 관리)
                  </button>
                  <button
                    type="button"
                    className="btn btn-success btn-sm"
                    onClick={() => handleExportLedger('xlsx')}
                  >
                    <FileSpreadsheet size={14} /> Excel (.xlsx) 다운로드 (데이터 관리)
                  </button>
                </div>
              )}
            </div>

            {/* 검색 필터 바 */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10, marginBottom: 18, padding: 14, background: 'var(--bg-tertiary)', borderRadius: 12 }}>
              <select
                className="select"
                value={txFilters.asset_type}
                onChange={(e) => {
                  const next = { ...txFilters, asset_type: e.target.value };
                  setTxFilters(next);
                  loadLedgerOnly(next);
                }}
              >
                <option value="ALL">전체 재화 (포인트+크레딧)</option>
                <option value="POINT">국가 기여 포인트 (P) 내역만</option>
                <option value="CREDIT">크레딧 (C) 내역만</option>
              </select>

              <select
                className="select"
                value={txFilters.tx_type}
                onChange={(e) => {
                  const next = { ...txFilters, tx_type: e.target.value };
                  setTxFilters(next);
                  loadLedgerOnly(next);
                }}
              >
                <option value="ALL">입금 + 출금 전체</option>
                <option value="IN">입금 (+) 내역만</option>
                <option value="OUT">출금 (-) 내역만</option>
              </select>

              <input
                type="date"
                className="input"
                value={txFilters.start_date}
                onChange={(e) => {
                  const next = { ...txFilters, start_date: e.target.value };
                  setTxFilters(next);
                  loadLedgerOnly(next);
                }}
              />

              <input
                type="date"
                className="input"
                value={txFilters.end_date}
                onChange={(e) => {
                  const next = { ...txFilters, end_date: e.target.value };
                  setTxFilters(next);
                  loadLedgerOnly(next);
                }}
              />

              <div style={{ display: 'flex', gap: 6 }}>
                <input
                  type="text"
                  className="input"
                  placeholder="닉네임/사유/분류 검색"
                  value={txFilters.search}
                  onChange={(e) => setTxFilters({ ...txFilters, search: e.target.value })}
                  onKeyDown={(e) => e.key === 'Enter' && loadLedgerOnly(txFilters)}
                />
                <button type="button" className="btn btn-primary btn-sm" onClick={() => loadLedgerOnly(txFilters)}>
                  <Search size={14} />
                </button>
              </div>
            </div>

            <div className="table-container">
              <table className="table">
                <thead>
                  <tr>
                    <th>번호</th>
                    <th>일시</th>
                    <th>플레이어</th>
                    <th>재화</th>
                    <th>구분</th>
                    <th>카테고리</th>
                    <th style={{ textAlign: 'right' }}>변동 수량</th>
                    <th style={{ textAlign: 'right' }}>변동 전 → 후 잔액</th>
                    <th>구체적인 상세 기록</th>
                    <th>처리자</th>
                  </tr>
                </thead>
                <tbody>
                  {transactions.length === 0 ? (
                    <tr>
                      <td colSpan={10} style={{ textAlign: 'center', padding: 28, color: 'var(--text-muted)' }}>
                        조건에 해당하는 입출금 상세 기록이 없습니다.
                      </td>
                    </tr>
                  ) : (
                    transactions.map((tx) => (
                      <tr key={tx.id}>
                        <td>#{tx.id}</td>
                        <td style={{ fontSize: 12, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{tx.created_at}</td>
                        <td>
                          <span style={{ fontWeight: 700 }}>{tx.nickname || tx.username}</span>
                          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>@{tx.username}</div>
                        </td>
                        <td>
                          {tx.asset_type === 'POINT' ? (
                            <span className="badge" style={{ background: '#fef3c7', color: '#b45309' }}>포인트(P)</span>
                          ) : (
                            <span className="badge" style={{ background: '#d1fae5', color: '#047857' }}>크레딧(C)</span>
                          )}
                        </td>
                        <td>
                          {tx.tx_type === 'IN' ? (
                            <span className="badge badge-approved">입금(+)</span>
                          ) : (
                            <span className="badge badge-rejected">출금(-)</span>
                          )}
                        </td>
                        <td><span style={{ fontWeight: 600, fontSize: 13 }}>{tx.category}</span></td>
                        <td style={{ textAlign: 'right', fontWeight: 800, color: tx.tx_type === 'IN' ? '#059669' : '#dc2626' }}>
                          {tx.tx_type === 'IN' ? '+' : '-'}{Number(tx.amount).toLocaleString()} {tx.asset_type === 'POINT' ? 'P' : 'C'}
                        </td>
                        <td style={{ textAlign: 'right', fontSize: 12, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                          {Number(tx.balance_before).toLocaleString()} → <strong>{Number(tx.balance_after).toLocaleString()}</strong>
                        </td>
                        <td style={{ fontSize: 13, color: 'var(--text-main)', maxWidth: 320 }}>{tx.description}</td>
                        <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{tx.actor_name || '시스템'}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* 크레딧 수치/정책 설정 모달 */}
      {showConfigModal && (
        <div className="modal-overlay">
          <div className="modal-content">
            <h2 style={{ fontSize: 18, fontWeight: 800, marginBottom: 16 }}>
              ⚙️ 크레딧 충전 & 환전 세부 수치 설정
            </h2>
            <form onSubmit={handleSaveConfig}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div className="form-group">
                  <label className="form-label">1 크레딧당 인게임 원화 비율</label>
                  <input
                    type="number"
                    step="0.1"
                    className="input"
                    value={config.exchange_rate}
                    onChange={(e) => setConfig({ ...config, exchange_rate: e.target.value })}
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">최소 환전 신청 가능 크레딧 (C)</label>
                  <input
                    type="number"
                    className="input"
                    value={config.min_exchange_amount}
                    onChange={(e) => setConfig({ ...config, min_exchange_amount: e.target.value })}
                  />
                </div>
              </div>

              <div className="form-group">
                <label className="form-label">크레딧 충전 창구 상단 안내 문구</label>
                <textarea
                  className="textarea"
                  rows="3"
                  value={config.credit_charge_notice}
                  onChange={(e) => setConfig({ ...config, credit_charge_notice: e.target.value })}
                />
              </div>

              <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
                <button type="button" className="btn btn-secondary" onClick={() => setShowConfigModal(false)} style={{ flex: 1 }}>
                  취소
                </button>
                <button type="submit" className="btn btn-primary" style={{ flex: 1 }}>
                  정책 및 수치 저장
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
