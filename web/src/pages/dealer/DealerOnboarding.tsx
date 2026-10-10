/**
 * O2-X5 — Dealer onboarding (applicant surface at /dealer/onboarding; ported by OC-5C from PR #208).
 *
 * A VIEW over server truth for the caller's OWN application: business identity, the responsible
 * person's identity standing (the subject-safe view from O2), every compliance requirement shown
 * independently, private evidence, proposed branches, the eight Dealer Compliance dimensions verbatim,
 * who-must-act, and the honest workspace dependency (an applicant is not an active Dealer).
 *
 * OC-5C: company documents are not read automatically on this lineage — the person types their details,
 * and the page says so instead of offering a button that cannot work. The workbook migration lane is
 * inspect → human-editable mapping (deterministic and AI suggestions, each labelled with its source) →
 * confirm the exact checksum-bound mapping → the EXISTING engine's dry run; nothing is imported here.
 */
import React, { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { CheckCircle, FileSpreadsheet, Lock, Upload } from 'lucide-react'
import { useCarUpApi } from '@/hooks/useCarUpApi'
import { useAuth } from '@/context/AuthContext'
import { toast } from 'sonner'

const fieldClass = 'min-h-11 w-full rounded-lg border border-input bg-background px-3 py-2.5 text-base text-foreground shadow-sm outline-none focus:border-primary sm:text-sm'

const ACTOR_LABELS: Record<string, string> = {
  subject_action: 'Your action needed',
  carup_review: 'With CarUp review',
  external_authority: 'With an external authority',
  escalated: 'Escalated to CarUp',
  none: 'Nothing outstanding',
}

const PROFILE_FIELDS = ['legal_name', 'trading_name', 'registration_number', 'tax_id', 'physical_address', 'responsible_person', 'operating_country'] as const
type ProfileField = typeof PROFILE_FIELDS[number]
const FIELD_LABELS: Record<ProfileField, string> = {
  legal_name: 'Legal name',
  trading_name: 'Trading name',
  registration_number: 'Company registration number',
  tax_id: 'Tax number',
  physical_address: 'Physical address',
  responsible_person: 'Responsible person',
  operating_country: 'Operating country',
}

interface OverviewDoc { id: string; doc_type: string; status: string; has_file: boolean }
interface Overview {
  registration: { organization_name: string | null; onboarding_status: string | null }
  profile: Record<string, string | null> | null
  requirements: Array<{ id: string; requirement_key: string; status: string; is_blocking: boolean }>
  documents: OverviewDoc[]
  branches: Array<{ id: string; name: string | null; address: string | null }>
  compliance: Record<string, unknown> | null
  responsible_person_identity: { status: string | null; status_label: string | null; capability_bearing: boolean; applicant_guidance: string | null; who_must_act: string }
  who_must_act: string
  action_summary: { missing: Array<{ code: string; label: string }>; awaiting_review: Array<{ code: string; label: string }> } | null
  workspace_access: { available: boolean; note: string }
  document_extraction: { available: boolean; reason: string }
  document_types: string[]
}

interface MappingRow { source: string; proposed_target: string | null; confidence: number | null; provider: string; model?: string; reason?: string }
interface InspectResult {
  checksum: string; template_type: string; sheet_name: string; row_count: number
  proposals: MappingRow[]; canonical_columns: string[]; ai: { state: string; code?: string; model?: string }
}

const DIMENSIONS = ['identity_status', 'business_evidence_status', 'compliance_review_state', 'active_state', 'restriction_state', 'suspension_state', 'investigation_state', 'expiry_state'] as const

function readFileAsDataUri(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('Could not read the selected file.'))
    reader.onload = () => resolve(String(reader.result))
    reader.readAsDataURL(file)
  })
}

const emptyForm = (): Record<ProfileField, string> => Object.fromEntries(PROFILE_FIELDS.map((f) => [f, ''])) as Record<ProfileField, string>

