/** RX06-LR03: Trade sign-in actions return to the exact page (path + query). */
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { SignInLink } from './SignInLink'

describe('SignInLink', () => {
  it('carries the current path and query as returnTo', () => {
    render(<MemoryRouter initialEntries={['/diaspora/imports/fx-order-1/passport?from=ledger']}><SignInLink testId="si">Sign in</SignInLink></MemoryRouter>)
    expect(screen.getByTestId('si').getAttribute('href')).toBe('/login?returnTo=%2Fdiaspora%2Fimports%2Ffx-order-1%2Fpassport%3Ffrom%3Dledger')
  })
})
