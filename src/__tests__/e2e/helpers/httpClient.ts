export interface HttpResult<T = unknown> {
  status: number;
  body: T;
}

export interface RequestOptions {
  body?: unknown;
  headers?: Record<string, string>;
  timeoutMs?: number;
}

/**
 * Minimal fetch-based HTTP helper for E2E scenarios.
 *
 * Unlike `src/shared/httpClient.ts` (which throws on non-2xx so production code
 * can fail fast), this returns `{ status, body }` for any response so scenarios
 * can assert on status codes (202, 404, ...) directly. Mirrors the raw `fetch`
 * style already used by the integration tests.
 */
export async function request<T = unknown>(
  method: 'GET' | 'POST' | 'PATCH',
  url: string,
  options: RequestOptions = {},
): Promise<HttpResult<T>> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 30000);

  try {
    const res = await fetch(url, {
      method,
      signal: controller.signal,
      headers: {
        ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...options.headers,
      },
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    });

    const text = await res.text();
    const body = (text && isJson(res) ? JSON.parse(text) : text) as T;
    return { status: res.status, body };
  } finally {
    clearTimeout(timeout);
  }
}

function isJson(res: Response): boolean {
  return (res.headers.get('content-type') ?? '').includes('application/json');
}

/** Bearer auth header for MBE / WP calls. */
export function authHeaders(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}
