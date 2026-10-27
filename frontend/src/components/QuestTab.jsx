import React, { useState, useEffect } from 'react';
import { apiRequest } from '../api';
import { Compass, Plus, CheckCircle, XCircle, Trash2, Edit2, Image, Send } from 'lucide-react';

export default function QuestTab({ user, refreshUser }) {
  const [quests, setQuests] = useState([]);
  const [submissions, setSubmissions] = useState([]);
  const [loading, setLoading] = useState(true);

  // 모달 상태
  const [showAddModal, setShowAddModal] = useState(false);
  const [showSubmitModal, setShowSubmitModal] = useState(false);
  const [selectedQuest, setSelectedQuest] = useState(null);
  const [editingQuest, setEditingQuest] = useState(null);

  // 폼 상태
  const [form, setForm] = useState({
    title: '',
    target_item: '',
    reward_text: '',
    credit_reward: 2000,
    point_reward: 50,
    notes: ''
  });

  const [submitForm, setSubmitForm] = useState({
    proof_text: '',
    proof_image: null
  });

  // 심사 시 수치 직접 조절 지원
  const [reviewPts, setReviewPts] = useState({});
  const [reviewCreds, setReviewCreds] = useState({});
  const [reviewComment, setReviewComment] = useState({});

  const canManageQuest = user.is_admin || user.permissions?.includes('퀘스트 관리');

  const loadData = async () => {
    try {
      setLoading(true);
      const [questsData, submissionsData] = await Promise.all([
        apiRequest('/quests'),
        apiRequest('/quests/submissions')
      ]);
      setQuests(questsData);
      setSubmissions(submissionsData);

      const defaultPts = {};
      const defaultCreds = {};
      submissionsData.forEach(s => {
        if (s.status === 'pending') {
          defaultPts[s.id] = s.point_reward;
          defaultCreds[s.id] = s.credit_reward;
        }
      });
      setReviewPts(prev => ({ ...defaultPts, ...prev }));
      setReviewCreds(prev => ({ ...defaultCreds, ...prev }));
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleSaveQuest = async (e) => {
    e.preventDefault();
    try {
      if (editingQuest) {
        await apiRequest(`/quests/${editingQuest.id}`, {
          method: 'PUT',
          body: JSON.stringify(form)
        });
        alert('퀘스트가 수정되었습니다.');
      } else {
        await apiRequest('/quests', {
          method: 'POST',
          body: JSON.stringify(form)
        });
        alert('퀘스트가 등록되었으며 디스코드 채널로 알림이 전송되었습니다.');
      }
      setShowAddModal(false);
      setEditingQuest(null);
      setForm({
        title: '',
        target_item: '',
        reward_text: '',
        credit_reward: 2000,
        point_reward: 50,
        notes: ''
      });
      loadData();
    } catch (err) {
      alert(err.message);
    }
  };

  const handleDeleteQuest = async (id) => {
    if (!confirm('이 퀘스트를 삭제하시겠습니까?')) return;
    try {
      await apiRequest(`/quests/${id}`, { method: 'DELETE' });
      loadData();
    } catch (err) {
      alert(err.message);
    }
  };

  const handleSubmitProof = async (e) => {
    e.preventDefault();
    try {
      const formData = new FormData();
      formData.append('proof_text', submitForm.proof_text);
      if (submitForm.proof_image) {
        formData.append('proof_image', submitForm.proof_image);
      }

      await apiRequest(`/quests/${selectedQuest.id}/submit`, {
        method: 'POST',
        body: formData
      });

      alert('퀘스트 완료 증빙이 제출되었습니다! 관리자 승인 후 보상이 지급됩니다.');
      setShowSubmitModal(false);
      setSubmitForm({ proof_text: '', proof_image: null });
      loadData();
    } catch (err) {
      alert(err.message);
    }
  };

  const handleReviewSubmission = async (sub, status) => {
    const subId = sub.id;
    const customPts = reviewPts[subId] ?? sub.point_reward;
    const customCreds = reviewCreds[subId] ?? sub.credit_reward;
    const comment = reviewComment[subId] || '';

    const msg = status === 'approved'
      ? `이 퀘스트 완료 신청을 승인하시겠습니까?\n지급 예정: +${Number(customPts).toLocaleString()} P / +${Number(customCreds).toLocaleString()} C`
      : `이 퀘스트 완료 신청을 거절하시겠습니까?`;
    if (!confirm(msg)) return;
    try {
      const res = await apiRequest(`/quests/submissions/${subId}/review`, {
        method: 'PUT',
        body: JSON.stringify({
          status,
          custom_points: customPts,
          custom_credits: customCreds,
          admin_comment: comment
        })
      });
      alert(res.message || `퀘스트가 ${status === 'approved' ? '승인되어 보상이 지급' : '거절'}되었습니다.`);
      loadData();
      if (refreshUser) refreshUser();
    } catch (err) {
      alert(err.message);
    }
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div>
          <h2 style={{ fontSize: 20, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 10 }}>
            <Compass color="#f59e0b" size={24} />
            <span>PlanetEarth 국가 공통 퀘스트</span>
          </h2>
          <p style={{ color: '#94a3b8', fontSize: 13, marginTop: 4 }}>
            PlanetEarth 서버의 모든 국민이 공통으로 수행 가능한 국가 임무입니다. 완수 후 증빙을 제출하세요.
          </p>
        </div>

        {canManageQuest && (
          <button
            className="btn btn-primary"
            onClick={() => {
              setEditingQuest(null);
              setForm({
                title: '',
                target_item: '',
                reward_text: '',
                credit_reward: 2000,
                point_reward: 50,
                notes: ''
              });
              setShowAddModal(true);
            }}
          >
            <Plus size={16} /> 퀘스트 등록
          </button>
        )}
      </div>

      {/* 퀘스트 카드 목록 */}
      <div className="grid-3" style={{ marginBottom: 36 }}>
        {quests.length === 0 ? (
          <div style={{ gridColumn: '1 / -1', padding: 40, textAlign: 'center', color: '#64748b' }}>
            진행 중인 공통 퀘스트가 없습니다.
          </div>
        ) : (
          quests.map((q) => (
            <div key={q.id} className="card" style={{ marginBottom: 0, display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <h3 style={{ fontSize: 17, fontWeight: 700 }}>{q.title}</h3>
                  {canManageQuest && (
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button
                        onClick={() => {
                          setEditingQuest(q);
                          setForm({
                            title: q.title,
                            target_item: q.target_item || '',
                            reward_text: q.reward_text || '',
                            credit_reward: q.credit_reward,
                            point_reward: q.point_reward,
                            notes: q.notes || ''
                          });
                          setShowAddModal(true);
                        }}
                        style={{ background: 'none', border: 'none', color: '#60a5fa', cursor: 'pointer' }}
                      >
                        <Edit2 size={14} />
                      </button>
                      <button
                        onClick={() => handleDeleteQuest(q.id)}
                        style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer' }}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  )}
                </div>

                <div style={{ marginTop: 12, background: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', padding: 14, borderRadius: 'var(--radius-md)', fontSize: 13, display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <div>
                    <span style={{ color: 'var(--text-muted)' }}>🎯 결과물: </span>
                    <span style={{ color: 'var(--text-main)', fontWeight: 600 }}>{q.target_item || '미지정'}</span>
                  </div>
                  <div>
                    <span style={{ color: 'var(--text-muted)' }}>🎁 기본 보수: </span>
                    <span style={{ color: 'var(--text-secondary)' }}>{q.reward_text || '없음'}</span>
                  </div>
                  {q.notes && (
                    <div>
                      <span style={{ color: 'var(--text-muted)' }}>📝 기타 사항: </span>
                      <span style={{ color: 'var(--text-secondary)' }}>{q.notes}</span>
                    </div>
                  )}
                </div>

                <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
                  <div className="asset-pill point" style={{ flex: 1, justifyContent: 'center' }}>
                    +{q.point_reward} P
                  </div>
                  <div className="asset-pill credit" style={{ flex: 1, justifyContent: 'center' }}>
                    +{q.credit_reward.toLocaleString()} C
                  </div>
                </div>
              </div>

              <button
                className="btn btn-primary"
                style={{ width: '100%', marginTop: 20 }}
                onClick={() => {
                  setSelectedQuest(q);
                  setShowSubmitModal(true);
                }}
              >
                퀘스트 완료 증빙 제출
              </button>
            </div>
          ))
        )}
      </div>

      {/* 완료 신청 및 심사 목록 */}
      <div className="card">
        <div className="card-header">
          <div className="card-title">
            <CheckCircle size={20} color="var(--primary)" />
            <span>{canManageQuest ? '퀘스트 완료 제출 심사 대기열' : '내 퀘스트 제출 내역'}</span>
          </div>
        </div>

        <div className="table-container">
          <table className="table">
            <thead>
              <tr>
                <th>제출 번호</th>
                <th>제출자</th>
                <th>퀘스트명</th>
                <th>증빙 설명</th>
                <th>스크린샷</th>
                <th>보상</th>
                <th>상태</th>
                {canManageQuest && <th>심사</th>}
              </tr>
            </thead>
            <tbody>
              {submissions.length === 0 ? (
                <tr>
                  <td colSpan={canManageQuest ? 8 : 7} style={{ textAlign: 'center', padding: 24, color: 'var(--text-muted)' }}>
                    제출된 내역이 없습니다.
                  </td>
                </tr>
              ) : (
                submissions.map((sub) => (
                  <tr key={sub.id}>
                    <td>#{sub.id}</td>
                    <td>
                      <span style={{ fontWeight: 600 }}>{sub.nickname || sub.username}</span>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>@{sub.username}</div>
                    </td>
                    <td><span style={{ fontWeight: 600, color: 'var(--text-main)' }}>{sub.quest_title}</span></td>
                    <td style={{ fontSize: 13, color: 'var(--text-secondary)', maxWidth: 220 }}>{sub.proof_text || '-'}</td>
                    <td>
                      {sub.proof_image ? (
                        <a href={sub.proof_image} target="_blank" rel="noreferrer" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: 'var(--primary)', fontSize: 13, textDecoration: 'none', fontWeight: 600 }}>
                          <Image size={14} /> 스크린샷 보기
                        </a>
                      ) : (
                        <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>첨부 없음</span>
                      )}
                    </td>
                    <td>
                      <div style={{ fontSize: 12 }}>
                        <span style={{ color: 'var(--point-gold)', fontWeight: 700 }}>
                          +{(sub.custom_points ?? sub.point_reward).toLocaleString()} P
                        </span>
                        {' | '}
                        <span style={{ color: 'var(--point-emerald)', fontWeight: 700 }}>
                          +{(sub.custom_credits ?? sub.credit_reward).toLocaleString()} C
                        </span>
                      </div>
                    </td>
                    <td>
                      {sub.status === 'pending' && <span className="badge badge-pending">심사 대기중</span>}
                      {sub.status === 'approved' && <span className="badge badge-approved">승인 완료</span>}
                      {sub.status === 'rejected' && <span className="badge badge-rejected">거절됨</span>}
                      {sub.admin_comment && (
                        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                          비고: {sub.admin_comment}
                        </div>
                      )}
                    </td>
                    {canManageQuest && (
                      <td>
                        {sub.status === 'pending' ? (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 200 }}>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
                              <div>
                                <label style={{ fontSize: 10, color: 'var(--text-muted)' }}>지급 포인트(P)</label>
                                <input
                                  type="number"
                                  className="input"
                                  style={{ padding: '4px 6px', fontSize: 12 }}
                                  value={reviewPts[sub.id] ?? sub.point_reward}
                                  onChange={(e) => setReviewPts({ ...reviewPts, [sub.id]: e.target.value })}
                                />
                              </div>
                              <div>
                                <label style={{ fontSize: 10, color: 'var(--text-muted)' }}>지급 크레딧(C)</label>
                                <input
                                  type="number"
                                  className="input"
                                  style={{ padding: '4px 6px', fontSize: 12 }}
                                  value={reviewCreds[sub.id] ?? sub.credit_reward}
                                  onChange={(e) => setReviewCreds({ ...reviewCreds, [sub.id]: e.target.value })}
                                />
                              </div>
                            </div>
                            <input
                              type="text"
                              className="input"
                              placeholder="심사 코멘트 (선택)"
                              style={{ padding: '4px 8px', fontSize: 12 }}
                              value={reviewComment[sub.id] || ''}
                              onChange={(e) => setReviewComment({ ...reviewComment, [sub.id]: e.target.value })}
                            />
                            <div style={{ display: 'flex', gap: 6 }}>
                              <button className="btn btn-success btn-sm" style={{ flex: 1 }} onClick={() => handleReviewSubmission(sub, 'approved')}>
                                <CheckCircle size={13} /> 승인
                              </button>
                              <button className="btn btn-danger btn-sm" style={{ flex: 1 }} onClick={() => handleReviewSubmission(sub, 'rejected')}>
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

      {/* 완료 증빙 제출 모달 */}
      {showSubmitModal && selectedQuest && (
        <div className="modal-overlay">
          <div className="modal-content">
            <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 16 }}>
              ⚔️ [{selectedQuest.title}] 완료 증빙 제출
            </h2>
            <form onSubmit={handleSubmitProof}>
              <div className="form-group">
                <label className="form-label">증빙 내용 및 결과 설명</label>
                <textarea
                  className="textarea"
                  rows="3"
                  placeholder="아이템을 보관한 상자 위치나 결과물 상세 내용을 적어주세요."
                  value={submitForm.proof_text}
                  onChange={(e) => setSubmitForm({ ...submitForm, proof_text: e.target.value })}
                  required
                />
              </div>

              <div className="form-group">
                <label className="form-label">증빙 스크린샷 캡쳐 (선택)</label>
                <input
                  type="file"
                  accept="image/*"
                  className="input"
                  onChange={(e) => setSubmitForm({ ...submitForm, proof_image: e.target.files[0] })}
                />
              </div>

              <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
                <button type="button" className="btn btn-secondary" onClick={() => setShowSubmitModal(false)} style={{ flex: 1 }}>
                  취소
                </button>
                <button type="submit" className="btn btn-primary" style={{ flex: 1 }}>
                  완료 신청 제출
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 퀘스트 등록/수정 모달 (권한자) */}
      {showAddModal && (
        <div className="modal-overlay">
          <div className="modal-content">
            <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 16 }}>
              {editingQuest ? '퀘스트 수정' : '새 공통 퀘스트 등록'}
            </h2>
            <form onSubmit={handleSaveQuest}>
              <div className="form-group">
                <label className="form-label">1) 퀘스트 이름</label>
                <input
                  type="text"
                  className="input"
                  placeholder="예: 네더 요새 정복, 식량 비축 100세트"
                  value={form.title}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                  required
                />
              </div>

              <div className="form-group">
                <label className="form-label">2) 결과물</label>
                <input
                  type="text"
                  className="input"
                  placeholder="예: 블레이즈 로드 64개, 구운 감자 100세트"
                  value={form.target_item}
                  onChange={(e) => setForm({ ...form, target_item: e.target.value })}
                  required
                />
              </div>

              <div className="form-group">
                <label className="form-label">3) 보수 (설명 문구)</label>
                <input
                  type="text"
                  className="input"
                  placeholder="예: 국가 보급품 상자 1개 지급"
                  value={form.reward_text}
                  onChange={(e) => setForm({ ...form, reward_text: e.target.value })}
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div className="form-group">
                  <label className="form-label">4) 크레딧 보상</label>
                  <input
                    type="number"
                    min="0"
                    className="input"
                    value={form.credit_reward}
                    onChange={(e) => setForm({ ...form, credit_reward: e.target.value })}
                    required
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">5) 국가 기여 포인트 보상</label>
                  <input
                    type="number"
                    min="0"
                    className="input"
                    value={form.point_reward}
                    onChange={(e) => setForm({ ...form, point_reward: e.target.value })}
                    required
                  />
                </div>
              </div>

              <div className="form-group">
                <label className="form-label">6) 기타 (직접 작성)</label>
                <textarea
                  className="textarea"
                  rows="2"
                  placeholder="주의사항이나 납품 기한 등"
                  value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                />
              </div>

              <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
                <button type="button" className="btn btn-secondary" onClick={() => setShowAddModal(false)} style={{ flex: 1 }}>
                  취소
                </button>
                <button type="submit" className="btn btn-primary" style={{ flex: 1 }}>
                  {editingQuest ? '수정 완료' : '등록 및 알림 전송'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
