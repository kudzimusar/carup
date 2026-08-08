import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

/**
 * F25 (web half): the template-download section previously always rendered the backend's stale
 * "Binary XLSX ... scheduled" message with a permanently disabled button. It must render that
 * message ONLY while downloadReady is false, and offer a real .xlsx download anchor once the
 * backend reports the template as ready.
 */

const fetchDiasporaWorkbookTemplateSchema = vi.fn()
const fetchDiasporaWorkbookTemplateDownloadStatus = vi.fn()
const runDiasporaWorkbookDryRun = vi.fn()

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 'op-1', name: 'Operator', email: 'operator@staging.carup.local', role: 'admin' },
    isAuthenticated: true,
    loading: false,
  }),
}))

vi.mock('@/hooks/useCarUpApi', () => ({
  useCarUpApi: () => ({
    fetchDiasporaWorkbookTemplateSchema,
    fetchDiasporaWorkbookTemplateDownloadStatus,
    runDiasporaWorkbookDryRun,
  }),
}))

const DiasporaWorkbookDryRun = (await import('./DiasporaWorkbookDryRun')).default

const schemaResponse = {
  data: {
    version: '1',
    templateType: 'enterprise',
    sheets: [{ sheetName: 'Vehicles', columns: [] }],
  },
  supportedTemplates: [{ templateType: 'enterprise' }],
}

function renderPage() {
  return render(<MemoryRouter><DiasporaWorkbookDryRun /></MemoryRouter>)
}

beforeEach(() => {
  vi.clearAllMocks()
  fetchDiasporaWorkbookTemplateSchema.mockResolvedValue(schemaResponse)
})

describe('DiasporaWorkbookDryRun template download truthfulness', () => {
  it('offers a real .xlsx download anchor when the backend reports downloadReady', async () => {
    fetchDiasporaWorkbookTemplateDownloadStatus.mockResolvedValue({
      downloadReady: true,
      message: 'Binary XLSX template generation is scheduled for the workbook template generation phase.',
    })
    renderPage()

    await waitFor(() => expect(screen.getByTestId('diaspora-workbook-template-download-link')).toBeTruthy())
    const anchor = screen.getByTestId('diaspora-workbook-template-download-link')
    expect(anchor.getAttribute('href')).toBe('/api/diaspora/workbook/template.xlsx?type=enterprise')
    expect(anchor.textContent).toContain('Download .xlsx template')

    // The stale "scheduled" message and the disabled button must be gone once ready.
    expect(screen.queryByTestId('diaspora-workbook-template-download-disabled')).toBeNull()
    expect(document.body.textContent).not.toContain('scheduled for the workbook template generation phase')
  })

  it('keeps the honest unavailable state (message + disabled button) while not ready', async () => {
    fetchDiasporaWorkbookTemplateDownloadStatus.mockResolvedValue({
      downloadReady: false,
      message: 'Binary XLSX template generation is scheduled for the workbook template generation phase.',
    })
    renderPage()

    await waitFor(() => expect(fetchDiasporaWorkbookTemplateDownloadStatus).toHaveBeenCalled())
    await waitFor(() => expect(screen.getByTestId('diaspora-workbook-template-download-disabled')).toBeTruthy())
    expect(screen.queryByTestId('diaspora-workbook-template-download-link')).toBeNull()
    expect(document.body.textContent).toContain('scheduled for the workbook template generation phase')
  })
})
