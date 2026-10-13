/**
 * CA-K3-AUTH-01 — the exact body GET /api/corporate/access returns for a legacy platform administrator
 * (backend/services/corporate/corporateAccessService.js). The backend suite pins the server side of this
 * shape and its parity with the navigation capabilities; web tests consume it as the server's answer.
 */
export const SERVER_GRANT = Object.freeze({
  contract: 'carup.corporate_access.v1',
  decision: 'granted',
  grant: Object.freeze({
    source: 'legacy_admin_compatibility_bridge',
    read_only: true,
    capabilities: Object.freeze([
      'corporate.overview.read',
      'corporate.business_unit.read',
      'corporate.finance.summary.read',
      'corporate.growth.aggregate.read',
      'corporate.customer.aggregate.read',
      'corporate.operations.queue.read',
      'corporate.operations.summary.read',
      'corporate.risk.aggregate.read',
      'corporate.metric.registry.read',
      'corporate.data.quality.read',
      'corporate.intelligence.aggregate.read',
      'corporate.people.aggregate.read',
      'corporate.people.access.read',
      'corporate.report.read',
      'platform.health.read',
      'platform.feature.read',
    ]) as readonly string[],
    explanation:
      'Access via the legacy Admin compatibility bridge (platform administrator). This is not a Corporate '
      + 'membership or a permission assignment; read-only navigation only. Every operational action keeps '
      + 'its own server authorization.',
  }),
})

export const SERVER_DENIAL = Object.freeze({
  decision: 'denied',
  code: 'CORPORATE_ACCESS_DENIED',
  error: 'Forbidden. This account has no Corporate Admin authority.',
  contract: 'carup.corporate_access.v1',
})
