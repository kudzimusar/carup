// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { RequireAuthenticatedUser, RequireFrontendRole } from './RegistryRouteBoundary'

// Mutable mocked auth state (hoisted so the vi.mock factory can read it).
const h = vi.hoisted(() => ({ auth: { user: null as null | { role: string }, loading: false } }))
vi.mock('@/context/AuthContext', () => ({ useAuth: () => h.auth }))

function renderAt(path: string, element: React.ReactNode) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path={path} element={element} />
        <Route path="/login" element={<div>LOGIN PAGE</div>} />
        <Route path="/" element={<div>HOME PAGE</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('Route boundary components (M5)', () => {
  beforeEach(() => { h.auth = { user: null, loading: false } })
  afterEach(() => cleanup())

  it('RequireAuthenticatedUser shows the loading state while auth bootstraps', () => {
    h.auth = { user: null, loading: true }
    renderAt('/secret', <RequireAuthenticatedUser><div>SECRET</div></RequireAuthenticatedUser>)
    expect(screen.getByTestId('auth-bootstrap-loading')).toBeTruthy()
  })

  it('RequireAuthenticatedUser redirects an unauthenticated user to login', () => {
    h.auth = { user: null, loading: false }
    renderAt('/secret', <RequireAuthenticatedUser><div>SECRET</div></RequireAuthenticatedUser>)
    expect(screen.getByText('LOGIN PAGE')).toBeTruthy()
    expect(screen.queryByText('SECRET')).toBeNull()
  })

  it('RequireAuthenticatedUser renders children for an authenticated user', () => {
    h.auth = { user: { role: 'owner' }, loading: false }
    renderAt('/secret', <RequireAuthenticatedUser><div>SECRET</div></RequireAuthenticatedUser>)
    expect(screen.getByText('SECRET')).toBeTruthy()
  })

  it('RequireFrontendRole renders for an allowed role and redirects a disallowed role home', () => {
    h.auth = { user: { role: 'admin' }, loading: false }
    renderAt('/area', <RequireFrontendRole roles={['admin']}><div>ADMIN AREA</div></RequireFrontendRole>)
    expect(screen.getByText('ADMIN AREA')).toBeTruthy()
  })

  it('RequireFrontendRole sends a wrong-role user home', () => {
    h.auth = { user: { role: 'owner' }, loading: false }
    renderAt('/area', <RequireFrontendRole roles={['admin']}><div>ADMIN AREA</div></RequireFrontendRole>)
    expect(screen.getByText('HOME PAGE')).toBeTruthy()
    expect(screen.queryByText('ADMIN AREA')).toBeNull()
  })
})
