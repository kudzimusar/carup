import { fireEvent, render, screen } from '@testing-library/react'
import { vi, describe, it, expect } from 'vitest'
import { LazyRouteBoundary } from './LazyRouteBoundary'

function FailedImport(): never { throw new Error('Failed to fetch dynamically imported module') }
describe('document recovery after a cached import failure', () => {
  it('shows an accessible failure and invokes explicit document recovery', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const reload = vi.fn()
    render(<LazyRouteBoundary onRetry={reload}><FailedImport /></LazyRouteBoundary>)
    expect(screen.getByRole('alert')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(reload).toHaveBeenCalledTimes(1)
    warn.mockRestore(); error.mockRestore()
  })
})
