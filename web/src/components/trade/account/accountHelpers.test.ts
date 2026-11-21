/**
 * RX-06 Account — pure helper truth rules (trade profile, plan & entitlements, Drive). Fictional values.
 */
import { describe, expect, it } from 'vitest'
import type { DiasporaDriveStatus } from '@/types'
import { profileNextMove, profileStatus, roleTypeLabel } from './tradeProfile'
import { featureParts, groupFeatureKeys, planFailure } from './subscriptionDesk'
import { canConnect, driveMode, scopeMeaning, scopeShortName } from './driveDesk'

describe('trade profile', () => {
  it('submitted is never verified: only VERIFIED is green', () => {
    expect(profileStatus('PENDING_REVIEW')).toMatchObject({ label: 'Submitted · awaiting CarUp review' })
    expect(profileStatus('PENDING_REVIEW').tone).not.toBe('success')
    expect(profileStatus('VERIFIED').tone).toBe('success')
    for (const s of ['REJECTED', 'FLAGGED', 'SUSPENDED', 'SOMETHING_NEW', null]) expect(profileStatus(s).tone).not.toBe('success')
    expect(profileStatus(null).key).toBe('PENDING_REVIEW')
  })

  it('says what each status allows, from what the code enforces', () => {
    expect(profileStatus('VERIFIED').allows).toMatch(/SafeTrade/)
    expect(profileStatus('PENDING_REVIEW').allows).toMatch(/does not yet count/)
    expect(profileStatus('SUSPENDED').allows).toMatch(/cannot be resubmitted/)
    expect(profileStatus('SUSPENDED').step).toBeNull()
  })

  it('picks the next move: resubmit a rejected profile first, then create, then wait for review', () => {
    expect(profileNextMove([])).toMatchObject({ create: true, usuallyWith: 'You' })
    expect(profileNextMove([{ id: 'p1', verification_status: 'REJECTED', role_type: 'buyer' }])).toMatchObject({ resubmitId: 'p1' })
    expect(profileNextMove([{ id: 'p1', verification_status: 'PENDING_REVIEW', role_type: 'buyer' }]).usuallyWith).toBe('A CarUp reviewer')
    expect(profileNextMove([{ id: 'p1', verification_status: 'VERIFIED', role_type: 'buyer' }]).title).toMatch(/verified/)
    expect(roleTypeLabel('supplier')).toBe('Supplier')
  })
})

describe('plan & entitlements', () => {
  it('reads area and capability from the canonical feature key', () => {
    expect(featureParts('diaspora.rfq.max_open')).toEqual({ area: 'rfq', areaLabel: 'Sourcing requests', capability: 'Max open' })
    expect(featureParts('diaspora.workbook.bulk_import').capability).toBe('Bulk import')
    expect(featureParts('custom').area).toBe('other')
    const groups = groupFeatureKeys(['diaspora.api.access', 'diaspora.rfq.create', 'diaspora.rfq.respond'])
    expect(groups[0]).toMatchObject({ area: 'rfq', keys: ['diaspora.rfq.create', 'diaspora.rfq.respond'] })
  })

  it('a rate limit is never "not permitted"; a missing tenant is its own state', () => {
    const generic = { category: 'ordinary-authorization-failure' as const, message: 'You do not have permission to perform this action.' }
    expect(planFailure(generic, { status: 429, message: 'Too many requests. Please try again later.' })).toBe('limited')
    expect(planFailure({ category: 'tenant-context-missing', message: 'x' }, { status: 400, message: 'An x-tenant-id context is required' })).toBe('tenant')
    expect(planFailure(generic, { status: 403, message: 'Forbidden' })).toBe('denied')
    expect(planFailure(generic, { status: 404, message: 'Not found' })).toBe('unavailable')
    expect(planFailure({ category: 'network-or-server-failure', message: 'x' }, { status: null, message: 'Failed to fetch' })).toBe('failed')
    expect(planFailure(null, null)).toBeNull()
  })
})

describe('Drive', () => {
  const status = (over: Partial<DiasporaDriveStatus> = {}): DiasporaDriveStatus => ({
    enabled: false, provider: 'google', scopes: ['https://www.googleapis.com/auth/drive.file'], connection: null,
    activation: { credentialsConfigured: false, redirectUris: 0, pending: true }, onedrive: { available: false }, workbookExport: { xlsx: false }, ...over,
  })

  it('keeps "switched off", "not activated" and "not connected" apart, and offers Connect only when it could complete', () => {
    expect(driveMode(status())).toBe('off')
    expect(canConnect(status())).toBe(false)
    expect(driveMode(status({ enabled: true }))).toBe('not-activated')
    expect(canConnect(status({ enabled: true }))).toBe(false)
    const ready = status({ enabled: true, activation: { credentialsConfigured: true, redirectUris: 1, pending: false } })
    expect(driveMode(ready)).toBe('ready')
    expect(canConnect(ready)).toBe(true)
    expect(driveMode({ ...ready, connection: { connected: true } })).toBe('connected')
    expect(driveMode({ ...ready, connection: { connected: false, accessStatus: 'REVOKED' } })).toBe('revoked')
  })

  it('explains the drive.file scope in words', () => {
    expect(scopeShortName('https://www.googleapis.com/auth/drive.file')).toBe('drive.file')
    expect(scopeMeaning('https://www.googleapis.com/auth/drive.file')).toMatch(/Only the files CarUp creates/)
    expect(scopeMeaning('https://example.invalid/other')).toBeNull()
  })
})
