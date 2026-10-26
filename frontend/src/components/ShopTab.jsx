import React, { useState, useEffect } from 'react';
import { apiRequest } from '../api';
import { ShoppingBag, Plus, CheckCircle, Trash2, Edit2, Tag, XCircle, Layers } from 'lucide-react';

export const SHOP_CATEGORIES = [
  '일상, 전투 아이템',
  '광물',
  '강화',
  '내부 혜택',
  '랭크'
];

export const SHOP_PRESET_UNITS = [
  '개',
  '세트',
  '상자',
  '큰상자',
  '셜커상자',
  '회',
  '영구'
];

const SHOP_CATEGORY_STYLE = {
  '일상, 전투 아이템': { bg: '#dbeafe', color: '#1d4ed8', border: '#bfdbfe', emoji: '⚔️' },
  '광물': { bg: '#e0f2fe', color: '#0369a1', border: '#bae6fd', emoji: '💎' },
  '강화': { bg: '#fef3c7', color: '#b45309', border: '#fde68a', emoji: '✨' },
  '내부 혜택': { bg: '#d1fae5', color: '#047857', border: '#a7f3d0', emoji: '🎁' },
  '랭크': { bg: '#ede9fe', color: '#6d28d9', border: '#ddd6fe', emoji: '👑' }
};

