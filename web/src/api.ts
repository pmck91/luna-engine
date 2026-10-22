const fragment = new URLSearchParams(location.hash.slice(1));
const fresh = fragment.get('token');
if (fresh) {
  sessionStorage.setItem('luna-token', fresh);
  history.replaceState(null, '', location.pathname);
}
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
export async function request<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch(`/api/v1${path}`, {
    method,
    headers: {
      'x-luna-token': sessionStorage.getItem('luna-token') ?? '',
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) {
    const text = await response.text();
    let message = text;
    try {
      message = JSON.parse(text).error ?? text;
    } catch {
      /* extractor errors can be plain text */
    }
    throw new ApiError(message, response.status);
  }
  return response.json();
}
export async function bundle(handle: string): Promise<Blob> {
  const response = await fetch(`/api/v1/projects/${handle}/export`, {
    method: 'POST',
    headers: { 'x-luna-token': sessionStorage.getItem('luna-token') ?? '' },
  });
  if (!response.ok) {
    const data = await response.json();
    throw new ApiError(data.error, response.status);
  }
  return response.blob();
}
