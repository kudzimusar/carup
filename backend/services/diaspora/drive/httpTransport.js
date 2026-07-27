/**
 * Diaspora GTM — injectable HTTP transport for the Google provider (Issue #127, Drive lane).
 *
 * WHY A TRANSPORT SEAM
 * --------------------
 * The provider below this seam speaks real Google request/response shapes: real endpoints, real
 * form encodings, real multipart upload bodies, real error envelopes. The only thing tests replace is
 * the socket. That is what makes the test suite both deterministic/offline AND a genuine test of the
 * production code path — as opposed to a mock provider, which tests nothing about how we talk to
 * Google.
 *
 * CONTRACT
 * --------
 *   await transport.request({ method, url, headers, body, timeoutMs })
 *     -> { status:number, headers:Record<string,string>, body:any (parsed JSON or text), rawBody:string }
 *
 * The transport NEVER throws on a non-2xx status — HTTP-level errors are data, and the provider maps
 * them deliberately. It throws only for transport-level failure (DNS, connection, timeout) as an
 * `HttpTransportError` with `retryable: true`.
 *
 * The transport also never logs. Request headers carry bearer tokens; a single well-meaning
 * `console.debug(headers)` here would defeat the whole vault design.
 */

export class HttpTransportError extends Error {
  constructor(message, code = 'TRANSPORT_ERROR', { retryable = true, cause = null } = {}) {
    super(message);
    this.name = 'HttpTransportError';
    this.code = code;
    this.retryable = retryable;
    if (cause) this.cause = cause;
  }
}

export const DEFAULT_TIMEOUT_MS = 15_000;

function normalizeHeaders(headers) {
  const out = {};
  if (!headers) return out;
  if (typeof headers.forEach === 'function' && typeof headers.get === 'function') {
    headers.forEach((value, key) => { out[String(key).toLowerCase()] = value; });
    return out;
  }
  for (const [key, value] of Object.entries(headers)) out[String(key).toLowerCase()] = value;
  return out;
}

function parseBody(rawBody, contentType) {
  if (!rawBody) return null;
  if (String(contentType || '').includes('application/json')) {
    try { return JSON.parse(rawBody); } catch { return rawBody; }
  }
  // Google sometimes returns JSON without the header on error paths; try anyway, fall back to text.
  const trimmed = rawBody.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try { return JSON.parse(trimmed); } catch { /* fall through to text */ }
  }
  return rawBody;
}

/**
 * The production transport. Uses global fetch (Node >= 18) with an AbortController timeout so a
 * hung Google connection cannot pin a request handler forever.
 */
export function createFetchTransport({ fetchImpl = null, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  return {
    name: 'fetch',
    async request({ method = 'GET', url, headers = {}, body = null, timeoutMs: perCallTimeout } = {}) {
      const doFetch = fetchImpl || globalThis.fetch;
      if (typeof doFetch !== 'function') {
        throw new HttpTransportError('No fetch implementation is available in this runtime', 'TRANSPORT_UNAVAILABLE', { retryable: false });
      }
      const controller = new AbortController();
      const limit = perCallTimeout || timeoutMs;
      const timer = setTimeout(() => controller.abort(), limit);
      try {
        const response = await doFetch(url, { method, headers, body, signal: controller.signal });
        const rawBody = await response.text();
        const responseHeaders = normalizeHeaders(response.headers);
        return {
          status: response.status,
          headers: responseHeaders,
          body: parseBody(rawBody, responseHeaders['content-type']),
          rawBody,
        };
      } catch (err) {
        if (err?.name === 'AbortError') {
          throw new HttpTransportError(`Request to the provider timed out after ${limit}ms`, 'TRANSPORT_TIMEOUT', { retryable: true });
        }
        // The message is the runtime's own (ECONNREFUSED etc.) and carries no request material.
        throw new HttpTransportError('Could not reach the provider', 'TRANSPORT_UNREACHABLE', { retryable: true, cause: err });
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

/**
 * Deterministic offline transport for tests.
 *
 * `routes` is an ordered list of `{ method?, url|urlMatch, respond }`. `respond(request)` returns
 * `{ status, headers?, body? }` (body may be an object — it is serialized and re-parsed so the
 * provider sees exactly the string/parse path production sees) or throws to simulate a socket error.
 *
 * Every call is recorded on `.calls` INCLUDING raw headers. That is intentional and test-only: the
 * token-absence proof needs to assert that the bearer token really was sent on the wire (so the code
 * genuinely authenticates) while never appearing anywhere durable.
 */
export function createStubTransport(routes = []) {
  const calls = [];
  const remaining = routes.map((r) => ({ ...r, uses: 0 }));

  const transport = {
    name: 'stub',
    calls,
    /** Add a route at runtime (e.g. to change the response for a second attempt). */
    addRoute(route) { remaining.push({ ...route, uses: 0 }); return transport; },
    async request(request) {
      const { method = 'GET', url } = request;
      calls.push({ ...request, method, url });
      for (const route of remaining) {
        if (route.method && String(route.method).toUpperCase() !== String(method).toUpperCase()) continue;
        const matches = route.url
          ? url === route.url || url.startsWith(route.url)
          : route.urlMatch instanceof RegExp
            ? route.urlMatch.test(url)
            : typeof route.urlMatch === 'function'
              ? route.urlMatch(url, request)
              : false;
        if (!matches) continue;
        if (route.maxUses && route.uses >= route.maxUses) continue;
        route.uses += 1;
        const result = typeof route.respond === 'function' ? await route.respond(request) : route.respond;
        if (result instanceof Error) throw result;
        const rawBody = typeof result.body === 'string'
          ? result.body
          : result.body === undefined || result.body === null ? '' : JSON.stringify(result.body);
        const headers = normalizeHeaders(result.headers || { 'content-type': 'application/json' });
        return { status: result.status ?? 200, headers, body: parseBody(rawBody, headers['content-type']), rawBody };
      }
      throw new HttpTransportError(`No stub route matched ${method} ${url}`, 'TRANSPORT_NO_ROUTE', { retryable: false });
    },
  };
  return transport;
}

/**
 * A transport that refuses every call. Used to prove a code path is genuinely offline: inject this
 * and any accidental network access becomes a loud test failure instead of a slow, flaky one.
 */
export function createDenyNetworkTransport(reason = 'Network access is not permitted in this context') {
  return {
    name: 'deny',
    async request({ method = 'GET', url } = {}) {
      throw new HttpTransportError(`${reason} (attempted ${method} ${url})`, 'TRANSPORT_DENIED', { retryable: false });
    },
  };
}
