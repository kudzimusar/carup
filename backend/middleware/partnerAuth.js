/**
 * Partner API authentication middleware — Workstream 9.
 *
 * Verifies the x-api-key, enforces the required scope, attaches req.partner, assigns a
 * correlation id, and logs every request append-only (including 401/403). Fail-closed:
 * any missing/invalid credential or scope is denied.
 */
import crypto from 'crypto';
import { verifyPartnerKey, clientHasScope, logPartnerRequest } from '../services/partner/partnerAuthService.js';

export function requirePartnerScope(scope) {
  return async (req, res, next) => {
    const started = Date.now();
    const correlationId = req.headers['x-correlation-id'] || crypto.randomUUID();
    req.partnerCorrelationId = correlationId;
    res.setHeader('x-correlation-id', correlationId);

    const finish = (statusCode, outcome, clientId) => {
      logPartnerRequest({
        client_id: clientId,
        correlation_id: correlationId,
        method: req.method,
        path: req.path,
        scope_required: scope,
        status_code: statusCode,
        outcome,
        latency_ms: Date.now() - started,
        idempotency_key: req.headers['idempotency-key'] || null,
      });
    };

    try {
      const rawKey = req.headers['x-api-key'];
      if (!rawKey) {
        finish(401, 'unauthorized', null);
        return res.status(401).json({ error: 'Missing API key', correlation_id: correlationId });
      }
      const client = await verifyPartnerKey(rawKey);
      if (!client) {
        finish(401, 'unauthorized', null);
        return res.status(401).json({ error: 'Invalid or revoked API key', correlation_id: correlationId });
      }
      if (scope && !clientHasScope(client, scope)) {
        finish(403, 'forbidden', client.id);
        return res.status(403).json({ error: `Missing required scope: ${scope}`, correlation_id: correlationId });
      }
      req.partner = client;
      // Log the successful access once the response completes.
      res.on('finish', () => finish(res.statusCode, res.statusCode >= 500 ? 'error' : (res.statusCode === 404 ? 'not_found' : 'ok'), client.id));
      next();
    } catch (err) {
      finish(500, 'error', null);
      res.status(500).json({ error: 'partner auth error', correlation_id: correlationId });
    }
  };
}

export default { requirePartnerScope };
