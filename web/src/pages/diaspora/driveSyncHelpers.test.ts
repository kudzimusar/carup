import { describe, it, expect } from 'vitest'
import { describeSyncAttempt } from './driveSyncHelpers'
import type { DiasporaDriveSyncAttempt } from '@/types'

/**
 * Drive lane, integration request #3. The backend records every sync attempt durably; the UI's job is
 * to not discard the one distinction that matters to a user:
 *
 *   `failed` + nextAttemptAt  → still being retried automatically
 *   `dead_lettered`           → the file did NOT reach Drive and never will without the user acting
 *
 * Rendering a dead letter as a warning-coloured "syncing" would tell someone their document is safe
 * when it is not, so these assertions pin the classification rather than the styling.
 */

function attempt(over: Partial<DiasporaDriveSyncAttempt> = {}): DiasporaDriveSyncAttempt {
  return {
    id: 'a1',
    operation: 'upload',
    entityType: 'diaspora_import_orders',
    entityId: 'order-1',
    idempotencyKey: 'idem-1',
    state: 'pending',
    attempts: 1,
    nextAttemptAt: null,
    providerFileId: null,
    providerFolderId: null,
    bytes: null,
    contentChecksum: null,
    lastErrorCode: null,
    lastError: null,
    startedAt: null,
    completedAt: null,
    createdAt: null,
    ...over,
  }
}

describe('describeSyncAttempt', () => {
  it('reports a succeeded attempt as reaching Drive', () => {
    const d = describeSyncAttempt(attempt({ state: 'succeeded' }))
    expect(d.tone).toBe('ok')
    expect(d.needsAction).toBe(false)
    expect(d.detail).toMatch(/reached your Drive/i)
  })

  it('reports a dead-lettered attempt as NOT synced and needing action', () => {
    const d = describeSyncAttempt(attempt({ state: 'dead_lettered', attempts: 5 }))
    expect(d.tone).toBe('failed')
    expect(d.needsAction).toBe(true)
    expect(d.label).toMatch(/not synced/i)
    expect(d.detail).toMatch(/will not be retried automatically/i)
    // The decisive assertion: a dead letter must never read as in-progress.
    expect(d.label).not.toMatch(/sync(ing)?$/i)
    expect(d.tone).not.toBe('pending')
  })

  it('pluralises the attempt count truthfully', () => {
    expect(describeSyncAttempt(attempt({ state: 'dead_lettered', attempts: 1 })).detail).toMatch(/1 attempt\b/)
    expect(describeSyncAttempt(attempt({ state: 'dead_lettered', attempts: 3 })).detail).toMatch(/3 attempts\b/)
  })

  it('distinguishes a retrying failure from a terminal one', () => {
    const retrying = describeSyncAttempt(attempt({ state: 'failed', nextAttemptAt: '2026-07-29T10:00:00Z' }))
    expect(retrying.tone).toBe('pending')
    expect(retrying.needsAction).toBe(false)
    expect(retrying.label).toMatch(/retrying/i)

    const terminal = describeSyncAttempt(attempt({ state: 'failed', nextAttemptAt: null }))
    expect(terminal.tone).toBe('failed')
    expect(terminal.needsAction).toBe(true)
    expect(terminal.detail).toMatch(/no retry is scheduled/i)
  })

  it('treats in-flight and pending as in-progress, needing no user action', () => {
    for (const state of ['in_flight', 'pending'] as const) {
      const d = describeSyncAttempt(attempt({ state }))
      expect(d.tone).toBe('pending')
      expect(d.needsAction).toBe(false)
    }
  })

  it('never claims success for any non-succeeded state', () => {
    for (const state of ['pending', 'in_flight', 'failed', 'dead_lettered'] as const) {
      expect(describeSyncAttempt(attempt({ state })).tone).not.toBe('ok')
    }
  })

  it('exposes no credential material for any state', () => {
    // The sanitized shape carries no token by design; assert the description never invents one.
    for (const state of ['pending', 'in_flight', 'succeeded', 'failed', 'dead_lettered'] as const) {
      const d = describeSyncAttempt(attempt({ state }))
      const text = `${d.label} ${d.detail}`
      expect(text).not.toMatch(/token|secret|refresh|bearer|vault_reference/i)
    }
  })
})
