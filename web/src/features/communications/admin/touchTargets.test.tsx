/**
 * CA-OWNER-02 — at 390×844 every principal Command Center control is at least 44×44 CSS px.
 *
 * jsdom does no layout, so the contract is the codebase's touch-target convention (button.tsx: `max-sm:h-11`): each
 * control below carries `max-sm:min-h-11` (44px) and, where it can be narrower than 44px, `max-sm:min-w-11`. The
 * `max-sm:` variant applies only below 640px, so desktop is unchanged. A checkbox's HIT AREA is its wrapping label.
 */
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { AuditSearch } from './AuditSearch'
import { ChannelFilterBar } from './ChannelFilterBar'
import { CommandCenterNav } from './CommandCenterNav'
import { ConversationRow } from './ConversationRow'
import { ProviderSmokeTestPanel } from './ProviderSmokeTestPanel'
import { RecoveryView } from './RecoveryView'
import { ReplyComposer } from './ReplyComposer'
import { SlaWorklist } from './SlaWorklist'

const noop = () => {}

function expectTouchTarget(el: Element | null, { width = true } = {}) {
  expect(el, 'control is rendered').not.toBeNull()
  const cls = (el as HTMLElement).className
  expect(cls, `${(el as HTMLElement).outerHTML.slice(0, 120)} needs a 44px minimum height on phones`).toContain('max-sm:min-h-11')
  if (width) expect(cls, `${(el as HTMLElement).outerHTML.slice(0, 120)} needs a 44px minimum width on phones`).toContain('max-sm:min-w-11')
}

describe('Command Center touch targets (390×844)', () => {
  it('section tabs', () => {
    render(<MemoryRouter><CommandCenterNav basePath="/admin/communications" active="inbox" /></MemoryRouter>)
    for (const tab of within(screen.getByTestId('command-center-nav')).getAllByRole('link')) expectTouchTarget(tab)
  })

  it('channel filter chips', () => {
    render(<ChannelFilterBar counts={{ whatsapp: 3, telegram: 1 }} active={null} onSelect={noop} />)
    for (const chip of within(screen.getByRole('group', { name: 'Filter by channel' })).getAllByRole('button')) expectTouchTarget(chip)
  })

  it('reply channel chips and the internal-note control', () => {
    render(<ReplyComposer channel="whatsapp" channels={['whatsapp', 'in_app']} onChannelChange={noop} reply="" onReplyChange={noop} internalNote={false} onInternalNoteChange={noop} status="idle" idempotencyKey="k-123456789" onSend={noop} />)
    for (const chip of within(screen.getByRole('radiogroup', { name: 'Reply channel' })).getAllByRole('radio')) expectTouchTarget(chip)
    expectTouchTarget(screen.getByRole('switch', { name: 'Internal note (not sent to the user)' }).closest('label'))
  })

  it('the inbox row select checkbox hit area', () => {
    render(<ConversationRow title="Rudo Banda" statusLabel="Open" onSelect={noop} checked={false} onToggle={noop} />)
    expectTouchTarget(screen.getByRole('checkbox', { name: /Select thread: Rudo Banda/ }).closest('label'))
  })

  it('the enlarged checkbox hit area toggles exactly once per tap — on the box or on the area around it', () => {
    const onToggle = vi.fn()
    render(<ConversationRow title="Rudo Banda" statusLabel="Open" onSelect={noop} checked={false} onToggle={onToggle} />)
    const box = screen.getByRole('checkbox', { name: /Select thread: Rudo Banda/ })
    fireEvent.click(box)
    expect(onToggle).toHaveBeenCalledTimes(1)
    fireEvent.click(box.closest('label')!)
    expect(onToggle).toHaveBeenCalledTimes(2)
  })

  it('the recovery bulk-select checkbox hit area', () => {
    render(<RecoveryView categories={{ dead_letter: [{ id: 'd1', notification_type: 'admin_reply', channel: 'whatsapp' }] }} counts={{ total: 1 }} onRetry={noop} onCancel={noop} onRequeue={noop} onBulkRetry={noop} />)
    expectTouchTarget(screen.getByRole('checkbox', { name: /for bulk retry/ }).closest('label'))
  })

  it('audit event-type chips', () => {
    render(<AuditSearch events={[]} eventType="" onEventTypeChange={noop} onOpenThread={noop} />)
    for (const chip of within(screen.getByRole('group', { name: 'Filter audit events by type' })).getAllByRole('button')) expectTouchTarget(chip)
  })

  it('the provider smoke-test confirmation', () => {
    render(<ProviderSmokeTestPanel onSend={async () => ({ ok: true })} />)
    expectTouchTarget(screen.getByRole('checkbox', { name: 'Confirm sending a real message' }).closest('label'), { width: false })
  })

  it('SLA worklist rows', () => {
    render(<SlaWorklist threads={[{ id: 't1', title: 'Rudo Banda', slaState: 'breached', slaLabel: 'Overdue · default 8h first-response target' }]} onOpen={noop} />)
    expectTouchTarget(screen.getByTestId('sla-row'), { width: false })
  })
})
