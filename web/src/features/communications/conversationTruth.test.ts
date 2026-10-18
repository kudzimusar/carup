import { describe, expect, it } from 'vitest'
import {
  CONVERSATION_VIEW_OPTIONS, DEFAULT_CONVERSATION_VIEW, categoryBadge, customerHeading, humanDuration, threadSlaTruth, threadSubject,
  type ThreadTruth,
} from './conversationTruth'

const NOW = Date.parse('2026-10-18T12:00:00.000Z')
const hoursAgo = (h: number) => new Date(NOW - h * 3_600_000).toISOString()
const hoursAhead = (h: number) => new Date(NOW + h * 3_600_000).toISOString()

const truth = (sla: Partial<ThreadTruth['sla']>, category: ThreadTruth['category'] = 'operational'): ThreadTruth => ({
  category, class: 'real_business_operational', rule: 'r', basis: 'account',
  sla: { state: 'not_applicable', reason: null, due_at: null, due_source: null, awaiting_since: null, ...sla },
  awaiting_reply: false, no_individual_assignee: false,
})

describe('views', () => {
  it('defaults to the working inbox and lists every classification view, ending with All', () => {
    expect(DEFAULT_CONVERSATION_VIEW).toBe('active')
    expect(CONVERSATION_VIEW_OPTIONS.map((o) => o.value)).toEqual(['active', 'operational', 'needs_review', 'certification', 'automation', 'historical', 'all'])
    expect(CONVERSATION_VIEW_OPTIONS[0].label).toBe('Active work (operational + needs review)')
    expect(CONVERSATION_VIEW_OPTIONS.find((o) => o.value === 'needs_review')?.label).toBe('Needs provenance review')
    expect(CONVERSATION_VIEW_OPTIONS.find((o) => o.value === 'certification')?.label).toBe('Certification & UAT')
    expect(CONVERSATION_VIEW_OPTIONS.find((o) => o.value === 'automation')?.label).toBe('Automation & smoke tests')
  })

  it('badges every non-operational conversation, and never an operational one', () => {
    expect(categoryBadge({ truth: truth({}, 'operational') })).toBeNull()
    expect(categoryBadge({ truth: truth({}, 'needs_review') })?.label).toBe('Needs review')
    expect(categoryBadge({ truth: truth({}, 'certification') })?.label).toBe('Certification & UAT')
    expect(categoryBadge({ truth: truth({}, 'automation') })?.label).toBe('Automation')
    expect(categoryBadge({ truth: truth({}, 'historical') })?.label).toBe('Historical')
    expect(categoryBadge({ truth: null })).toBeNull()
  })
})

describe('SLA labels come from truth — never raw minute counts', () => {
  it('names an overdue default target for what it is', () => {
    const sla = threadSlaTruth({ created_at: hoursAgo(700), truth: truth({ state: 'overdue', due_at: hoursAgo(692), due_source: 'default_priority_target', awaiting_since: hoursAgo(690) }) }, NOW)
    expect(sla).toEqual({ level: 'breach', label: 'Overdue · default 8h first-response target', state: 'overdue' })
  })

  it('names policy and service targets', () => {
    expect(threadSlaTruth({ truth: truth({ state: 'overdue', due_at: hoursAgo(1), due_source: 'sla_policy' }) }, NOW).label).toBe('Overdue · SLA policy target')
    expect(threadSlaTruth({ truth: truth({ state: 'overdue', due_at: hoursAgo(1), due_source: 'service_target' }) }, NOW).label).toBe('Overdue · reply target')
  })

  it('counts a live target down in human units', () => {
    expect(threadSlaTruth({ truth: truth({ state: 'live', due_at: hoursAhead(2), due_source: 'service_target' }) }, NOW)).toEqual({ level: 'ok', label: 'Live · due in 2h', state: 'live' })
    expect(threadSlaTruth({ truth: truth({ state: 'live', due_at: new Date(NOW + 10 * 60_000).toISOString(), due_source: 'service_target' }) }, NOW)).toEqual({ level: 'due', label: 'Live · due in 10m', state: 'live' })
  })

  it('says why no service level applies', () => {
    const label = (sla: Partial<ThreadTruth['sla']>, category: ThreadTruth['category'] = 'operational') => threadSlaTruth({ truth: truth(sla, category) }, NOW).label
    expect(label({ state: 'paused', reason: 'SLA paused.' })).toBe('Paused')
    expect(label({ reason: 'No customer message is waiting for a reply.' })).toBe('No customer message waiting')
    expect(label({ reason: 'Replied — waiting on the customer.' })).toBe('Waiting on the customer')
    expect(label({ reason: 'Waiting on the customer.' })).toBe('Waiting on the customer')
    expect(label({ reason: 'With the AI assistant.' })).toBe('With the AI assistant')
    expect(label({ reason: 'A customer is waiting, but no reply target is recorded for this turn.' })).toBe('Customer waiting · no reply target recorded')
    expect(label({ state: 'certification' }, 'certification')).toBe('Certification record — no SLA')
    expect(label({ state: 'certification' }, 'automation')).toBe('Automation record — no SLA')
    expect(label({ state: 'historical' }, 'historical')).toBe('Historical record — no SLA')
  })

  it('a conversation that could not be classified makes no SLA claim at all', () => {
    expect(threadSlaTruth({ truth: null, sla_due_at: hoursAgo(698) }, NOW)).toEqual({ level: 'none', label: '', state: null })
  })

  it('humanDuration never prints thousands of minutes', () => {
    expect(humanDuration(41_892 * 60_000)).toBe('29d 2h')
    expect(humanDuration(480 * 60_000)).toBe('8h')
    expect(humanDuration(15 * 60_000)).toBe('15m')
    expect(humanDuration(30_000)).toBe('under 1m')
  })
})

describe('one primary identity', () => {
  it('heads a conversation with its customer, never its seller or type', () => {
    expect(customerHeading({ customer: { display_name: 'Rudo Banda', source: 'buyer_account' }, identity_display_name: 'UAT seller', thread_type: 'marketplace_inquiry' })).toBe('Rudo Banda')
    expect(customerHeading({ identity_display_name: 'Legacy Name', thread_type: 'support' })).toBe('Legacy Name')
    expect(customerHeading({ thread_type: 'support' })).toBe('Support')
  })

  it('reads the subject as type + reference', () => {
    expect(threadSubject({ thread_type: 'marketplace_inquiry', marketplace_listing_id: 'JTDBR32E520123456' })).toBe('Marketplace inquiry · listing JTDBR32E520123456')
    expect(threadSubject({ thread_type: 'escrow', escrow_id: 'ESC-42' })).toBe('Escrow · escrow ESC-42')
    expect(threadSubject({ thread_type: 'support' })).toBe('Support')
    expect(threadSubject({ thread_type: 'marketplace_inquiry', subject_type: 'marketplace_inquiry', subject_id: 'b1e2c3d4-0000-4000-8000-000000000000' })).toBe('Marketplace inquiry · inquiry b1e2c3d4')
  })
})
