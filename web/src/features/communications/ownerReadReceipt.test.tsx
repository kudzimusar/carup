import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * Owner inbox read receipts must be persisted, not faked.
 *
 * The page previously set unread_count: 0 in local state only, so the badge cleared visually while
 * last_read_at never moved server-side and the count returned on the next load. The backend route
 * already existed; only the client method and the call were missing.
 *
 * These assertions are made against the shipped source because the behaviour that matters is the
 * ORDER — persist first, clear only on success — which a render-only harness cannot observe.
 */
const read = (p: string) => readFileSync(resolve(__dirname, p), 'utf8')

describe('owner conversation read receipt', () => {
  const api = read('../../hooks/useCarUpApi.ts')
  const page = read('../../pages/dashboard/owner/Communications.tsx')

  it('exposes a participant-facing mark-read client method on the correct endpoint', () => {
    expect(api).toContain('const markCommunicationThreadRead = useCallback')
    expect(api).toMatch(/\/communications\/threads\/\$\{encodeURIComponent\(id\)\}\/read/)
    expect(api).toMatch(/markCommunicationThreadRead,/)
  })

  it('does not reuse the admin endpoint for a participant', () => {
    const method = api.slice(api.indexOf('const markCommunicationThreadRead'), api.indexOf('const markAdminCommunicationThreadRead'))
    expect(method).not.toContain('/admin/')
  })

  it('the owner inbox calls it when a conversation is opened', () => {
    expect(page).toContain('markCommunicationThreadRead(activeId)')
    expect(page).toMatch(/\}, \[activeId, fetchCommunicationThread, markCommunicationThreadRead\]\)/)
  })

  it('clears the unread badge only AFTER the mutation resolves', () => {
    const effect = page.slice(page.indexOf('fetchCommunicationThread(activeId)'))
    const call = effect.indexOf('await markCommunicationThreadRead(activeId)')
    const clear = effect.indexOf('unread_count: 0')
    expect(call).toBeGreaterThan(-1)
    expect(clear).toBeGreaterThan(-1)
    expect(call).toBeLessThan(clear)
  })

  it('a failed mutation leaves the unread badge intact rather than claiming a read state', () => {
    const effect = page.slice(page.indexOf('await markCommunicationThreadRead(activeId)'))
    const cat = effect.indexOf('} catch {')
    const nextClear = effect.indexOf('unread_count: 0', cat)
    expect(cat).toBeGreaterThan(-1)
    // No unread clearing inside or after the catch block for this effect.
    expect(nextClear === -1 || nextClear > effect.indexOf('}, [activeId')).toBe(true)
  })
})
