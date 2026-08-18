import { describe, it, expect } from 'vitest'
import {
  STAGE5_REQUIRED_ENV,
  assertStage5StagingApiTarget,
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

describe('Stage 5 staging API target guard', () => {
  it.each([
    'https://api-staging.carup.dev',
    'https://carup-backend-staging.vercel.app',
    'https://carup-backend-staging-abc123.vercel.app',
    'https://carup-backend-staging-abc123-pay-pass-project.vercel.app',
  ])('allows explicit staging backend host %s', (target) => {
    expect(assertStage5StagingApiTarget(target).hostname).toMatch(/^(api-staging\.carup\.dev|carup-backend-staging)/)
  })

  it.each([
    'https://api.carup.dev',
    'https://carup.dev',
    'https://carup-backend.vercel.app',
    'https://carup-backend-git-main-pay-pass-project.vercel.app',
    'https://api.carup.app',
    'https://example.com',
    'https://carup-backend-staging.evil.example.com',
    'https://api-staging.carup.dev.evil.example.com',
    '',
    'not a url',
    'http://carup-backend-staging.vercel.app',
    'http://api-staging.carup.dev',
  ])('rejects production, unknown, malformed, or non-HTTPS target %s', (target) => {
    expect(() => assertStage5StagingApiTarget(target)).toThrow()
  })

  it.each([
    'apiLogin',
    'createImportBundle',
    'route creation',
    'lead creation',
    'qualification',
  ])('throws before %s can execute on an unsafe target', () => {
    let operationInvoked = false
    expect(() => {
      assertStage5StagingApiTarget('https://carup-backend.vercel.app')
      operationInvoked = true
    }).toThrow()
    expect(operationInvoked).toBe(false)
  })
})
