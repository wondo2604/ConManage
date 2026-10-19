import React, { useState } from 'react';
import { apiRequest } from '../api';
import { ShieldAlert, X } from 'lucide-react';

export default function ChangePasswordModal({ isOpen, onClose, isForced, onSuccess }) {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  if (!isOpen) return null;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (newPassword !== confirmPassword) {
      setError('새 비밀번호가 일치하지 않습니다.');
      return;
    }
    if (newPassword.length < 4) {
      setError('비밀번호는 최소 4자 이상이어야 합니다.');
      return;
    }

    setLoading(true);
    try {
      await apiRequest('/auth/change-password', {
        method: 'POST',
        body: JSON.stringify({ currentPassword, newPassword })
      });
      alert('비밀번호가 안전하게 변경되었습니다.');
      if (onSuccess) onSuccess();
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="modal-overlay">
      <div className="modal-content">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <ShieldAlert color="#f59e0b" size={24} />
            <h2 style={{ fontSize: 18, fontWeight: 700 }}>
              {isForced ? '초기 비밀번호 변경 필수 안내' : '비밀번호 변경'}
            </h2>
          </div>
          {!isForced && (
            <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', display: 'flex', alignItems: 'center' }}>
              <X size={20} />
            </button>
          )}
        </div>

        {isForced && (
          <div style={{ background: 'var(--warning-container)', border: '1px solid #fde68a', padding: '12px 16px', borderRadius: 'var(--radius-md)', marginBottom: 18, fontSize: 13, color: 'var(--on-warning-container)', fontWeight: 500, lineHeight: 1.5 }}>
            보안을 위해 초기 비밀번호(admin)를 사용 중인 계정은 반드시 새로운 비밀번호로 변경해야 서비스를 이용하실 수 있습니다.
          </div>
        )}

        {error && (
          <div style={{ background: 'var(--danger-container)', border: '1px solid #fecaca', padding: '10px 14px', borderRadius: 'var(--radius-md)', marginBottom: 18, fontSize: 13, color: 'var(--on-danger-container)', fontWeight: 500 }}>
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label className="form-label">현재 비밀번호</label>
            <input
              type="password"
              className="input"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              placeholder="현재 비밀번호 입력"
              required
            />
          </div>

          <div className="form-group">
            <label className="form-label">새 비밀번호</label>
            <input
              type="password"
              className="input"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="새 비밀번호 (4자 이상)"
              required
            />
          </div>

          <div className="form-group">
            <label className="form-label">새 비밀번호 확인</label>
            <input
              type="password"
              className="input"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="새 비밀번호 다시 입력"
              required
            />
          </div>

          <div style={{ display: 'flex', gap: 10, marginTop: 24 }}>
            {!isForced && (
              <button type="button" className="btn btn-secondary" onClick={onClose} style={{ flex: 1 }}>
                취소
              </button>
            )}
            <button type="submit" className="btn btn-primary" disabled={loading} style={{ flex: 1 }}>
              {loading ? '변경 중...' : '비밀번호 변경하기'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
