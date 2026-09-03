/**
 * O2-X5 — Dealer onboarding (applicant surface at /dealer/onboarding).
 *
 * A VIEW over server truth for the caller's OWN application: business identity (with
 * OCR candidates the user explicitly confirms/corrects), responsible-person identity from O2,
 * every compliance requirement shown independently, private evidence with signed previews,
 * proposed branches, the eight Dealer Compliance dimensions verbatim, who-must-act, the honest
 * workspace dependency (an applicant is not an active Dealer), and the workbook migration lane
 * (inspect → editable mapping → confirm → the EXISTING engine's dry run).
 */
import React, { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { CheckCircle, Lock, Upload, FileSpreadsheet, ScanSearch } from 'lucide-react'
import { useCarUpApi } from '@/hooks/useCarUpApi'
import { useAuth } from '@/context/AuthContext'
import { toast } from 'sonner'
import WorkbookWorkspace from '@/components/workbook/WorkbookWorkspace'

const fieldClass = 'w-full rounded-md border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-100'

const ACTOR_LABELS: Record<string, string> = {
  subject_action: 'Your action needed',
  carup_review: 'With CarUp review',
  external_authority: 'With an external authority',
  escalated: 'Escalated to CarUp',
  none: 'Nothing outstanding',
}

interface Candidate { state: string; value?: string }
interface OverviewDoc { id: string; doc_type: string; status: string; has_file: boolean; extraction_candidates?: Record<string, Candidate> | null }
interface Overview {
  registration: { organization_name: string | null; onboarding_status: string | null }
  profile: Record<string, string | null> | null
  requirements: Array<{ id: string; requirement_key: string; status: string; is_blocking: boolean }>
  documents: OverviewDoc[]
  branches: Array<{ id: string; name: string | null; address: string | null }>
  compliance: Record<string, unknown> | null
  responsible_person_identity: { effective_state: string; capability_bearing: boolean; applicant_guidance: string | null; who_must_act: string }
  who_must_act: string
  workspace_access: { available: boolean; note: string }
  document_types: string[]
}

interface MappingRow { source: string; proposed_target: string | null; confidence: number | null; provider: string }

function readFileAsDataUri(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('Could not read the selected file.'))
    reader.onload = () => resolve(String(reader.result))
    reader.readAsDataURL(file)
  })
}

