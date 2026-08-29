import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const here = path.dirname(fileURLToPath(import.meta.url))
const source = readFileSync(path.resolve(here, './Register.tsx'), 'utf8')

describe('registration profile contract', () => {
  it('collects market/account dimensions without transmitting them as a privileged role', () => {
    expect(source).toContain("account_kind: form.accountKind")
    expect(source).toContain("market_relationship: form.marketRelationship")
    expect(source).toContain("business_type: form.accountKind === 'business'")
    expect(source).toContain("role: 'owner'")
    expect(source).not.toContain("role: form.businessType")
  })

  it('separates required legal/privacy acknowledgement from optional marketing consent', () => {
    expect(source).toContain('terms_acknowledged: form.termsAcknowledged')
    expect(source).toContain('privacy_acknowledged: form.privacyAcknowledged')
    expect(source).toContain('marketing_consent: form.marketingConsent')
    expect(source).toContain('Send me optional CarUp product news and offers')
  })

  it('uses the real Terms and Privacy routes instead of dead links', () => {
    expect(source).toContain('to="/terms"')
    expect(source).toContain('to="/privacy"')
    expect(source).not.toContain('to="#"')
  })
})
