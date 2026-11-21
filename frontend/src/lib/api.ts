export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function parse<T>(res: Response): Promise<T> {
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

export async function api<T = unknown>(path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const res = await fetch(path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return parse<T>(res);
}

/* POST raw bytes (not JSON), e.g. an .eml file as message/rfc822. Same origin, errors and 401 handling as api(). */
export async function apiRaw<T = unknown>(path: string, body: BodyInit, contentType: string): Promise<T> {
  const res = await fetch(path, { method: 'POST', headers: { 'Content-Type': contentType }, body });
  return parse<T>(res);
}

export const issuePath = (id: string, tail: string) => `/api/issues/${encodeURIComponent(id)}/${tail}`;
