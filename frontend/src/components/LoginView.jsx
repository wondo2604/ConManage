import React, { useState } from 'react';
import { apiRequest, setAuthToken } from '../api';
import { Shield, KeyRound, User, Sparkles, CheckCircle2 } from 'lucide-react';

export default function LoginView({ onLoginSuccess, branding }) {
  const [isRegister, setIsRegister] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [nickname, setNickname] = useState('');
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSuccessMsg('');
    setLoading(true);

    try {
      if (isRegister) {
        // 회원가입: 즉시 로그인되지 않고 관리자 승인 대기
        const res = await apiRequest('/auth/register', {
          method: 'POST',
          body: JSON.stringify({ username, password, nickname })
        });
        setSuccessMsg(res.message || '회원가입 신청이 완료되었습니다! "계정 관리" 관리자의 승인 후 로그인할 수 있습니다.');
        setIsRegister(false);
        setPassword('');
      } else {
        // 로그인
        const res = await apiRequest('/auth/login', {
          method: 'POST',
          body: JSON.stringify({ username, password })
        });
        setAuthToken(res.token);
        onLoginSuccess(res.user);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleAdminQuickFill = () => {
    setUsername('admin');
    setPassword('admin');
  };

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'var(--bg-primary)',
      padding: 24
    }}>
      <div style={{
        background: '#ffffff',
        border: '1px solid var(--border-color)',
        borderRadius: 24,
        padding: '40px 36px',
        width: '100%',
        maxWidth: 440,
        boxShadow: 'var(--shadow-lg)'
      }}>
        <div style={{ textAlign: 'center', marginBottom: 28 }}>
          <div style={{
            width: 58,
            height: 58,
            background: 'var(--primary)',
            borderRadius: 18,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            margin: '0 auto 16px',
            boxShadow: '0 8px 18px rgba(138, 24, 24, 0.25)'
          }}>
            <span style={{ fontSize: 26, fontWeight: 800, color: '#ffffff' }}>
              {branding?.server_logo_text || 'M'}
            </span>
          </div>
          <h1 style={{ fontSize: 22, fontWeight: 800, letterSpacing: -0.5, color: 'var(--text-main)' }}>
            {branding?.nation_name || '마인크래프트 국가전쟁 관리 플랫폼'}
          </h1>
          <p style={{ color: 'var(--text-muted)', fontSize: 13, marginTop: 6, fontWeight: 500 }}>
            {branding?.system_title || 'FEDERATION'} - 연방 국가전쟁 통합 관리 시스템
          </p>
        </div>

        {/* 성공 안내 메시지 */}
        {successMsg && (
          <div style={{
            background: 'var(--success-container)',
            border: '1px solid #a7f3d0',
            borderRadius: 12,
            padding: '12px 16px',
            fontSize: 13,
            color: 'var(--on-success-container)',
            marginBottom: 20,
            display: 'flex',
            alignItems: 'flex-start',
            gap: 10,
            lineHeight: 1.5,
            fontWeight: 500
          }}>
            <CheckCircle2 size={18} style={{ flexShrink: 0, marginTop: 2 }} />
            <span>{successMsg}</span>
          </div>
        )}

        {/* 에러 메시지 */}
        {error && (
          <div style={{
            background: 'var(--danger-container)',
            border: '1px solid #fecaca',
            borderRadius: 12,
            padding: '12px 16px',
            fontSize: 13,
            color: 'var(--on-danger-container)',
            marginBottom: 20,
            fontWeight: 500
          }}>
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label className="form-label">아이디</label>
            <input
              type="text"
              className="input"
              placeholder="아이디를 입력하세요"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
            />
          </div>

          {isRegister && (
            <div className="form-group">
              <label className="form-label">인게임 닉네임</label>
              <input
                type="text"
                className="input"
                placeholder="마인크래프트 닉네임"
                value={nickname}
                onChange={(e) => setNickname(e.target.value)}
                required
              />
            </div>
          )}

          <div className="form-group">
            <label className="form-label">비밀번호</label>
            <input
              type="password"
              className="input"
              placeholder="비밀번호를 입력하세요"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>

          <button
            type="submit"
            className="btn btn-primary"
            style={{ width: '100%', padding: '13px', marginTop: 10, borderRadius: 'var(--radius-pill)', fontSize: 15 }}
            disabled={loading}
          >
            {loading ? '처리 중...' : (isRegister ? '회원가입 신청 (관리자 승인 대기)' : '로그인')}
          </button>
        </form>

        <div style={{
          marginTop: 24,
          paddingTop: 18,
          borderTop: '1px solid var(--border-color)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          fontSize: 13
        }}>
          <button
            type="button"
            onClick={() => {
              setIsRegister(!isRegister);
              setError('');
              setSuccessMsg('');
            }}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--primary)',
              cursor: 'pointer',
              fontWeight: 600,
              fontSize: 13
            }}
          >
            {isRegister ? '이미 계정이 있으신가요? 로그인' : '새로운 플레이어 등록 (회원가입)'}
          </button>

          {!isRegister && (
            <button
              type="button"
              onClick={handleAdminQuickFill}
              style={{
                background: 'var(--bg-tertiary)',
                border: '1px solid var(--border-color)',
                color: 'var(--text-secondary)',
                padding: '6px 12px',
                borderRadius: 'var(--radius-pill)',
                cursor: 'pointer',
                fontSize: 12,
                fontWeight: 600,
                display: 'flex',
                alignItems: 'center',
                gap: 5,
                transition: 'all 0.15s ease'
              }}
            >
              <Sparkles size={13} color="var(--primary)" /> admin 채우기
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
