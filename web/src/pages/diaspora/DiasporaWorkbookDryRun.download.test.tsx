import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

/**
 * DB-contract audit: the template-download section previously rendered a relative
 * <a href="/api/diaspora/workbook/template.xlsx?type=..."> — broken twice on the deployed SPA
 * (the static host rewrites unknown paths to index.html per web/vercel.json, and an anchor cannot
 * attach x-session-token / x-tenant-id headers). The section must instead drive the authenticated
 * blob-download hook downloadDiasporaWorkbookTemplateXlsx, preferring the backend-advertised
 * template_xlsx_path, with loading + error states — and keep the honest unavailable state while
 * downloadReady is false.
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
  it('invokes the authenticated download hook (no relative anchor) when downloadReady', async () => {
    fetchDiasporaWorkbookTemplateDownloadStatus.mockResolvedValue({
      downloadReady: true,
      template_xlsx_path: '/api/diaspora/workbook/template.xlsx',
      message: 'Binary XLSX template download is available at /api/diaspora/workbook/template.xlsx.',
    })
    renderPage()

    await waitFor(() => expect(screen.getByTestId('diaspora-workbook-template-download-button')).toBeTruthy())
    // The broken relative anchor must be gone entirely.
    expect(screen.queryByTestId('diaspora-workbook-template-download-link')).toBeNull()
    expect(screen.queryByTestId('diaspora-workbook-template-download-disabled')).toBeNull()

    fireEvent.click(screen.getByTestId('diaspora-workbook-template-download-button'))

    // The hook receives the selected template type AND the backend-advertised path.
    await waitFor(() =>
      expect(downloadDiasporaWorkbookTemplateXlsx).toHaveBeenCalledWith(
        'enterprise',
        '/api/diaspora/workbook/template.xlsx',
      ),
    )
    expect(screen.queryByTestId('diaspora-workbook-template-download-error')).toBeNull()
  })

  it('passes undefined for the path when the backend does not advertise template_xlsx_path', async () => {
    fetchDiasporaWorkbookTemplateDownloadStatus.mockResolvedValue({ downloadReady: true })
    renderPage()

    await waitFor(() => expect(screen.getByTestId('diaspora-workbook-template-download-button')).toBeTruthy())
    fireEvent.click(screen.getByTestId('diaspora-workbook-template-download-button'))

    await waitFor(() => expect(downloadDiasporaWorkbookTemplateXlsx).toHaveBeenCalledWith('enterprise', undefined))
  })

  it('surfaces a failed download honestly instead of pretending success', async () => {
    fetchDiasporaWorkbookTemplateDownloadStatus.mockResolvedValue({
      downloadReady: true,
      template_xlsx_path: '/api/diaspora/workbook/template.xlsx',
    })
    downloadDiasporaWorkbookTemplateXlsx.mockRejectedValue(new Error('Template download failed (403)'))
    renderPage()

    await waitFor(() => expect(screen.getByTestId('diaspora-workbook-template-download-button')).toBeTruthy())
    fireEvent.click(screen.getByTestId('diaspora-workbook-template-download-button'))

    await waitFor(() => expect(screen.getByTestId('diaspora-workbook-template-download-error')).toBeTruthy())
    expect(screen.getByTestId('diaspora-workbook-template-download-error').textContent).toContain('Template download failed (403)')
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
    expect(document.body.textContent).toContain('scheduled for the workbook template generation phase')
    expect(downloadDiasporaWorkbookTemplateXlsx).not.toHaveBeenCalled()
  })
})
