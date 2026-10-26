const API_BASE = import.meta.env.VITE_API_URL || '/api';

export function getAuthToken() {
  return localStorage.getItem('token');
}

export function setAuthToken(token) {
  if (token) {
    localStorage.setItem('token', token);
  } else {
    localStorage.removeItem('token');
  }
}

let browserWebhookNextAt = 0;
let drainingFallbacks = false;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * 서버(Render 등 공유 클라우드 IP)가 디스코드/Cloudflare HTTP 429로 제한되었을 때
 * 클라이언트 브라우저에서 직접 디스코드 웹훅(CORS 지원)으로 릴레이 전송
 */
export async function deliverWebhookFromBrowser(item) {
  const { targetUrl, payload, isTest } = item || {};
  if (!targetUrl || !payload) return { success: false };

  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const waitBefore = browserWebhookNextAt - Date.now();
    if (waitBefore > 0) {
      await sleep(Math.min(waitBefore, 6000));
    }

    let res;
    try {
      res = await fetch(targetUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
    } catch (netErr) {
      if (attempt < maxAttempts) {
        await sleep(600 * attempt);
        continue;
      }
      if (isTest) throw new Error(`디스코드 웹훅 네트워크 연결 실패: ${netErr.message}`);
      return { success: false };
    }

    if (res.ok) {
      browserWebhookNextAt = Math.max(browserWebhookNextAt, Date.now() + 550);
      return { success: true };
    }

    const errText = await res.text().catch(() => '');

    if (res.status === 429 && attempt < maxAttempts) {
      let waitMs = 2000 * attempt;
      const retryHeader = res.headers?.get?.('retry-after') || res.headers?.get?.('x-ratelimit-reset-after');
      if (retryHeader) {
        const val = parseFloat(retryHeader);
        if (!isNaN(val) && val > 0) {
          waitMs = (val > 500 ? val : val * 1000) + 250;
        }
      } else {
        try {
          const parsed = JSON.parse(errText);
          if (typeof parsed?.retry_after === 'number' && parsed.retry_after > 0) {
            const r = parsed.retry_after;
            waitMs = (r > 500 ? r : r * 1000) + 250;
          }
        } catch (_) {}
      }
      browserWebhookNextAt = Math.max(browserWebhookNextAt, Date.now() + Math.min(waitMs, 8000));
      await sleep(Math.min(waitMs, 8000));
      continue;
    }

    if (isTest) {
      throw new Error(`디스코드 응답 오류 (HTTP ${res.status}): ${errText || res.statusText}`);
    }
    console.warn('[Webhook Browser Relay Failed]', res.status, errText);
    return { success: false, status: res.status };
  }

  return { success: false };
}

async function flushPendingWebhookFallbacks() {
  if (drainingFallbacks || !getAuthToken()) return;
  drainingFallbacks = true;
  try {
    const res = await fetch(`${API_BASE}/webhooks/pending-fallbacks`, {
      headers: { Authorization: `Bearer ${getAuthToken()}` }
    });
    if (!res.ok) return;
    const data = await res.json().catch(() => null);
    if (Array.isArray(data?.fallback_webhooks) && data.fallback_webhooks.length > 0) {
      for (const item of data.fallback_webhooks) {
        await deliverWebhookFromBrowser(item).catch(() => {});
      }
    }
  } catch (_) {
  } finally {
    drainingFallbacks = false;
  }
}

export async function apiRequest(endpoint, options = {}) {
  const token = getAuthToken();
  const headers = { ...options.headers };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  // FormData가 아닐 경우 JSON 처리
  if (!(options.body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
  }

  const res = await fetch(`${API_BASE}${endpoint}`, {
    ...options,
    headers
  });

  const data = await res.json().catch(() => null);

  if (!res.ok) {
    throw new Error(data?.error || `요청 실패 (${res.status})`);
  }

  // 응답 본문에 즉시 릴레이할 웹훅 폴백이 포함된 경우 (테스트 발송 / 공지 발송 등)
  if (Array.isArray(data?.fallback_webhooks) && data.fallback_webhooks.length > 0) {
    for (const item of data.fallback_webhooks) {
      await deliverWebhookFromBrowser(item);
    }
  }

  // 백그라운드 웹훅이 서버 공유 IP 429로 인해 대기열에 들어간 경우 비동기 릴레이
  if (res.headers?.get?.('x-webhook-fallback-pending') === '1') {
    flushPendingWebhookFallbacks();
  }

  const method = (options.method || 'GET').toUpperCase();
  if (
    ['POST', 'PUT', 'DELETE', 'PATCH'].includes(method) &&
    !endpoint.startsWith('/auth/login') &&
    !endpoint.startsWith('/admin/import') &&
    !endpoint.startsWith('/admin/reset') &&
    !endpoint.endsWith('/test') &&
    !endpoint.endsWith('/test-webhook')
  ) {
    try {
      window.dispatchEvent(new CustomEvent('mc-db-mutated'));
    } catch (_) {}
    setTimeout(() => {
      flushPendingWebhookFallbacks();
    }, 900);
  }

  return data;
}
