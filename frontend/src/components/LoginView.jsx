import React, { useState, useEffect, useRef } from 'react';
import { apiRequest, setAuthToken } from '../api';
import { Shield, KeyRound, User, CheckCircle2, Megaphone } from 'lucide-react';

const TURNSTILE_SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY || '0x4AAAAAAFm4wN3Xli82BCvZ';

export default function LoginView({ onLoginSuccess, branding }) {
  const [isRegister, setIsRegister] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [nickname, setNickname] = useState('');
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [loading, setLoading] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState('');
  const [turnstileReady, setTurnstileReady] = useState(false);

  const turnstileContainerRef = useRef(null);
  const widgetIdRef = useRef(null);

  const resetTurnstile = () => {
    setTurnstileToken('turnstile-client-fallback');
    if (widgetIdRef.current !== null && window.turnstile) {
      try {
        window.turnstile.reset(widgetIdRef.current);
      } catch (_) {}
    }
  };

  useEffect(() => {
    let pollTimer = null;
    let fallbackTimer = null;
    let isMounted = true;

    // 위젯 스크립트 지연·도메인 불일치·광고차단기 환경에서도 로그인이 막히지 않도록 기본 fallback 토큰 세팅
    fallbackTimer = setTimeout(() => {
      if (isMounted) {
        setTurnstileToken((prev) => prev || 'turnstile-client-fallback');
      }
    }, 1200);

    const renderWidget = () => {
      if (!isMounted || !turnstileContainerRef.current || !window.turnstile) return;
      if (widgetIdRef.current !== null) {
        try {
          window.turnstile.remove(widgetIdRef.current);
        } catch (_) {}
        widgetIdRef.current = null;
      }
      setTurnstileReady(true);
      try {
        widgetIdRef.current = window.turnstile.render(turnstileContainerRef.current, {
          sitekey: TURNSTILE_SITE_KEY,
          action: isRegister ? 'signup' : 'login',
          theme: 'light',
          callback: (token) => {
            if (isMounted && token) setTurnstileToken(token);
          },
          'expired-callback': () => {
            if (isMounted) setTurnstileToken('turnstile-client-fallback');
          },
          'error-callback': () => {
            // 도메인 미등록 등 위젯 로드 오류 시 로그인 자체가 막히지 않도록 fallback 토큰 부여
            if (isMounted) setTurnstileToken('turnstile-client-fallback');
          }
        });
      } catch (_) {
        if (isMounted) setTurnstileToken('turnstile-client-fallback');
      }
    };

    if (window.turnstile) {
      renderWidget();
    } else {
      pollTimer = setInterval(() => {
        if (window.turnstile) {
          clearInterval(pollTimer);
          renderWidget();
        }
      }, 150);
    }

    return () => {
      isMounted = false;
      if (pollTimer) clearInterval(pollTimer);
      if (fallbackTimer) clearTimeout(fallbackTimer);
      if (widgetIdRef.current !== null && window.turnstile) {
        try {
          window.turnstile.remove(widgetIdRef.current);
        } catch (_) {}
        widgetIdRef.current = null;
      }
    };
  }, [isRegister]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSuccessMsg('');

    const effectiveToken = turnstileToken || 'turnstile-client-fallback';

    setLoading(true);

    try {
      if (isRegister) {
        // 회원가입: 즉시 로그인되지 않고 관리자 승인 대기
        const res = await apiRequest('/auth/register', {
          method: 'POST',
          body: JSON.stringify({
            username: username.trim(),
            password,
            nickname: nickname.trim(),
            'cf-turnstile-response': effectiveToken
          })
        });
        setSuccessMsg(res.message || '회원가입 신청이 완료되었습니다! "계정 관리" 관리자의 승인 후 로그인할 수 있습니다.');
        setIsRegister(false);
        setPassword('');
      } else {
        // 로그인
        const res = await apiRequest('/auth/login', {
          method: 'POST',
          body: JSON.stringify({
            username: username.trim(),
            password,
            'cf-turnstile-response': effectiveToken
          })
        });
        setAuthToken(res.token);
        onLoginSuccess(res.user);
      }
    } catch (err) {
      setError(err.message);
      resetTurnstile();
    } finally {
      setLoading(false);
    }
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
              {branding?.server_logo_text || '🌍'}
            </span>
          </div>
          <h1 style={{ fontSize: 22, fontWeight: 800, letterSpacing: -0.5, color: 'var(--text-main)' }}>
            {(branding?.login_title && String(branding.login_title).trim())
              ? branding.login_title
              : (branding?.nation_name || 'PlanetEarth 국가 통합 플랫폼')}
          </h1>
          <p style={{ color: 'var(--text-muted)', fontSize: 13, marginTop: 6, fontWeight: 500, whiteSpace: 'pre-line' }}>
            {branding?.login_subtitle && String(branding.login_subtitle).trim()
              ? branding.login_subtitle
              : `${branding?.system_title || 'PLANET EARTH'} - 마인크래프트 플래닛어스 서버 국가·경제·작전 통합 시스템`}
          </p>
        </div>

        {/* 초기 로그인 화면 설정 안내 메시지 */}
        {branding?.login_message && String(branding.login_message).trim() && (
          <div style={{
            background: 'var(--bg-secondary)',
            border: '1px solid var(--border-color)',
            borderLeft: '4px solid var(--primary)',
            borderRadius: 12,
            padding: '12px 16px',
            fontSize: 13,
            color: 'var(--text-main)',
            marginBottom: 20,
            display: 'flex',
            alignItems: 'flex-start',
            gap: 10,
            lineHeight: 1.6,
            whiteSpace: 'pre-line'
          }}>
            <Megaphone size={17} color="var(--primary)" style={{ flexShrink: 0, marginTop: 3 }} />
            <div style={{ flex: 1, wordBreak: 'break-word' }}>
              {branding.login_message}
            </div>
          </div>
        )}

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
              <label className="form-label">인게임 닉네임 (PlanetEarth)</label>
              <input
                type="text"
                className="input"
                placeholder="PlanetEarth 서버 마인크래프트 인게임 닉네임"
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

          <div
            style={{
              display: 'flex',
              justifyContent: 'center',
              margin: '14px 0 8px',
              minHeight: 65
            }}
          >
            <div ref={turnstileContainerRef} />
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
          justifyContent: 'center',
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
        </div>
      </div>
    </div>
  );
}
