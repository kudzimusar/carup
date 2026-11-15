import { describe, it, expect } from 'vitest'
import { FEATURE_REGISTRY } from './featureRegistry'

/**
 * RX-02 TI-06 — the sidebar must not show fixed numbers as if they were live counts.
 *
 * `badge` is rendered verbatim beside a dashboard nav item (DashboardLayout). On main five entries
 * carried literal numbers (Leads 12, Work Orders 8, Claims 12, Fraud Alerts 3, Lending Queue 2):
 * every dealer, mechanic, insurer and bank officer saw the same "pending" counts regardless of
 * their real queue. A static registry can carry a static LABEL ("Inbox", "AI", "SLA"); it cannot
 * carry a count. A live count must come from a data source, not from this file.
 */
describe('feature registry badges (TI-06)', () => {
  it('no registry entry carries a numeric badge', () => {
    const offenders = FEATURE_REGISTRY
      .filter(feature => feature.badge !== undefined)
      .filter(feature => typeof feature.badge !== 'string' || /\d/.test(feature.badge))
      .map(feature => `${feature.id}=${String(feature.badge)}`)
    expect(offenders).toEqual([])
  })

  it('the five formerly hard-coded queues show no badge at all', () => {
    for (const id of ['dealer.leads', 'mechanic.work-orders', 'insurance.claims', 'insurance.fraud', 'bank.applications']) {
      const feature = FEATURE_REGISTRY.find(entry => entry.id === id)
      expect(feature, id).toBeDefined()
      expect(feature?.badge, id).toBeUndefined()
    }
  })
})
