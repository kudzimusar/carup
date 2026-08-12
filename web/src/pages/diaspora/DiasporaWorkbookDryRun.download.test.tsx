import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

/**
 * F25 (web half): the template-download section must render the stale "scheduled" message ONLY while
 * downloadReady is false, and offer a REAL download once the backend reports the template as ready.
 *
 * "Real" means an authenticated fetch through downloadDiasporaWorkbookTemplateXlsx — never a relative
 * <a href="/api/...">: the SPA rewrite (web/vercel.json) serves index.html for that path, and an
 * anchor cannot carry x-session-token/x-tenant-id, so the old link was broken twice over.
 */

const fetchDiasporaWorkbookTemplateSchema = vi.fn()
const fetchDiasporaWorkbookTemplateDownloadStatus = vi.fn()
const downloadDiasporaWorkbookTemplateXlsx = vi.fn()
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
    downloadDiasporaWorkbookTemplateXlsx,
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
  downloadDiasporaWorkbookTemplateXlsx.mockResolvedValue(undefined)
})

describe('DiasporaWorkbookDryRun template download truthfulness', () => {
  it('downloads through the authenticated hook when the backend reports downloadReady', async () => {
    fetchDiasporaWorkbookTemplateDownloadStatus.mockResolvedValue({
      downloadReady: true,
      template_xlsx_path: '/api/diaspora/workbook/template.xlsx',
      message: 'Binary XLSX template download is available at /api/diaspora/workbook/template.xlsx.',
    })
    renderPage()

    const button = await screen.findByTestId('diaspora-workbook-template-download-button')
    expect(button.textContent).toContain('Download .xlsx template')

    fireEvent.click(button)
    await waitFor(() =>
      expect(downloadDiasporaWorkbookTemplateXlsx).toHaveBeenCalledWith('enterprise', '/api/diaspora/workbook/template.xlsx'),
    )

    // No relative anchor may remain — it cannot authenticate and the SPA rewrite breaks it.
    expect(document.querySelector('a[href*="template.xlsx"]')).toBeNull()
    // The stale "scheduled" message and the disabled button must be gone once ready.
    expect(screen.queryByTestId('diaspora-workbook-template-download-disabled')).toBeNull()
  })

  it('surfaces a download failure honestly instead of pretending success', async () => {
    fetchDiasporaWorkbookTemplateDownloadStatus.mockResolvedValue({ downloadReady: true })
    downloadDiasporaWorkbookTemplateXlsx.mockRejectedValue(new Error('Template download failed (403)'))
    renderPage()

    fireEvent.click(await screen.findByTestId('diaspora-workbook-template-download-button'))

    const error = await screen.findByTestId('diaspora-workbook-template-download-error')
    expect(error.textContent).toContain('Template download failed (403)')
    // Without an advertised path the hook falls back to its hardcoded route.
    expect(downloadDiasporaWorkbookTemplateXlsx).toHaveBeenCalledWith('enterprise', undefined)
  })

  it('keeps the honest unavailable state (message + disabled button) while not ready', async () => {
    fetchDiasporaWorkbookTemplateDownloadStatus.mockResolvedValue({
      downloadReady: false,
      message: 'Binary XLSX template generation is scheduled for the workbook template generation phase.',
    })
    renderPage()

    await waitFor(() => expect(fetchDiasporaWorkbookTemplateDownloadStatus).toHaveBeenCalled())
    await waitFor(() => expect(screen.getByTestId('diaspora-workbook-template-download-disabled')).toBeTruthy())
    expect(screen.queryByTestId('diaspora-workbook-template-download-button')).toBeNull()
    expect(downloadDiasporaWorkbookTemplateXlsx).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain('scheduled for the workbook template generation phase')
  })
})