export default function DealerOnboarding() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const {
    fetchDealerOnboardingOverview,
    saveDealerOnboardingProfile,
    uploadDealerEvidence,
    addDealerOnboardingBranch,
    inspectDealerWorkbook,
    confirmDealerWorkbookMapping,
    runDealerWorkbookDryRun,
  } = useCarUpApi()

  const [overview, setOverview] = useState<Overview | null>(null)
  const [accessDenied, setAccessDenied] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState<Record<ProfileField, string>>(emptyForm)
  const [docType, setDocType] = useState('company_registration')
  const [uploading, setUploading] = useState(false)
  const [branchName, setBranchName] = useState('')
  const [branchAddress, setBranchAddress] = useState('')
  // Workbook lane
  const [workbookFile, setWorkbookFile] = useState<{ name: string; dataUri: string } | null>(null)
  const [inspecting, setInspecting] = useState(false)
  const [inspection, setInspection] = useState<InspectResult | null>(null)
  const [mappingTargets, setMappingTargets] = useState<Record<string, string>>({})
  const [mappingConfirmed, setMappingConfirmed] = useState(false)
  const [dryRun, setDryRun] = useState<Record<string, unknown> | null>(null)
  const [runningDryRun, setRunningDryRun] = useState(false)

  const load = useCallback(async () => {
    try {
      const data = await fetchDealerOnboardingOverview() as unknown as Overview
      setOverview(data)
      if (data.profile) {
        setForm(Object.fromEntries(PROFILE_FIELDS.map((f) => [f, data.profile![f] || ''])) as Record<ProfileField, string>)
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

  const saveProfile = async () => {
    setSaving(true)
    try {
      const profile = Object.fromEntries(PROFILE_FIELDS.map((f) => [f, form[f].trim() || null]))
      await saveDealerOnboardingProfile({ profile })
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

  const addBranch = async () => {
    try {
      await addDealerOnboardingBranch({ name: branchName, address: branchAddress })
      setBranchName(''); setBranchAddress('')
      await load()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not add the branch.')
    }
  }

  const pickWorkbook = async (file: File | undefined) => {
    if (!file) return
    const dataUri = await readFileAsDataUri(file)
    setWorkbookFile({ name: file.name, dataUri })
    setInspection(null); setDryRun(null); setMappingConfirmed(false)
  }

  const inspectWorkbook = async () => {
    if (!workbookFile) return
    setInspecting(true)
    try {
      const result = await inspectDealerWorkbook({ fileBase64: workbookFile.dataUri, filename: workbookFile.name }) as unknown as InspectResult
      setInspection(result)
      setMappingTargets(Object.fromEntries(result.proposals.map((p) => [p.source, p.proposed_target || 'ignore'])))
      setMappingConfirmed(false)
      setDryRun(null)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not inspect the workbook.')
    } finally {
      setInspecting(false)
    }
  }

  const confirmMapping = async () => {
    if (!inspection) return
    try {
      await confirmDealerWorkbookMapping({
        template_type: inspection.template_type,
        sheet_name: inspection.sheet_name,
        workbook_checksum: inspection.checksum,
        mappings: inspection.proposals.map((row) => ({ source: row.source, target: mappingTargets[row.source] || 'ignore' })),
      })
      setMappingConfirmed(true)
      toast.success('Mapping confirmed for this exact file.')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Mapping confirmation failed.')
    }
  }

  const runWorkbookDryRun = async () => {
    if (!workbookFile || !inspection) return
    setRunningDryRun(true)
    try {
      const result = await runDealerWorkbookDryRun({
        fileBase64: workbookFile.dataUri,
        filename: workbookFile.name,
        templateType: inspection.template_type,
        sheetName: inspection.sheet_name,
      }) as unknown as { data: Record<string, unknown> }
      setDryRun(result.data)
      toast.success('Dry run complete — review before any import is confirmed.')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Dry run failed.')
    } finally {
      setRunningDryRun(false)
    }
  }

  const sourceLabel = (row: MappingRow) => (row.provider === 'ai'
    ? `AI suggestion${row.model ? ` (${row.model})` : ''}${row.confidence !== null ? ` · ${Math.round(row.confidence * 100)}%` : ''}`
    : row.provider === 'deterministic' ? 'Matched by name' : 'Not mapped')

  if (loading) return <div className="min-h-[45vh] bg-background px-4 py-6 text-base text-muted-foreground" data-testid="dealer-onboarding-loading">Loading your dealer application…</div>
  if (accessDenied) {
    return (
      <div className="mx-auto max-w-xl space-y-3 bg-background px-4 py-8 text-foreground" data-testid="dealer-onboarding-denied">
        <h1 className="text-xl font-semibold">Dealer onboarding</h1>
        <p className="text-sm text-muted-foreground">Dealer onboarding opens once your registration records a dealer business.</p>
        <Button onClick={() => navigate('/onboarding')}>Go to registration</Button>
      </div>
    )
  }
  if (!overview) return <div className="min-h-[45vh] bg-background px-4 py-6 text-base text-muted-foreground" data-testid="dealer-onboarding-unavailable">Your dealer application is unavailable right now.</div>

  const compliance = overview.compliance as Record<string, string | boolean | string[]> | null
  const identity = overview.responsible_person_identity

  return (
    <div className="min-h-screen overflow-x-clip bg-background"><div className="mx-auto w-full max-w-4xl space-y-4 px-4 py-5 pb-24 text-foreground sm:space-y-6 sm:px-6 sm:py-8 lg:px-8">
      <header className="space-y-2">
        <h1 className="text-xl font-semibold leading-tight tracking-tight sm:text-2xl">Dealer onboarding — {overview.registration.organization_name || 'your business'}</h1>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline" className="border-input text-foreground" data-testid="dealer-who-must-act">{ACTOR_LABELS[overview.who_must_act] || overview.who_must_act}</Badge>
          <Badge variant="outline" className="border-input text-foreground" data-testid="workspace-dependency"><Lock className="mr-1 h-3 w-3" aria-hidden />Applicant — not an active Dealer</Badge>
        </div>
        <p className="text-xs text-muted-foreground">{overview.workspace_access.note}</p>
      </header>

      {/* Business identity + responsible person */}
      <Card className="bg-card border-border">
        <CardContent className="space-y-3 p-4 sm:p-5">
          <h2 className="font-medium">Business identity</h2>
          <p className="text-xs text-muted-foreground" data-testid="extraction-unavailable">{overview.document_extraction.reason}</p>
          <div className="grid gap-3 sm:grid-cols-2" data-testid="dealer-profile-form">
            {PROFILE_FIELDS.map((field) => (
              <label key={field} className="space-y-1 text-sm">
                <span className="text-muted-foreground">{FIELD_LABELS[field]}</span>
                <input className={fieldClass} value={form[field]} data-testid={`dealer-field-${field}`}
                  onChange={(e) => setForm({ ...form, [field]: e.target.value })} />
              </label>
            ))}
          </div>
          <Button className="min-h-11 w-full sm:w-auto" onClick={saveProfile} disabled={saving} data-testid="save-dealer-profile">
            {saving ? 'Saving…' : overview.profile ? 'Save changes' : 'Create dealer application'}
          </Button>
          <div className="border-t border-border pt-3 text-sm" data-testid="responsible-person-identity">
            <span className="text-muted-foreground">Responsible person identity: </span>
            <span className={identity.capability_bearing ? 'text-green-600' : 'text-amber-600'}>
              {identity.status_label || (identity.capability_bearing ? 'verified' : 'not yet verified')}
            </span>
            {!identity.capability_bearing && (
              <span className="text-muted-foreground"> — {identity.applicant_guidance || 'complete identity verification in your registration.'}</span>
            )}
          </div>
        </CardContent>
      </Card>

      {overview.profile && (
        <>
          {/* Requirements — and the one batched summary of what is still needed */}
          <Card className="bg-card border-border">
            <CardContent className="space-y-2 p-4 sm:p-5">
              <h2 className="font-medium">Compliance requirements</h2>
              {overview.action_summary && overview.action_summary.missing.length > 0 && (
                <p className="text-sm" data-testid="still-needed">CarUp still needs: {overview.action_summary.missing.map((m) => m.label).join(' · ')}</p>
              )}
              {overview.requirements.length === 0 && <p className="text-sm text-muted-foreground" data-testid="no-requirements">No requirements recorded yet — CarUp review will populate your checklist.</p>}
              <ul className="space-y-1 text-sm" data-testid="requirements-list">
                {overview.requirements.map((req) => (
                  <li key={req.id} className="flex items-center justify-between gap-2">
                    <span>{req.requirement_key.replace(/_/g, ' ')}{req.is_blocking ? ' (blocking)' : ''}</span>
                    <Badge variant="outline" className="border-input text-foreground">{req.status}</Badge>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>

          {/* Documents — private evidence */}
          <Card className="bg-card border-border">
            <CardContent className="space-y-3 p-4 sm:p-5">
              <h2 className="font-medium">Company documents (private)</h2>
              <div className="flex flex-wrap items-end gap-3">
                <label className="space-y-1 text-sm">
                  <span className="text-muted-foreground">Document type</span>
                  <select className={fieldClass} value={docType} onChange={(e) => setDocType(e.target.value)} data-testid="doc-type">
                    {overview.document_types.map((t) => <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>)}
                  </select>
                </label>
                <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border border-dashed border-input px-3 py-2 text-sm focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2" data-testid="upload-evidence">
                  <Upload className="h-4 w-4" aria-hidden />{uploading ? 'Uploading…' : 'Upload document'}
                  <input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" className="sr-only"
                    onChange={(e) => uploadEvidence(e.target.files?.[0])} />
                </label>
              </div>
              <ul className="space-y-2 text-sm" data-testid="documents-list">
                {overview.documents.map((doc) => (
                  <li key={doc.id} className="flex items-center justify-between rounded-lg border border-border p-2">
                    <span>{doc.doc_type.replace(/_/g, ' ')}</span>
                    <Badge variant="outline" className="border-input text-foreground">{doc.status}</Badge>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>

          {/* Branches */}
          <Card className="bg-card border-border">
            <CardContent className="space-y-3 p-4 sm:p-5">
              <h2 className="font-medium">Branches</h2>
              <ul className="text-sm text-muted-foreground" data-testid="branches-list">
                {overview.branches.map((b) => <li key={b.id}>{b.name || 'Unnamed'} — {b.address || 'no address'}</li>)}
              </ul>
              <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
                <input className={fieldClass} placeholder="Branch name" value={branchName} onChange={(e) => setBranchName(e.target.value)} data-testid="branch-name" />
                <input className={fieldClass} placeholder="Address" value={branchAddress} onChange={(e) => setBranchAddress(e.target.value)} data-testid="branch-address" />
                <Button size="sm" variant="outline" data-testid="add-branch" onClick={addBranch}>Add branch</Button>
              </div>
            </CardContent>
          </Card>

          {/* Workbook migration — a mapping front-end to the existing import engine */}
          <Card className="bg-card border-border">
            <CardContent className="space-y-3 p-4 sm:p-5" data-testid="workbook-lane">
              <h2 className="flex items-center gap-2 font-medium"><FileSpreadsheet className="h-4 w-4" aria-hidden />Migrate existing records (workbook)</h2>
              <p className="text-xs text-muted-foreground">
                CarUp suggests how your columns map; you decide. Nothing is imported here — the import engine runs a dry run you review first.
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border border-dashed border-input px-3 py-2 text-sm focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2">
                  <Upload className="h-4 w-4" aria-hidden />{workbookFile ? workbookFile.name : 'Choose .xlsx file'}
                  <input type="file" accept=".xlsx" className="sr-only" onChange={(e) => pickWorkbook(e.target.files?.[0])} data-testid="workbook-file" />
                </label>
                <Button size="sm" onClick={inspectWorkbook} disabled={!workbookFile || inspecting} data-testid="inspect-workbook">
                  {inspecting ? 'Inspecting…' : 'Inspect & suggest mapping'}
                </Button>
              </div>

              {inspection && (
                <div className="space-y-2" data-testid="mapping-table">
                  <p className="text-xs text-muted-foreground">
                    {inspection.row_count} rows · review every column. Suggestions are advisory — changing the file means confirming again.
                  </p>
                  {inspection.ai.state === 'unavailable' && (
                    <p className="text-xs text-amber-700" data-testid="ai-unavailable">AI suggestions are unavailable right now — map the remaining columns yourself.</p>
                  )}
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead><tr className="text-left text-muted-foreground"><th className="p-1">Workbook column</th><th className="p-1">CarUp field</th><th className="p-1">Suggested by</th></tr></thead>
                      <tbody>
                        {inspection.proposals.map((row) => (
                          <tr key={row.source} className="border-t border-border">
                            <td className="p-1">{row.source}</td>
                            <td className="p-1">
                              <select className={fieldClass} value={mappingTargets[row.source] || 'ignore'} data-testid={`target-${row.source}`}
                                onChange={(e) => { setMappingTargets({ ...mappingTargets, [row.source]: e.target.value }); setMappingConfirmed(false) }}>
                                <option value="ignore">— ignore —</option>
                                {inspection.canonical_columns.map((c) => <option key={c} value={c}>{c}</option>)}
                              </select>
                            </td>
                            <td className="p-1 text-muted-foreground" data-testid={`source-${row.source}`}>{sourceLabel(row)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="flex flex-wrap gap-2">
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
                <div className="rounded-lg border border-border p-2 text-xs" data-testid="dry-run-result">
                  <p className="text-muted-foreground">Dry run recorded by the import engine — review it; confirmation and execution follow the engine's own governed steps. Nothing has been imported yet.</p>
                  <pre className="mt-1 max-h-56 overflow-auto whitespace-pre-wrap text-muted-foreground">{JSON.stringify(dryRun, null, 2).slice(0, 4000)}</pre>
                </div>
              )}
            </CardContent>
          </Card>

          {/* The eight dimensions, verbatim */}
          {compliance && (
            <Card className="bg-card border-border">
              <CardContent className="space-y-2 p-4 sm:p-5">
                <h2 className="font-medium">Dealer review state</h2>
                <dl className="grid grid-cols-2 gap-1 text-sm" data-testid="compliance-dimensions">
                  {DIMENSIONS.map((dim) => (
                    <React.Fragment key={dim}>
                      <dt className="text-muted-foreground">{dim.replace(/_/g, ' ')}</dt>
                      <dd>{String(compliance[dim] ?? '—')}</dd>
                    </React.Fragment>
                  ))}
                </dl>
                <p className="text-xs text-muted-foreground">
                  can publish: <span data-testid="can-publish">{String(compliance.can_publish)}</span> — decided only by Dealer Compliance review, never by this application form.
                </p>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div></div>
  )
}