export default function ShopTab({ user, refreshUser }) {
  const [items, setItems] = useState([]);
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedCategory, setSelectedCategory] = useState('전체');

  // 모달 상태
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingItem, setEditingItem] = useState(null);
  const [newItem, setNewItem] = useState({
    name: '',
    category: '일상, 전투 아이템',
    unit: '개',
    custom_unit: '',
    price: 100,
    stock: -1,
    description: '',
    image_url: ''
  });

  const canManageShop = user.is_admin || user.permissions?.includes('샵 관리');

  const loadData = async () => {
    try {
      setLoading(true);
      const [itemsData, ordersData] = await Promise.all([
        apiRequest('/shop/items'),
        apiRequest('/shop/orders')
      ]);
      setItems(itemsData);
      setOrders(ordersData);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const openCreateModal = (defaultCat) => {
    const initialCat = defaultCat && defaultCat !== '전체' ? defaultCat : (selectedCategory !== '전체' ? selectedCategory : '일상, 전투 아이템');
    setEditingItem(null);
    setNewItem({
      name: '',
      category: initialCat,
      unit: '개',
      custom_unit: '',
      price: 100,
      stock: -1,
      description: '',
      image_url: ''
    });
    setShowAddModal(true);
  };

  const openEditModal = (item) => {
    const itemUnit = item.unit || '개';
    const isPresetUnit = SHOP_PRESET_UNITS.includes(itemUnit);
    const itemCat = SHOP_CATEGORIES.includes(item.category) ? item.category : '일상, 전투 아이템';

    setEditingItem(item);
    setNewItem({
      name: item.name,
      category: itemCat,
      unit: isPresetUnit ? itemUnit : '기타',
      custom_unit: isPresetUnit ? '' : itemUnit,
      price: item.price,
      stock: item.stock,
      description: item.description || '',
      image_url: item.image_url || ''
    });
    setShowAddModal(true);
  };

  const handleCreateOrUpdateItem = async (e) => {
    e.preventDefault();
    const resolvedUnit = newItem.unit === '기타' ? (newItem.custom_unit || '').trim() : newItem.unit;
    if (!resolvedUnit) {
      alert('기타 단위를 직접 입력해주세요.');
      return;
    }

    const payload = {
      ...newItem,
      category: newItem.category || '일상, 전투 아이템',
      unit: resolvedUnit,
      custom_unit: newItem.unit === '기타' ? resolvedUnit : ''
    };

    try {
      if (editingItem) {
        await apiRequest(`/shop/items/${editingItem.id}`, {
          method: 'PUT',
          body: JSON.stringify(payload)
        });
        alert('상품이 수정되었습니다.');
      } else {
        await apiRequest('/shop/items', {
          method: 'POST',
          body: JSON.stringify(payload)
        });
        alert('상품이 등록되었습니다.');
      }
      setShowAddModal(false);
      setEditingItem(null);
      loadData();
    } catch (err) {
      alert(err.message);
    }
  };

  const handleDeleteItem = async (id) => {
    if (!confirm('이 상품을 삭제하시겠습니까?')) return;
    try {
      await apiRequest(`/shop/items/${id}`, { method: 'DELETE' });
      loadData();
    } catch (err) {
      alert(err.message);
    }
  };

  const handlePurchase = async (item) => {
    if (user.points < item.price) {
      alert('보유하신 연방 포인트가 부족합니다.');
      return;
    }
    const unitLabel = item.unit || '개';
    if (!confirm(`[${item.category || '일상, 전투 아이템'}] ${item.name} (단위: ${unitLabel}) 상품을 ${item.price.toLocaleString()} 연방 포인트로 구매하시겠습니까?`)) return;

    try {
      await apiRequest('/shop/purchase', {
        method: 'POST',
        body: JSON.stringify({ item_id: item.id })
      });
      alert('구매 신청이 완료되었습니다! 샵 관리자가 인게임으로 아이템을 지급합니다.');
      loadData();
      if (refreshUser) refreshUser();
    } catch (err) {
      alert(err.message);
    }
  };

  const handleDeliver = async (orderId) => {
    try {
      await apiRequest(`/shop/orders/${orderId}/deliver`, { method: 'PUT' });
      alert('아이템 지급 처리가 완료되었습니다.');
      loadData();
    } catch (err) {
      alert(err.message);
    }
  };

  const handleCancelOrder = async (orderId) => {
    if (!confirm('이 주문을 취소하고 사용자에게 연방 포인트와 상품 재고를 환불하시겠습니까?')) return;
    try {
      const res = await apiRequest(`/shop/orders/${orderId}/cancel`, { method: 'PUT' });
      alert(res.message || '주문이 취소 및 환불되었습니다.');
      loadData();
      if (refreshUser) refreshUser();
    } catch (err) {
      alert(err.message);
    }
  };

  const getItemCategory = (item) => {
    return SHOP_CATEGORIES.includes(item.category) ? item.category : '일상, 전투 아이템';
  };

  const getCategoryCount = (cat) => {
    if (cat === '전체') return items.length;
    return items.filter(it => getItemCategory(it) === cat).length;
  };

  const renderItemCard = (item) => {
    const canAfford = user.points >= item.price;
    const isOutOfStock = item.stock === 0;
    const catName = getItemCategory(item);
    const catStyle = SHOP_CATEGORY_STYLE[catName] || SHOP_CATEGORY_STYLE['일상, 전투 아이템'];
    const unitLabel = item.unit || '개';

    return (
      <div key={item.id} className="card" style={{ marginBottom: 0, display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
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
                <span
                  className="badge"
                  style={{
                    background: 'var(--bg-tertiary)',
                    color: 'var(--text-secondary)',
                    border: '1px solid var(--border-color)',
                    fontSize: 11
                  }}
                >
                  단위: {unitLabel}
                </span>
              </div>
              <h3 style={{ fontSize: 17, fontWeight: 700, color: 'var(--text-main)' }}>{item.name}</h3>
            </div>

            {canManageShop && (
              <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                <button
                  onClick={() => openEditModal(item)}
                  style={{ background: 'none', border: 'none', color: 'var(--primary)', cursor: 'pointer' }}
                  title="상품 수정"
                >
                  <Edit2 size={14} />
                </button>
                <button
                  onClick={() => handleDeleteItem(item.id)}
                  style={{ background: 'none', border: 'none', color: 'var(--danger)', cursor: 'pointer' }}
                  title="상품 삭제"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            )}
          </div>

          <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 10, minHeight: 40, lineHeight: 1.5, whiteSpace: 'pre-line' }}>
            {item.description || '등록된 상세 설명이 없습니다.'}
          </p>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--border-subtle)' }}>
            <div style={{ fontSize: 12, color: item.stock === 0 ? 'var(--danger)' : 'var(--text-muted)', fontWeight: 600 }}>
              재고: {item.stock === -1 ? '무제한' : `${item.stock} (${unitLabel})`}
            </div>
            <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--point-gold)' }}>
              {item.price.toLocaleString()} P <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)' }}>/ {unitLabel}</span>
            </div>
          </div>
        </div>

        <button
          className="btn btn-primary"
          style={{ width: '100%', marginTop: 18 }}
          disabled={!canAfford || isOutOfStock}
          onClick={() => handlePurchase(item)}
        >
          {isOutOfStock ? '품절' : !canAfford ? '포인트 부족' : '구매하기'}
        </button>
      </div>
    );
  };

  const categoriesToDisplay = selectedCategory === '전체'
    ? SHOP_CATEGORIES.filter(cat => getCategoryCount(cat) > 0)
    : [selectedCategory];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h2 style={{ fontSize: 20, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 10 }}>
            <ShoppingBag color="#3b82f6" size={24} />
            <span>연방 포인트 상점</span>
          </h2>
          <p style={{ color: '#94a3b8', fontSize: 13, marginTop: 4 }}>
            기여도를 통해 획득한 연방 포인트로 카테고리별 아이템, 광물, 강화, 내부 혜택, 랭크를 구매하세요.
          </p>
        </div>

        {canManageShop && (
          <button
            className="btn btn-primary"
            onClick={() => openCreateModal()}
          >
            <Plus size={16} /> 상품 등록
          </button>
        )}
      </div>

      {/* 내 보유 포인트 강조 배너 */}
      <div style={{ background: '#ffffff', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-lg)', padding: '20px 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, boxShadow: 'var(--shadow-sm)', flexWrap: 'wrap', gap: 10 }}>
        <div>
          <span style={{ fontSize: 13, color: 'var(--text-muted)', fontWeight: 600 }}>내 보유 연방 포인트</span>
          <div style={{ fontSize: 24, fontWeight: 800, color: 'var(--point-gold)', marginTop: 2 }}>
            {user.points?.toLocaleString() || 0} P
          </div>
        </div>
        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
          * 포인트는 납품, 퀘스트, 단기 알바 완수 시 지급됩니다.
        </span>
      </div>

      {/* 카테고리 탭 필터 */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 24 }}>
        {['전체', ...SHOP_CATEGORIES].map((cat) => {
          const isActive = selectedCategory === cat;
          const count = getCategoryCount(cat);
          const catStyle = SHOP_CATEGORY_STYLE[cat];
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

      {/* 카테고리별 상품 목록 */}
      <div style={{ marginBottom: 36 }}>
        {items.length === 0 ? (
          <div className="card" style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>
            등록된 상점 상품이 없습니다.
          </div>
        ) : categoriesToDisplay.length === 0 ? (
          <div className="card" style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>
            등록된 상점 상품이 없습니다.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
            {categoriesToDisplay.map((cat) => {
              const catItems = items.filter(it => getItemCategory(it) === cat);
              const catStyle = SHOP_CATEGORY_STYLE[cat] || SHOP_CATEGORY_STYLE['일상, 전투 아이템'];

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
                        총 {catItems.length}개 상품
                      </span>
                    </div>
                    {canManageShop && (
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        onClick={() => openCreateModal(cat)}
                      >
                        <Plus size={13} /> '{cat}' 상품 추가
                      </button>
                    )}
                  </div>

                  {catItems.length === 0 ? (
                    <div className="card" style={{ padding: 32, textAlign: 'center', color: 'var(--text-muted)', marginBottom: 0 }}>
                      현재 <strong>[{cat}]</strong> 카테고리에 등록된 상품이 없습니다.
                    </div>
                  ) : (
                    <div className="grid-3">
                      {catItems.map(item => renderItemCard(item))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 주문 및 수령 내역 */}
      <div className="card">
        <div className="card-header">
          <div className="card-title">
            <Tag size={20} color="var(--primary)" />
            <span>{canManageShop ? '유저 포인트 상점 주문 관리' : '내 주문 및 수령 내역'}</span>
          </div>
        </div>

        <div className="table-container">
          <table className="table">
            <thead>
              <tr>
                <th>주문 번호</th>
                <th>신청자</th>
                <th>카테고리 / 상품명</th>
                <th>사용 포인트</th>
                <th>주문 일시</th>
                <th>상태</th>
                {canManageShop && <th>지급 처리</th>}
              </tr>
            </thead>
            <tbody>
              {orders.length === 0 ? (
                <tr>
                  <td colSpan={canManageShop ? 7 : 6} style={{ textAlign: 'center', padding: 24, color: '#64748b' }}>
                    주문 내역이 없습니다.
                  </td>
                </tr>
              ) : (
                orders.map((order) => {
                  const catName = SHOP_CATEGORIES.includes(order.item_category) ? order.item_category : '일상, 전투 아이템';
                  const catStyle = SHOP_CATEGORY_STYLE[catName] || SHOP_CATEGORY_STYLE['일상, 전투 아이템'];
                  return (
                    <tr key={order.id}>
                      <td>#{order.id}</td>
                      <td>
                        <span style={{ fontWeight: 600 }}>{order.nickname || order.username}</span>
                        <div style={{ fontSize: 11, color: '#64748b' }}>@{order.username}</div>
                      </td>
                      <td>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
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
                          <div>
                            <span style={{ fontWeight: 700, color: 'var(--text-main)' }}>{order.item_name}</span>
                            <span style={{ fontSize: 12, color: 'var(--text-muted)', marginLeft: 6 }}>
                              (단위: {order.item_unit || '개'})
                            </span>
                          </div>
                        </div>
                      </td>
                      <td><span style={{ color: 'var(--point-gold)', fontWeight: 700 }}>{order.points_spent.toLocaleString()} P</span></td>
                      <td style={{ fontSize: 13, color: '#94a3b8' }}>{order.created_at}</td>
                      <td>
                        {order.status === 'pending' && (
                          <span className="badge badge-pending">지급 대기중</span>
                        )}
                        {order.status === 'delivered' && (
                          <span className="badge badge-delivered">인게임 지급 완료</span>
                        )}
                        {order.status === 'cancelled' && (
                          <span className="badge badge-rejected">주문 취소/환불됨</span>
                        )}
                      </td>
                      {canManageShop && (
                        <td>
                          {order.status === 'pending' ? (
                            <div style={{ display: 'flex', gap: 6 }}>
                              <button className="btn btn-success btn-sm" onClick={() => handleDeliver(order.id)}>
                                <CheckCircle size={13} /> 지급 완료
                              </button>
                              <button className="btn btn-danger btn-sm" onClick={() => handleCancelOrder(order.id)}>
                                <XCircle size={13} /> 취소·환불
                              </button>
                            </div>
                          ) : order.status === 'delivered' ? (
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              <span style={{ fontSize: 12, color: '#64748b' }}>지급됨</span>
                              <button className="btn btn-secondary btn-sm" style={{ padding: '2px 8px', fontSize: 11 }} onClick={() => handleCancelOrder(order.id)}>
                                환불 취소
                              </button>
                            </div>
                          ) : (
                            <span style={{ fontSize: 12, color: '#ef4444' }}>환불 완료</span>
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

      {/* 상품 등록/수정 모달 */}
      {showAddModal && (
        <div className="modal-overlay">
          <div className="modal-content">
            <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 16 }}>
              {editingItem ? '상점 상품 수정' : '새 상점 상품 등록'}
            </h2>
            <form onSubmit={handleCreateOrUpdateItem}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div className="form-group">
                  <label className="form-label">카테고리</label>
                  <select
                    className="select"
                    value={newItem.category}
                    onChange={(e) => setNewItem({ ...newItem, category: e.target.value })}
                  >
                    {SHOP_CATEGORIES.map((cat) => (
                      <option key={cat} value={cat}>{cat}</option>
                    ))}
                  </select>
                </div>

                <div className="form-group">
                  <label className="form-label">단위</label>
                  <select
                    className="select"
                    value={newItem.unit}
                    onChange={(e) => setNewItem({ ...newItem, unit: e.target.value })}
                  >
                    <option value="개">개</option>
                    <option value="세트">세트 (64개)</option>
                    <option value="상자">상자 (단일)</option>
                    <option value="큰상자">큰상자 (더블)</option>
                    <option value="셜커상자">셜커상자</option>
                    <option value="회">회 (1회권)</option>
                    <option value="영구">영구</option>
                    <option value="기타">기타 (직접 입력)</option>
                  </select>
                </div>
              </div>

              {newItem.unit === '기타' && (
                <div className="form-group">
                  <label className="form-label">기타 단위 직접 입력</label>
                  <input
                    type="text"
                    className="input"
                    placeholder="예: 1주일, 권, 묶음, 세트(16개), 풀세트 등"
                    value={newItem.custom_unit}
                    onChange={(e) => setNewItem({ ...newItem, custom_unit: e.target.value })}
                    required
                  />
                </div>
              )}

              <div className="form-group">
                <label className="form-label">상품명</label>
                <input
                  type="text"
                  className="input"
                  placeholder="예: 네더라이트 강화 도구, 특별 칭호권 등"
                  value={newItem.name}
                  onChange={(e) => setNewItem({ ...newItem, name: e.target.value })}
                  required
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div className="form-group">
                  <label className="form-label">필요 연방 포인트 (단위당)</label>
                  <input
                    type="number"
                    min="0"
                    className="input"
                    value={newItem.price}
                    onChange={(e) => setNewItem({ ...newItem, price: e.target.value })}
                    required
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">재고 (-1은 무제한)</label>
                  <input
                    type="number"
                    className="input"
                    value={newItem.stock}
                    onChange={(e) => setNewItem({ ...newItem, stock: e.target.value })}
                    required
                  />
                </div>
              </div>

              <div className="form-group">
                <label className="form-label">상품 설명</label>
                <textarea
                  className="textarea"
                  rows="3"
                  value={newItem.description}
                  onChange={(e) => setNewItem({ ...newItem, description: e.target.value })}
                  placeholder="아이템 옵션이나 수령 안내를 작성하세요."
                />
              </div>

              <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
                <button type="button" className="btn btn-secondary" onClick={() => setShowAddModal(false)} style={{ flex: 1 }}>
                  취소
                </button>
                <button type="submit" className="btn btn-primary" style={{ flex: 1 }}>
                  {editingItem ? '수정 완료' : '등록하기'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
