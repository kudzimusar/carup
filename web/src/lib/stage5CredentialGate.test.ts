import { describe, it, expect } from 'vitest'
import {
  STAGE5_REQUIRED_ENV,
  missingStage5Credentials,
  stage5ShouldSkip,
} from './stage5CredentialGate'

function fullEnv(): Record<string, string> {
  return Object.fromEntries(STAGE5_REQUIRED_ENV.map((k) => [k, `value-for-${k}`]))
}

describe('Stage 5 credential gate', () => {
  it('does NOT skip when every credential + identifier is present', () => {
    expect(missingStage5Credentials(fullEnv())).toEqual([])
    expect(stage5ShouldSkip(fullEnv())).toBe(false)
  })

  // The exact defect the reviewer flagged: emails + IDs + API URL present but a
  // password absent must SKIP, never run and pass `undefined` to login.
  it.each(['E2E_UAT_ADMIN_PASSWORD', 'E2E_UAT_OWNER_PASSWORD', 'E2E_UAT_INVITEE_PASSWORD'])(
    'SKIPS when the password %s is missing',
    (missingKey) => {
      const env = fullEnv()
      delete (env as Record<string, string | undefined>)[missingKey]
      expect(stage5ShouldSkip(env)).toBe(true)
      expect(missingStage5Credentials(env)).toContain(missingKey)
    },
  )

  it('SKIPS when a password is blank/whitespace (not just undefined)', () => {
    const env = fullEnv()
    env.E2E_UAT_OWNER_PASSWORD = '   '
    expect(stage5ShouldSkip(env)).toBe(true)
  })

  it.each(STAGE5_REQUIRED_ENV)('SKIPS when any single required key %s is missing', (key) => {
    const env = fullEnv()
    delete (env as Record<string, string | undefined>)[key]
    expect(stage5ShouldSkip(env)).toBe(true)
  })

  it('requires all three passwords, both user IDs, and the API base URL', () => {
    for (const k of [
      'E2E_UAT_ADMIN_PASSWORD',
      'E2E_UAT_OWNER_PASSWORD',
      'E2E_UAT_INVITEE_PASSWORD',
      'E2E_UAT_OWNER_USER_ID',
      'E2E_UAT_INVITEE_USER_ID',
      'E2E_UAT_API_BASE_URL',
    ]) {
      expect(STAGE5_REQUIRED_ENV).toContain(k)
    }
  })
})
