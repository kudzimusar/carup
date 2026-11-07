import {describe,expect,it} from 'vitest'
import {legacyDealerCanonicalTarget} from './legacyDealerRoutes'

describe('R6 E legacy dealer bookmarks → canonical dealer workspace',()=>{
  it('maps every legacy dealer route to its canonical equivalent',()=>{
    expect(legacyDealerCanonicalTarget('/dealer')).toBe('/dealer/dashboard')
    expect(legacyDealerCanonicalTarget('/dealer/')).toBe('/dealer/dashboard')
    expect(legacyDealerCanonicalTarget('/dealer/inventory')).toBe('/dealers/stock')
    expect(legacyDealerCanonicalTarget('/dealer/leads')).toBe('/dealers/inquiries')
    expect(legacyDealerCanonicalTarget('/dealer/promotions')).toBe('/dealer/dashboard')
    expect(legacyDealerCanonicalTarget('/dealer/analytics')).toBe('/dealer/dashboard')
    expect(legacyDealerCanonicalTarget('/dealer/evidence')).toBe('/dealers/stock')
  })
  it('never redirects canonical, admin or unrelated paths (no loop, no widening)',()=>{
    for(const p of ['/dealer/dashboard','/dealers/stock','/admin/dealer-vehicle-evidence',
      '/dashboard','/dealer/inventory/extra','/dealerx','/','/dealer/__proto__','/dealer/constructor'])
      expect(legacyDealerCanonicalTarget(p)).toBeNull()
  })
})
