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
