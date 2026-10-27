const configured = import.meta.env.VITE_API_URL;
if (import.meta.env.PROD && !configured) {
  throw new Error('VITE_API_URL must be configured for a production build.');
}
const API_BASE = (configured || 'http://localhost:4000/api').replace(/\/+$/, '');
export async function apiRequest(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (options.body !== undefined && !(options.body instanceof FormData)) headers['Content-Type'] = 'application/json';
  let response;
  try {
    response = await fetch(`${API_BASE}${path.startsWith('/') ? path : `/${path}`}`, {
      ...options,
      headers,
      body: options.body !== undefined && typeof options.body !== 'string' && !(options.body instanceof FormData) ? JSON.stringify(options.body) : options.body,
      credentials: 'include',
    });
  } catch {
    throw new Error('Cannot reach the Ullas API. Check the API URL and service status.');
  }
  const type = response.headers.get('content-type') || '';
  const payload = type.includes('application/json') ? await response.json() : await response.text();
  if (!response.ok) throw new Error(payload?.error || `Request failed (${response.status})`);
  return payload;
}
