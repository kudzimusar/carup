/**
 * Vehicle media upload authorization — regression tests for the P0 fix that put
 * authorizeRole + VIN ownership scoping on POST /api/media/upload/vehicle.
 * Anonymous rejection is exercised behaviorally through the real router +
 * middleware chain; the ownership branch (which needs a live vehicles table) is
 * pinned by source assertions, the repo's established pattern for
 * infrastructure-coupled guards.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

import mediaRouter from '../services/storage/mediaRouter.js';

const mediaRouterSource = readFileSync(new URL('../services/storage/mediaRouter.js', import.meta.url), 'utf8');

function invokeRouter(router, { method, url, headers = {}, body = {} }) {
  return new Promise((resolve, reject) => {
    const req = {
      method,
      url,
      originalUrl: url,
      path: url,
      headers,
      body,
      query: {},
      params: {},
      get(name) { return this.headers[String(name).toLowerCase()]; },
    };
    const res = {
      statusCode: 200,
      headers: {},
      body: undefined,
      status(code) { this.statusCode = code; return this; },
      set(k, v) { this.headers[k] = v; return this; },
      json(payload) { this.body = payload; resolve(this); return this; },
      send(payload) { this.body = payload; resolve(this); return this; },
      end() { resolve(this); return this; },
    };
    router(req, res, (err) => (err ? reject(err) : reject(new Error(`route fell through: ${method} ${url}`))));
  });
}

test('anonymous vehicle image upload is rejected with 401 (no session, no fallback identity)', async () => {
  const previousFallback = process.env.CARUP_ALLOW_X_USER_ID_FALLBACK;
  const previousNodeEnv = process.env.NODE_ENV;
  // Force production-like auth posture so the x-user-id fallback cannot apply.
  process.env.CARUP_ALLOW_X_USER_ID_FALLBACK = 'false';
  process.env.NODE_ENV = 'production';
  try {
    const response = await invokeRouter(mediaRouter, {
      method: 'POST',
      url: '/upload/vehicle',
      body: { vin: 'VINANON00000000001', images: ['data:image/jpeg;base64,/9j/4AAQ'] },
    });
    assert.equal(response.statusCode, 401, 'anonymous upload must be rejected before any processing');
  } finally {
    if (previousFallback === undefined) delete process.env.CARUP_ALLOW_X_USER_ID_FALLBACK;
    else process.env.CARUP_ALLOW_X_USER_ID_FALLBACK = previousFallback;
    process.env.NODE_ENV = previousNodeEnv;
  }
});

test('vehicle upload route is role-guarded and ownership-scoped (source contract)', () => {
  assert.match(
    mediaRouterSource,
    /router\.post\('\/upload\/vehicle',\s*authorizeRole\(\['owner',\s*'dealer',\s*'admin'\]\)/,
    'vehicle upload must require an authenticated owner/dealer/admin',
  );
  assert.ok(
    mediaRouterSource.includes("select('owner_id, tenant_id')"),
    'handler must resolve the VIN owner/tenant before accepting an upload',
  );
  assert.ok(
    mediaRouterSource.includes('SECURITY_MEDIA_UPLOAD_DENIED'),
    'cross-owner attempts must be audited',
  );
  assert.match(
    mediaRouterSource,
    /status\(403\)\.json\(\{ error: 'You are not authorized to upload media for this vehicle\.' \}\)/,
    'cross-owner attempts must be rejected with 403',
  );
  assert.ok(
    mediaRouterSource.includes('imageList.length > 15'),
    'per-request image count must be capped to match the seller UI limit',
  );
});
