import React, { useState, useEffect } from 'react';
import { apiRequest } from '../api';
import { Package, Plus, CheckCircle, XCircle, Clock, AlertCircle, Edit3, Image, MapPin, Send, Bell, Palette, Sparkles } from 'lucide-react';

export default function SupplyTab({ user, refreshUser }) {
  const [supplies, setSupplies] = useState([]);
  const [requests, setRequests] = useState([]);
  const [notice, setNotice] = useState({
    title: '',
    content: '',
    webhook_url: '',
    webhook_enabled: 0,
    mention_type: 'none',
    embed_color: '#3b82f6',
    message_template: ''
  });
  const [loading, setLoading] = useState(true);

  // 모달 상태
  const [showAddModal, setShowAddModal] = useState(false);
  const [showApplyModal, setShowApplyModal] = useState(false);
  const [showNoticeModal, setShowNoticeModal] = useState(false);
  const [selectedSupply, setSelectedSupply] = useState(null);

  // 폼 상태
  const [newSupply, setNewSupply] = useState({ name: '', unit: '개', points_per_unit: 10, credits_per_unit: 100, description: '' });
  const [applyForm, setApplyForm] = useState({ amount: 1, chest_location: '', proof_image: null });
  const [noticeForm, setNoticeForm] = useState({
    title: '',
    content: '',
    webhook_url: '',
    webhook_enabled: 0,
    mention_type: 'none',
    embed_color: '#3b82f6',
    message_template: ''
  });
  const [testingWebhook, setTestingWebhook] = useState(false);
  const [reviewComment, setReviewComment] = useState({});

  const canRegisterSupply = user.is_admin || user.roles?.includes('납품 등록');
  const canManageSupply = user.is_admin || user.roles?.includes('납품 관리');
  const canManageNotice = user.is_admin || user.roles?.includes('공지 관리');

  const loadData = async () => {
    try {
      setLoading(true);
      const [suppliesData, requestsData, noticeData] = await Promise.all([
        apiRequest('/supplies'),
        apiRequest('/supplies/requests'),
        apiRequest('/notices/supply')
      ]);
      setSupplies(suppliesData);
      setRequests(requestsData);
      setNotice(noticeData);
      setNoticeForm({
        title: noticeData.title || '',
        content: noticeData.content || '',
        webhook_url: noticeData.webhook_url || '',
        webhook_enabled: noticeData.webhook_enabled ? 1 : 0,
        mention_type: noticeData.mention_type || 'none',
        embed_color: noticeData.embed_color || '#3b82f6',
        message_template: noticeData.message_template || ''
      });
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleCreateSupply = async (e) => {
    e.preventDefault();
    try {
      await apiRequest('/supplies', {
        method: 'POST',
        body: JSON.stringify(newSupply)
      });
      alert('납품 상품이 등록되었습니다.');
      setShowAddModal(false);
      setNewSupply({ name: '', unit: '개', points_per_unit: 10, credits_per_unit: 100, description: '' });
      loadData();
    } catch (err) {
      alert(err.message);
    }
  };

  const handleDeleteSupply = async (id) => {
    if (!confirm('이 상품을 목록에서 삭제하시겠습니까?')) return;
    try {
      await apiRequest(`/supplies/${id}`, { method: 'DELETE' });
      loadData();
    } catch (err) {
      alert(err.message);
    }
  };

  const handleApplySupply = async (e) => {
    e.preventDefault();
    if (!applyForm.proof_image) {
      alert('상자 속 아이템이 들어간 캡쳐 이미지를 첨부해주세요.');
      return;
    }

    try {
      const formData = new FormData();
      formData.append('supply_id', selectedSupply.id);
      formData.append('amount', applyForm.amount);
      formData.append('chest_location', applyForm.chest_location);
      formData.append('proof_image', applyForm.proof_image);

      await apiRequest('/supplies/requests', {
        method: 'POST',
        body: formData
      });

      alert('납품 신청이 정상 접수되었습니다! 관리자 승인 후 포인트가 지급됩니다.');
      setShowApplyModal(false);
      setApplyForm({ amount: 1, chest_location: '', proof_image: null });
      loadData();
    } catch (err) {
      alert(err.message);
    }
  };

  const handleReview = async (id, status) => {
    const comment = reviewComment[id] || '';
    if (!confirm(`이 납품 신청을 ${status === 'approved' ? '승인' : '거절'}하시겠습니까?`)) return;

    try {
      await apiRequest(`/supplies/requests/${id}/review`, {
        method: 'PUT',
        body: JSON.stringify({ status, admin_comment: comment })
      });
      alert(`납품 신청이 ${status === 'approved' ? '승인' : '거절'}되었습니다.`);
      loadData();
      if (refreshUser) refreshUser();
    } catch (err) {
      alert(err.message);
    }
  };

  const handleSaveNotice = async (e, sendNow = false) => {
    if (e && e.preventDefault) e.preventDefault();
    try {
      const res = await apiRequest('/notices/supply', {
        method: 'PUT',
        body: JSON.stringify({
          ...noticeForm,
          send_now: sendNow
        })
      });
      alert(res.message || '납품 안내문이 저장되었습니다.');
      setShowNoticeModal(false);
      loadData();
    } catch (err) {
      alert(err.message);
    }
  };

  const handleTestNoticeWebhook = async () => {
    try {
      setTestingWebhook(true);
      const res = await apiRequest('/notices/supply/test-webhook', {
        method: 'POST',
        body: JSON.stringify(noticeForm)
      });
      alert(res.message || '디스코드 테스트 웹훅이 성공적으로 발송되었습니다!');
    } catch (err) {
      alert(`웹훅 테스트 실패: ${err.message}`);
    } finally {
      setTestingWebhook(false);
    }
  };

  return (
    <div>
      {/* 납품 공지사항 / 안내문 */}
      <div className="notice-banner" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#60a5fa', fontWeight: 700, marginBottom: 6 }}>
            <AlertCircle size={18} />
            <span>{notice.title || '납품 안내 사항'}</span>
          </div>
          <div style={{ color: '#cbd5e1', fontSize: 13, whiteSpace: 'pre-line' }}>
            {notice.content}
          </div>
        </div>
        {canManageNotice && (
          <button className="btn btn-secondary btn-sm" onClick={() => setShowNoticeModal(true)}>
            <Edit3 size={14} /> 안내문 수정
          </button>
        )}
      </div>

      {/* 상단 액션바 */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div>
          <h2 style={{ fontSize: 20, fontWeight: 700 }}>국가 물자 납품 품목</h2>
          <p style={{ color: '#94a3b8', fontSize: 13, marginTop: 4 }}>
            지정된 물자를 상자에 넣고 납품하면 연방 포인트와 크레딧을 획득할 수 있습니다.
          </p>
        </div>
        {canRegisterSupply && (
          <button className="btn btn-primary" onClick={() => setShowAddModal(true)}>
            <Plus size={16} /> 납품 상품 등록
          </button>
        )}
      </div>

      {/* 납품 가능한 품목 그리드 */}
      <div className="grid-3" style={{ marginBottom: 36 }}>
        {supplies.length === 0 ? (
          <div style={{ gridColumn: '1 / -1', padding: 40, textAlign: 'center', color: 'var(--text-muted)', background: 'var(--bg-tertiary)', borderRadius: 'var(--radius-lg)' }}>
            등록된 납품 가능 품목이 없습니다.
          </div>
        ) : (
          supplies.map((item) => (
            <div key={item.id} className="card" style={{ marginBottom: 0, display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <div style={{ width: 44, height: 44, borderRadius: 'var(--radius-md)', background: 'var(--primary-container)', color: 'var(--on-primary-container)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <Package size={22} color="var(--primary)" />
                    </div>
                    <div>
                      <h3 style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-main)' }}>{item.name}</h3>
                      <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>단위: {item.unit}</span>
                    </div>
                  </div>
                  {canRegisterSupply && (
                    <button
                      onClick={() => handleDeleteSupply(item.id)}
                      style={{ background: 'none', border: 'none', color: 'var(--danger)', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}
                    >
                      삭제
                    </button>
                  )}
                </div>

                {item.description && (
                  <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 12, lineHeight: 1.5 }}>
                    {item.description}
                  </p>
                )}

                <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
                  <div className="asset-pill point" style={{ flex: 1, justifyContent: 'center' }}>
                    +{item.points_per_unit} P / {item.unit}
                  </div>
                  <div className="asset-pill credit" style={{ flex: 1, justifyContent: 'center' }}>
                    +{item.credits_per_unit.toLocaleString()} C / {item.unit}
                  </div>
                </div>
              </div>

              <button
                className="btn btn-primary"
                style={{ width: '100%', marginTop: 18 }}
                onClick={() => {
                  setSelectedSupply(item);
                  setShowApplyModal(true);
                }}
              >
                납품 신청하기
              </button>
            </div>
          ))
        )}
      </div>

      {/* 납품 신청 내역 및 심사 목록 */}
      <div className="card">
        <div className="card-header">
          <div className="card-title">
            <Clock size={20} color="var(--primary)" />
            <span>{canManageSupply ? '납품 신청 심사 및 내역 관리' : '나의 납품 신청 내역'}</span>
          </div>
        </div>

        <div className="table-container">
          <table className="table">
            <thead>
              <tr>
                <th>신청 번호</th>
                <th>신청자</th>
                <th>납품 물품</th>
                <th>수량</th>
                <th>상자 위치</th>
                <th>스크린샷</th>
                <th>획득 예정/지급</th>
                <th>상태</th>
                {canManageSupply && <th>심사 / 관리</th>}
              </tr>
            </thead>
            <tbody>
              {requests.length === 0 ? (
                <tr>
                  <td colSpan={canManageSupply ? 9 : 8} style={{ textAlign: 'center', padding: 30, color: 'var(--text-muted)' }}>
                    신청 내역이 없습니다.
                  </td>
                </tr>
              ) : (
                requests.map((req) => (
                  <tr key={req.id}>
                    <td>#{req.id}</td>
                    <td>
                      <div>
                        <span style={{ fontWeight: 600 }}>{req.nickname || req.username}</span>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>@{req.username}</div>
                      </div>
                    </td>
                    <td>
                      <span style={{ fontWeight: 600, color: 'var(--text-main)' }}>{req.supply_name}</span>
                    </td>
                    <td>{req.amount} {req.unit}</td>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 4, color: 'var(--text-secondary)', fontSize: 13 }}>
                        <MapPin size={14} /> {req.chest_location}
                      </div>
                    </td>
                    <td>
                      {req.proof_image ? (
                        <a href={req.proof_image} target="_blank" rel="noreferrer" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: 'var(--primary)', fontSize: 13, textDecoration: 'none', fontWeight: 600 }}>
                          <Image size={14} /> 캡쳐 보기
                        </a>
                      ) : (
                        <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>없음</span>
                      )}
                    </td>
                    <td>
                      <div style={{ fontSize: 12 }}>
                        <span style={{ color: '#fbbf24', fontWeight: 600 }}>+{(req.amount * req.points_per_unit)} P</span>
                        <span style={{ margin: '0 4px', color: '#64748b' }}>|</span>
                        <span style={{ color: '#34d399', fontWeight: 600 }}>+{(req.amount * req.credits_per_unit).toLocaleString()} C</span>
                      </div>
                    </td>
                    <td>
                      {req.status === 'pending' && <span className="badge badge-pending">심사 대기중</span>}
                      {req.status === 'approved' && <span className="badge badge-approved">승인 완료</span>}
                      {req.status === 'rejected' && <span className="badge badge-rejected">거절됨</span>}
                      {req.admin_comment && (
                        <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 4 }}>
                          사유: {req.admin_comment}
                        </div>
                      )}
                    </td>
                    {canManageSupply && (
                      <td>
                        {req.status === 'pending' ? (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 160 }}>
                            <input
                              type="text"
                              className="input"
                              placeholder="반려 사유 (선택)"
                              style={{ padding: '4px 8px', fontSize: 12 }}
                              value={reviewComment[req.id] || ''}
                              onChange={(e) => setReviewComment({ ...reviewComment, [req.id]: e.target.value })}
                            />
                            <div style={{ display: 'flex', gap: 6 }}>
                              <button className="btn btn-success btn-sm" style={{ flex: 1 }} onClick={() => handleReview(req.id, 'approved')}>
                                <CheckCircle size={13} /> 승인
                              </button>
                              <button className="btn btn-danger btn-sm" style={{ flex: 1 }} onClick={() => handleReview(req.id, 'rejected')}>
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

      {/* 납품 신청 모달 */}
      {showApplyModal && selectedSupply && (
        <div className="modal-overlay">
          <div className="modal-content">
            <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 16 }}>
              📦 [{selectedSupply.name}] 납품 신청
            </h2>
            <form onSubmit={handleApplySupply}>
              <div className="form-group">
                <label className="form-label">납품 아이템 수 ({selectedSupply.unit})</label>
                <input
                  type="number"
                  min="1"
                  className="input"
                  value={applyForm.amount}
                  onChange={(e) => setApplyForm({ ...applyForm, amount: e.target.value })}
                  required
                />
                <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 4 }}>
                  예상 보상: <span style={{ color: '#fbbf24' }}>{applyForm.amount * selectedSupply.points_per_unit} 포인트</span> / <span style={{ color: '#34d399' }}>{(applyForm.amount * selectedSupply.credits_per_unit).toLocaleString()} 크레딧</span>
                </div>
              </div>

              <div className="form-group">
                <label className="form-label">상자의 위치 (좌표 / 장소 설명)</label>
                <input
                  type="text"
                  className="input"
                  placeholder="예: X: 120, Y: 64, Z: -350 창고 2번 상자"
                  value={applyForm.chest_location}
                  onChange={(e) => setApplyForm({ ...applyForm, chest_location: e.target.value })}
                  required
                />
              </div>

              <div className="form-group">
                <label className="form-label">상자 속 아이템 캡쳐 스크린샷 첨부</label>
                <input
                  type="file"
                  accept="image/*"
                  className="input"
                  onChange={(e) => setApplyForm({ ...applyForm, proof_image: e.target.files[0] })}
                  required
                />
              </div>

              <div style={{ display: 'flex', gap: 10, marginTop: 24 }}>
                <button type="button" className="btn btn-secondary" onClick={() => setShowApplyModal(false)} style={{ flex: 1 }}>
                  취소
                </button>
                <button type="submit" className="btn btn-primary" style={{ flex: 1 }}>
                  납품 신청 제출
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 납품 상품 등록 모달 (권한자) */}
      {showAddModal && (
        <div className="modal-overlay">
          <div className="modal-content">
            <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 16 }}>
              새 납품 품목 등록
            </h2>
            <form onSubmit={handleCreateSupply}>
              <div className="form-group">
                <label className="form-label">상품명</label>
                <input
                  type="text"
                  className="input"
                  placeholder="예: 철 주괴, 옵시디언, 금 블록 등"
                  value={newSupply.name}
                  onChange={(e) => setNewSupply({ ...newSupply, name: e.target.value })}
                  required
                />
              </div>

              <div className="form-group">
                <label className="form-label">단위 (개 / 세트)</label>
                <select
                  className="select"
                  value={newSupply.unit}
                  onChange={(e) => setNewSupply({ ...newSupply, unit: e.target.value })}
                >
                  <option value="개">개</option>
                  <option value="세트">세트 (64개)</option>
                </select>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div className="form-group">
                  <label className="form-label">연방 포인트 (단위당)</label>
                  <input
                    type="number"
                    className="input"
                    value={newSupply.points_per_unit}
                    onChange={(e) => setNewSupply({ ...newSupply, points_per_unit: e.target.value })}
                    required
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">크레딧 (단위당)</label>
                  <input
                    type="number"
                    className="input"
                    value={newSupply.credits_per_unit}
                    onChange={(e) => setNewSupply({ ...newSupply, credits_per_unit: e.target.value })}
                    required
                  />
                </div>
              </div>

              <div className="form-group">
                <label className="form-label">설명 및 세부 조건 (선택)</label>
                <textarea
                  className="textarea"
                  rows="3"
                  value={newSupply.description}
                  onChange={(e) => setNewSupply({ ...newSupply, description: e.target.value })}
                  placeholder="특이사항이나 보관 안내가 있다면 적어주세요."
                />
              </div>

              <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
                <button type="button" className="btn btn-secondary" onClick={() => setShowAddModal(false)} style={{ flex: 1 }}>
                  취소
                </button>
                <button type="submit" className="btn btn-primary" style={{ flex: 1 }}>
                  품목 등록하기
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 공지 수정 모달 */}
      {showNoticeModal && (
        <div className="modal-overlay">
          <div className="modal-content">
            <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 16 }}>
              납품 안내문 (공지사항) 수정
            </h2>
            <form onSubmit={handleSaveNotice}>
              <div className="form-group">
                <label className="form-label">제목</label>
                <input
                  type="text"
                  className="input"
                  value={noticeForm.title}
                  onChange={(e) => setNoticeForm({ ...noticeForm, title: e.target.value })}
                  required
                />
              </div>

              <div className="form-group">
                <label className="form-label">내용</label>
                <textarea
                  className="textarea"
                  rows="5"
                  value={noticeForm.content}
                  onChange={(e) => setNoticeForm({ ...noticeForm, content: e.target.value })}
                  required
                />
              </div>

              {/* 📢 디스코드 웹훅 개별 설정 & 메시지 양식 */}
              <div style={{
                marginTop: 20,
                padding: 16,
                background: 'var(--bg-tertiary)',
                borderRadius: 'var(--radius-md)',
                border: '1px solid var(--border-color)'
              }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700, fontSize: 14, color: '#38bdf8' }}>
                    <Bell size={16} />
                    <span>디스코드 웹훅 개별 설정 & 메시지 양식</span>
                  </div>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={noticeForm.webhook_enabled === 1}
                      onChange={(e) => setNoticeForm({ ...noticeForm, webhook_enabled: e.target.checked ? 1 : 0 })}
                    />
                    <span style={{ fontWeight: 600, color: noticeForm.webhook_enabled ? 'var(--primary)' : 'var(--text-secondary)' }}>
                      공지 저장 시 자동 발송
                    </span>
                  </label>
                </div>

                <div className="form-group">
                  <label className="form-label" style={{ fontSize: 12 }}>
                    공지사항 전용 웹훅 URL (비워두면 전역 기본 웹훅 사용)
                  </label>
                  <input
                    type="url"
                    className="input"
                    placeholder="https://discord.com/api/webhooks/... (개별 채널로 발송 가능)"
                    value={noticeForm.webhook_url}
                    onChange={(e) => setNoticeForm({ ...noticeForm, webhook_url: e.target.value })}
                  />
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label className="form-label" style={{ fontSize: 12 }}>멘션 호출</label>
                    <select
                      className="input"
                      value={noticeForm.mention_type}
                      onChange={(e) => setNoticeForm({ ...noticeForm, mention_type: e.target.value })}
                    >
                      <option value="none">멘션 없음 (알림만)</option>
                      <option value="everyone">@everyone (전체 호출)</option>
                      <option value="here">@here (현재 접속자 호출)</option>
                    </select>
                  </div>

                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label className="form-label" style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
                      <Palette size={14} /> 임베드 테두리 색상
                    </label>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <input
                        type="color"
                        value={noticeForm.embed_color || '#3b82f6'}
                        onChange={(e) => setNoticeForm({ ...noticeForm, embed_color: e.target.value })}
                        style={{ width: 40, height: 36, padding: 2, borderRadius: 6, cursor: 'pointer', border: '1px solid var(--border-color)', background: 'transparent' }}
                      />
                      <input
                        type="text"
                        className="input"
                        value={noticeForm.embed_color || '#3b82f6'}
                        onChange={(e) => setNoticeForm({ ...noticeForm, embed_color: e.target.value })}
                        style={{ flex: 1 }}
                      />
                    </div>
                  </div>
                </div>

                <div className="form-group" style={{ marginBottom: 8 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                    <label className="form-label" style={{ fontSize: 12, marginBottom: 0 }}>
                      디스코드 메시지 양식 (템플릿)
                    </label>
                    <div style={{ display: 'flex', gap: 4 }}>
                      {['{title}', '{content}', '{author}', '{date}'].map((tag) => (
                        <button
                          key={tag}
                          type="button"
                          className="btn btn-secondary btn-sm"
                          style={{ padding: '2px 6px', fontSize: 11 }}
                          onClick={() => setNoticeForm({ ...noticeForm, message_template: (noticeForm.message_template || '') + tag })}
                        >
                          +{tag}
                        </button>
                      ))}
                    </div>
                  </div>
                  <textarea
                    className="textarea"
                    rows="3"
                    placeholder="비워두면 기본 공지 내용이 그대로 전송됩니다. 예: 📢 [공지] {title}&#10;&#10;{content}&#10;&#10;— 안내자: {author}"
                    value={noticeForm.message_template}
                    onChange={(e) => setNoticeForm({ ...noticeForm, message_template: e.target.value })}
                  />
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                    사용 가능한 변수: <code>{'{title}'}</code>(제목), <code>{'{content}'}</code>(내용), <code>{'{author}'}</code>(작성자), <code>{'{date}'}</code>(발송일시)
                  </div>
                </div>

                <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 10 }}>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={handleTestNoticeWebhook}
                    disabled={testingWebhook}
                    style={{ display: 'flex', alignItems: 'center', gap: 6 }}
                  >
                    <Send size={13} />
                    <span>{testingWebhook ? '테스트 발송 중...' : '디스코드 테스트 발송'}</span>
                  </button>
                </div>
              </div>

              <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
                <button type="button" className="btn btn-secondary" onClick={() => setShowNoticeModal(false)} style={{ flex: 1 }}>
                  취소
                </button>
                <button
                  type="button"
                  className="btn btn-warning"
                  onClick={(e) => handleSaveNotice(e, true)}
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, flex: 1 }}
                >
                  <Send size={15} /> 저장 & 디스코드 즉시 알림
                </button>
                <button type="submit" className="btn btn-primary" style={{ flex: 1 }}>
                  공지사항 저장
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
