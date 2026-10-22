import React, { useState, useEffect } from 'react';
import { apiRequest } from '../api';
import { ShoppingBag, Plus, CheckCircle, Trash2, Edit2, Tag, XCircle } from 'lucide-react';

export default function ShopTab({ user, refreshUser }) {
  const [items, setItems] = useState([]);
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);

  // 모달 상태
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingItem, setEditingItem] = useState(null);
  const [newItem, setNewItem] = useState({ name: '', price: 100, stock: -1, description: '', image_url: '' });

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

  const handleCreateOrUpdateItem = async (e) => {
    e.preventDefault();
    try {
      if (editingItem) {
        await apiRequest(`/shop/items/${editingItem.id}`, {
          method: 'PUT',
          body: JSON.stringify(newItem)
        });
        alert('상품이 수정되었습니다.');
      } else {
        await apiRequest('/shop/items', {
          method: 'POST',
          body: JSON.stringify(newItem)
        });
        alert('상품이 등록되었습니다.');
      }
      setShowAddModal(false);
      setEditingItem(null);
      setNewItem({ name: '', price: 100, stock: -1, description: '', image_url: '' });
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
    if (!confirm(`[${item.name}] 상품을 ${item.price} 연방 포인트로 구매하시겠습니까?`)) return;

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

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div>
          <h2 style={{ fontSize: 20, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 10 }}>
            <ShoppingBag color="#3b82f6" size={24} />
            <span>연방 포인트 샵</span>
          </h2>
          <p style={{ color: '#94a3b8', fontSize: 13, marginTop: 4 }}>
            기여도를 통해 획득한 연방 포인트로 인게임 특수 아이템과 장비를 구매하세요.
          </p>
        </div>

        {canManageShop && (
          <button
            className="btn btn-primary"
            onClick={() => {
              setEditingItem(null);
              setNewItem({ name: '', price: 100, stock: -1, description: '', image_url: '' });
              setShowAddModal(true);
            }}
          >
            <Plus size={16} /> 상품 등록
          </button>
        )}
      </div>

      {/* 내 보유 포인트 강조 배너 */}
      <div style={{ background: '#ffffff', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-lg)', padding: '20px 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 28, boxShadow: 'var(--shadow-sm)' }}>
        <div>
          <span style={{ fontSize: 13, color: 'var(--text-muted)', fontWeight: 600 }}>내 보유 연방 포인트</span>
          <div style={{ fontSize: 24, fontWeight: 800, color: 'var(--point-gold)', marginTop: 2 }}>
            {user.points?.toLocaleString() || 0} P
          </div>
        </div>
        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
          * 포인트는 납품 및 퀘스트 완수 시 지급됩니다.
        </span>
      </div>

      {/* 상품 목록 카드 */}
      <div className="grid-3" style={{ marginBottom: 36 }}>
        {items.length === 0 ? (
          <div style={{ gridColumn: '1 / -1', padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>
            등록된 샵 상품이 없습니다.
          </div>
        ) : (
          items.map((item) => {
            const canAfford = user.points >= item.price;
            const isOutOfStock = item.stock === 0;

            return (
              <div key={item.id} className="card" style={{ marginBottom: 0, display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <h3 style={{ fontSize: 17, fontWeight: 700, color: 'var(--text-main)' }}>{item.name}</h3>
                    {canManageShop && (
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button
                          onClick={() => {
                            setEditingItem(item);
                            setNewItem({
                              name: item.name,
                              price: item.price,
                              stock: item.stock,
                              description: item.description,
                              image_url: item.image_url || ''
                            });
                            setShowAddModal(true);
                          }}
                          style={{ background: 'none', border: 'none', color: 'var(--primary)', cursor: 'pointer' }}
                        >
                          <Edit2 size={14} />
                        </button>
                        <button
                          onClick={() => handleDeleteItem(item.id)}
                          style={{ background: 'none', border: 'none', color: 'var(--danger)', cursor: 'pointer' }}
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    )}
                  </div>

                  <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 8, minHeight: 40, lineHeight: 1.5 }}>
                    {item.description || '등록된 상세 설명이 없습니다.'}
                  </p>

                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 14 }}>
                    <div style={{ fontSize: 12, color: item.stock === 0 ? 'var(--danger)' : 'var(--text-muted)' }}>
                      재고: {item.stock === -1 ? '무제한' : `${item.stock}개`}
                    </div>
                    <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--point-gold)' }}>
                      {item.price.toLocaleString()} P
                    </div>
                  </div>
                </div>

                <button
                  className="btn btn-primary"
                  style={{ width: '100%', marginTop: 20 }}
                  disabled={!canAfford || isOutOfStock}
                  onClick={() => handlePurchase(item)}
                >
                  {isOutOfStock ? '품절' : !canAfford ? '포인트 부족' : '구매하기'}
                </button>
              </div>
            );
          })
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
                <th>상품명</th>
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
                orders.map((order) => (
                  <tr key={order.id}>
                    <td>#{order.id}</td>
                    <td>
                      <span style={{ fontWeight: 600 }}>{order.nickname || order.username}</span>
                      <div style={{ fontSize: 11, color: '#64748b' }}>@{order.username}</div>
                    </td>
                    <td><span style={{ fontWeight: 600, color: '#60a5fa' }}>{order.item_name}</span></td>
                    <td><span style={{ color: '#fbbf24', fontWeight: 700 }}>{order.points_spent.toLocaleString()} P</span></td>
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
                ))
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
              {editingItem ? '상품 수정' : '새 상품 등록'}
            </h2>
            <form onSubmit={handleCreateOrUpdateItem}>
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
                  <label className="form-label">필요 연방 포인트</label>
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
