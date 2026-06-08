import { useEffect, useMemo, useState } from 'react'
import type React from 'react'
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom'
import { AlertCircle, ArrowRight, CheckCircle2, ClipboardCheck, FileText, Loader2, Package, Plus, ShieldCheck, Ship, Timer, Upload, XCircle, CheckCircle, Eye } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { useAuth } from '@/context/AuthContext'
import { useCarUpApi } from '@/hooks/useCarUpApi'
import type { DiasporaComplianceReview, DiasporaImportOrder, DiasporaImportOrderPayload, DiasporaOrderType, DiasporaTradeDocument } from '@/types'

const requiredDocuments = [
  'Buyer identity document',
  'Invoice or auction sheet',
  'Export certificate',
  'Bill of lading',
  'ZIMRA duty assessment',
]

const documentTypeOptions = [
  { value: 'passport', label: 'Passport' },
  { value: 'national_id', label: 'National ID' },
  { value: 'residence_card', label: 'Residence Card' },
  { value: 'vehicle_registration', label: 'Vehicle Registration' },
  { value: 'auction_sheet', label: 'Auction Sheet' },
  { value: 'bill_of_lading', label: 'Bill of Lading' },
  { value: 'commercial_invoice', label: 'Commercial Invoice' },
  { value: 'export_certificate', label: 'Export Certificate' },
  { value: 'customs_declaration', label: 'Customs Declaration' },
  { value: 'inspection_certificate', label: 'Inspection Certificate' },
  { value: 'insurance_certificate', label: 'Insurance Certificate' },
  { value: 'duty_receipt', label: 'Duty Receipt' },
  { value: 'packing_list', label: 'Packing List' },
  { value: 'port_release_order', label: 'Port Release Order' },
  { value: 'police_clearance', label: 'Police Clearance' },
  { value: 'mechanical_report', label: 'Mechanical Report' },
]

const timelineSteps = [
  'IMPORT_REQUESTED',
  'DOCUMENTS_PENDING',
  'DOCUMENTS_VERIFIED',
  'CONTAINER_BOOKED',
  'SHIPPED',
  'CUSTOMS_IN_PROGRESS',
  'ZIMBABWE_READY',
]

const adminRoles = new Set(['admin', 'platform_admin', 'super_admin', 'government', 'government_reviewer', 'reviewer'])

const initialForm: DiasporaImportOrderPayload = {
  order_type: 'vehicle',
  origin_country: '',
  origin_city: '',
  destination_country: 'Zimbabwe',
  destination_city: '',
  requested_make: '',
  requested_model: '',
  requested_year_min: new Date().getFullYear(),
  requested_year_max: new Date().getFullYear(),
  budget_amount: undefined,
  budget_currency: 'USD',
}

function labelize(value?: string | null) {
  if (!value) return 'Not set'
  return value
    .replace(/_/g, ' ')
    .toLowerCase()
    .replace(/\b\w/g, char => char.toUpperCase())
}

function formatMoney(amount?: string | number | null, currency = 'USD') {
  if (amount === undefined || amount === null || amount === '') return 'Budget pending'
  return `${currency} ${Number(amount).toLocaleString()}`
}

function RequireDiasporaAuth({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, loading } = useAuth()

  if (loading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center text-orange-600" data-testid="diaspora-auth-loading">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    )
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />
  }

  return children
}

function StatusBadge({ status }: { status?: string }) {
  return (
    <Badge className="bg-orange-100 text-orange-800 hover:bg-orange-100" data-testid="diaspora-status-badge">
      {labelize(status || 'IMPORT_REQUESTED')}
    </Badge>
  )
}

