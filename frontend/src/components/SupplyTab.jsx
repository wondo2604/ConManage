import React, { useState, useEffect } from 'react';
import { apiRequest } from '../api';
import {
  Package, Plus, CheckCircle, XCircle, Clock, AlertCircle,
  Edit3, Image, MapPin, Send, Bell, Palette, Sparkles,
  Trash2, Edit2, Layers, ListPlus
} from 'lucide-react';

export const SUPPLY_CATEGORIES = [
  '광물',
  '소모품',
  '농산품'
];

export const SUPPLY_PRESET_UNITS = [
  '개',
  '세트',
  '상자',
  '큰상자',
  '셜커상자'
];

const SUPPLY_CATEGORY_STYLE = {
  '광물': { bg: '#e0f2fe', color: '#0369a1', border: '#bae6fd', emoji: '💎' },
  '소모품': { bg: '#fef3c7', color: '#b45309', border: '#fde68a', emoji: '🧪' },
  '농산품': { bg: '#d1fae5', color: '#047857', border: '#a7f3d0', emoji: '🌾' }
};

export default function SupplyTab({ user, refreshUser }) {
  const [supplies, setSupplies] = useState([]);
  const [requests, setRequests] = useState([]);
  const [selectedCategory, setSelectedCategory] = useState('전체');
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
  const [editingSupply, setEditingSupply] = useState(null);
  const [showApplyModal, setShowApplyModal] = useState(false);
  const [showCustomApplyModal, setShowCustomApplyModal] = useState(false);
  const [showNoticeModal, setShowNoticeModal] = useState(false);
  const [selectedSupply, setSelectedSupply] = useState(null);

  // 납품 기록 사후 수정 모달 ('납품 관리')
  const [editingRequest, setEditingRequest] = useState(null);
  const [editReqForm, setEditReqForm] = useState({
    custom_item_name: '',
    amount: 1,
    chest_location: '',
    points_earned: 0,
    credits_earned: 0,
    admin_comment: ''
  });

  // 폼 상태
  const [newSupply, setNewSupply] = useState({
    name: '',
    category: '광물',
    unit: '개',
    custom_unit: '',
    points_per_unit: 10,
    credits_per_unit: 100,
    description: ''
  });
  const [applyForm, setApplyForm] = useState({ amount: 1, chest_location: '', notes: '', proof_image: null });

  // 자율 직접 입력 납품 폼 (다중 품목 지원 + 단위 '기타' 직접 입력 지원)
  const [customItems, setCustomItems] = useState([
    { name: '', amount: 1, unit: '개', custom_unit: '' }
  ]);
  const [customApplyForm, setCustomApplyForm] = useState({
    chest_location: '',
    notes: '',
    proof_image: null
  });

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

  // 심사 상태 (코멘트, 지급 포인트, 지급 크레딧 직접 수정 가능)
  const [reviewComment, setReviewComment] = useState({});
  const [reviewPoints, setReviewPoints] = useState({});
  const [reviewCredits, setReviewCredits] = useState({});

  const canRegisterSupply = user.is_admin || user.permissions?.includes('납품 등록') || user.permissions?.includes('납품 관리');
  const canManageSupply = user.is_admin || user.permissions?.includes('납품 관리');
  const canManageNotice = user.is_admin || user.permissions?.includes('공지 관리');

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

      // 심사 대기 항목들의 기본 보상 수치 세팅
      const defaultPts = {};
      const defaultCreds = {};
      requestsData.forEach(r => {
        if (r.status === 'pending') {
          defaultPts[r.id] = r.is_custom ? 50 : (r.amount * r.points_per_unit);
          defaultCreds[r.id] = r.is_custom ? 500 : (r.amount * r.credits_per_unit);
        }
      });
      setReviewPoints(prev => ({ ...defaultPts, ...prev }));
      setReviewCredits(prev => ({ ...defaultCreds, ...prev }));

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

  const openCreateSupplyModal = (defaultCat) => {
    const initialCat = defaultCat && defaultCat !== '전체' ? defaultCat : (selectedCategory !== '전체' ? selectedCategory : '광물');
    setEditingSupply(null);
    setNewSupply({
      name: '',
      category: initialCat,
      unit: '개',
      custom_unit: '',
      points_per_unit: 10,
      credits_per_unit: 100,
      description: ''
    });
    setShowAddModal(true);
  };

  const openEditSupplyModal = (item) => {
    const itemUnit = item.unit || '개';
    const isPresetUnit = SUPPLY_PRESET_UNITS.includes(itemUnit);
    const itemCat = SUPPLY_CATEGORIES.includes(item.category) ? item.category : '광물';

    setEditingSupply(item);
    setNewSupply({
      name: item.name,
      category: itemCat,
      unit: isPresetUnit ? itemUnit : '기타',
      custom_unit: isPresetUnit ? '' : itemUnit,
      points_per_unit: item.points_per_unit,
      credits_per_unit: item.credits_per_unit,
      description: item.description || ''
    });
    setShowAddModal(true);
  };

  const handleSaveSupply = async (e) => {
    e.preventDefault();
    const resolvedUnit = newSupply.unit === '기타' ? (newSupply.custom_unit || '').trim() : newSupply.unit;
    if (!resolvedUnit) {
      alert('기타 단위를 직접 입력해주세요.');
      return;
    }

    const payload = {
      ...newSupply,
      category: newSupply.category || '광물',
      unit: resolvedUnit,
      custom_unit: newSupply.unit === '기타' ? resolvedUnit : ''
    };

    try {
      if (editingSupply) {
        await apiRequest(`/supplies/${editingSupply.id}`, {
          method: 'PUT',
          body: JSON.stringify(payload)
        });
        alert('납품 품목 정보 및 단가 수치가 수정되었습니다.');
      } else {
        await apiRequest('/supplies', {
          method: 'POST',
          body: JSON.stringify(payload)
        });
        alert('납품 상품이 등록되었습니다.');
      }
      setShowAddModal(false);
      setEditingSupply(null);
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
      formData.append('is_custom', '0');
      formData.append('amount', applyForm.amount);
      formData.append('chest_location', applyForm.chest_location);
      formData.append('notes', applyForm.notes || '');
      formData.append('proof_image', applyForm.proof_image);

      await apiRequest('/supplies/requests', {
        method: 'POST',
        body: formData
      });

      alert('납품 신청이 정상 접수되었습니다! 관리자 승인 후 포인트가 지급됩니다.');
      setShowApplyModal(false);
      setApplyForm({ amount: 1, chest_location: '', notes: '', proof_image: null });
      loadData();
    } catch (err) {
      alert(err.message);
    }
  };

  // 자율 / 직접 아이템 & 수량 입력 납품 신청
  const handleAddCustomItemRow = () => {
    setCustomItems([...customItems, { name: '', amount: 1, unit: '개', custom_unit: '' }]);
  };

  const handleRemoveCustomItemRow = (idx) => {
    if (customItems.length <= 1) return;
    setCustomItems(customItems.filter((_, i) => i !== idx));
  };

  const handleChangeCustomItem = (idx, field, val) => {
    const updated = [...customItems];
    updated[idx] = { ...updated[idx], [field]: val };
    setCustomItems(updated);
  };

  const handleSubmitCustomSupply = async (e) => {
    e.preventDefault();
    const validItems = customItems.filter(it => it.name && it.name.trim() !== '');
    if (validItems.length === 0) {
      alert('납품할 아이템 이름을 최소 1개 이상 입력해주세요.');
      return;
    }
    for (const it of validItems) {
      if (it.unit === '기타' && (!it.custom_unit || !it.custom_unit.trim())) {
        alert(`'${it.name}' 품목의 기타 단위를 직접 입력해주세요.`);
        return;
      }
    }
    if (!customApplyForm.chest_location.trim()) {
      alert('상자의 위치를 입력해주세요.');
      return;
    }
    if (!customApplyForm.proof_image) {
      alert('상자 속 아이템이 들어간 캡쳐 이미지를 첨부해주세요.');
      return;
    }

    const normalizedItems = validItems.map(it => ({
      name: it.name.trim(),
      amount: Number(it.amount) || 1,
      unit: it.unit === '기타' ? it.custom_unit.trim() : it.unit,
      custom_unit: it.unit === '기타' ? it.custom_unit.trim() : ''
    }));

    try {
      const formData = new FormData();
      formData.append('is_custom', '1');
      formData.append('custom_items_json', JSON.stringify(normalizedItems));
      formData.append('chest_location', customApplyForm.chest_location);
      formData.append('notes', customApplyForm.notes || '');
      formData.append('proof_image', customApplyForm.proof_image);

      const res = await apiRequest('/supplies/requests', {
        method: 'POST',
        body: formData
      });

      alert(res.message || '직접 입력 납품 신청이 접수되었습니다!');
      setShowCustomApplyModal(false);
      setCustomItems([{ name: '', amount: 1, unit: '개', custom_unit: '' }]);
      setCustomApplyForm({ chest_location: '', notes: '', proof_image: null });
      loadData();
    } catch (err) {
      alert(err.message);
    }
  };

  const handleReview = async (reqItem, status) => {
    const id = reqItem.id;
    const comment = reviewComment[id] || '';
    const customPts = reviewPoints[id];
    const customCreds = reviewCredits[id];

    const confirmMsg = status === 'approved'
      ? `이 납품 신청을 승인하시겠습니까?\n지급 예정: +${Number(customPts || 0).toLocaleString()} P / +${Number(customCreds || 0).toLocaleString()} C`
      : `이 납품 신청을 거절하시겠습니까?`;
    if (!confirm(confirmMsg)) return;

    try {
      await apiRequest(`/supplies/requests/${id}/review`, {
        method: 'PUT',
        body: JSON.stringify({
          status,
          admin_comment: comment,
          custom_points: customPts,
          custom_credits: customCreds
        })
      });
      alert(`납품 신청이 ${status === 'approved' ? '승인' : '거절'}되었습니다.`);
      loadData();
      if (refreshUser) refreshUser();
    } catch (err) {
      alert(err.message);
    }
  };

  const handleSaveEditRequest = async (e) => {
    e.preventDefault();
    if (!editingRequest) return;
    try {
      const res = await apiRequest(`/supplies/requests/${editingRequest.id}/edit`, {
        method: 'PUT',
        body: JSON.stringify(editReqForm)
      });
      alert(res.message);
      setEditingRequest(null);
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

  const getSupplyCategory = (item) => {
    return SUPPLY_CATEGORIES.includes(item.category) ? item.category : '광물';
  };

  const getCategoryCount = (cat) => {
    if (cat === '전체') return supplies.length;
    return supplies.filter(it => getSupplyCategory(it) === cat).length;
  };

  const renderSupplyCard = (item) => {
    const catName = getSupplyCategory(item);
    const catStyle = SUPPLY_CATEGORY_STYLE[catName] || SUPPLY_CATEGORY_STYLE['광물'];

    return (
      <div key={item.id} className="card" style={{ marginBottom: 0, display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
              <div style={{ width: 44, height: 44, borderRadius: 'var(--radius-md)', background: 'var(--primary-container)', color: 'var(--on-primary-container)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <Package size={22} color="var(--primary)" />
              </div>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginBottom: 4 }}>
                  <span
                    className="badge"
                    style={{
                      background: catStyle.bg,
                      color: catStyle.color,
                      border: `1px solid ${catStyle.border}`,
                      fontSize: 11,
                      fontWeight: 700
                    }}
                  >
                    {catStyle.emoji} {catName}
                  </span>
                  <span style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 600 }}>단위: {item.unit}</span>
                </div>
                <h3 style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-main)' }}>{item.name}</h3>
              </div>
            </div>
            {canRegisterSupply && (
              <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                <button
                  onClick={() => openEditSupplyModal(item)}
                  style={{ background: 'none', border: 'none', color: 'var(--primary)', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}
                  title="품목 및 수치 수정"
                >
                  <Edit2 size={14} />
                </button>
                <button
                  onClick={() => handleDeleteSupply(item.id)}
                  style={{ background: 'none', border: 'none', color: 'var(--danger)', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}
                  title="삭제"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            )}
          </div>

          {item.description && (
            <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 12, lineHeight: 1.5, whiteSpace: 'pre-line' }}>
              {item.description}
            </p>
          )}

          <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
            <div className="asset-pill point" style={{ flex: 1, justifyContent: 'center' }}>
              +{item.points_per_unit.toLocaleString()} P / {item.unit}
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
            setApplyForm({ amount: 1, chest_location: '', notes: '', proof_image: null });
            setShowApplyModal(true);
          }}
        >
          납품 신청하기
        </button>
      </div>
    );
  };

  const categoriesToDisplay = selectedCategory === '전체'
    ? SUPPLY_CATEGORIES.filter(cat => getCategoryCount(cat) > 0)
    : [selectedCategory];

  return (
    <div>
      {/* 납품 공지사항 / 안내문 */}
      <div className="notice-banner" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--primary)', fontWeight: 700, marginBottom: 6 }}>
            <AlertCircle size={18} />
            <span>{notice.title || '납품 안내 사항'}</span>
          </div>
          <div style={{ color: 'var(--text-secondary)', fontSize: 13, whiteSpace: 'pre-line', lineHeight: 1.6 }}>
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
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h2 style={{ fontSize: 20, fontWeight: 700 }}>🌍 PlanetEarth 국가 물자 납품 품목</h2>
          <p style={{ color: 'var(--text-muted)', fontSize: 13, marginTop: 4 }}>
            플래닛어스(PlanetEarth) 서버 국가 창고에 지정 물자(광물 / 소모품 / 농산품)를 납품하거나, 목록에 없는 아이템도 <strong>[직접 아이템·수량 입력 납품]</strong>으로 신청할 수 있습니다.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button
            className="btn btn-primary"
            style={{ background: '#059669', border: '1px solid #047857' }}
            onClick={() => {
              setCustomItems([{ name: '', amount: 1, unit: '개', custom_unit: '' }]);
              setCustomApplyForm({ chest_location: '', notes: '', proof_image: null });
              setShowCustomApplyModal(true);
            }}
          >
            <ListPlus size={16} /> 직접 아이템·수량 입력 납품 신청
          </button>

          {canRegisterSupply && (
            <button
              className="btn btn-primary"
              onClick={() => openCreateSupplyModal()}
            >
              <Plus size={16} /> 지정 납품 품목 등록
            </button>
          )}
        </div>
      </div>

      {/* 자율 직접 입력 납품 상시 배너 카드 */}
      <div
        className="card"
        style={{
          marginBottom: 24,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 16,
          border: '2px dashed #10b981',
          background: 'linear-gradient(180deg, #ecfdf5 0%, #ffffff 100%)'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, flex: '1 1 380px' }}>
          <div style={{ width: 46, height: 46, borderRadius: 'var(--radius-md)', background: '#d1fae5', color: '#047857', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <Layers size={24} />
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <h3 style={{ fontSize: 16, fontWeight: 800, color: '#065f46' }}>자율 / 직접 입력 납품</h3>
              <span style={{ fontSize: 12, color: '#047857', background: '#d1fae5', padding: '2px 8px', borderRadius: 999, fontWeight: 700 }}>
                품목 제한 없음 · 다중 아이템 & 기타 단위 입력 지원
              </span>
            </div>
            <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 4, lineHeight: 1.5 }}>
              지정된 목록에 없는 아이템이나 여러 종류의 물자를 한 상자에 담아 납품할 때 직접 아이템명·수량·단위를 입력해 신청하세요!
            </p>
          </div>
        </div>

        <button
          className="btn btn-success"
          onClick={() => {
            setCustomItems([{ name: '', amount: 1, unit: '개', custom_unit: '' }]);
            setCustomApplyForm({ chest_location: '', notes: '', proof_image: null });
            setShowCustomApplyModal(true);
          }}
        >
          <ListPlus size={16} /> 직접 아이템 입력하여 납품하기
        </button>
      </div>

      {/* 카테고리 탭 필터 */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 24 }}>
        {['전체', ...SUPPLY_CATEGORIES].map((cat) => {
          const isActive = selectedCategory === cat;
          const count = getCategoryCount(cat);
          const catStyle = SUPPLY_CATEGORY_STYLE[cat];
          return (
            <button
              key={cat}
              type="button"
              onClick={() => setSelectedCategory(cat)}
              className={isActive ? 'btn btn-primary btn-sm' : 'btn btn-secondary btn-sm'}
              style={{
                padding: '8px 16px',
                fontSize: 13,
                fontWeight: isActive ? 700 : 600,
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6
              }}
            >
              <span>{catStyle ? `${catStyle.emoji} ${cat}` : `🗂️ 전체`}</span>
              <span
                style={{
                  background: isActive ? 'rgba(255,255,255,0.22)' : 'rgba(0,0,0,0.06)',
                  color: isActive ? '#ffffff' : 'var(--text-secondary)',
                  padding: '1px 7px',
                  borderRadius: 999,
                  fontSize: 11,
                  fontWeight: 700
                }}
              >
                {count}
              </span>
            </button>
          );
        })}
      </div>

      {/* 카테고리별 납품 가능한 품목 목록 */}
      <div style={{ marginBottom: 36 }}>
        {supplies.length === 0 ? (
          <div className="card" style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>
            등록된 지정 납품 품목이 없습니다.
          </div>
        ) : categoriesToDisplay.length === 0 ? (
          <div className="card" style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>
            등록된 지정 납품 품목이 없습니다.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
            {categoriesToDisplay.map((cat) => {
              const catItems = supplies.filter(it => getSupplyCategory(it) === cat);
              const catStyle = SUPPLY_CATEGORY_STYLE[cat] || SUPPLY_CATEGORY_STYLE['광물'];

              return (
                <div key={cat}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, paddingBottom: 8, borderBottom: '2px solid var(--border-color)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span
                        className="badge"
                        style={{
                          background: catStyle.bg,
                          color: catStyle.color,
                          border: `1px solid ${catStyle.border}`,
                          fontSize: 13,
                          fontWeight: 800,
                          padding: '5px 12px'
                        }}
                      >
                        {catStyle.emoji} {cat}
                      </span>
                      <span style={{ fontSize: 13, color: 'var(--text-muted)', fontWeight: 600 }}>
                        총 {catItems.length}개 품목
                      </span>
                    </div>
                    {canRegisterSupply && (
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        onClick={() => openCreateSupplyModal(cat)}
                      >
                        <Plus size={13} /> '{cat}' 품목 추가
                      </button>
                    )}
                  </div>

                  {catItems.length === 0 ? (
                    <div className="card" style={{ padding: 32, textAlign: 'center', color: 'var(--text-muted)', marginBottom: 0 }}>
                      현재 <strong>[{cat}]</strong> 카테고리에 등록된 납품 품목이 없습니다.
                    </div>
                  ) : (
                    <div className="grid-3">
                      {catItems.map(item => renderSupplyCard(item))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 납품 신청 내역 및 심사 목록 */}
      <div className="card">
        <div className="card-header">
          <div className="card-title">
            <Clock size={20} color="var(--primary)" />
            <span>{canManageSupply ? '납품 신청 심사 및 수치 정밀 관리' : '나의 납품 신청 내역'}</span>
          </div>
        </div>

        <div className="table-container">
          <table className="table">
            <thead>
              <tr>
                <th>번호</th>
                <th>신청자</th>
                <th>구분 / 납품 물품</th>
                <th>수량</th>
                <th>상자 위치 / 비고</th>
                <th>스크린샷</th>
                <th>획득 예정 / 지급 수치</th>
                <th>상태</th>
                {canManageSupply && <th>심사 / 수치 조절</th>}
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
                requests.map((req) => {
                  const catName = SUPPLY_CATEGORIES.includes(req.supply_category) ? req.supply_category : '광물';
                  const catStyle = SUPPLY_CATEGORY_STYLE[catName] || SUPPLY_CATEGORY_STYLE['광물'];
                  return (
                    <tr key={req.id}>
                      <td>#{req.id}</td>
                      <td>
                        <div>
                          <span style={{ fontWeight: 600 }}>{req.nickname || req.username}</span>
                          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>@{req.username}</div>
                        </div>
                      </td>
                      <td>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                          {req.is_custom === 1 ? (
                            <span className="badge" style={{ background: '#d1fae5', color: '#065f46', width: 'fit-content', fontSize: 11 }}>
                              ✍️ 직접 입력 납품
                            </span>
                          ) : (
                            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                              <span className="badge badge-role" style={{ width: 'fit-content', fontSize: 11 }}>
                                📦 지정 품목
                              </span>
                              <span
                                className="badge"
                                style={{
                                  background: catStyle.bg,
                                  color: catStyle.color,
                                  border: `1px solid ${catStyle.border}`,
                                  width: 'fit-content',
                                  fontSize: 11
                                }}
                              >
                                {catStyle.emoji} {catName}
                              </span>
                            </div>
                          )}
                          <span style={{ fontWeight: 700, color: 'var(--text-main)' }}>{req.supply_name}</span>
                        </div>
                      </td>
                      <td>{req.amount} {req.unit}</td>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4, color: 'var(--text-secondary)', fontSize: 13 }}>
                          <MapPin size={14} /> {req.chest_location}
                        </div>
                        {req.notes && (
                          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                            메모: {req.notes}
                          </div>
                        )}
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
                        {req.status === 'approved' ? (
                          <div style={{ fontSize: 12 }}>
                            <span style={{ color: 'var(--point-gold)', fontWeight: 700 }}>+{req.points_earned?.toLocaleString() || 0} P</span>
                            <span style={{ margin: '0 4px', color: '#64748b' }}>|</span>
                            <span style={{ color: 'var(--point-emerald)', fontWeight: 700 }}>+{req.credits_earned?.toLocaleString() || 0} C</span>
                          </div>
                        ) : req.is_custom === 1 ? (
                          <span style={{ fontSize: 12, color: '#047857', fontWeight: 600 }}>심사 시 관리자 직접 산정</span>
                        ) : (
                          <div style={{ fontSize: 12 }}>
                            <span style={{ color: 'var(--point-gold)', fontWeight: 600 }}>+{(req.amount * req.points_per_unit).toLocaleString()} P</span>
                            <span style={{ margin: '0 4px', color: '#64748b' }}>|</span>
                            <span style={{ color: 'var(--point-emerald)', fontWeight: 600 }}>+{(req.amount * req.credits_per_unit).toLocaleString()} C</span>
                          </div>
                        )}
                      </td>
                      <td>
                        {req.status === 'pending' && <span className="badge badge-pending">심사 대기중</span>}
                        {req.status === 'approved' && <span className="badge badge-approved">승인 완료</span>}
                        {req.status === 'rejected' && <span className="badge badge-rejected">거절됨</span>}
                        {req.admin_comment && (
                          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                            사유/비고: {req.admin_comment}
                          </div>
                        )}
                      </td>
                      {canManageSupply && (
                        <td>
                          {req.status === 'pending' ? (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 210 }}>
                              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
                                <div>
                                  <label style={{ fontSize: 10, color: 'var(--text-muted)', display: 'block' }}>지급 포인트(P)</label>
                                  <input
                                    type="number"
                                    className="input"
                                    style={{ padding: '4px 6px', fontSize: 12 }}
                                    value={reviewPoints[req.id] ?? (req.amount * req.points_per_unit)}
                                    onChange={(e) => setReviewPoints({ ...reviewPoints, [req.id]: e.target.value })}
                                  />
                                </div>
                                <div>
                                  <label style={{ fontSize: 10, color: 'var(--text-muted)', display: 'block' }}>지급 크레딧(C)</label>
                                  <input
                                    type="number"
                                    className="input"
                                    style={{ padding: '4px 6px', fontSize: 12 }}
                                    value={reviewCredits[req.id] ?? (req.amount * req.credits_per_unit)}
                                    onChange={(e) => setReviewCredits({ ...reviewCredits, [req.id]: e.target.value })}
                                  />
                                </div>
                              </div>
                              <input
                                type="text"
                                className="input"
                                placeholder="승인 메모 / 반려 사유 (선택)"
                                style={{ padding: '4px 8px', fontSize: 12 }}
                                value={reviewComment[req.id] || ''}
                                onChange={(e) => setReviewComment({ ...reviewComment, [req.id]: e.target.value })}
                              />
                              <div style={{ display: 'flex', gap: 6 }}>
                                <button className="btn btn-success btn-sm" style={{ flex: 1 }} onClick={() => handleReview(req, 'approved')}>
                                  <CheckCircle size={13} /> 승인
                                </button>
                                <button className="btn btn-danger btn-sm" style={{ flex: 1 }} onClick={() => handleReview(req, 'rejected')}>
                                  <XCircle size={13} /> 거절
                                </button>
                              </div>
                            </div>
                          ) : (
                            <button
                              className="btn btn-secondary btn-sm"
                              onClick={() => {
                                setEditingRequest(req);
                                setEditReqForm({
                                  custom_item_name: req.supply_name || '',
                                  amount: req.amount || 1,
                                  chest_location: req.chest_location || '',
                                  points_earned: req.points_earned || 0,
                                  credits_earned: req.credits_earned || 0,
                                  admin_comment: req.admin_comment || ''
                                });
                              }}
                            >
                              <Edit2 size={12} /> 수치/내역 수정
                            </button>
                          )}
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

      {/* 지정 품목 납품 신청 모달 */}
      {showApplyModal && selectedSupply && (
        <div className="modal-overlay">
          <div className="modal-content">
            <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 16 }}>
              📦 [{selectedSupply.category || '광물'}] {selectedSupply.name} 납품 신청
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
                <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 4 }}>
                  예상 기본 보상: <span style={{ color: 'var(--point-gold)', fontWeight: 700 }}>{(applyForm.amount * selectedSupply.points_per_unit).toLocaleString()} 포인트</span> / <span style={{ color: 'var(--point-emerald)', fontWeight: 700 }}>{(applyForm.amount * selectedSupply.credits_per_unit).toLocaleString()} 크레딧</span>
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
                <label className="form-label">기타 메모 (선택)</label>
                <input
                  type="text"
                  className="input"
                  placeholder="추가 전달 사항이 있다면 입력하세요"
                  value={applyForm.notes}
                  onChange={(e) => setApplyForm({ ...applyForm, notes: e.target.value })}
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

      {/* 자율 / 직접 아이템 & 수량 입력 납품 모달 */}
      {showCustomApplyModal && (
        <div className="modal-overlay">
          <div className="modal-content" style={{ maxWidth: 680 }}>
            <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 6, display: 'flex', alignItems: 'center', gap: 8 }}>
              <ListPlus color="#059669" size={22} />
              <span>직접 아이템 및 수량 입력 납품 신청</span>
            </h2>
            <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 18 }}>
              등록된 목록에 없는 아이템이거나 여러 종류의 물자를 동시에 납품할 때 아이템 이름과 수량·단위를 직접 입력하여 신청할 수 있습니다.
            </p>

            <form onSubmit={handleSubmitCustomSupply}>
              <div className="form-group">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <label className="form-label" style={{ marginBottom: 0 }}>납품할 아이템 및 수량 목록</label>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={handleAddCustomItemRow}
                  >
                    <Plus size={13} /> 아이템 행 추가
                  </button>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {customItems.map((row, idx) => (
                    <div
                      key={idx}
                      style={{
                        display: 'grid',
                        gridTemplateColumns: row.unit === '기타' ? '1fr 90px 125px 120px auto' : '1fr 110px 135px auto',
                        gap: 8,
                        alignItems: 'center'
                      }}
                    >
                      <input
                        type="text"
                        className="input"
                        placeholder="아이템 이름 (예: 다이아몬드 블록, 화약 등)"
                        value={row.name}
                        onChange={(e) => handleChangeCustomItem(idx, 'name', e.target.value)}
                        required
                      />
                      <input
                        type="number"
                        min="1"
                        className="input"
                        placeholder="수량"
                        value={row.amount}
                        onChange={(e) => handleChangeCustomItem(idx, 'amount', e.target.value)}
                        required
                      />
                      <select
                        className="select"
                        value={row.unit}
                        onChange={(e) => handleChangeCustomItem(idx, 'unit', e.target.value)}
                      >
                        <option value="개">개</option>
                        <option value="세트">세트 (64개)</option>
                        <option value="상자">상자 (단일)</option>
                        <option value="큰상자">큰상자 (더블)</option>
                        <option value="셜커상자">셜커상자</option>
                        <option value="기타">기타 (직접 입력)</option>
                      </select>
                      {row.unit === '기타' && (
                        <input
                          type="text"
                          className="input"
                          placeholder="단위 직접 입력"
                          value={row.custom_unit || ''}
                          onChange={(e) => handleChangeCustomItem(idx, 'custom_unit', e.target.value)}
                          required
                        />
                      )}
                      {customItems.length > 1 && (
                        <button
                          type="button"
                          className="btn btn-danger btn-sm"
                          onClick={() => handleRemoveCustomItemRow(idx)}
                          style={{ padding: '8px 10px' }}
                        >
                          <Trash2 size={14} />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              <div className="form-group">
                <label className="form-label">상자의 위치 (좌표 / 장소 설명)</label>
                <input
                  type="text"
                  className="input"
                  placeholder="예: X: 120, Y: 64, Z: -350 국가 중앙 창고 5번 상자 (/n spawn)"
                  value={customApplyForm.chest_location}
                  onChange={(e) => setCustomApplyForm({ ...customApplyForm, chest_location: e.target.value })}
                  required
                />
              </div>

              <div className="form-group">
                <label className="form-label">기타 상세 설명 / 희망 보상 메모 (선택)</label>
                <textarea
                  className="textarea"
                  rows="2"
                  placeholder="특수 인챈트 여부나 추가 설명이 있다면 자유롭게 적어주세요."
                  value={customApplyForm.notes}
                  onChange={(e) => setCustomApplyForm({ ...customApplyForm, notes: e.target.value })}
                />
              </div>

              <div className="form-group">
                <label className="form-label">상자 속 아이템 캡쳐 스크린샷 첨부</label>
                <input
                  type="file"
                  accept="image/*"
                  className="input"
                  onChange={(e) => setCustomApplyForm({ ...customApplyForm, proof_image: e.target.files[0] })}
                  required
                />
              </div>

              <div style={{ display: 'flex', gap: 10, marginTop: 24 }}>
                <button type="button" className="btn btn-secondary" onClick={() => setShowCustomApplyModal(false)} style={{ flex: 1 }}>
                  취소
                </button>
                <button type="submit" className="btn btn-success" style={{ flex: 1 }}>
                  직접 입력 납품 신청하기
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 납품 내역/수치 사후 정정 모달 ('납품 관리') */}
      {editingRequest && (
        <div className="modal-overlay">
          <div className="modal-content">
            <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 16 }}>
              ✏️ 납품 기록 #{editingRequest.id} 세부 수치 수정
            </h2>
            <form onSubmit={handleSaveEditRequest}>
              <div className="form-group">
                <label className="form-label">물품명 표시</label>
                <input
                  type="text"
                  className="input"
                  value={editReqForm.custom_item_name}
                  onChange={(e) => setEditReqForm({ ...editReqForm, custom_item_name: e.target.value })}
                />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div className="form-group">
                  <label className="form-label">수량</label>
                  <input
                    type="number"
                    className="input"
                    value={editReqForm.amount}
                    onChange={(e) => setEditReqForm({ ...editReqForm, amount: e.target.value })}
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">상자 위치</label>
                  <input
                    type="text"
                    className="input"
                    value={editReqForm.chest_location}
                    onChange={(e) => setEditReqForm({ ...editReqForm, chest_location: e.target.value })}
                  />
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div className="form-group">
                  <label className="form-label">지급된 국가 기여 포인트 (변경 시 유저 잔액 자동 반영)</label>
                  <input
                    type="number"
                    className="input"
                    value={editReqForm.points_earned}
                    onChange={(e) => setEditReqForm({ ...editReqForm, points_earned: e.target.value })}
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">지급된 크레딧 (변경 시 유저 잔액 자동 반영)</label>
                  <input
                    type="number"
                    className="input"
                    value={editReqForm.credits_earned}
                    onChange={(e) => setEditReqForm({ ...editReqForm, credits_earned: e.target.value })}
                  />
                </div>
              </div>
              <div className="form-group">
                <label className="form-label">관리자 코멘트 / 사유</label>
                <input
                  type="text"
                  className="input"
                  value={editReqForm.admin_comment}
                  onChange={(e) => setEditReqForm({ ...editReqForm, admin_comment: e.target.value })}
                />
              </div>
              <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
                <button type="button" className="btn btn-secondary" onClick={() => setEditingRequest(null)} style={{ flex: 1 }}>
                  취소
                </button>
                <button type="submit" className="btn btn-primary" style={{ flex: 1 }}>
                  수정 저장
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 납품 상품 등록/수정 모달 (권한자) */}
      {showAddModal && (
        <div className="modal-overlay">
          <div className="modal-content">
            <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 16 }}>
              {editingSupply ? '납품 품목 및 단가 수치 수정' : '새 지정 납품 품목 등록'}
            </h2>
            <form onSubmit={handleSaveSupply}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div className="form-group">
                  <label className="form-label">카테고리</label>
                  <select
                    className="select"
                    value={newSupply.category}
                    onChange={(e) => setNewSupply({ ...newSupply, category: e.target.value })}
                  >
                    {SUPPLY_CATEGORIES.map((cat) => (
                      <option key={cat} value={cat}>{cat}</option>
                    ))}
                  </select>
                </div>

                <div className="form-group">
                  <label className="form-label">단위</label>
                  <select
                    className="select"
                    value={newSupply.unit}
                    onChange={(e) => setNewSupply({ ...newSupply, unit: e.target.value })}
                  >
                    <option value="개">개</option>
                    <option value="세트">세트 (64개)</option>
                    <option value="상자">상자 (단일)</option>
                    <option value="큰상자">큰상자 (더블)</option>
                    <option value="셜커상자">셜커상자</option>
                    <option value="기타">기타 (직접 입력)</option>
                  </select>
                </div>
              </div>

              {newSupply.unit === '기타' && (
                <div className="form-group">
                  <label className="form-label">기타 단위 직접 입력</label>
                  <input
                    type="text"
                    className="input"
                    placeholder="예: 블록, 묶음, 세트(16개), 인벤토리, 더블상자 등"
                    value={newSupply.custom_unit}
                    onChange={(e) => setNewSupply({ ...newSupply, custom_unit: e.target.value })}
                    required
                  />
                </div>
              )}

              <div className="form-group">
                <label className="form-label">상품명</label>
                <input
                  type="text"
                  className="input"
                  placeholder="예: 철 주괴, 옵시디언, 황금 사과, 밀 블록 등"
                  value={newSupply.name}
                  onChange={(e) => setNewSupply({ ...newSupply, name: e.target.value })}
                  required
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div className="form-group">
                  <label className="form-label">국가 기여 포인트 (단위당)</label>
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
                  {editingSupply ? '품목 수정 저장' : '품목 등록하기'}
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

              <div style={{
                marginTop: 20,
                padding: 16,
                background: 'var(--bg-tertiary)',
                borderRadius: 'var(--radius-md)',
                border: '1px solid var(--border-color)'
              }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700, fontSize: 14, color: 'var(--primary)' }}>
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
                    placeholder="https://discord.com/api/webhooks/..."
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
                    placeholder="비워두면 기본 공지 내용이 그대로 전송됩니다."
                    value={noticeForm.message_template}
                    onChange={(e) => setNoticeForm({ ...noticeForm, message_template: e.target.value })}
                  />
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
                  <Send size={15} /> 저장 & 즉시 알림
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
