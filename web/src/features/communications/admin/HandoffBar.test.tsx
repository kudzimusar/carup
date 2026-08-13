import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { HandoffBar } from './HandoffBar'

const noop = () => {}

describe('HandoffBar', () => {
  it('renders assign/escalate/resolve controls and the team options', () => {
    const html = renderToStaticMarkup(
      <HandoffBar
        teams={['support', 'finance', 'safepay']}
        onAssignToMe={noop}
        onAssignTeam={noop}
        onAssignAdminId={noop}
        onEscalate={noop}
        onResolve={noop}
      />,
    )
    expect(html).toContain('Handoff')
    expect(html).toContain('Assign to me')
    expect(html).toContain('Escalate')
    expect(html).toContain('Resolve')
    expect(html).toContain('Assign to admin user ID')
  })

  it('disables Assign-to-me when the operator has no id', () => {
    const html = renderToStaticMarkup(
      <HandoffBar teams={['support']} canAssignToMe={false} onAssignToMe={noop} onAssignTeam={noop} onAssignAdminId={noop} onEscalate={noop} onResolve={noop} />,
    )
    expect(html).toContain('disabled')
  })
})

describe('HandoffBar reopen affordance', () => {
  // Found by live staging UAT: the server has POST /threads/:id/reopen and the API client already
  // exported reopenCommunicationThread, but nothing rendered it — so an operator who resolved the
  // wrong conversation had no way back from the Command Center.
  const base = {
    teams: ['support'] as const,
    onAssignToMe: noop,
    onAssignTeam: noop,
    onAssignAdminId: noop,
    onEscalate: noop,
    onResolve: noop,
  }

  it('hides Reopen on a live thread', () => {
    const html = renderToStaticMarkup(<HandoffBar {...base} canReopen={false} onReopen={noop} />)
    expect(html).not.toContain('reopen-thread')
    expect(html).not.toContain('Reopen')
  })

  it('offers Reopen on a terminal thread', () => {
    const html = renderToStaticMarkup(<HandoffBar {...base} canReopen onReopen={noop} />)
    expect(html).toContain('reopen-thread')
    expect(html).toContain('Reopen')
  })

  it('does not offer Reopen without a handler, so the button is never inert', () => {
    const html = renderToStaticMarkup(<HandoffBar {...base} canReopen />)
    expect(html).not.toContain('reopen-thread')
  })

  it('disables Reopen while the reopen action is in flight', () => {
    const html = renderToStaticMarkup(<HandoffBar {...base} canReopen onReopen={noop} busyAction="reopen" />)
    const button = html.slice(html.indexOf('reopen-thread') - 220, html.indexOf('reopen-thread') + 60)
    expect(button).toContain('disabled')
  })
})
