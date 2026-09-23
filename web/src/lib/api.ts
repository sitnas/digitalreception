/** Thin fetch wrapper. Admin: HttpOnly session cookie + CSRF header. Kiosk: device bearer token. */
export class ApiError extends Error {
  constructor(public status: number, public code: string) { super(code); }
}

const DEVICE_KEY = 'rs_device_token';
export const deviceToken = {
  get: () => { try { return localStorage.getItem(DEVICE_KEY); } catch { return null; } },
  set: (t: string) => { try { localStorage.setItem(DEVICE_KEY, t); } catch { /* storage unavailable */ } },
  clear: () => { try { localStorage.removeItem(DEVICE_KEY); } catch { /* storage unavailable */ } },
};

async function request<T>(path: string, init: RequestInit & { device?: boolean } = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  if (init.device) {
    const t = deviceToken.get();
    if (t) headers.set('Authorization', `Bearer ${t}`);
  } else {
    headers.set('X-Requested-With', 'reception-admin');
  }
  const res = await fetch(`/api${path}`, { ...init, headers, credentials: 'same-origin', cache: 'no-store' });
  if (!res.ok) {
    let code = res.statusText;
    try {
      const body = await res.json();
      code = Array.isArray(body.message) ? body.message[0] : body.message ?? code;
    } catch { /* not json */ }
    throw new ApiError(res.status, String(code));
  }
  const type = res.headers.get('Content-Type') ?? '';
  if (type.includes('application/json')) return res.json() as Promise<T>;
  return (await res.blob()) as unknown as T;
}

const json = (body: unknown) => JSON.stringify(body);

export const api = {
  get: <T>(p: string) => request<T>(p),
  post: <T>(p: string, body?: unknown) => request<T>(p, { method: 'POST', body: json(body ?? {}) }),
  patch: <T>(p: string, body: unknown) => request<T>(p, { method: 'PATCH', body: json(body) }),
  del: <T>(p: string, body?: unknown) => request<T>(p, { method: 'DELETE', body: json(body ?? {}) }),
  blob: (p: string) => request<Blob>(p),
  kiosk: {
    get: <T>(p: string) => request<T>(`/kiosk${p}`, { device: true }),
    post: <T>(p: string, body: unknown) => request<T>(`/kiosk${p}`, { method: 'POST', body: json(body), device: true }),
  },
};

export function qs(params: Record<string, string | number | undefined | null>): string {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') u.set(k, String(v));
  const s = u.toString();
  return s ? `?${s}` : '';
}
