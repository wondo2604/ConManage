import React, { useState, useEffect, useRef } from 'react';
import { apiRequest } from '../api';
import {
  Bell,
  Send,
  Save,
  CheckCircle2,
  Sliders,
  Link2,
  Sparkles,
  Power,
  RefreshCw,
  Search
} from 'lucide-react';

const CATEGORY_ORDER = [
  '전체',
  '지급 및 재화 기록',
  '크레딧 충전 & 환전',
  '물자 납품 & 상점',
  '퀘스트 & 단기 알바',
  '일정 · 시즌 · 계정 관리'
];

export default function WebhookManager() {
  const [globalUrl, setGlobalUrl] = useState('');
  const [configs, setConfigs] = useState([]);
  const [selectedCategory, setSelectedCategory] = useState('지급 및 재화 기록');
  const [selectedEventKey, setSelectedEventKey] = useState('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryBulkUrl, setCategoryBulkUrl] = useState('');
  const [loading, setLoading] = useState(true);
  const [savingAll, setSavingAll] = useState(false);
  const [testingKey, setTestingKey] = useState(null);
  const [savingKey, setSavingKey] = useState(null);
  const [autoSaveStatus, setAutoSaveStatus] = useState('💾 SQLite 실시간 자동저장');
  const itemSaveTimersRef = useRef({});
  const globalUrlTimerRef = useRef(null);

  const loadWebhooks = async () => {
    try {
      setLoading(true);
      const data = await apiRequest('/webhooks');
      setGlobalUrl(data.global_webhook_url || '');
      setConfigs(Array.isArray(data.configs) ? data.configs : []);
    } catch (err) {
      console.error('Failed to load webhook configs:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadWebhooks();
  }, []);

  const handleUpdateGlobalUrl = (nextUrl) => {
    setGlobalUrl(nextUrl);
    if (globalUrlTimerRef.current) clearTimeout(globalUrlTimerRef.current);
    setAutoSaveStatus('⏳ 기본 웹훅 URL 자동 저장 대기...');
    globalUrlTimerRef.current = setTimeout(async () => {
      try {
        setAutoSaveStatus('⏳ SQLite 저장 중...');
        await apiRequest('/webhooks', {
          method: 'PUT',
          body: JSON.stringify({ global_webhook_url: nextUrl })
        });
        setAutoSaveStatus(`✅ 자동 저장됨 (${new Date().toLocaleTimeString('ko-KR', { hour12: false })})`);
      } catch (err) {
        console.error(err);
        setAutoSaveStatus('⚠️ 자동 저장 오류');
      }
    }, 600);
  };

  const handleUpdateItem = (eventKey, patch) => {
    setConfigs(prev => {
      const next = prev.map(item => (item.event_key === eventKey ? { ...item, ...patch } : item));
      const updatedItem = next.find(item => item.event_key === eventKey);
      if (updatedItem) {
        if (itemSaveTimersRef.current[eventKey]) {
          clearTimeout(itemSaveTimersRef.current[eventKey]);
        }
        setAutoSaveStatus(`⏳ [${updatedItem.label}] 자동 저장 대기...`);
        itemSaveTimersRef.current[eventKey] = setTimeout(async () => {
          try {
            setSavingKey(eventKey);
            setAutoSaveStatus(`⏳ [${updatedItem.label}] SQLite 저장 중...`);
            await apiRequest(`/webhooks/${eventKey}`, {
              method: 'PUT',
              body: JSON.stringify(updatedItem)
            });
            setAutoSaveStatus(`✅ 자동 저장됨 (${new Date().toLocaleTimeString('ko-KR', { hour12: false })})`);
          } catch (err) {
            console.error(err);
            setAutoSaveStatus('⚠️ 자동 저장 오류');
          } finally {
            setSavingKey(null);
          }
        }, 550);
      }
      return next;
    });
  };

  const handleToggleItem = async (item) => {
    const nextEnabled = item.enabled ? 0 : 1;
    handleUpdateItem(item.event_key, { enabled: nextEnabled });
    try {
      await apiRequest(`/webhooks/${item.event_key}`, {
        method: 'PUT',
        body: JSON.stringify({
          ...item,
          enabled: nextEnabled
        })
      });
    } catch (err) {
      alert(err.message);
      loadWebhooks();
    }
  };

  const handleSaveSingle = async (item) => {
    try {
      setSavingKey(item.event_key);
      const res = await apiRequest(`/webhooks/${item.event_key}`, {
        method: 'PUT',
        body: JSON.stringify(item)
      });
      if (res.configs) setConfigs(res.configs);
      alert(res.message || `[${item.label}] 웹훅 설정이 저장되었습니다.`);
    } catch (err) {
      alert(err.message);
    } finally {
      setSavingKey(null);
    }
  };

  const handleSaveAll = async (e) => {
    if (e && e.preventDefault) e.preventDefault();
    try {
      setSavingAll(true);
      const res = await apiRequest('/webhooks', {
        method: 'PUT',
        body: JSON.stringify({
          global_webhook_url: globalUrl,
          configs
        })
      });
      if (res.configs) setConfigs(res.configs);
      alert(res.message || '전체 웹훅 설정이 일괄 저장되었습니다.');
    } catch (err) {
      alert(err.message);
    } finally {
      setSavingAll(false);
    }
  };

  const handleTestEvent = async (item) => {
    try {
      setTestingKey(item.event_key);
      // 먼저 현재 편집 중인 설정 저장 후 테스트 발송
      await apiRequest(`/webhooks/${item.event_key}`, {
        method: 'PUT',
        body: JSON.stringify(item)
      });
      const res = await apiRequest(`/webhooks/${item.event_key}/test`, {
        method: 'POST',
        body: JSON.stringify({
          custom_url: item.webhook_url || globalUrl
        })
      });
      alert(res.message);
    } catch (err) {
      alert(`웹훅 테스트 발송 실패: ${err.message}`);
    } finally {
      setTestingKey(null);
    }
  };

  const handleBulkToggleCategory = async (enable) => {
    const targetKeys = filteredConfigs.map(c => c.event_key);
    const updated = configs.map(c =>
      targetKeys.includes(c.event_key) ? { ...c, enabled: enable ? 1 : 0 } : c
    );
    setConfigs(updated);
    try {
      setSavingAll(true);
      const res = await apiRequest('/webhooks', {
        method: 'PUT',
        body: JSON.stringify({
          global_webhook_url: globalUrl,
          configs: updated
        })
      });
      if (res.configs) setConfigs(res.configs);
    } catch (err) {
      alert(err.message);
    } finally {
      setSavingAll(false);
    }
  };

  const handleApplyCategoryUrl = async () => {
    const targetKeys = filteredConfigs.map(c => c.event_key);
    const updated = configs.map(c =>
      targetKeys.includes(c.event_key) ? { ...c, webhook_url: categoryBulkUrl.trim() } : c
    );
    setConfigs(updated);
    try {
      setSavingAll(true);
      setAutoSaveStatus('⏳ 일괄 웹훅 URL SQLite 저장 중...');
      const res = await apiRequest('/webhooks', {
        method: 'PUT',
        body: JSON.stringify({
          global_webhook_url: globalUrl,
          configs: updated
        })
      });
      if (res.configs) setConfigs(res.configs);
      setAutoSaveStatus(`✅ 일괄 자동 저장됨 (${new Date().toLocaleTimeString('ko-KR', { hour12: false })})`);
    } catch (err) {
      alert(err.message);
    } finally {
      setSavingAll(false);
    }
  };

  const categoryFilteredConfigs = configs.filter(item => {
    return selectedCategory === '전체' || item.category === selectedCategory;
  });

  const filteredConfigs = categoryFilteredConfigs.filter(item => {
    const matchEvent = selectedEventKey === 'ALL' || item.event_key === selectedEventKey;
    const q = searchQuery.trim().toLowerCase();
    const matchSearch =
      !q ||
      (item.label || '').toLowerCase().includes(q) ||
      (item.description || '').toLowerCase().includes(q) ||
      (item.event_key || '').toLowerCase().includes(q);
    return matchEvent && matchSearch;
  });

  const enabledCount = configs.filter(c => c.enabled).length;

  return (
    <div className="card" style={{ marginBottom: 28, border: '1px solid rgba(59, 130, 246, 0.35)' }}>
      <div className="card-header" style={{ flexWrap: 'wrap', gap: 12 }}>
        <div>
          <div className="card-title">
            <Bell size={20} color="#3b82f6" />
            <span>디스코드 웹훅 통합 & 개별 상세 설정 센터 (총 {configs.length}종 이벤트)</span>
            <span className="badge badge-approved" style={{ marginLeft: 6 }}>
              활성 {enabledCount} / {configs.length}
            </span>
            <span className="badge" style={{ background: '#eff6ff', color: '#1d4ed8', marginLeft: 4 }}>
              {autoSaveStatus}
            </span>
          </div>
          <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 4 }}>
            지급 기록(포인트·크레딧 입출금 원장, 납품/퀘스트/알바 보상 정산, 수동 지급, 일괄 지급)을 포함한 모든 플랫폼 이벤트마다 <strong>개별 ON/OFF, 전용 웹훅 채널 URL, 멘션(@everyone/@here), 임베드 색상</strong>을 각각 분리하여 설정할 수 있습니다.
          </p>
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={loadWebhooks}
            disabled={loading}
          >
            <RefreshCw size={14} /> 새로고침
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={handleSaveAll}
            disabled={savingAll}
          >
            <Save size={15} /> {savingAll ? '저장 중...' : '전체 웹훅 설정 일괄 저장'}
          </button>
        </div>
      </div>

      {/* 1. 기본(전역) 웹훅 URL 설정 */}
      <div
        style={{
          padding: 16,
          background: 'var(--bg-tertiary)',
          borderRadius: 'var(--radius-md)',
          border: '1px solid var(--border-color)',
          marginBottom: 18
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, flexWrap: 'wrap', gap: 8 }}>
          <div style={{ fontWeight: 700, fontSize: 14, display: 'flex', alignItems: 'center', gap: 6 }}>
            <Link2 size={16} color="var(--primary)" />
            <span>전역 기본 디스코드 웹훅 URL (개별 URL 미입력 시 기본 발송 채널)</span>
          </div>
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            개별 항목의 웹훅 URL 칸을 비워두면 이 기본 URL로 전송됩니다.
          </span>
        </div>

        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <input
            type="url"
            className="input"
            placeholder="https://discord.com/api/webhooks/... (입력 시 자동 저장)"
            value={globalUrl}
            onChange={e => handleUpdateGlobalUrl(e.target.value)}
            style={{ flex: 1, minWidth: 260 }}
          />
          <button
            type="button"
            className="btn btn-primary"
            onClick={handleSaveAll}
            disabled={savingAll}
            style={{ whiteSpace: 'nowrap' }}
          >
            기본 URL 및 전체 저장
          </button>
        </div>
      </div>

      {/* 2. 카테고리 탭 & 검색/일괄 도구 */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10, marginBottom: 14 }}>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {CATEGORY_ORDER.map(cat => {
            const count = cat === '전체' ? configs.length : configs.filter(c => c.category === cat).length;
            const activeInCat = cat === '전체'
              ? configs.filter(c => c.enabled).length
              : configs.filter(c => c.category === cat && c.enabled).length;
            const isSelected = selectedCategory === cat;
            return (
              <button
                key={cat}
                type="button"
                onClick={() => {
                  setSelectedCategory(cat);
                  setSelectedEventKey('ALL');
                }}
                className={`btn btn-sm ${isSelected ? 'btn-primary' : 'btn-secondary'}`}
                style={{ fontWeight: isSelected ? 700 : 500 }}
              >
                <span>{cat}</span>
                <span
                  style={{
                    fontSize: 11,
                    padding: '1px 6px',
                    borderRadius: 999,
                    background: isSelected ? 'rgba(255,255,255,0.22)' : 'rgba(148,163,184,0.18)'
                  }}
                >
                  {activeInCat}/{count}
                </span>
              </button>
            );
          })}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <select
            className="select"
            value={selectedEventKey}
            onChange={e => setSelectedEventKey(e.target.value)}
            style={{ width: 'auto', minWidth: 200, height: 34, padding: '4px 12px', fontSize: 12, fontWeight: 600 }}
          >
            <option value="ALL">📌 세부 웹훅 항목 선택 ({categoryFilteredConfigs.length}개 전체 보기)</option>
            {categoryFilteredConfigs.map(ev => (
              <option key={ev.event_key} value={ev.event_key}>
                {ev.enabled ? '🟢' : '⚪'} {ev.label} ({ev.event_key})
              </option>
            ))}
          </select>

          <div style={{ position: 'relative' }}>
            <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
            <input
              type="text"
              className="input"
              placeholder="웹훅 이름/키 검색..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              style={{ paddingLeft: 30, width: 190, height: 34, fontSize: 13 }}
            />
          </div>
        </div>
      </div>

      {/* 현재 카테고리 빠른 일괄 제어 바 */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 10,
          padding: '10px 14px',
          background: 'rgba(59, 130, 246, 0.05)',
          border: '1px dashed rgba(59, 130, 246, 0.3)',
          borderRadius: 'var(--radius-md)',
          marginBottom: 16
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--primary)' }}>
            [{selectedCategory}] 빠른 일괄 설정:
          </span>
          <button
            type="button"
            className="btn btn-success btn-sm"
            onClick={() => handleBulkToggleCategory(true)}
          >
            <Power size={13} /> 현재 목록 모두 켜기 (ON)
          </button>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => handleBulkToggleCategory(false)}
          >
            현재 목록 모두 끄기 (OFF)
          </button>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1, maxWidth: 520, minWidth: 260 }}>
          <input
            type="url"
            className="input"
            placeholder={`[${selectedCategory}] 전용 디스코드 웹훅 URL 일괄 입력 (비우면 기본 URL 사용)`}
            value={categoryBulkUrl}
            onChange={e => setCategoryBulkUrl(e.target.value)}
            style={{ height: 32, fontSize: 12, flex: 1 }}
          />
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={handleApplyCategoryUrl}
            style={{ whiteSpace: 'nowrap' }}
          >
            현재 목록에 URL 일괄 적용
          </button>
        </div>
      </div>

      {/* 3. 개별 웹훅 이벤트 카드 리스트 */}
      {loading ? (
        <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-muted)' }}>
          웹훅 설정 목록을 불러오는 중입니다...
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 12 }}>
          {filteredConfigs.map(item => {
            const isEnabled = Boolean(item.enabled);
            const effectiveColor = item.custom_color || item.default_color || '#3b82f6';
            const isPresetMention = ['none', 'everyone', 'here'].includes(item.mention_type || 'none');

            return (
              <div
                key={item.event_key}
                style={{
                  padding: '14px 16px',
                  borderRadius: 'var(--radius-md)',
                  border: isEnabled
                    ? '1px solid rgba(59, 130, 246, 0.45)'
                    : '1px solid var(--border-color)',
                  background: isEnabled ? '#ffffff' : 'var(--bg-tertiary)',
                  opacity: isEnabled ? 1 : 0.82,
                  transition: 'all 0.15s ease'
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                    <button
                      type="button"
                      onClick={() => handleToggleItem(item)}
                      className={`btn btn-sm ${isEnabled ? 'btn-primary' : 'btn-secondary'}`}
                      style={{
                        minWidth: 68,
                        justifyContent: 'center',
                        fontWeight: 700,
                        background: isEnabled ? '#10b981' : undefined,
                        borderColor: isEnabled ? '#059669' : undefined
                      }}
                    >
                      {isEnabled ? 'ON 켜짐' : 'OFF 꺼짐'}
                    </button>

                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <span
                          style={{
                            width: 10,
                            height: 10,
                            borderRadius: '50%',
                            background: effectiveColor,
                            display: 'inline-block'
                          }}
                        />
                        <span style={{ fontWeight: 700, fontSize: 15, color: 'var(--text-primary)' }}>
                          {item.label}
                        </span>
                        <span
                          style={{
                            fontSize: 11,
                            padding: '2px 8px',
                            borderRadius: 999,
                            background: 'rgba(59, 130, 246, 0.1)',
                            color: 'var(--primary)',
                            fontWeight: 600
                          }}
                        >
                          {item.category}
                        </span>
                        <code style={{ fontSize: 11, color: 'var(--text-muted)', background: 'var(--bg-tertiary)', padding: '2px 6px', borderRadius: 4 }}>
                          {item.event_key}
                        </code>
                      </div>
                      <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 4 }}>
                        {item.description}
                      </p>
                    </div>
                  </div>

                  <div style={{ display: 'flex', gap: 6 }}>
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={() => handleTestEvent(item)}
                      disabled={testingKey === item.event_key}
                      title="이 이벤트 양식으로 디스코드 테스트 메시지를 즉시 전송합니다"
                    >
                      <Send size={13} />
                      {testingKey === item.event_key ? '발송 중...' : '테스트 발송'}
                    </button>
                    <button
                      type="button"
                      className="btn btn-primary btn-sm"
                      onClick={() => handleSaveSingle(item)}
                      disabled={savingKey === item.event_key}
                    >
                      <Save size={13} />
                      {savingKey === item.event_key ? '저장 중...' : '개별 저장'}
                    </button>
                  </div>
                </div>

                {/* 세부 설정 입력 행: 전용 웹훅 URL / 멘션 / 임베드 색상 */}
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '2fr 1fr 160px',
                    gap: 10,
                    alignItems: 'center',
                    paddingTop: 10,
                    borderTop: '1px solid var(--border-color)'
                  }}
                >
                  <div>
                    <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 4 }}>
                      개별 전용 웹훅 URL (비워두면 전역 기본 웹훅 URL로 전송)
                    </label>
                    <input
                      type="url"
                      className="input"
                      placeholder={globalUrl ? `기본값 사용 중 (${globalUrl.slice(0, 38)}...)` : 'https://discord.com/api/webhooks/... (개별 채널 지정)'}
                      value={item.webhook_url || ''}
                      onChange={e => handleUpdateItem(item.event_key, { webhook_url: e.target.value })}
                      style={{ height: 34, fontSize: 12 }}
                    />
                  </div>

                  <div>
                    <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 4 }}>
                      호출 멘션 설정
                    </label>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <select
                        className="select"
                        value={isPresetMention ? (item.mention_type || 'none') : 'custom'}
                        onChange={e => {
                          const val = e.target.value;
                          handleUpdateItem(item.event_key, {
                            mention_type: val === 'custom' ? '<@&역할ID>' : val
                          });
                        }}
                        style={{ height: 34, fontSize: 12, flex: 1 }}
                      >
                        <option value="none">멘션 없음</option>
                        <option value="everyone">@everyone 전체 멘션</option>
                        <option value="here">@here 온라인 멘션</option>
                        <option value="custom">직접 입력 (역할/유저 ID)</option>
                      </select>
                      {!isPresetMention && (
                        <input
                          type="text"
                          className="input"
                          placeholder="예: <@&123456789>"
                          value={item.mention_type || ''}
                          onChange={e => handleUpdateItem(item.event_key, { mention_type: e.target.value })}
                          style={{ height: 34, fontSize: 12, width: 140 }}
                        />
                      )}
                    </div>
                  </div>

                  <div>
                    <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 4 }}>
                      임베드 좌측 컬러
                    </label>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <input
                        type="color"
                        value={effectiveColor}
                        onChange={e => handleUpdateItem(item.event_key, { custom_color: e.target.value })}
                        style={{
                          width: 34,
                          height: 34,
                          padding: 2,
                          borderRadius: 6,
                          border: '1px solid var(--border-color)',
                          cursor: 'pointer',
                          background: '#fff'
                        }}
                      />
                      <input
                        type="text"
                        className="input"
                        value={item.custom_color || item.default_color || '#3b82f6'}
                        onChange={e => handleUpdateItem(item.event_key, { custom_color: e.target.value })}
                        style={{ height: 34, fontSize: 12, width: '100%' }}
                      />
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
