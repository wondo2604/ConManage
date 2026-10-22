import React, { useState, useEffect } from 'react';
import { apiRequest } from '../api';
import { Briefcase, Plus, CheckCircle, Clock, AlertCircle, Pickaxe, Users, Send, Edit2, Trash2 } from 'lucide-react';

export default function GigTab({ user, refreshUser }) {
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);

  // 모달 상태
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingJob, setEditingJob] = useState(null);
  const [showApproveModal, setShowApproveModal] = useState(false);
  const [targetJob, setTargetJob] = useState(null);
  const [federationPointsInput, setFederationPointsInput] = useState(20);

  // 최종 지급 심사 시 수치 커스텀 조절
  const [finalPayMap, setFinalPayMap] = useState({});
  const [finalPtsMap, setFinalPtsMap] = useState({});

  // 구인 등록 폼 ('사업가' 권한)
  const [form, setForm] = useState({
    work_type: '광질',
    custom_work_type: '',
    description: '',
    pay_credit: 1000,
    federation_points: 20,
    work_date: '',
    duration_text: '약 1시간 소요',
    notes: '',
    status: 'pending_approval'
  });

  const canCreateGig = user.is_admin || user.permissions?.includes('사업가');
  const canManageCorporate = user.is_admin || user.permissions?.includes('기업 관리');

  const loadData = async () => {
    try {
      setLoading(true);
      const data = await apiRequest('/jobs');
      setJobs(data);

      const defaultPay = {};
      const defaultPts = {};
      data.forEach(j => {
        defaultPay[j.id] = j.pay_credit;
        defaultPts[j.id] = j.federation_points;
      });
      setFinalPayMap(prev => ({ ...defaultPay, ...prev }));
      setFinalPtsMap(prev => ({ ...defaultPts, ...prev }));
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleCreateJob = async (e) => {
    e.preventDefault();
    try {
      if (editingJob) {
        await apiRequest(`/jobs/${editingJob.id}`, {
          method: 'PUT',
          body: JSON.stringify(form)
        });
        alert('단기 알바 공고 및 보수/포인트 수치가 수정되었습니다.');
      } else {
        await apiRequest('/jobs', {
          method: 'POST',
          body: JSON.stringify(form)
        });
        alert('알바 구인 등록이 신청되었습니다! 기업 관리자가 연방 포인트를 책정하면 공고가 게시됩니다.');
      }
      setShowCreateModal(false);
      setEditingJob(null);
      setForm({
        work_type: '광질',
        custom_work_type: '',
        description: '',
        pay_credit: 1000,
        federation_points: 20,
        work_date: '',
        duration_text: '약 1시간 소요',
        notes: '',
        status: 'pending_approval'
      });
      loadData();
    } catch (err) {
      alert(err.message);
    }
  };

  const handleDeleteJob = async (jobId) => {
    if (!confirm('이 단기 알바 공고를 삭제하시겠습니까?')) return;
    try {
      await apiRequest(`/jobs/${jobId}`, { method: 'DELETE' });
      loadData();
    } catch (err) {
      alert(err.message);
    }
  };

  // 기업 관리자 승인 & 연방 포인트 책정
  const handleApproveGig = async (e) => {
    e.preventDefault();
    try {
      await apiRequest(`/jobs/${targetJob.id}/approve`, {
        method: 'PUT',
        body: JSON.stringify({ federation_points: federationPointsInput })
      });
      alert('공고가 승인되어 게시되었습니다. 디스코드 알림이 전송되었습니다.');
      setShowApproveModal(false);
      setTargetJob(null);
      loadData();
    } catch (err) {
      alert(err.message);
    }
  };

  // 구직자 지원
  const handleApplyGig = async (jobId) => {
    if (!confirm('이 단기 알바에 지원하시겠습니까?')) return;
    try {
      await apiRequest(`/jobs/${jobId}/apply`, { method: 'POST' });
      alert('지원이 완료되어 채용되었습니다! 작업을 진행해 주세요.');
      loadData();
    } catch (err) {
      alert(err.message);
    }
  };

  // 완료 체크 (사업가 / 구직자)
  const handleCompleteGig = async (jobId) => {
    if (!confirm('작업 완료를 확정하시겠습니까? 양측 모두 완료 시 기업 관리자 최종 검토로 전달됩니다.')) return;
    try {
      const res = await apiRequest(`/jobs/${jobId}/complete`, { method: 'POST' });
      alert(res.message);
      loadData();
    } catch (err) {
      alert(err.message);
    }
  };

  // 기업 관리자 최종 지급 확인
  const handleFinalize = async (job, decision) => {
    const jobId = job.id;
    const customPay = finalPayMap[jobId] ?? job.pay_credit;
    const customPts = finalPtsMap[jobId] ?? job.federation_points;

    if (!confirm(`노동 여부를 확인하고 ${decision === 'approve' ? `최종 보수(+${Number(customPay).toLocaleString()}C) 및 포인트(+${Number(customPts)}P)를 지급` : '취소/반려'}하시겠습니까?`)) return;
    try {
      const res = await apiRequest(`/jobs/${jobId}/finalize`, {
        method: 'PUT',
        body: JSON.stringify({
          decision,
          custom_pay_credit: customPay,
          custom_federation_points: customPts
        })
      });
      alert(res.message);
      loadData();
      if (refreshUser) refreshUser();
    } catch (err) {
      alert(err.message);
    }
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div>
          <h2 style={{ fontSize: 20, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 10 }}>
            <Briefcase color="var(--primary)" size={24} />
            <span>단기 알바 구인 & 매칭</span>
          </h2>
          <p style={{ color: 'var(--text-muted)', fontSize: 13, marginTop: 4 }}>
            사업가는 노동력을 구인하고, 구직자는 크레딧과 연방 포인트를 획득할 수 있습니다.
          </p>
        </div>

        {(canCreateGig || canManageCorporate) && (
          <button
            className="btn btn-primary"
            onClick={() => {
              setEditingJob(null);
              setForm({
                work_type: '광질',
                custom_work_type: '',
                description: '',
                pay_credit: 1000,
                federation_points: 20,
                work_date: '',
                duration_text: '약 1시간 소요',
                notes: '',
                status: 'pending_approval'
              });
              setShowCreateModal(true);
            }}
          >
            <Plus size={16} /> 알바 구인 등록
          </button>
        )}
      </div>

      {/* 알바 목록 */}
      <div className="grid-2" style={{ marginBottom: 36 }}>
        {jobs.length === 0 ? (
          <div style={{ gridColumn: '1 / -1', padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>
            등록된 알바 공고가 없습니다.
          </div>
        ) : (
          jobs.map((job) => {
            const isEmployer = job.employer_id === user.id;
            const isWorker = job.worker_id === user.id;

            return (
              <div key={job.id} className="card" style={{ marginBottom: 0, display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span className="badge badge-role" style={{ fontSize: 13 }}>
                        {job.work_type === '기타' && job.custom_work_type ? job.custom_work_type : job.work_type}
                      </span>
                      <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                        구인자: {job.employer_name || job.employer_username}
                      </span>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      {job.status === 'pending_approval' && <span className="badge badge-pending">포인트 책정 대기</span>}
                      {job.status === 'open' && <span className="badge badge-approved">구인 중</span>}
                      {job.status === 'in_progress' && <span className="badge badge-role">작업 진행 중</span>}
                      {job.status === 'both_done_pending_review' && <span className="badge badge-pending">최종 지급 심사 중</span>}
                      {job.status === 'completed' && <span className="badge badge-approved">지급 완료</span>}
                      {job.status === 'cancelled' && <span className="badge badge-rejected">취소됨</span>}

                      {(canManageCorporate || isEmployer) && (
                        <>
                          <button
                            onClick={() => {
                              setEditingJob(job);
                              setForm({
                                work_type: job.work_type,
                                custom_work_type: job.custom_work_type || '',
                                description: job.description,
                                pay_credit: job.pay_credit,
                                federation_points: job.federation_points || 0,
                                work_date: job.work_date,
                                duration_text: job.duration_text,
                                notes: job.notes || '',
                                status: job.status
                              });
                              setShowCreateModal(true);
                            }}
                            style={{ background: 'none', border: 'none', color: 'var(--primary)', cursor: 'pointer' }}
                            title="공고 및 수치 수정"
                          >
                            <Edit2 size={14} />
                          </button>
                          <button
                            onClick={() => handleDeleteJob(job.id)}
                            style={{ background: 'none', border: 'none', color: 'var(--danger)', cursor: 'pointer' }}
                            title="삭제"
                          >
                            <Trash2 size={14} />
                          </button>
                        </>
                      )}
                    </div>
                  </div>

                  <p style={{ fontSize: 14, color: 'var(--text-main)', whiteSpace: 'pre-line', marginBottom: 14, fontWeight: 500 }}>
                    {job.description}
                  </p>

                  <div style={{ background: 'var(--bg-tertiary)', padding: 12, borderRadius: 8, fontSize: 13, display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 16 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ color: 'var(--text-muted)' }}>일시</span>
                      <span style={{ fontWeight: 600 }}>{job.work_date}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ color: 'var(--text-muted)' }}>지속 기간</span>
                      <span style={{ fontWeight: 600 }}>{job.duration_text}</span>
                    </div>
                    {job.notes && (
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span style={{ color: 'var(--text-muted)' }}>특이사항</span>
                        <span style={{ color: 'var(--text-secondary)' }}>{job.notes}</span>
                      </div>
                    )}
                    {job.worker_name && (
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span style={{ color: 'var(--text-muted)' }}>채용된 구직자</span>
                        <span style={{ color: 'var(--primary)', fontWeight: 700 }}>{job.worker_name}</span>
                      </div>
                    )}
                  </div>

                  <div style={{ display: 'flex', gap: 10 }}>
                    <div className="asset-pill credit" style={{ flex: 1, justifyContent: 'center' }}>
                      페이: {job.pay_credit.toLocaleString()} C
                    </div>
                    <div className="asset-pill point" style={{ flex: 1, justifyContent: 'center' }}>
                      포인트: {job.federation_points} P
                    </div>
                  </div>
                </div>

                <div style={{ marginTop: 20 }}>
                  {/* 1) 기업 관리자의 공고 승인 & 포인트 설정 */}
                  {job.status === 'pending_approval' && canManageCorporate && (
                    <button
                      className="btn btn-primary"
                      style={{ width: '100%' }}
                      onClick={() => {
                        setTargetJob(job);
                        setFederationPointsInput(job.federation_points || 20);
                        setShowApproveModal(true);
                      }}
                    >
                      연방 포인트 책정 및 공고 승인 (기업 관리)
                    </button>
                  )}

                  {/* 2) 구직 지원 */}
                  {job.status === 'open' && !isEmployer && (
                    <button
                      className="btn btn-success"
                      style={{ width: '100%' }}
                      onClick={() => handleApplyGig(job.id)}
                    >
                      <Users size={16} /> 알바 지원하기
                    </button>
                  )}

                  {/* 3) 진행 중: 완료 버튼 (사업가 / 구직자) */}
                  {(job.status === 'in_progress' || job.status === 'both_done_pending_review') && (isEmployer || isWorker) && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      <div style={{ fontSize: 12, color: 'var(--text-muted)', textAlign: 'center' }}>
                        고용주 완료: {job.employer_completed ? '✅ 완료' : '⏳ 미완료'} | 구직자 완료: {job.worker_completed ? '✅ 완료' : '⏳ 미완료'}
                      </div>
                      {((isEmployer && !job.employer_completed) || (isWorker && !job.worker_completed)) && (
                        <button
                          className="btn btn-primary"
                          style={{ width: '100%' }}
                          onClick={() => handleCompleteGig(job.id)}
                        >
                          <CheckCircle size={16} /> 본인 작업 완료 확정
                        </button>
                      )}
                    </div>
                  )}

                  {/* 4) 기업 관리자의 최종 지급 승인 (수치 직접 조절 가능) */}
                  {job.status === 'both_done_pending_review' && canManageCorporate && (
                    <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--border-color)' }}>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
                        <div>
                          <label style={{ fontSize: 11, color: 'var(--text-muted)' }}>최종 지급 크레딧(C)</label>
                          <input
                            type="number"
                            className="input"
                            style={{ padding: '4px 8px', fontSize: 12 }}
                            value={finalPayMap[job.id] ?? job.pay_credit}
                            onChange={(e) => setFinalPayMap({ ...finalPayMap, [job.id]: e.target.value })}
                          />
                        </div>
                        <div>
                          <label style={{ fontSize: 11, color: 'var(--text-muted)' }}>최종 지급 포인트(P)</label>
                          <input
                            type="number"
                            className="input"
                            style={{ padding: '4px 8px', fontSize: 12 }}
                            value={finalPtsMap[job.id] ?? job.federation_points}
                            onChange={(e) => setFinalPtsMap({ ...finalPtsMap, [job.id]: e.target.value })}
                          />
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button
                          className="btn btn-success btn-sm"
                          style={{ flex: 1 }}
                          onClick={() => handleFinalize(job, 'approve')}
                        >
                          최종 승인 & 지급
                        </button>
                        <button
                          className="btn btn-danger btn-sm"
                          style={{ flex: 1 }}
                          onClick={() => handleFinalize(job, 'reject')}
                        >
                          반려/취소
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* 알바 등록/수정 모달 */}
      {showCreateModal && (
        <div className="modal-overlay">
          <div className="modal-content">
            <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 16 }}>
              💼 {editingJob ? '알바 공고 및 수치 수정' : '알바 구인 등록 신청'}
            </h2>
            <form onSubmit={handleCreateJob}>
              <div className="form-group">
                <label className="form-label">노동 유형</label>
                <select
                  className="select"
                  value={form.work_type}
                  onChange={(e) => setForm({ ...form, work_type: e.target.value })}
                >
                  <option value="광질">광질</option>
                  <option value="조합">조합</option>
                  <option value="양조">양조</option>
                  <option value="농사">농사</option>
                  <option value="수집">수집</option>
                  <option value="건축">건축</option>
                  <option value="기타">기타 (직접 작성)</option>
                </select>
              </div>

              {form.work_type === '기타' && (
                <div className="form-group">
                  <label className="form-label">기타 노동 유형 직접 입력</label>
                  <input
                    type="text"
                    className="input"
                    placeholder="예: 몬스터 타워 관리, 지형 평탄화"
                    value={form.custom_work_type}
                    onChange={(e) => setForm({ ...form, custom_work_type: e.target.value })}
                    required
                  />
                </div>
              )}

              <div className="form-group">
                <label className="form-label">구체적 설명</label>
                <textarea
                  className="textarea"
                  rows="3"
                  placeholder="작업 내용과 요구 사항을 상세히 기재해주세요."
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  required
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: canManageCorporate ? '1fr 1fr' : '1fr', gap: 12 }}>
                <div className="form-group">
                  <label className="form-label">보수 페이 (크레딧)</label>
                  <input
                    type="number"
                    min="0"
                    className="input"
                    placeholder="예: 5000"
                    value={form.pay_credit}
                    onChange={(e) => setForm({ ...form, pay_credit: e.target.value })}
                    required
                  />
                </div>
                {canManageCorporate && (
                  <div className="form-group">
                    <label className="form-label">연방 포인트 (기업 관리 권한)</label>
                    <input
                      type="number"
                      min="0"
                      className="input"
                      value={form.federation_points}
                      onChange={(e) => setForm({ ...form, federation_points: e.target.value })}
                    />
                  </div>
                )}
              </div>

              <div className="form-group">
                <label className="form-label">일시</label>
                <input
                  type="text"
                  className="input"
                  placeholder="예: 2026-10-15 오후 8시 또는 상시"
                  value={form.work_date}
                  onChange={(e) => setForm({ ...form, work_date: e.target.value })}
                  required
                />
              </div>

              <div className="form-group">
                <label className="form-label">지속 기간 (텍스트로 작성)</label>
                <input
                  type="text"
                  className="input"
                  placeholder="예: 약 2시간, 상자 채울 때까지"
                  value={form.duration_text}
                  onChange={(e) => setForm({ ...form, duration_text: e.target.value })}
                  required
                />
              </div>

              <div className="form-group">
                <label className="form-label">기타 특이사항 (직접 작성)</label>
                <input
                  type="text"
                  className="input"
                  placeholder="예: 개인 곡괭이 지참 필수, 음식 제공"
                  value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                />
              </div>

              <div style={{ display: 'flex', gap: 10, marginTop: 24 }}>
                <button type="button" className="btn btn-secondary" onClick={() => setShowCreateModal(false)} style={{ flex: 1 }}>
                  취소
                </button>
                <button type="submit" className="btn btn-primary" style={{ flex: 1 }}>
                  신청 등록하기
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 기업 관리자 포인트 책정 및 승인 모달 */}
      {showApproveModal && targetJob && (
        <div className="modal-overlay">
          <div className="modal-content">
            <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 16 }}>
              기업 관리: 연방 포인트 책정 & 승인
            </h2>
            <div style={{ marginBottom: 16, background: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', padding: 14, borderRadius: 'var(--radius-md)', fontSize: 13, color: 'var(--text-main)', lineHeight: 1.6 }}>
              <div><strong>유형:</strong> {targetJob.work_type}</div>
              <div><strong>내용:</strong> {targetJob.description}</div>
              <div><strong>페이:</strong> {targetJob.pay_credit.toLocaleString()} 크레딧</div>
            </div>

            <form onSubmit={handleApproveGig}>
              <div className="form-group">
                <label className="form-label">지급할 국가 기여 연방 포인트</label>
                <input
                  type="number"
                  min="0"
                  className="input"
                  value={federationPointsInput}
                  onChange={(e) => setFederationPointsInput(e.target.value)}
                  required
                />
                <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 4 }}>
                  승인 시 디스코드 웹훅 알림이 발송되며 구인 공고가 오픈됩니다.
                </div>
              </div>

              <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
                <button type="button" className="btn btn-secondary" onClick={() => setShowApproveModal(false)} style={{ flex: 1 }}>
                  취소
                </button>
                <button type="submit" className="btn btn-primary" style={{ flex: 1 }}>
                  승인 및 알림 발송
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
