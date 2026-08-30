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
    mediaRouterSource.includes("select('owner_id, current_seller_id, tenant_id')"),
    'handler must resolve the VIN owner/current-seller/tenant before accepting an upload',
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

test('document upload is ownership-scoped and takes its actor from the session, not headers (source contract)', () => {
  const docIdx = mediaRouterSource.indexOf("router.post('/upload/document'");
  assert.ok(docIdx > -1, 'document upload route must exist');
  const docSection = mediaRouterSource.slice(docIdx, mediaRouterSource.indexOf("router.get('/upload/signed-url'"));
  assert.match(
    docSection,
    /req\.userContext\?\.id/,
    'the acting user must come from the authenticated session context',
  );
  assert.ok(
    !docSection.includes("req.headers['x-user-id']"),
    'the spoofable x-user-id header must never identify the document uploader',
  );
  assert.ok(
    docSection.includes("select('owner_id, current_seller_id, tenant_id')"),
    'handler must resolve the VIN owner/current-seller/tenant before accepting a document',
  );
  assert.ok(
    docSection.includes('SECURITY_MEDIA_UPLOAD_DENIED'),
    'cross-owner document uploads must be audited',
  );
  assert.match(
    docSection,
    /status\(403\)\.json\(\{ error: 'You are not authorized to upload documents for this vehicle\.' \}\)/,
    'cross-owner document uploads must be rejected with 403',
  );
});

test('signed upload URL generation is ownership-scoped for non-admins (source contract)', () => {
  const signedIdx = mediaRouterSource.indexOf("router.get('/upload/signed-url'");
  assert.ok(signedIdx > -1, 'signed upload URL route must exist');
  const signedSection = mediaRouterSource.slice(signedIdx, mediaRouterSource.indexOf("router.get('/document/signed-url'"));
  assert.match(
    signedSection,
    /req\.userContext\?\.role !== 'admin'/,
    'non-admin callers must be ownership-checked before a signed upload URL is minted',
  );
  assert.ok(
    signedSection.includes("select('owner_id, current_seller_id, tenant_id')"),
    'handler must resolve the VIN owner/current-seller/tenant before signing an upload grant',
  );
  assert.ok(
    signedSection.includes('SECURITY_MEDIA_UPLOAD_DENIED'),
    'cross-owner signed-URL requests must be audited',
  );
  assert.match(
    signedSection,
    /status\(403\)\.json\(\{ error: 'You are not authorized to upload media for this vehicle\.' \}\)/,
    'cross-owner signed-URL requests must be rejected with 403',
  );
});

test('document read signed-url enforces the VIN path shape and owner scope (source contract, IDOR fix)', () => {
  const readIdx = mediaRouterSource.indexOf("router.get('/document/signed-url'");
  assert.ok(readIdx > -1, 'document read signed-url route must exist');
  const readSection = mediaRouterSource.slice(readIdx);
  assert.ok(
    readSection.includes('^([A-Z0-9]{17})\\/'),
    'path must be validated against the <VIN>/ prefix shape before signing',
  );
  assert.match(
    readSection,
    /cleanPath\.includes\('\.\.'\)\s*\|\|\s*cleanPath\.startsWith\('\/'\)/,
    'traversal sequences and absolute paths must be rejected',
  );
  assert.match(
    readSection,
    /role === 'owner' \|\| req\.userContext\?\.role === 'dealer'/,
    'owner/dealer sessions must be VIN-ownership-checked (admin/government stay global)',
  );
  assert.ok(
    readSection.includes("select('owner_id, current_seller_id, tenant_id')"),
    'handler must resolve the VIN owner/current-seller/tenant before signing a read grant',
  );
  assert.match(
    readSection,
    /status\(403\)\.json\(\{ error: 'You are not authorized to read documents for this vehicle\.' \}\)/,
    'cross-owner document reads must be rejected with 403',
  );
  assert.match(
    readSection,
    /generateSecureReadUrl\('ocr-documents', cleanPath, 3600\)/,
    'only the validated path may reach the signer',
  );
});
