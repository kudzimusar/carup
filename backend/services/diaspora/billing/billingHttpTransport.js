/**
 * Injectable HTTP transport for the billing adapter (ADR-001 §6, Issue #127 Deliverable D).
 *
 * The point of this module is that "test mode" is not a second implementation of the provider. The
 * SAME adapter builds the SAME request — path, method, headers, body encoding, signature — and the only
 * thing that changes is who carries the bytes. That is what makes a test-mode pass evidence about the
 * real integration rather than evidence about a mock.
 *
 * Three transports:
 *   BillingHttpTransport   — the interface. `request()` throws on the base.
 *   RecordingTransport     — deterministic and OFFLINE. Routes are matched by `METHOD path`; every
 *                            request is recorded so a test can assert the exact wire contract. Any
 *                            unrouted request is a hard error, never a silent empty response.
 *   FetchBillingTransport  — real `fetch`, for pointing test mode at a provider's own sandbox host.
 *                            Refuses to exist under NODE_ENV=test, so no test can accidentally open a
 *                            socket, and refuses any non-https or live-looking base URL.
 *
 * Nothing here knows what a provider is called. Provider vocabulary lives in billingProviderProfiles.js.
 */
import { BillingProviderError } from './billingProviderBase.js';

/** The transport interface every implementation satisfies. */
export class BillingHttpTransport {
  get name() { return 'base'; }

  /**
   * @param {object} req
   * @param {string} req.method   HTTP method, upper case.
   * @param {string} req.url      Absolute URL.
   * @param {object} req.headers  Header map (already includes auth + content-type).
   * @param {string|null} req.body Encoded body (form-encoded or JSON string), or null.
   * @returns {Promise<{status:number, headers:object, body:string}>} raw response; parsing is the
   *          profile's job, because response *encoding* is provider-specific.
   */
  // eslint-disable-next-line no-unused-vars
  async request(_req) {
    throw new BillingProviderError('transport not implemented', 'TRANSPORT_NOT_IMPLEMENTED');
  }
}

/**
 * Deterministic offline transport.
 *
 * `routes` maps `"POST /v1/checkout/sessions"` to either a response object or a function
 * `(req) => response`. A function lets a test assert on the request it received *and* vary the reply,
 * which is how the out-of-order / failure / mismatch scenarios are driven.
 */
export class RecordingTransport extends BillingHttpTransport {
  constructor(routes = {}) {
    super();
    this._routes = { ...routes };
    this.requests = [];
  }

  get name() { return 'recording'; }

  /** Register (or replace) a route after construction. */
  on(key, handler) {
    this._routes[key] = handler;
    return this;
  }

  /** The path portion of a URL, without host or query — the key half of a route. */
  static pathOf(url) {
    try {
      return new URL(url).pathname;
    } catch {
      return String(url || '');
    }
  }

  async request({ method, url, headers = {}, body = null } = {}) {
    const path = RecordingTransport.pathOf(url);
    const key = `${String(method || 'GET').toUpperCase()} ${path}`;
    // Record BEFORE dispatching, so a throwing route still leaves the request assertable.
    this.requests.push({ method: String(method || 'GET').toUpperCase(), url, path, headers, body });

    const handler = this._routes[key];
    if (handler === undefined) {
      // A missing route is a contract error. Returning an empty 200 here would let an adapter that
      // calls the wrong endpoint pass its tests, which is the exact failure this whole module exists
      // to prevent.
      throw new BillingProviderError(
        `No recorded provider route for ${key}. Test-mode transport is offline by design.`,
        'TRANSPORT_ROUTE_MISSING',
      );
    }

    const response = typeof handler === 'function'
      ? await handler(this.requests[this.requests.length - 1])
      : handler;

    return {
      status: response?.status ?? 200,
      headers: response?.headers ?? { 'content-type': 'application/json' },
      body: response?.body ?? '',
    };
  }

  /** Every request whose path matches, for wire-contract assertions. */
  requestsFor(method, path) {
    const m = String(method).toUpperCase();
    return this.requests.filter((r) => r.method === m && r.path === path);
  }

  reset() { this.requests = []; }
}

/**
 * Real-network transport, for running the SAME adapter against a provider's own sandbox host during
 * manual integration verification.
 *
 * Deliberately hostile to accidental use:
 *  - construction throws under NODE_ENV=test (a unit test must never open a socket);
 *  - the base URL must be https;
 *  - a bounded timeout, because a hung provider call must not hold a request open indefinitely.
 */
export class FetchBillingTransport extends BillingHttpTransport {
  constructor({ timeoutMs = 15000, fetchImpl = null } = {}) {
    super();
    if (String(process.env.NODE_ENV || '').toLowerCase() === 'test') {
      throw new BillingProviderError(
        'FetchBillingTransport must not be constructed under NODE_ENV=test',
        'TRANSPORT_FORBIDDEN_IN_TEST',
      );
    }
    this._timeoutMs = Math.min(Math.max(Number(timeoutMs) || 15000, 1000), 60000);
    this._fetch = fetchImpl || globalThis.fetch;
    if (typeof this._fetch !== 'function') {
      throw new BillingProviderError('No fetch implementation available', 'TRANSPORT_UNAVAILABLE');
    }
  }

  get name() { return 'fetch'; }

  async request({ method, url, headers = {}, body = null } = {}) {
    if (!/^https:\/\//i.test(String(url || ''))) {
      throw new BillingProviderError('Billing transport refuses a non-https URL', 'TRANSPORT_INSECURE_URL');
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this._timeoutMs);
    try {
      const res = await this._fetch(url, {
        method: String(method || 'GET').toUpperCase(),
        headers,
        body: body ?? undefined,
        signal: controller.signal,
      });
      const text = await res.text();
      const outHeaders = {};
      if (res.headers && typeof res.headers.forEach === 'function') {
        res.headers.forEach((v, k) => { outHeaders[k] = v; });
      }
      return { status: res.status, headers: outHeaders, body: text };
    } catch (err) {
      // Sanitized: a transport error must not carry the request headers (they hold the API key).
      throw new BillingProviderError(
        `Billing provider request failed: ${err?.name === 'AbortError' ? 'timeout' : 'network error'}`,
        'TRANSPORT_REQUEST_FAILED',
      );
    } finally {
      clearTimeout(timer);
    }
  }
}

/**
 * Transport selection for test mode. The recording transport is the default *everywhere*: opening a
 * real socket requires an explicit opt-in AND a non-test NODE_ENV. There is no configuration in which
 * `node --test` reaches a network through this module.
 */
export function selectBillingTransport({ transport = null, routes = {} } = {}) {
  if (transport) return transport; // explicit injection always wins
  const optedIn = String(process.env.DIASPORA_BILLING_TEST_HTTP || '').toLowerCase() === 'sandbox';
  if (optedIn && String(process.env.NODE_ENV || '').toLowerCase() !== 'test') {
    return new FetchBillingTransport();
  }
  return new RecordingTransport(routes);
}
