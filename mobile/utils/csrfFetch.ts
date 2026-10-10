/**
 * A mutating request the backend's CSRF middleware will accept — PC01-J-R1 (native UAT blockers N2/N3).
 *
 * The backend requires a signed `x-csrf-token`, bound to the caller's session (or to the guest
 * context before sign-in), on every POST/PUT/PATCH/DELETE. Login already did this; registration, the
 * evidence uploader, the odometer read and the SafePay actions did not, so on every deployed backend
 * they were refused with 403 — and the uploader's refusal was swallowed and told the owner their
 * photo would "upload when you are back online" while they were online.
 *
 * One fresh token per call (as Login does), and one retry with a new token on 403: a token can go
 * stale between fetch and use, and a second refusal is a real refusal the caller must see.
 *
 * Self-contained on purpose (no store imports): the uploader and odometer modules are node-safe and
 * are exercised by tsx scripts without a React Native runtime.
 */
export class CsrfTokenError extends Error {
  constructor(message: string, readonly status: number | null) {
    super(message);
    this.name = 'CsrfTokenError';
  }
}

export async function requestCsrfToken(baseUrl: string, sessionToken: string | null): Promise<string> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    // ngrok's free tier serves an HTML warning page to browser-like User-Agents; this documented
    // header bypasses it and is ignored by every other backend (the same as login and verificationApi).
    'ngrok-skip-browser-warning': 'true',
  };
  if (sessionToken) headers['x-session-token'] = sessionToken;
  const response = await fetch(`${baseUrl}/api/security/csrf-token`, { headers });
  if (!response.ok) throw new CsrfTokenError(`Failed to obtain CSRF token (HTTP ${response.status}).`, response.status);
  const body = (await response.json().catch(() => null)) as { csrfToken?: string } | null;
  if (!body?.csrfToken) throw new CsrfTokenError('CSRF token missing from security endpoint response.', response.status);
  return body.csrfToken;
}

export async function csrfFetch(
  baseUrl: string,
  sessionToken: string | null,
  url: string,
  init: RequestInit = {},
): Promise<Response> {
  const send = async () => {
    const csrfToken = await requestCsrfToken(baseUrl, sessionToken);
    return fetch(url, {
      ...init,
      headers: { ...((init.headers as Record<string, string>) || {}), 'x-csrf-token': csrfToken },
    });
  };
  const first = await send();
  if (first.status !== 403) return first;
  return send();
}
