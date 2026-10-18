/**
 * CA-OWNER-02 — the Corporate management read-model client: parse strictly, fail closed, never invent a value.
 */
import { describe, expect, it, vi } from 'vitest'
import { factToSlot, fetchManagementArea, parseManagementArea, MANAGEMENT_CONTRACT } from './management'
import { presentSlot } from './truthState'
import { managementEnvelope, liveFactFixture, statementFactFixture } from '@/test/corporateManagementFixture'

describe('parseManagementArea', () => {
  it('accepts a granted, read-only envelope for the requested area and keeps every fact as the server stated it', () => {
    const payload = managementEnvelope('growth', { facts: [liveFactFixture({ id: 'growth.account.operational', label: 'Operational accounts (not customers)', value: 3 })] })
    const parsed = parseManagementArea('growth', payload)
    expect(parsed?.area).toBe('growth')
    if (parsed?.area !== 'growth') throw new Error('wrong area')
    expect(parsed.facts[0]).toMatchObject({ id: 'growth.account.operational', state: 'TECHNICAL_OPERATIONAL', value: 3, kind: 'operational' })
    expect(parsed.facts[0].source?.authority).toBeTruthy()
    expect(parsed.facts[0].asOf).toBe('2026-10-18T00:00:00.000Z')
  })

  it('fails closed on a wrong contract, a non-granted decision, another area or a missing read-only flag', () => {
    const good = managementEnvelope('growth', { facts: [] })
    expect(parseManagementArea('growth', { ...good, contract: 'carup.something_else' })).toBeNull()
    expect(parseManagementArea('growth', { ...good, decision: 'denied' })).toBeNull()
    expect(parseManagementArea('finance', good)).toBeNull()
    expect(parseManagementArea('growth', { ...good, read_only: false })).toBeNull()
    expect(MANAGEMENT_CONTRACT).toBe('carup.corporate_management.v1')
  })

  it('R3 D3: keeps the snapshot block exactly — its read time, age, staleness and refresh — and fails closed on a malformed one', () => {
    const snapshot = { generated_at: '2026-10-18T00:00:00.000Z', age_seconds: 95, stale: true, refreshing: true }
    const parsed = parseManagementArea('growth', managementEnvelope('growth', { facts: [], snapshot }))
    expect(parsed?.snapshot).toEqual({ generatedAt: '2026-10-18T00:00:00.000Z', ageSeconds: 95, stale: true, refreshing: true })
    expect(parseManagementArea('growth', managementEnvelope('growth', { facts: [] }))?.snapshot).toBeNull()
    expect(parseManagementArea('growth', managementEnvelope('growth', { facts: [], snapshot: { ...snapshot, stale: 'no' } }))).toBeNull()
    expect(parseManagementArea('growth', managementEnvelope('growth', { facts: [], snapshot: { ...snapshot, age_seconds: -1 } }))).toBeNull()
  })

  it('fails closed when a statement state smuggles a value, or a live state has none', () => {
    const smuggled = managementEnvelope('growth', { facts: [{ ...statementFactFixture({ id: 'growth.customers', state: 'UNKNOWN_AUTHORITY' }), value: 99 }] })
    expect(parseManagementArea('growth', smuggled)).toBeNull()
    const empty = managementEnvelope('growth', { facts: [{ ...liveFactFixture({ id: 'x', label: 'X', value: 1 }), value: null }] })
    expect(parseManagementArea('growth', empty)).toBeNull()
  })
})

describe('factToSlot', () => {
  it('a live record read says "Live read" (never "Operational"), a technical one "Technical", a governance record "Actual" — a degraded one has no value', () => {
    // CA-OWNER-02-R3 D2: the badge names the READ STATE; a population is never called operational because it was read live.
    expect(presentSlot(factToSlot(liveFactFixture({ id: 'a', label: 'A', value: 0 }))).badge).toBe('Live read')
    expect(presentSlot(factToSlot(liveFactFixture({ id: 'a', label: 'A', value: 0 }))).primary).toBe('0')
    expect(presentSlot(factToSlot(liveFactFixture({ id: 'p', label: 'P', value: 'healthy', kind: 'technical' }))).badge).toBe('Technical')
    expect(presentSlot(factToSlot(liveFactFixture({ id: 'g', label: 'G', value: 2, kind: 'governance', state: 'GOVERNED_ACTUAL' }))).badge).toBe('Actual')
    const degraded = presentSlot(factToSlot({ ...liveFactFixture({ id: 'd', label: 'D', value: 1 }), state: 'DEGRADED', value: null, reason: 'could not be read' }))
    expect(degraded.isValue).toBe(false)
    expect(degraded.primary).not.toMatch(/\d/)
  })
})

describe('fetchManagementArea', () => {
  const call = (status: number, body: unknown) => fetchManagementArea({
    baseUrl: 'https://api.test/api', sessionToken: 'tok', area: 'growth',
    fetchImpl: vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })) as unknown as typeof fetch,
  })

  it('sends only the session token and maps the server decision', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(managementEnvelope('growth', { facts: [] })), { status: 200, headers: { 'content-type': 'application/json' } }))
    const ok = await fetchManagementArea({ baseUrl: 'https://api.test/api', sessionToken: 'tok', area: 'growth', fetchImpl: fetchImpl as unknown as typeof fetch })
    expect(ok.status).toBe('ok')
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://api.test/api/corporate/management/growth')
    const headers = Object.fromEntries(Object.entries(init.headers as Record<string, string>).map(([k, v]) => [k.toLowerCase(), v]))
    expect(headers['x-session-token']).toBe('tok')
    expect(Object.keys(headers).some((h) => /role|user-id|tenant/.test(h))).toBe(false)
    expect((await call(403, { code: 'CORPORATE_CAPABILITY_REQUIRED' })).status).toBe('denied')
    expect((await call(401, {})).status).toBe('unauthenticated')
    expect((await call(503, {})).status).toBe('unavailable')
    expect((await call(200, { contract: 'nope' })).status).toBe('unavailable')
  })
})