function DocumentChecklist({ documents = [] }: { documents?: DiasporaTradeDocument[] }) {
  const uploadedTypes = new Set(documents.map(document => labelize(document.document_type)))

  return (
    <div className="rounded-lg border border-gray-200 bg-white" data-testid="diaspora-document-checklist">
      <div className="border-b border-gray-100 px-4 py-3">
        <h2 className="text-base font-semibold text-gray-900">Required documents</h2>
      </div>
      <div className="divide-y divide-gray-100">
        {requiredDocuments.map((documentName, index) => {
          const uploaded = uploadedTypes.has(documentName)
          return (
            <div key={documentName} className="flex items-center justify-between gap-3 px-4 py-3" data-testid="diaspora-document-row">
              <div className="flex items-center gap-3">
                <FileText className="h-4 w-4 text-gray-400" />
                <span className="text-sm font-medium text-gray-800" data-testid={`diaspora-document-name-${index}`}>
                  {documentName}
                </span>
              </div>
              <Badge variant="outline" data-testid={`diaspora-document-status-${index}`}>
                {uploaded ? 'Uploaded' : 'Pending'}
              </Badge>
            </div>
          )
        })}
      </div>
      {documents.length > 0 && (
        <div className="border-t border-gray-100 px-4 py-3">
          <h3 className="text-sm font-semibold text-gray-900 mb-2">Uploaded documents</h3>
          <div className="space-y-2">
            {documents.map(document => (
              <div key={document.id} className="flex items-center justify-between gap-3 rounded-md bg-gray-50 px-3 py-2" data-testid="diaspora-uploaded-document-row">
                <div className="flex items-center gap-3">
                  <FileText className="h-4 w-4 text-orange-600" />
                  <div>
                    <p className="text-sm font-medium text-gray-900">{labelize(document.document_type)}</p>
                    {document.file_name && (
                      <p className="text-xs text-gray-500">{document.file_name}</p>
                    )}
                    {document.created_at && (
                      <p className="text-xs text-gray-500">{new Date(document.created_at).toLocaleDateString()}</p>
                    )}
                  </div>
                </div>
                <DocumentStatusBadge status={document.verification_status} />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function DocumentStatusBadge({ status }: { status?: string }) {
  const normalizedStatus = (status || 'UPLOADED').toUpperCase()
  let className = 'bg-yellow-100 text-yellow-800'
  let label = labelize(status || 'UPLOADED')

  if (normalizedStatus === 'VERIFIED') {
    className = 'bg-green-100 text-green-800'
  } else if (normalizedStatus === 'REJECTED') {
    className = 'bg-red-100 text-red-800'
  } else if (normalizedStatus === 'OCR_EXTRACTED') {
    className = 'bg-blue-100 text-blue-800'
  } else if (normalizedStatus === 'PENDING_REVIEW') {
    className = 'bg-purple-100 text-purple-800'
  }

  return (
    <Badge className={className} data-testid="diaspora-document-status-badge">
      {label}
    </Badge>
  )
}

function DocumentReviewPanel({ document, onStatusChange }: { document: DiasporaTradeDocument; onStatusChange: () => void }) {
  const { verifyDiasporaTradeDocument, rejectDiasporaTradeDocument } = useCarUpApi()
  const [verifying, setVerifying] = useState(false)
  const [rejecting, setRejecting] = useState(false)
  const [showRejectForm, setShowRejectForm] = useState(false)
  const [rejectReason, setRejectReason] = useState('')
  const [rejectNotes, setRejectNotes] = useState('')
  const [verifyNotes, setVerifyNotes] = useState('')
  const [error, setError] = useState('')

  const handleVerify = async () => {
    setVerifying(true)
    setError('')
    try {
      await verifyDiasporaTradeDocument(document.id, { notes: verifyNotes || undefined })
      onStatusChange()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Verification failed')
    } finally {
      setVerifying(false)
    }
  }

  const handleReject = async () => {
    if (!rejectReason.trim()) {
      setError('Rejection reason is required')
      return
    }
    setRejecting(true)
    setError('')
    try {
      await rejectDiasporaTradeDocument(document.id, { reason: rejectReason, notes: rejectNotes || undefined })
      setShowRejectForm(false)
      setRejectReason('')
      setRejectNotes('')
      onStatusChange()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Rejection failed')
    } finally {
      setRejecting(false)
    }
  }

  const normalizedStatus = (document.verification_status || 'UPLOADED').toUpperCase()
  const isTerminal = normalizedStatus === 'VERIFIED' || normalizedStatus === 'REJECTED'

  return (
    <div className="rounded-md border border-gray-200 bg-white p-4" data-testid={`diaspora-document-review-${document.id}`}>
      <div className="flex items-center justify-between mb-3">
        <div>
          <p className="text-sm font-semibold text-gray-900">{labelize(document.document_type)}</p>
          {document.file_name && <p className="text-xs text-gray-500">{document.file_name}</p>}
        </div>
        <DocumentStatusBadge status={document.verification_status} />
      </div>

      {error && (
        <Alert className="mb-3 border-red-200" data-testid="diaspora-review-error">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {document.extractions && document.extractions.length > 0 && (
        <div className="mb-3 rounded-md bg-gray-50 p-3">
          <p className="text-xs font-semibold text-gray-700 mb-1">OCR Extracted Data</p>
          {document.extractions.map(extraction => (
            <div key={extraction.id} className="text-xs text-gray-600">
              <p>Provider: {extraction.extraction_provider || 'carup_ocr'}</p>
              <p>Confidence: {extraction.confidence_score ? `${(extraction.confidence_score * 100).toFixed(1)}%` : 'N/A'}</p>
              {extraction.extracted_fields && (
                <pre className="mt-1 text-xs overflow-auto max-h-32">{JSON.stringify(extraction.extracted_fields, null, 2)}</pre>
              )}
            </div>
          ))}
        </div>
      )}

      {!isTerminal && !showRejectForm && (
        <div className="space-y-2">
          <div>
            <label className="text-xs text-gray-600" htmlFor={`verify-notes-${document.id}`}>Verification notes (optional)</label>
            <Input
              id={`verify-notes-${document.id}`}
              value={verifyNotes}
              onChange={event => setVerifyNotes(event.target.value)}
              placeholder="Add notes..."
              className="mt-1"
              data-testid="diaspora-verify-notes-input"
            />
          </div>
          <div className="flex gap-2">
            <Button
              size="sm"
              onClick={handleVerify}
              disabled={verifying}
              className="bg-green-600 hover:bg-green-700"
              data-testid="diaspora-verify-button"
            >
              {verifying ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <CheckCircle className="mr-1 h-3 w-3" />}
              Verify document
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setShowRejectForm(true)}
              className="text-red-600 border-red-300 hover:bg-red-50"
              data-testid="diaspora-reject-button"
            >
              <XCircle className="mr-1 h-3 w-3" />
              Reject
            </Button>
          </div>
        </div>
      )}

      {showRejectForm && (
        <div className="space-y-2 border-t border-gray-200 pt-3">
          <div>
            <label className="text-xs text-gray-600" htmlFor={`reject-reason-${document.id}`}>Rejection reason (required)</label>
            <Input
              id={`reject-reason-${document.id}`}
              value={rejectReason}
              onChange={event => setRejectReason(event.target.value)}
              placeholder="Reason for rejection..."
              className="mt-1"
              data-testid="diaspora-reject-reason-input"
            />
          </div>
          <div>
            <label className="text-xs text-gray-600" htmlFor={`reject-notes-${document.id}`}>Additional notes (optional)</label>
            <Input
              id={`reject-notes-${document.id}`}
              value={rejectNotes}
              onChange={event => setRejectNotes(event.target.value)}
              placeholder="Additional details..."
              className="mt-1"
              data-testid="diaspora-reject-notes-input"
            />
          </div>
          <div className="flex gap-2">
            <Button
              size="sm"
              onClick={handleReject}
              disabled={rejecting || !rejectReason.trim()}
              className="bg-red-600 hover:bg-red-700"
              data-testid="diaspora-confirm-reject-button"
            >
              {rejecting ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <XCircle className="mr-1 h-3 w-3" />}
              Confirm rejection
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setShowRejectForm(false)
                setRejectReason('')
                setRejectNotes('')
                setError('')
              }}
              data-testid="diaspora-cancel-reject-button"
            >
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

function DocumentUploadForm({ importOrderId, onDocumentUploaded }: { importOrderId: string; onDocumentUploaded: (document: DiasporaTradeDocument) => void }) {
  const { uploadDiasporaDocument, createDiasporaTradeDocument } = useCarUpApi()
  const [documentType, setDocumentType] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [uploadProgress, setUploadProgress] = useState<string>('')
  const [error, setError] = useState('')

  const allowedTypes = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp']
  const maxSize = 10 * 1024 * 1024 // 10MB

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = event.target.files?.[0]
    if (!selectedFile) {
      setFile(null)
      return
    }

    if (!allowedTypes.includes(selectedFile.type)) {
      setError('Invalid file type. Only PDF, JPEG, PNG, and WebP are allowed.')
      setFile(null)
      return
    }

    if (selectedFile.size > maxSize) {
      setError('File too large. Maximum size is 10MB.')
      setFile(null)
      return
    }

    setError('')
    setFile(selectedFile)
  }

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!documentType) {
      setError('Please select a document type.')
      return
    }
    if (!file) {
      setError('Please select a file to upload.')
      return
    }

    setSubmitting(true)
    setError('')
    setUploadProgress('Uploading file...')

    try {
      const uploadResult = await uploadDiasporaDocument(file, documentType, importOrderId)
      setUploadProgress('Creating document record...')

      const created = await createDiasporaTradeDocument(importOrderId, {
        document_type: documentType,
        file_name: file.name,
        storage_path: uploadResult.storagePath,
      })

      onDocumentUploaded(created)
      setDocumentType('')
      setFile(null)
      setUploadProgress('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to upload document.')
      setUploadProgress('')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="rounded-lg border border-gray-200 bg-white p-5" data-testid="diaspora-document-upload-form">
      <div className="flex items-center gap-3 mb-2">
        <Upload className="h-5 w-5 text-orange-600" />
        <h2 className="text-base font-semibold text-gray-900">Upload document</h2>
      </div>
      <p className="text-xs text-gray-500 mb-4">
        Upload a PDF or image file for this trade document. The file will be stored securely and may be processed for OCR extraction.
      </p>

      {error && (
        <Alert className="mb-4 border-red-200" data-testid="diaspora-document-upload-error">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Upload failed</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {uploadProgress && (
        <Alert className="mb-4 border-blue-200 bg-blue-50" data-testid="diaspora-document-upload-progress">
          <Loader2 className="h-4 w-4 animate-spin text-blue-600" />
          <AlertDescription className="text-blue-800">{uploadProgress}</AlertDescription>
        </Alert>
      )}

      <div className="space-y-4">
        <div>
          <label className="text-sm font-medium text-gray-800" htmlFor="document-type">Document type</label>
          <select
            id="document-type"
            value={documentType}
            onChange={event => setDocumentType(event.target.value)}
            className="mt-1 block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:border-orange-500 focus:outline-none focus:ring-1 focus:ring-orange-500"
            data-testid="diaspora-document-type-select"
          >
            <option value="">Select document type</option>
            {documentTypeOptions.map(option => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="text-sm font-medium text-gray-800" htmlFor="document-file">File (PDF, JPEG, PNG, WebP - max 10MB)</label>
          <Input
            id="document-file"
            type="file"
            accept=".pdf,.jpg,.jpeg,.png,.webp"
            onChange={handleFileChange}
            className="mt-1"
            data-testid="diaspora-document-file-input"
          />
          {file && (
            <p className="mt-1 text-xs text-gray-500" data-testid="diaspora-document-file-selected">
              Selected: {file.name} ({(file.size / 1024 / 1024).toFixed(2)} MB)
            </p>
          )}
        </div>

        <div className="flex justify-end">
          <Button
            type="submit"
            disabled={submitting || !documentType || !file}
            className="bg-orange-600 hover:bg-orange-700"
            data-testid="diaspora-document-upload-submit"
          >
            {submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
            Upload document
          </Button>
        </div>
      </div>
    </form>
  )
}

function OrderSummary({ order }: { order: DiasporaImportOrder }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-5" data-testid="diaspora-order-summary">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase text-gray-400">Import order</p>
          <h1 className="mt-1 text-2xl font-bold text-gray-950">{order.requested_make || 'Vehicle'} {order.requested_model || 'request'}</h1>
        </div>
        <StatusBadge status={order.status} />
      </div>
      <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div data-testid="diaspora-order-type">
          <p className="text-xs text-gray-500">Cargo</p>
          <p className="font-semibold text-gray-900">{labelize(order.order_type)}</p>
        </div>
        <div data-testid="diaspora-order-origin">
          <p className="text-xs text-gray-500">Origin</p>
          <p className="font-semibold text-gray-900">{[order.origin_city, order.origin_country].filter(Boolean).join(', ')}</p>
        </div>
        <div data-testid="diaspora-order-destination">
          <p className="text-xs text-gray-500">Destination</p>
          <p className="font-semibold text-gray-900">{[order.destination_city, order.destination_country].filter(Boolean).join(', ')}</p>
        </div>
        <div data-testid="diaspora-order-budget">
          <p className="text-xs text-gray-500">Budget</p>
          <p className="font-semibold text-gray-900">{formatMoney(order.budget_amount, order.budget_currency || 'USD')}</p>
        </div>
      </div>
    </div>
  )
}

function StatusTimeline({ currentStatus }: { currentStatus?: string }) {
  const activeIndex = Math.max(0, timelineSteps.indexOf(currentStatus || 'IMPORT_REQUESTED'))

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-5" data-testid="diaspora-status-timeline">
      <h2 className="text-base font-semibold text-gray-900">Status timeline</h2>
      <div className="mt-4 grid gap-3">
        {timelineSteps.map((step, index) => {
          const active = index <= activeIndex
          return (
            <div key={step} className="flex items-center gap-3" data-testid="diaspora-timeline-item">
              <span className={`flex h-7 w-7 items-center justify-center rounded-full ${active ? 'bg-orange-600 text-white' : 'bg-gray-100 text-gray-400'}`}>
                {active ? <CheckCircle2 className="h-4 w-4" /> : <Timer className="h-4 w-4" />}
              </span>
              <span className={`text-sm font-medium ${active ? 'text-gray-950' : 'text-gray-500'}`}>{labelize(step)}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export function DiasporaLanding() {
  return (
    <div className="bg-gray-50" data-testid="diaspora-landing-route">
      <section className="mx-auto grid max-w-7xl gap-8 px-4 py-10 sm:px-6 lg:grid-cols-[1.1fr_0.9fr] lg:px-8 lg:py-14">
        <div className="flex flex-col justify-center">
          <Badge className="w-fit bg-orange-100 text-orange-800 hover:bg-orange-100" data-testid="diaspora-landing-status-badge">
            Early access import coordination
          </Badge>
          <h1 className="mt-4 text-4xl font-bold tracking-tight text-gray-950 sm:text-5xl">Diaspora Trade</h1>
          <p className="mt-4 max-w-2xl text-base leading-7 text-gray-600">
            Start a vehicle or parts import request for Zimbabwe, keep the request order-scoped, and prepare documents and shipment milestones without exposing private trade data.
          </p>
          <Alert className="mt-5 max-w-2xl border-amber-200 bg-amber-50 text-amber-900" data-testid="diaspora-status-note">
            <ClipboardCheck className="h-4 w-4" />
            <AlertTitle>Buyer import order slice is active</AlertTitle>
            <AlertDescription>
              Document upload, payment, shipment booking, and compliance review actions remain staged behind the order workflow.
            </AlertDescription>
          </Alert>
          <div className="mt-6 flex flex-wrap gap-3">
            <Button asChild className="bg-orange-600 hover:bg-orange-700" data-testid="diaspora-start-import-button">
              <Link to="/diaspora/imports/new">
                <Plus className="mr-2 h-4 w-4" />
                Start import order
              </Link>
            </Button>
            <Button asChild variant="outline" data-testid="diaspora-view-imports-button">
              <Link to="/diaspora/imports">View my import orders</Link>
            </Button>
            <Button asChild variant="outline" data-testid="diaspora-learn-docs-button">
              <Link to="#diaspora-documents">Learn documents</Link>
            </Button>
          </div>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm" data-testid="diaspora-landing-workflow">
          <div className="grid gap-4">
            {[
              { icon: ClipboardCheck, title: 'Request', body: 'Capture origin, destination, cargo type, vehicle details, and budget.' },
              { icon: FileText, title: 'Documents', body: 'Track required trade documents against a single import order.' },
              { icon: Ship, title: 'Shipment', body: 'Prepare container and border milestones once coordination starts.' },
            ].map(item => (
              <div key={item.title} className="flex gap-3 rounded-md border border-gray-100 p-4" data-testid="diaspora-landing-workflow-item">
                <item.icon className="mt-0.5 h-5 w-5 text-orange-600" />
                <div>
                  <h2 className="font-semibold text-gray-950">{item.title}</h2>
                  <p className="text-sm leading-6 text-gray-600">{item.body}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>
      <section id="diaspora-documents" className="mx-auto max-w-7xl px-4 pb-12 sm:px-6 lg:px-8" data-testid="diaspora-documents-section">
        <div className="rounded-lg border border-gray-200 bg-white p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-gray-950">Document checklist preview</h2>
              <p className="mt-1 text-sm text-gray-600">
                These placeholders become order-specific rows after a buyer creates an import request.
              </p>
            </div>
            <Badge variant="outline" data-testid="diaspora-documents-preview-badge">Order scoped</Badge>
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {requiredDocuments.map((documentName, index) => (
              <div key={documentName} className="rounded-md border border-gray-100 p-3" data-testid="diaspora-documents-preview-row">
                <FileText className="h-4 w-4 text-orange-600" />
                <p className="mt-2 text-sm font-medium text-gray-900" data-testid={`diaspora-documents-preview-name-${index}`}>{documentName}</p>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  )
}

export function DiasporaImportList() {
  const { fetchDiasporaImportOrders } = useCarUpApi()
  const [orders, setOrders] = useState<DiasporaImportOrder[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    fetchDiasporaImportOrders()
      .then(setOrders)
      .catch(err => setError(err instanceof Error ? err.message : 'Unable to load import orders'))
      .finally(() => setLoading(false))
  }, [fetchDiasporaImportOrders])

  return (
    <RequireDiasporaAuth>
      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8" data-testid="diaspora-import-list-route">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-gray-950">Import orders</h1>
            <p className="text-sm text-gray-500">Order-scoped buyer import requests.</p>
          </div>
          <Button asChild className="bg-orange-600 hover:bg-orange-700" data-testid="diaspora-new-import-button">
            <Link to="/diaspora/imports/new">New import order</Link>
          </Button>
        </div>
        {loading && <div className="mt-8 text-orange-600" data-testid="diaspora-import-list-loading">Loading import orders...</div>}
        {error && <Alert className="mt-8 border-red-200" data-testid="diaspora-import-list-error"><AlertCircle className="h-4 w-4" /><AlertTitle>Unable to load</AlertTitle><AlertDescription>{error}</AlertDescription></Alert>}
        {!loading && !error && (
          <div className="mt-6 divide-y divide-gray-100 rounded-lg border border-gray-200 bg-white" data-testid="diaspora-import-list">
            {orders.length === 0 ? (
              <div className="px-4 py-8 text-center text-gray-500" data-testid="diaspora-import-list-empty">No import orders yet.</div>
            ) : orders.map(order => (
              <Link key={order.id} to={`/diaspora/imports/${order.id}`} className="flex items-center justify-between gap-4 px-4 py-4 hover:bg-gray-50" data-testid="diaspora-import-row">
                <div>
                  <p className="font-semibold text-gray-950">{order.requested_make || 'Import'} {order.requested_model || order.id}</p>
                  <p className="text-sm text-gray-500">{labelize(order.order_type)} from {order.origin_country}</p>
                </div>
                <StatusBadge status={order.status} />
              </Link>
            ))}
          </div>
        )}
      </div>
    </RequireDiasporaAuth>
  )
}

export function NewDiasporaImportOrder() {
  const navigate = useNavigate()
  const { createDiasporaImportOrder } = useCarUpApi()
  const [form, setForm] = useState<DiasporaImportOrderPayload>(initialForm)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [submitting, setSubmitting] = useState(false)

  const set = (field: keyof DiasporaImportOrderPayload, value: string | number | undefined) => {
    setForm(prev => ({ ...prev, [field]: value }))
  }

  const selectOrderType = (orderType: DiasporaOrderType) => {
    setForm(prev => ({ ...prev, order_type: orderType }))
  }

  const validate = () => {
    const nextErrors: Record<string, string> = {}
    if (!form.order_type) nextErrors.order_type = 'Choose vehicle or parts.'
    if (!form.origin_country?.trim()) nextErrors.origin_country = 'Origin country is required.'
    if (!form.origin_city?.trim()) nextErrors.origin_city = 'Origin city is required.'
    if (!form.destination_city?.trim()) nextErrors.destination_city = 'Destination city is required.'
    if (!form.requested_make?.trim()) nextErrors.requested_make = 'Make is required.'
    if (!form.requested_model?.trim()) nextErrors.requested_model = 'Model is required.'
    if (!form.requested_year_min) nextErrors.requested_year_min = 'Year is required.'
    if (!form.budget_amount || Number(form.budget_amount) <= 0) nextErrors.budget_amount = 'Budget is required.'
    setErrors(nextErrors)
    return Object.keys(nextErrors).length === 0
  }

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!validate()) return
    setSubmitting(true)
    try {
      const created = await createDiasporaImportOrder({
        ...form,
        requested_year_max: form.requested_year_min,
        budget_amount: Number(form.budget_amount),
      })
      navigate(`/diaspora/imports/${created.id}`)
    } catch (err) {
      setErrors({ form: err instanceof Error ? err.message : 'Unable to create import order.' })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <RequireDiasporaAuth>
      <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 lg:px-8" data-testid="diaspora-new-import-route">
        <div className="mb-6">
          <Badge variant="outline" data-testid="diaspora-new-import-status-badge">Buyer request</Badge>
          <h1 className="mt-3 text-2xl font-bold text-gray-950">New import order</h1>
          <p className="text-sm text-gray-500">Create the order record that documents, shipment, and compliance work will attach to.</p>
        </div>
        <form onSubmit={handleSubmit} className="rounded-lg border border-gray-200 bg-white p-5" data-testid="diaspora-import-form">
          {errors.form && (
            <Alert className="mb-5 border-red-200" data-testid="diaspora-import-form-error">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>Order not created</AlertTitle>
              <AlertDescription>{errors.form}</AlertDescription>
            </Alert>
          )}
          {Object.keys(errors).length > 0 && !errors.form && (
            <Alert className="mb-5 border-red-200" data-testid="diaspora-import-validation-error">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>Check required fields</AlertTitle>
              <AlertDescription>Complete the highlighted fields before submitting.</AlertDescription>
            </Alert>
          )}
          <div className="space-y-6">
            <div>
              <label className="text-sm font-semibold text-gray-900">Cargo type</label>
              <div className="mt-2 grid gap-3 sm:grid-cols-2" data-testid="diaspora-order-type-control">
                {[
                  { value: 'vehicle' as const, label: 'Vehicle', icon: Package },
                  { value: 'parts' as const, label: 'Parts', icon: ClipboardCheck },
                ].map(option => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => selectOrderType(option.value)}
                    className={`flex items-center gap-3 rounded-md border px-4 py-3 text-left transition-colors ${form.order_type === option.value ? 'border-orange-500 bg-orange-50 text-orange-900' : 'border-gray-200 text-gray-700 hover:bg-gray-50'}`}
                    data-testid={`diaspora-order-type-${option.value}`}
                  >
                    <option.icon className="h-5 w-5" />
                    <span className="font-medium">{option.label}</span>
                  </button>
                ))}
              </div>
              {errors.order_type && <p className="mt-1 text-xs text-red-600">{errors.order_type}</p>}
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="text-sm font-medium text-gray-800" htmlFor="origin-country">Origin country</label>
                <Input id="origin-country" value={form.origin_country} onChange={event => set('origin_country', event.target.value)} className={errors.origin_country ? 'border-red-400' : ''} data-testid="diaspora-origin-country-input" />
                {errors.origin_country && <p className="mt-1 text-xs text-red-600">{errors.origin_country}</p>}
              </div>
              <div>
                <label className="text-sm font-medium text-gray-800" htmlFor="origin-city">Origin city</label>
                <Input id="origin-city" value={form.origin_city} onChange={event => set('origin_city', event.target.value)} className={errors.origin_city ? 'border-red-400' : ''} data-testid="diaspora-origin-city-input" />
                {errors.origin_city && <p className="mt-1 text-xs text-red-600">{errors.origin_city}</p>}
              </div>
              <div>
                <label className="text-sm font-medium text-gray-800" htmlFor="destination-city">Destination city in Zimbabwe</label>
                <Input id="destination-city" value={form.destination_city} onChange={event => set('destination_city', event.target.value)} className={errors.destination_city ? 'border-red-400' : ''} data-testid="diaspora-destination-city-input" />
                {errors.destination_city && <p className="mt-1 text-xs text-red-600">{errors.destination_city}</p>}
              </div>
              <div>
                <label className="text-sm font-medium text-gray-800" htmlFor="destination-country">Destination country</label>
                <Input id="destination-country" value="Zimbabwe" readOnly data-testid="diaspora-destination-country-input" />
              </div>
              <div>
                <label className="text-sm font-medium text-gray-800" htmlFor="requested-make">Make</label>
                <Input id="requested-make" value={form.requested_make} onChange={event => set('requested_make', event.target.value)} className={errors.requested_make ? 'border-red-400' : ''} data-testid="diaspora-make-input" />
                {errors.requested_make && <p className="mt-1 text-xs text-red-600">{errors.requested_make}</p>}
              </div>
              <div>
                <label className="text-sm font-medium text-gray-800" htmlFor="requested-model">Model</label>
                <Input id="requested-model" value={form.requested_model} onChange={event => set('requested_model', event.target.value)} className={errors.requested_model ? 'border-red-400' : ''} data-testid="diaspora-model-input" />
                {errors.requested_model && <p className="mt-1 text-xs text-red-600">{errors.requested_model}</p>}
              </div>
              <div>
                <label className="text-sm font-medium text-gray-800" htmlFor="requested-year">Year</label>
                <Input id="requested-year" type="number" value={form.requested_year_min || ''} onChange={event => set('requested_year_min', Number(event.target.value) || undefined)} className={errors.requested_year_min ? 'border-red-400' : ''} data-testid="diaspora-year-input" />
                {errors.requested_year_min && <p className="mt-1 text-xs text-red-600">{errors.requested_year_min}</p>}
              </div>
              <div>
                <label className="text-sm font-medium text-gray-800" htmlFor="budget-amount">Budget</label>
                <Input id="budget-amount" type="number" min="1" value={form.budget_amount || ''} onChange={event => set('budget_amount', Number(event.target.value) || undefined)} className={errors.budget_amount ? 'border-red-400' : ''} data-testid="diaspora-budget-input" />
                {errors.budget_amount && <p className="mt-1 text-xs text-red-600">{errors.budget_amount}</p>}
              </div>
            </div>
            <div className="flex flex-wrap justify-end gap-3 border-t border-gray-100 pt-5">
              <Button type="button" variant="outline" asChild data-testid="diaspora-cancel-import-button">
                <Link to="/diaspora">Cancel</Link>
              </Button>
              <Button type="submit" disabled={submitting} className="bg-orange-600 hover:bg-orange-700" data-testid="diaspora-submit-import-button">
                {submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ArrowRight className="mr-2 h-4 w-4" />}
                Submit import order
              </Button>
            </div>
          </div>
        </form>
      </div>
    </RequireDiasporaAuth>
  )
}

function useDiasporaOrder(orderId?: string) {
  const { fetchDiasporaImportOrder } = useCarUpApi()
  const [order, setOrder] = useState<DiasporaImportOrder | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!orderId) return
    fetchDiasporaImportOrder(orderId)
      .then(setOrder)
      .catch(err => setError(err instanceof Error ? err.message : 'Unable to load import order'))
      .finally(() => setLoading(false))
  }, [fetchDiasporaImportOrder, orderId])

  return { order, loading, error }
}

export function DiasporaImportDetail() {
  const { id } = useParams()
  const { order, loading, error } = useDiasporaOrder(id)

  return (
    <RequireDiasporaAuth>
      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8" data-testid="diaspora-import-detail-route">
        {loading && <div className="text-orange-600" data-testid="diaspora-import-detail-loading">Loading import order...</div>}
        {error && <Alert className="border-red-200" data-testid="diaspora-import-detail-error"><AlertCircle className="h-4 w-4" /><AlertTitle>Unable to load</AlertTitle><AlertDescription>{error}</AlertDescription></Alert>}
        {order && (
          <div className="space-y-6">
            <OrderSummary order={order} />
            <div className="grid gap-6 lg:grid-cols-[0.9fr_1.1fr]">
              <StatusTimeline currentStatus={order.status} />
              <DocumentChecklist documents={order.diaspora_trade_documents || []} />
            </div>
            <div className="flex flex-wrap gap-3">
              <Button asChild variant="outline" data-testid="diaspora-open-documents-button">
                <Link to={`/diaspora/imports/${order.id}/documents`}>Documents</Link>
              </Button>
              <Button asChild variant="outline" data-testid="diaspora-open-shipment-button">
                <Link to={`/diaspora/imports/${order.id}/shipment`}>Shipment</Link>
              </Button>
            </div>
          </div>
        )}
      </div>
    </RequireDiasporaAuth>
  )
}

export function DiasporaImportDocuments() {
  const { id } = useParams()
  const { user } = useAuth()
  const { fetchDiasporaTradeDocuments } = useCarUpApi()
  const [documents, setDocuments] = useState<DiasporaTradeDocument[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const isReviewer = useMemo(() => {
    const role = user?.role || ''
    return adminRoles.has(role)
  }, [user?.role])

  useEffect(() => {
    if (!id) return
    fetchDiasporaTradeDocuments(id)
      .then(setDocuments)
      .catch(err => setError(err instanceof Error ? err.message : 'Unable to load documents'))
      .finally(() => setLoading(false))
  }, [fetchDiasporaTradeDocuments, id])

  const handleDocumentUploaded = (document: DiasporaTradeDocument) => {
    setDocuments(prev => [...prev, document])
  }

  const handleStatusChange = () => {
    if (!id) return
    fetchDiasporaTradeDocuments(id)
      .then(setDocuments)
      .catch(err => setError(err instanceof Error ? err.message : 'Unable to reload documents'))
  }

  return (
    <RequireDiasporaAuth>
      <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8" data-testid="diaspora-import-documents-route">
        <h1 className="text-2xl font-bold text-gray-950">Trade documents</h1>
        <p className="mt-1 text-sm text-gray-500">Only documents scoped to this import order are shown.</p>

        <Alert className="mt-4 border-blue-200 bg-blue-50" data-testid="diaspora-documents-info">
          <Eye className="h-4 w-4 text-blue-600" />
          <AlertDescription className="text-blue-800">
            Uploaded documents require OCR/reviewer processing before they are verified.
          </AlertDescription>
        </Alert>

        {loading && <div className="mt-6 text-orange-600" data-testid="diaspora-documents-loading">Loading documents...</div>}
        {error && <Alert className="mt-6 border-red-200" data-testid="diaspora-documents-error"><AlertCircle className="h-4 w-4" /><AlertTitle>Unable to load</AlertTitle><AlertDescription>{error}</AlertDescription></Alert>}
        {!loading && !error && (
          <div className="mt-6 space-y-6">
            {id && <DocumentUploadForm importOrderId={id} onDocumentUploaded={handleDocumentUploaded} />}
            <DocumentChecklist documents={documents} />

            {isReviewer && documents.length > 0 && (
              <div className="rounded-lg border border-gray-200 bg-white p-5" data-testid="diaspora-document-review-panel">
                <div className="flex items-center gap-3 mb-4">
                  <ShieldCheck className="h-5 w-5 text-orange-600" />
                  <h2 className="text-base font-semibold text-gray-900">Document review</h2>
                </div>
                <p className="text-xs text-gray-500 mb-4">
                  Review, verify, or reject uploaded documents. Only visible to admin/reviewer users.
                </p>
                <div className="space-y-3">
                  {documents.map(document => (
                    <DocumentReviewPanel
                      key={document.id}
                      document={document}
                      onStatusChange={handleStatusChange}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </RequireDiasporaAuth>
  )
}

export function DiasporaImportShipment() {
  const { id } = useParams()

  return (
    <RequireDiasporaAuth>
      <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8" data-testid="diaspora-import-shipment-route">
        <Badge variant="outline" data-testid="diaspora-shipment-status-badge">Shipment planning</Badge>
        <h1 className="mt-3 text-2xl font-bold text-gray-950">Shipment</h1>
        <p className="mt-1 text-sm text-gray-500">Container booking and shipment events will attach to import order {id} after documents are ready.</p>
      </div>
    </RequireDiasporaAuth>
  )
}

export function DiasporaComplianceAdmin() {
  const { user, isAuthenticated, loading: authLoading } = useAuth()
  const { fetchDiasporaComplianceReviews } = useCarUpApi()
  const [rows, setRows] = useState<DiasporaComplianceReview[]>([])
  const [loading, setLoading] = useState(false)
  const role = user?.role || ''
  const canView = useMemo(() => isAuthenticated && adminRoles.has(role), [isAuthenticated, role])

  useEffect(() => {
    if (!canView) return
    fetchDiasporaComplianceReviews()
      .then(setRows)
      .finally(() => setLoading(false))
  }, [canView, fetchDiasporaComplianceReviews])

  if (authLoading) {
    return <div className="py-16 text-center text-orange-600" data-testid="diaspora-compliance-loading">Loading compliance access...</div>
  }

  if (!canView) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16 sm:px-6 lg:px-8" data-testid="diaspora-compliance-unauthorized">
        <Alert className="border-amber-200 bg-amber-50">
          <ShieldCheck className="h-4 w-4" />
          <AlertTitle>Compliance dashboard restricted</AlertTitle>
          <AlertDescription>Admin or government reviewer access is required.</AlertDescription>
        </Alert>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8" data-testid="diaspora-compliance-admin-route">
      <Badge className="bg-orange-100 text-orange-800 hover:bg-orange-100" data-testid="diaspora-compliance-status-badge">Reviewer</Badge>
      <h1 className="mt-3 text-2xl font-bold text-gray-950">Diaspora compliance</h1>
      {loading ? (
        <div className="mt-6 text-orange-600" data-testid="diaspora-compliance-table-loading">Loading compliance reviews...</div>
      ) : (
        <div className="mt-6 divide-y divide-gray-100 rounded-lg border border-gray-200 bg-white" data-testid="diaspora-compliance-table">
          {rows.length === 0 ? (
            <div className="px-4 py-8 text-center text-gray-500" data-testid="diaspora-compliance-empty">No compliance reviews found.</div>
          ) : rows.map(row => (
            <div key={row.id} className="flex justify-between gap-4 px-4 py-3" data-testid="diaspora-compliance-row">
              <span className="font-medium text-gray-900">{row.import_order_id || row.id}</span>
              <Badge variant="outline">{labelize(row.status)}</Badge>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
