export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export async function api<T = unknown>(path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const res = await fetch(path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (res.status === 401) {
    window.location.href = '/login';
    throw new ApiError('Access code required', 401);
  }
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    /* not JSON */
  }
  if (!res.ok) {
    const detail = (data as { detail?: unknown } | null)?.detail;
    throw new ApiError((typeof detail === 'string' ? detail : '') || `Request failed (${res.status})`, res.status);
  }
  return data as T;
}

export const issuePath = (id: string, tail: string) => `/api/issues/${encodeURIComponent(id)}/${tail}`;
