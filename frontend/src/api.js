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
  }

  return data;
}
