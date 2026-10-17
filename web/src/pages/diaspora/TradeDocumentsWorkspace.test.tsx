/**
 * T8.3 — what the workspace is allowed to CLAIM on screen.
 *
 * The failure this guards against is a customer skimming the page and reading a green tick beside a
 * document nobody has looked at.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import React from 'react'

const state = vi.hoisted(() => ({ workspace: null as unknown, err: null as Error | null }))
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ loading: false, user: { id: 'u1' } }) }))
vi.mock('@/hooks/useCarUpApi', () => ({
  useCarUpApi: () => ({
    fetchDocumentWorkspace: vi.fn(async () => { if (state.err) throw state.err; return state.workspace }),
  }),
}))

import TradeDocumentsWorkspace from './TradeDocumentsWorkspace'

const item = (over = {}) => ({
  document_type: 'commercial_invoice', display_name: 'Commercial Invoice',
  verification_required: true, state: 'AWAITING_REVIEW', note: 'Supplied. Nobody has checked it yet.',
  document: { id: 'd1', version: 1, supplied_by: 'Kaizen Exports', supplied_at: '2026-09-01T00:00:00Z',
              reviewed_by: null, reviewed_at: null, has_extraction: false, has_earlier_versions: false },
  ...over,
})
const ws = (items: unknown[]) => ({
  subject: { type: 'logistics_request', id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' },
  viewer_role: 'requester', items,
  summary: { total: items.length, supplied: items.filter((i: never) => (i as { document: unknown }).document).length,
             verified: 0, awaiting_review: 1, rejected: 0, requested_outstanding: 0 },
  disclaimer: 'A document being present does not mean it has been checked, and a document being checked does not make what it describes true.',
})

const open = async () => {
  render(
    <MemoryRouter initialEntries={['/diaspora/documents/logistics_request/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee']}>
      <Routes><Route path="/diaspora/documents/:subjectType/:subjectId" element={<TradeDocumentsWorkspace />} /></Routes>
    </MemoryRouter>,
  )
  await waitFor(() => expect(screen.getByTestId('documents-workspace')).toBeInTheDocument())
}

beforeEach(() => { state.err = null; state.workspace = ws([item()]) })

describe('the documents workspace', () => {
  it('says SUPPLIED — AWAITING REVIEW, never "verified", for a document nobody has checked', async () => {
    await open()
    expect(screen.getByTestId('documents-state').textContent).toContain('Supplied — awaiting review')
    expect(screen.getByTestId('documents-workspace').textContent).not.toContain('Verified')
  })

  it('says Verified only when a reviewer actually verified it', async () => {
    state.workspace = ws([item({ state: 'VERIFIED', note: 'Checked and verified by CarUp.' })])
    await open()
    expect(screen.getByTestId('documents-state').textContent).toContain('Verified')
  })

  it('reports that text was read automatically WITHOUT letting it become a status', async () => {
    state.workspace = ws([item({ document: { ...item().document, has_extraction: true } })])
    await open()
    expect(screen.getByTestId('documents-provenance').textContent).toContain('text was read automatically')
    // The state is still awaiting review — extraction is an observation.
    expect(screen.getByTestId('documents-state').textContent).toContain('awaiting review')
  })

  it('shows who supplied it and when — provenance a reader needs to weigh it', async () => {
    await open()
    const p = screen.getByTestId('documents-provenance').textContent || ''
    expect(p).toContain('Kaizen Exports')
    expect(p).toContain('2026-09-01')
  })

  it('says an earlier version is kept, so replacement is visible', async () => {
    state.workspace = ws([item({ document: { ...item().document, version: 2, has_earlier_versions: true } })])
    await open()
    const p = screen.getByTestId('documents-provenance').textContent || ''
    expect(p).toContain('version 2')
    expect(p).toContain('an earlier version is kept')
  })

  it('separates what is still needed from what has been supplied', async () => {
    state.workspace = ws([item(), item({ document_type: 'bill_of_lading', display_name: 'Bill of Lading', state: 'MISSING', note: 'Not supplied yet.', document: null })])
    await open()
    expect(screen.getByTestId('documents-outstanding')).toBeInTheDocument()
    expect(screen.getByTestId('documents-supplied')).toBeInTheDocument()
  })

  it('never calls anything legally required', async () => {
    state.workspace = ws([item({ state: 'MISSING', document: null })])
    await open()
    expect(screen.getByTestId('documents-workspace').textContent).not.toMatch(/legally required|required by law/i)
  })

  it('states the truth model in words, not just in colour', async () => {
    await open()
    const d = screen.getByTestId('documents-disclaimer').textContent || ''
    expect(d).toContain('does not mean it has been checked')
    expect(d).toContain('does not make what it describes true')
    expect(screen.getByTestId('documents-workspace').textContent)
      .toContain('CarUp does not decide duty, tax or customs outcomes')
  })

  it('an unreadable workspace is not reported as an empty one', async () => {
    state.err = new Error('network')
    render(
      <MemoryRouter initialEntries={['/diaspora/documents/logistics_request/x']}>
        <Routes><Route path="/diaspora/documents/:subjectType/:subjectId" element={<TradeDocumentsWorkspace />} /></Routes>
      </MemoryRouter>,
    )
    await waitFor(() => expect(screen.getByTestId('documents-unreadable')).toBeInTheDocument())
    expect(screen.getByTestId('documents-unreadable').textContent).toContain('not a report that there are none')
    expect(screen.queryByTestId('documents-workspace')).toBeNull()
  })

  it('exposes no internal table or column names', async () => {
    await open()
    const t = screen.getByTestId('documents-workspace').textContent || ''
    for (const leak of ['diaspora_trade_documents', 'subject_type', 'verification_status', 'ocr_document_id']) {
      expect(t).not.toContain(leak)
    }
  })
})