export default function DealerOnboarding() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const {
    fetchDealerOnboardingOverview,
    saveDealerOnboardingProfile,
    uploadDealerEvidence,
    runDealerDocumentOcr,
    addDealerOnboardingBranch,
    inspectDealerWorkbook,
    confirmDealerWorkbookMapping,
    runDealerWorkbookDryRun,
  } = useCarUpApi()

  const [overview, setOverview] = useState<Overview | null>(null)
  const [accessDenied, setAccessDenied] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({ legal_name: '', trading_name: '', registration_number: '', tax_id: '', physical_address: '', responsible_person: '', operating_country: '' })
  const [candidatesSeen, setCandidatesSeen] = useState<Record<string, string>>({})
  const [docType, setDocType] = useState('company_registration')
  const [uploading, setUploading] = useState(false)
  const [ocrRunning, setOcrRunning] = useState<string | null>(null)
  const [branchName, setBranchName] = useState('')
  const [branchAddress, setBranchAddress] = useState('')
  // Workbook lane state
  const [workbookFile, setWorkbookFile] = useState<{ name: string; dataUri: string } | null>(null)
  const [inspecting, setInspecting] = useState(false)
  const [mappingRows, setMappingRows] = useState<MappingRow[]>([])
  const [mappingTargets, setMappingTargets] = useState<Record<string, string>>({})
  const [canonicalColumns, setCanonicalColumns] = useState<string[]>([])
  const [workbookMeta, setWorkbookMeta] = useState<{ checksum: string; templateType: string; sheetName: string; rowCount: number } | null>(null)
  const [mappingConfirmed, setMappingConfirmed] = useState(false)
  const [dryRun, setDryRun] = useState<Record<string, unknown> | null>(null)
  const [runningDryRun, setRunningDryRun] = useState(false)

  const load = useCallback(async () => {
    try {
      const data = await fetchDealerOnboardingOverview() as unknown as Overview
      setOverview(data)
      if (data.profile) {
        setForm((current) => ({
          ...current,
          legal_name: data.profile!.legal_name || '',
          trading_name: data.profile!.trading_name || '',
          registration_number: data.profile!.registration_number || '',
          tax_id: data.profile!.tax_id || '',
          physical_address: data.profile!.physical_address || '',
          responsible_person: data.profile!.responsible_person || '',
          operating_country: data.profile!.operating_country || '',
        }))
      }
    } catch (error) {
      if (error instanceof Error && /DEALER_ONBOARDING_CONTEXT_REQUIRED/.test(error.message)) {
        setAccessDenied(true)
      } else {
        toast.error(error instanceof Error ? error.message : 'Could not load your dealer application.')
      }
    } finally {
      setLoading(false)
    }
  }, [fetchDealerOnboardingOverview])

  // Keyed on the user's id, not the user object — a context re-render must not refetch.
  const userId = user?.id
  useEffect(() => {
    if (!userId) { navigate('/login'); return }
    queueMicrotask(() => { void load() })
  }, [userId, navigate, load])

  const applyCandidate = (field: string, value: string) => {
    setCandidatesSeen((current) => ({ ...current, [field]: value }))
    setForm((current) => ({ ...current, [field]: value }))
  }

  const saveProfile = async () => {
    setSaving(true)
    try {
      const seen: Record<string, string> = {}
      for (const [field, value] of Object.entries(candidatesSeen)) seen[field] = value
      await saveDealerOnboardingProfile({ profile: { ...form }, candidates_seen: Object.keys(seen).length ? seen : undefined })
      toast.success('Dealer application saved.')
      await load()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not save the application.')
    } finally {
      setSaving(false)
    }
  }

  const uploadEvidence = async (file: File | undefined) => {
    if (!file) return
    setUploading(true)
    try {
      const dataUri = await readFileAsDataUri(file)
      await uploadDealerEvidence({ doc_type: docType, file: dataUri })
      toast.success('Document uploaded (private).')
      await load()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Upload failed — try again.')
    } finally {
      setUploading(false)
    }
  }

  const runOcr = async (docId: string) => {
    setOcrRunning(docId)
    try {
      await runDealerDocumentOcr(docId)
      toast.success('Extraction complete — review the candidates below.')
      await load()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Extraction failed.')
    } finally {
      setOcrRunning(null)
    }
  }

  const pickWorkbook = async (file: File | undefined) => {
    if (!file) return
    const dataUri = await readFileAsDataUri(file)
    setWorkbookFile({ name: file.name, dataUri })
    setMappingRows([]); setDryRun(null); setMappingConfirmed(false); setWorkbookMeta(null)
  }

  const inspectWorkbook = async () => {
    if (!workbookFile) return
    setInspecting(true)
    try {
      const result = await inspectDealerWorkbook({ fileBase64: workbookFile.dataUri, filename: workbookFile.name }) as unknown as {
        checksum: string; template_type: string; sheet_name: string; row_count: number;
        proposals: MappingRow[]; canonical_columns: string[];
      }
      setWorkbookMeta({ checksum: result.checksum, templateType: result.template_type, sheetName: result.sheet_name, rowCount: result.row_count })
      setMappingRows(result.proposals)
      setCanonicalColumns(result.canonical_columns)
      const targets: Record<string, string> = {}
      for (const p of result.proposals) targets[p.source] = p.proposed_target || 'ignore'
      setMappingTargets(targets)
      setMappingConfirmed(false)
      setDryRun(null)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not inspect the workbook.')
    } finally {
      setInspecting(false)
    }
  }

  const confirmMapping = async () => {
    if (!workbookMeta) return
    try {
      await confirmDealerWorkbookMapping({
        template_type: workbookMeta.templateType,
        sheet_name: workbookMeta.sheetName,
        workbook_checksum: workbookMeta.checksum,
        mappings: mappingRows.map((row) => ({ source: row.source, target: mappingTargets[row.source] || 'ignore' })),
      })
      setMappingConfirmed(true)
      toast.success('Mapping confirmed for this exact file.')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Mapping confirmation failed.')
    }
  }

  const runWorkbookDryRun = async () => {
    if (!workbookFile || !workbookMeta) return
    setRunningDryRun(true)
    try {
      const result = await runDealerWorkbookDryRun({
        fileBase64: workbookFile.dataUri,
        filename: workbookFile.name,
        templateType: workbookMeta.templateType,
        sheetName: workbookMeta.sheetName,
      })
      setDryRun(result.data as Record<string, unknown>)
      toast.success('Dry run complete — review before any import is confirmed.')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Dry run failed.')
    } finally {
      setRunningDryRun(false)
    }
  }

  if (loading) return <div className="p-8 text-gray-300" data-testid="dealer-onboarding-loading">Loading your dealer application…</div>
  if (accessDenied) {
    return (
      <div className="mx-auto max-w-xl p-8 text-gray-200 space-y-3" data-testid="dealer-onboarding-denied">
        <h1 className="text-xl font-semibold">Dealer onboarding</h1>
        <p>Dealer onboarding opens once your registration profile records a dealer business. Update your registration details first.</p>
        <Button onClick={() => navigate('/onboarding')}>Go to registration</Button>
      </div>
    )
  }
  if (!overview) return <div className="p-8 text-gray-300">Your dealer application is unavailable right now.</div>

  const compliance = overview.compliance as Record<string, string | boolean | string[]> | null

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-4 sm:p-8 text-gray-100">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold">Dealer onboarding — {overview.registration.organization_name || 'your business'}</h1>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline" data-testid="dealer-who-must-act">{ACTOR_LABELS[overview.who_must_act] || overview.who_must_act}</Badge>
          <Badge className="bg-gray-700" data-testid="workspace-dependency"><Lock className="mr-1 h-3 w-3" aria-hidden />Applicant — not an active Dealer</Badge>
        </div>
        <p className="text-xs text-gray-500">{overview.workspace_access.note}</p>
      </header>

      {/* A + B — business identity + responsible person */}
      <Card className="bg-gray-900 border-gray-800">
        <CardContent className="p-4 space-y-3">
          <h2 className="font-medium">Business identity</h2>
          <div className="grid gap-3 sm:grid-cols-2" data-testid="dealer-profile-form">
            {(['legal_name', 'trading_name', 'registration_number', 'tax_id', 'physical_address', 'responsible_person', 'operating_country'] as const).map((field) => (
              <label key={field} className="text-sm space-y-1">
                <span className="text-gray-400">{field.replace(/_/g, ' ')}</span>
                <input className={fieldClass} value={form[field]}
                  onChange={(e) => setForm({ ...form, [field]: e.target.value })} />
              </label>
            ))}
          </div>
          <Button onClick={saveProfile} disabled={saving} data-testid="save-dealer-profile">
            {saving ? 'Saving…' : overview.profile ? 'Save changes' : 'Create dealer application'}
          </Button>
          <div className="border-t border-gray-800 pt-3 text-sm" data-testid="responsible-person-identity">
            <span className="text-gray-400">Responsible person identity: </span>
            <span className={overview.responsible_person_identity.capability_bearing ? 'text-green-500' : 'text-amber-500'}>
              {overview.responsible_person_identity.effective_state.replace(/_/g, ' ')}
            </span>
            {!overview.responsible_person_identity.capability_bearing && (
              <span className="text-gray-500"> — {overview.responsible_person_identity.applicant_guidance || 'complete identity verification in registration'}</span>
            )}
          </div>
        </CardContent>
      </Card>

      {overview.profile && (
        <>
          {/* C — requirements */}
          <Card className="bg-gray-900 border-gray-800">
            <CardContent className="p-4 space-y-2">
              <h2 className="font-medium">Compliance requirements</h2>
              {overview.requirements.length === 0 && <p className="text-sm text-gray-500" data-testid="no-requirements">No requirements recorded yet — CarUp review will populate your checklist.</p>}
              <ul className="space-y-1 text-sm" data-testid="requirements-list">
                {overview.requirements.map((req) => (
                  <li key={req.id} className="flex items-center justify-between">
                    <span>{req.requirement_key.replace(/_/g, ' ')}{req.is_blocking ? ' (blocking)' : ''}</span>
                    <Badge variant="outline">{req.status}</Badge>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>

          {/* D — documents */}
          <Card className="bg-gray-900 border-gray-800">
            <CardContent className="p-4 space-y-3">
              <h2 className="font-medium">Company documents (private)</h2>
              <div className="flex flex-wrap items-end gap-3">
                <label className="text-sm space-y-1">
                  <span className="text-gray-400">Document type</span>
                  <select className={fieldClass} value={docType} onChange={(e) => setDocType(e.target.value)}>
                    {overview.document_types.map((t) => <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>)}
                  </select>
                </label>
                <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-dashed border-gray-700 px-3 py-2 text-sm" data-testid="upload-evidence">
                  <Upload className="h-4 w-4" aria-hidden />{uploading ? 'Uploading…' : 'Upload document'}
                  <input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" className="hidden"
                    onChange={(e) => uploadEvidence(e.target.files?.[0])} />
                </label>
              </div>
              <ul className="space-y-2 text-sm" data-testid="documents-list">
                {overview.documents.map((doc) => (
                  <li key={doc.id} className="rounded-md border border-gray-800 p-2 space-y-1">
                    <div className="flex items-center justify-between">
                      <span>{doc.doc_type.replace(/_/g, ' ')}</span>
                      <span className="flex items-center gap-2">
                        <Badge variant="outline">{doc.status}</Badge>
                        <Button size="sm" variant="ghost" disabled={ocrRunning === doc.id} onClick={() => runOcr(doc.id)} data-testid={`ocr-${doc.id}`}>
                          <ScanSearch className="mr-1 h-3 w-3" aria-hidden />{ocrRunning === doc.id ? 'Extracting…' : 'Extract details'}
                        </Button>
                      </span>
                    </div>
                    {doc.extraction_candidates && (
                      <div className="text-xs text-gray-400 space-y-0.5" data-testid={`candidates-${doc.id}`}>
                        <p className="text-gray-500">Extracted as candidates — use only what is correct:</p>
                        {Object.entries(doc.extraction_candidates).map(([field, candidate]) => (
                          <div key={field} className="flex items-center justify-between">
                            <span>{field.replace(/_/g, ' ')}: {candidate.state === 'machine_candidate' ? candidate.value : 'not read'}</span>
                            {candidate.state === 'machine_candidate' && candidate.value && (
                              <button type="button" className="text-orange-400 underline" data-testid={`use-${doc.id}-${field}`}
                                onClick={() => applyCandidate(field, candidate.value!)}>use</button>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>

          {/* E — branches */}
          <Card className="bg-gray-900 border-gray-800">
            <CardContent className="p-4 space-y-3">
              <h2 className="font-medium">Branches</h2>
              <ul className="text-sm text-gray-300" data-testid="branches-list">
                {overview.branches.map((b) => <li key={b.id}>{b.name || 'Unnamed'} — {b.address || 'no address'}</li>)}
              </ul>
              <div className="flex flex-wrap items-end gap-2">
                <input className={fieldClass + ' sm:w-56'} placeholder="Branch name" value={branchName} onChange={(e) => setBranchName(e.target.value)} />
                <input className={fieldClass + ' sm:w-72'} placeholder="Address" value={branchAddress} onChange={(e) => setBranchAddress(e.target.value)} />
                <Button size="sm" variant="outline" data-testid="add-branch" onClick={async () => {
                  try {
                    await addDealerOnboardingBranch({ name: branchName, address: branchAddress })
                    setBranchName(''); setBranchAddress('')
                    await load()
                  } catch (error) {
                    toast.error(error instanceof Error ? error.message : 'Could not add the branch.')
                  }
                }}>Add branch</Button>
              </div>
            </CardContent>
          </Card>

          {/* F + G — the eight dimensions, verbatim */}
          {compliance && (
            <Card className="bg-gray-900 border-gray-800">
              <CardContent className="p-4 space-y-2">
                <h2 className="font-medium">Dealer review state</h2>
                <dl className="grid grid-cols-2 gap-1 text-sm" data-testid="compliance-dimensions">
                  {(['identity_status', 'business_evidence_status', 'compliance_review_state', 'active_state', 'restriction_state', 'suspension_state', 'investigation_state', 'expiry_state'] as const).map((dim) => (
                    <React.Fragment key={dim}>
                      <dt className="text-gray-500">{dim.replace(/_/g, ' ')}</dt>
                      <dd>{String(compliance[dim] ?? '—')}</dd>
                    </React.Fragment>
                  ))}
                </dl>
                <p className="text-xs text-gray-500">
                  can publish: <span data-testid="can-publish">{String(compliance.can_publish)}</span> — decided only by Dealer Compliance review, never by this application form.
                </p>
              </CardContent>
            </Card>
          )}

          {/* H2 — O2-X5A: the shared Workbook tools shell (Template · Export · Import ·
              Recent Imports + the CarUp AI Workbook Assistant) for the dealer vehicle
              inventory workbook. Imports create DRAFT vehicles under the applicant's own
              listing authority — Dealer activation stays a separate governed decision. */}
          <WorkbookWorkspace templateKey="dealer_vehicle_inventory" title="Vehicle inventory workbook" />

          {/* H — workbook migration */}
          <Card className="bg-gray-900 border-gray-800">
            <CardContent className="p-4 space-y-3" data-testid="workbook-lane">
              <h2 className="font-medium flex items-center gap-2"><FileSpreadsheet className="h-4 w-4" aria-hidden />Migrate existing records (workbook)</h2>
              <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-dashed border-gray-700 px-3 py-2 text-sm">
                <Upload className="h-4 w-4" aria-hidden />{workbookFile ? workbookFile.name : 'Choose .xlsx file'}
                <input type="file" accept=".xlsx" className="hidden" onChange={(e) => pickWorkbook(e.target.files?.[0])} data-testid="workbook-file" />
              </label>
              <Button size="sm" onClick={inspectWorkbook} disabled={!workbookFile || inspecting} data-testid="inspect-workbook">
                {inspecting ? 'Inspecting…' : 'Inspect & propose mapping'}
              </Button>

              {mappingRows.length > 0 && workbookMeta && (
                <div className="space-y-2" data-testid="mapping-table">
                  <p className="text-xs text-gray-500">
                    {workbookMeta.rowCount} rows · review every column: AI proposals are suggestions — you decide. Changing the file requires confirming again.
                  </p>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead><tr className="text-left text-gray-500"><th className="p-1">Workbook column</th><th className="p-1">CarUp field</th><th className="p-1">Source</th></tr></thead>
                      <tbody>
                        {mappingRows.map((row) => (
                          <tr key={row.source} className="border-t border-gray-800">
                            <td className="p-1">{row.source}</td>
                            <td className="p-1">
                              <select className={fieldClass} value={mappingTargets[row.source] || 'ignore'}
                                data-testid={`target-${row.source}`}
                                onChange={(e) => setMappingTargets({ ...mappingTargets, [row.source]: e.target.value })}>
                                <option value="ignore">— ignore —</option>
                                {canonicalColumns.map((c) => <option key={c} value={c}>{c}</option>)}
                              </select>
                            </td>
                            <td className="p-1 text-gray-500">{row.provider}{row.confidence !== null ? ` (${Math.round((row.confidence || 0) * 100)}%)` : ''}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" onClick={confirmMapping} disabled={mappingConfirmed} data-testid="confirm-mapping">
                      {mappingConfirmed ? <><CheckCircle className="mr-1 h-3 w-3" aria-hidden />Mapping confirmed</> : 'Confirm mapping'}
                    </Button>
                    <Button size="sm" variant="outline" onClick={runWorkbookDryRun} disabled={!mappingConfirmed || runningDryRun} data-testid="run-dry-run">
                      {runningDryRun ? 'Running…' : 'Run dry run'}
                    </Button>
                  </div>
                </div>
              )}

              {dryRun !== null && (
                <div className="rounded-md border border-gray-800 p-2 text-xs" data-testid="dry-run-result">
                  <p className="text-gray-400">Dry run recorded by the import engine — review, then confirmation and execution follow the engine's own governed steps. Nothing has been imported yet.</p>
                  <pre className="mt-1 max-h-56 overflow-auto whitespace-pre-wrap text-gray-500">{JSON.stringify(dryRun, null, 2).slice(0, 4000)}</pre>
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}
