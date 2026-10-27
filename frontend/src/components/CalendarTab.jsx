import React, { useState, useEffect } from 'react';
import { apiRequest } from '../api';
import { Calendar as CalendarIcon, ChevronLeft, ChevronRight, Plus, Trash2, Edit2, Clock, Tag } from 'lucide-react';

export default function CalendarTab({ user }) {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [schedules, setSchedules] = useState([]);
  const [loading, setLoading] = useState(true);

  // 모달 상태
  const [showModal, setShowModal] = useState(false);
  const [selectedEvent, setSelectedEvent] = useState(null);
  const [editingId, setEditingId] = useState(null);

  const [form, setForm] = useState({
    title: '',
    start_date: new Date().toISOString().split('T')[0],
    end_date: new Date().toISOString().split('T')[0],
    start_time: '20:00',
    end_time: '21:00',
    category: '국가 회의',
    description: '',
    color: '#3b82f6'
  });

  const canManageSchedule = user.is_admin || user.permissions?.includes('일정 관리');

  const loadData = async () => {
    try {
      setLoading(true);
      const data = await apiRequest('/schedules');
      setSchedules(data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  // 캘린더 날짜 계산
  const year = currentDate.getFullYear();
  const month = currentDate.getMonth(); // 0 ~ 11

  const firstDayOfMonth = new Date(year, month, 1).getDay(); // 0 (일) ~ 6 (토)
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const handlePrevMonth = () => {
    setCurrentDate(new Date(year, month - 1, 1));
  };

  const handleNextMonth = () => {
    setCurrentDate(new Date(year, month + 1, 1));
  };

  const handleToday = () => {
    setCurrentDate(new Date());
  };

  const handleSave = async (e) => {
    e.preventDefault();
    try {
      if (editingId) {
        await apiRequest(`/schedules/${editingId}`, {
          method: 'PUT',
          body: JSON.stringify(form)
        });
        alert('일정이 수정되었습니다.');
      } else {
        await apiRequest('/schedules', {
          method: 'POST',
          body: JSON.stringify(form)
        });
        alert('일정이 등록되었으며 디스코드 채널로 @everyone 알림이 전송되었습니다.');
      }
      setShowModal(false);
      setEditingId(null);
      setForm({
        title: '',
        start_date: new Date().toISOString().split('T')[0],
        end_date: new Date().toISOString().split('T')[0],
        start_time: '20:00',
        end_time: '21:00',
        category: '국가 회의',
        description: '',
        color: '#3b82f6'
      });
      loadData();
    } catch (err) {
      alert(err.message);
    }
  };

  const handleDelete = async (id) => {
    if (!confirm('이 일정을 삭제하시겠습니까?')) return;
    try {
      await apiRequest(`/schedules/${id}`, { method: 'DELETE' });
      setSelectedEvent(null);
      loadData();
    } catch (err) {
      alert(err.message);
    }
  };

  // 날짜별 일정 매핑
  const getEventsForDay = (day) => {
    const dayStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    return schedules.filter(s => {
      const start = s.start_date;
      const end = s.end_date || s.start_date;
      return dayStr >= start && dayStr <= end;
    });
  };

  const todayStr = new Date().toISOString().split('T')[0];

  return (
    <div>
      {/* 캘린더 상단 툴바 */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div>
          <h2 style={{ fontSize: 20, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 10 }}>
            <CalendarIcon color="#10b981" size={24} />
            <span>PlanetEarth 국가 작전 & 일정 캘린더</span>
          </h2>
          <p style={{ color: '#94a3b8', fontSize: 13, marginTop: 4 }}>
            노션 스타일 캘린더로 PlanetEarth 서버 국가 회의, 공성전, 건축·영토 확장 및 이벤트 일정을 관리합니다.
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', background: 'var(--bg-tertiary)', borderRadius: 'var(--radius-pill)', padding: '4px 8px', border: '1px solid var(--border-color)' }}>
            <button className="btn btn-secondary btn-sm" onClick={handlePrevMonth} style={{ padding: '6px 8px', borderRadius: 'var(--radius-pill)' }}>
              <ChevronLeft size={16} />
            </button>
            <span style={{ minWidth: 120, textAlign: 'center', fontWeight: 700, fontSize: 15, color: 'var(--text-main)' }}>
              {year}년 {month + 1}월
            </span>
            <button className="btn btn-secondary btn-sm" onClick={handleNextMonth} style={{ padding: '6px 8px', borderRadius: 'var(--radius-pill)' }}>
              <ChevronRight size={16} />
            </button>
          </div>

          <button className="btn btn-secondary btn-sm" onClick={handleToday}>
            오늘
          </button>

          {canManageSchedule && (
            <button
              className="btn btn-primary"
              onClick={() => {
                setEditingId(null);
                setForm({
                  title: '',
                  start_date: new Date().toISOString().split('T')[0],
                  end_date: new Date().toISOString().split('T')[0],
                  start_time: '20:00',
                  end_time: '21:00',
                  category: '국가 회의',
                  description: '',
                  color: 'var(--primary)'
                });
                setShowModal(true);
              }}
            >
              <Plus size={16} /> 일정 추가
            </button>
          )}
        </div>
      </div>

      {/* 노션 스타일 그리드 캘린더 */}
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        {/* 요일 헤더 */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', background: 'var(--bg-tertiary)', borderBottom: '1px solid var(--border-color)', textAlign: 'center', fontWeight: 700, fontSize: 13, color: 'var(--text-secondary)' }}>
          {['일', '월', '화', '수', '목', '금', '토'].map((d, i) => (
            <div key={d} style={{ padding: '12px 0', color: i === 0 ? 'var(--danger)' : i === 6 ? '#1d4ed8' : undefined }}>
              {d}
            </div>
          ))}
        </div>

        {/* 일 그리드 */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gridAutoRows: 'minmax(110px, auto)' }}>
          {/* 빈 칸 (시작 요일 이전) */}
          {Array.from({ length: firstDayOfMonth }).map((_, i) => (
            <div key={`empty-${i}`} style={{ borderRight: '1px solid var(--border-color)', borderBottom: '1px solid var(--border-color)', background: 'var(--bg-primary)' }} />
          ))}

          {/* 해당 월 날짜들 */}
          {Array.from({ length: daysInMonth }).map((_, i) => {
            const dayNum = i + 1;
            const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(dayNum).padStart(2, '0')}`;
            const isToday = dateStr === todayStr;
            const dayEvents = getEventsForDay(dayNum);

            return (
              <div
                key={dayNum}
                style={{
                  borderRight: '1px solid var(--border-color)',
                  borderBottom: '1px solid var(--border-color)',
                  padding: 8,
                  position: 'relative',
                  background: isToday ? 'var(--primary-container)' : '#ffffff',
                  display: 'flex',
                  flexDirection: 'column'
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                  <span style={{
                    fontSize: 12,
                    fontWeight: isToday ? 800 : 600,
                    color: isToday ? '#ffffff' : 'var(--text-main)',
                    background: isToday ? 'var(--primary)' : undefined,
                    padding: isToday ? '2px 8px' : 0,
                    borderRadius: isToday ? 'var(--radius-pill)' : 0
                  }}>
                    {dayNum}
                  </span>
                  {canManageSchedule && (
                    <button
                      onClick={() => {
                        setEditingId(null);
                        setForm({
                          title: '',
                          start_date: dateStr,
                          end_date: dateStr,
                          start_time: '20:00',
                          end_time: '21:00',
                          category: '공성전',
                          description: '',
                          color: '#ef4444'
                        });
                        setShowModal(true);
                      }}
                      style={{ background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', fontSize: 11 }}
                      title="이 날짜에 추가"
                    >
                      +
                    </button>
                  )}
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1 }}>
                  {dayEvents.map(evt => (
                    <div
                      key={evt.id}
                      onClick={() => setSelectedEvent(evt)}
                      style={{
                        fontSize: 11,
                        padding: '3px 6px',
                        borderRadius: 4,
                        background: `${evt.color}22`,
                        borderLeft: `3px solid ${evt.color}`,
                        color: '#f1f5f9',
                        cursor: 'pointer',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis'
                      }}
                    >
                      {evt.start_time ? `[${evt.start_time}] ` : ''}{evt.title}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* 이벤트 상세 팝업 */}
      {selectedEvent && (
        <div className="modal-overlay">
          <div className="modal-content">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
              <div>
                <span className="badge" style={{ background: `${selectedEvent.color}33`, color: selectedEvent.color, marginBottom: 8 }}>
                  {selectedEvent.category}
                </span>
                <h2 style={{ fontSize: 18, fontWeight: 700 }}>{selectedEvent.title}</h2>
              </div>
              <button onClick={() => setSelectedEvent(null)} style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer' }}>
                ✕
              </button>
            </div>

            <div style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', padding: 16, borderRadius: 'var(--radius-md)', fontSize: 13, marginBottom: 18 }}>
              <div style={{ color: 'var(--text-secondary)', marginBottom: 6 }}>
                📅 일자: {selectedEvent.start_date} {selectedEvent.end_date && selectedEvent.end_date !== selectedEvent.start_date ? `~ ${selectedEvent.end_date}` : ''}
              </div>
              {selectedEvent.start_time && (
                <div style={{ color: 'var(--primary)', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 6, fontWeight: 600 }}>
                  <Clock size={14} /> 시간: {selectedEvent.start_time} {selectedEvent.end_time ? `~ ${selectedEvent.end_time}` : ''}
                </div>
              )}
              <div style={{ color: 'var(--text-main)', whiteSpace: 'pre-line', marginTop: 10, borderTop: '1px solid var(--border-color)', paddingTop: 10, lineHeight: 1.6 }}>
                {selectedEvent.description || '상세 내용이 없습니다.'}
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
              {canManageSchedule && (
                <>
                  <button
                    className="btn btn-danger btn-sm"
                    onClick={() => handleDelete(selectedEvent.id)}
                  >
                    <Trash2 size={14} /> 삭제
                  </button>
                  <button
                    className="btn btn-secondary btn-sm"
                    onClick={() => {
                      setEditingId(selectedEvent.id);
                      setForm({
                        title: selectedEvent.title,
                        start_date: selectedEvent.start_date,
                        end_date: selectedEvent.end_date || selectedEvent.start_date,
                        start_time: selectedEvent.start_time || '',
                        end_time: selectedEvent.end_time || '',
                        category: selectedEvent.category,
                        description: selectedEvent.description,
                        color: selectedEvent.color
                      });
                      setSelectedEvent(null);
                      setShowModal(true);
                    }}
                  >
                    <Edit2 size={14} /> 수정
                  </button>
                </>
              )}
              <button className="btn btn-secondary btn-sm" onClick={() => setSelectedEvent(null)}>
                닫기
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 일정 추가/수정 모달 */}
      {showModal && (
        <div className="modal-overlay">
          <div className="modal-content">
            <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 16 }}>
              {editingId ? '일정 수정' : '새 일정 등록 (@everyone 웹훅 발송)'}
            </h2>
            <form onSubmit={handleSave}>
              <div className="form-group">
                <label className="form-label">일정 제목</label>
                <input
                  type="text"
                  className="input"
                  placeholder="예: 제1구역 공성전, 정기 국가 회의"
                  value={form.title}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                  required
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div className="form-group">
                  <label className="form-label">시작일</label>
                  <input
                    type="date"
                    className="input"
                    value={form.start_date}
                    onChange={(e) => setForm({ ...form, start_date: e.target.value })}
                    required
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">종료일</label>
                  <input
                    type="date"
                    className="input"
                    value={form.end_date}
                    onChange={(e) => setForm({ ...form, end_date: e.target.value })}
                    required
                  />
                </div>
              </div>

              {/* 시간 추가 필드 */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div className="form-group">
                  <label className="form-label">시작 시간 (선택)</label>
                  <input
                    type="time"
                    className="input"
                    value={form.start_time}
                    onChange={(e) => setForm({ ...form, start_time: e.target.value })}
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">종료 시간 (선택)</label>
                  <input
                    type="time"
                    className="input"
                    value={form.end_time}
                    onChange={(e) => setForm({ ...form, end_time: e.target.value })}
                  />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div className="form-group">
                  <label className="form-label">카테고리</label>
                  <select
                    className="select"
                    value={form.category}
                    onChange={(e) => setForm({ ...form, category: e.target.value })}
                  >
                    <option value="국가 회의">국가 회의</option>
                    <option value="공성전">공성전</option>
                    <option value="이벤트">이벤트</option>
                    <option value="작업/건축">작업/건축</option>
                    <option value="일반">일반</option>
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">태그 색상</label>
                  <select
                    className="select"
                    value={form.color}
                    onChange={(e) => setForm({ ...form, color: e.target.value })}
                  >
                    <option value="#3b82f6">파랑 (기본)</option>
                    <option value="#ef4444">빨강 (전쟁/긴급)</option>
                    <option value="#10b981">초록 (완료/안전)</option>
                    <option value="#f59e0b">주황 (회의/주요)</option>
                    <option value="#8b5cf6">보라 (이벤트)</option>
                  </select>
                </div>
              </div>

              <div className="form-group">
                <label className="form-label">상세 설명</label>
                <textarea
                  className="textarea"
                  rows="3"
                  placeholder="회의 장소나 준비물 등을 작성하세요."
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                />
              </div>

              <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
                <button type="button" className="btn btn-secondary" onClick={() => setShowModal(false)} style={{ flex: 1 }}>
                  취소
                </button>
                <button type="submit" className="btn btn-primary" style={{ flex: 1 }}>
                  {editingId ? '수정 완료' : '일정 등록'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
