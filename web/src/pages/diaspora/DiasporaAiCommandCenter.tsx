import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, Bot, CheckCircle2, Loader2, Lock, ShieldCheck } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useAuth } from '@/context/AuthContext'
import { useCarUpApi } from '@/hooks/useCarUpApi'
import type { DiasporaAiCommand, DiasporaAiParseResult } from '@/types'

const allowedRoles = new Set(['owner', 'dealer', 'admin', 'platform_admin', 'super_admin', 'government', 'reviewer'])
const reviewerRoles = new Set(['admin', 'platform_admin', 'super_admin', 'government', 'reviewer'])

function riskBadgeClass(risk?: string) {
  if (risk === 'HIGH') return 'bg-red-100 text-red-800 hover:bg-red-100'
  if (risk === 'MEDIUM') return 'bg-amber-100 text-amber-800 hover:bg-amber-100'
  return 'bg-green-100 text-green-800 hover:bg-green-100'
}

export default function DiasporaAiCommandCenter() {
  const { user, isAuthenticated, loading: authLoading } = useAuth()
  const api = useCarUpApi()
  const role = (user?.role || '').toLowerCase()
  const canView = isAuthenticated && allowedRoles.has(role)
  const isReviewer = reviewerRoles.has(role)

  const [text, setText] = useState('')
  const [parsed, setParsed] = useState<DiasporaAiParseResult | null>(null)
  const [commands, setCommands] = useState<DiasporaAiCommand[]>([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const loadCommands = useCallback(async () => {
    if (!canView) return
    try {
      setCommands(await api.fetchDiasporaAiCommands())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load commands')
    }
  }, [api, canView])

  useEffect(() => {
    if (authLoading || !canView) return
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadCommands()
  }, [authLoading, canView, loadCommands])

  const handleParse = async () => {
    setError('')
    if (!text.trim()) { setError('Enter a command'); return }
    try {
      setParsed(await api.parseDiasporaAiCommand(text.trim()))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Parse failed')
    }
  }

  const handleSubmit = async () => {
    if (busy) return
    setError('')
    if (!text.trim()) { setError('Enter a command'); return }
    setBusy(true)
    try {
      await api.createDiasporaAiCommand(text.trim())
      setText('')
      setParsed(null)
      await loadCommands()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to create command')
    } finally {
      setBusy(false)
    }
  }

  const act = async (fn: () => Promise<unknown>) => {
    setError('')
    try {
      await fn()
      await loadCommands()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action failed')
    }
  }

  const voiceAvailable = useMemo(() => false, [])

  if (authLoading) {
    return <div className="flex min-h-[50vh] items-center justify-center text-orange-600"><Loader2 className="h-5 w-5 animate-spin" /></div>
  }
  if (!canView) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16" data-testid="diaspora-ai-access-denied">
        <Alert className="border-amber-200 bg-amber-50">
          <ShieldCheck className="h-4 w-4 text-amber-700" />
          <AlertTitle>Access denied</AlertTitle>
          <AlertDescription>The AI command center requires an authorized trade role.</AlertDescription>
        </Alert>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 lg:px-8" data-testid="diaspora-ai-page">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Badge className="bg-orange-100 text-orange-800 hover:bg-orange-100">Diaspora Trade OS</Badge>
          <h1 className="mt-3 flex items-center gap-2 text-2xl font-semibold text-gray-950"><Bot className="h-6 w-6 text-orange-600" /> AI command center</h1>
          <p className="mt-1 text-sm text-gray-500">AI prepares draft actions with risk gates. It never bypasses permissions; high-risk actions stay blocked.</p>
        </div>
        <Button asChild variant="outline"><Link to="/diaspora/rfq">Reverse RFQ</Link></Button>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <section className="rounded-md border border-gray-200 bg-white p-5">
          <h2 className="text-lg font-semibold text-gray-950">New command</h2>
          <p className="mt-1 text-xs text-gray-500" data-testid="diaspora-ai-voice-status">
            Voice input: {voiceAvailable ? 'available' : 'unavailable (text only in this phase)'}
          </p>
          <Textarea value={text} onChange={(e) => setText(e.target.value)} className="mt-3 min-h-28" placeholder='e.g. "Create demand for a Toyota part" or "reserve stock stk-1 5 units"' data-testid="diaspora-ai-input" />
          <div className="mt-3 flex gap-2">
            <Button variant="outline" onClick={handleParse} data-testid="diaspora-ai-parse">Parse</Button>
            <Button onClick={handleSubmit} disabled={busy} data-testid="diaspora-ai-submit">{busy ? 'Submitting…' : 'Submit command'}</Button>
          </div>
          {error && <p className="mt-2 text-sm font-medium text-red-700" data-testid="diaspora-ai-error">{error}</p>}

          {parsed && (
            <div className="mt-4 rounded-md border border-gray-200 p-4" data-testid="diaspora-ai-parse-result">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline">{parsed.intent || 'UNKNOWN'}</Badge>
                <Badge className={riskBadgeClass(parsed.risk || undefined)} data-testid="diaspora-ai-risk">{parsed.risk || 'N/A'} risk</Badge>
                <span className="text-sm text-gray-600" data-testid="diaspora-ai-confidence">confidence {(parsed.confidence * 100).toFixed(0)}%</span>
                {parsed.ambiguous && <Badge className="bg-amber-100 text-amber-800 hover:bg-amber-100" data-testid="diaspora-ai-ambiguous">ambiguous</Badge>}
              </div>
              <ul className="mt-2 list-disc pl-5 text-xs text-gray-600">
                {(parsed.reasons || []).map((r, i) => <li key={i}>{r}</li>)}
              </ul>
              {parsed.risk === 'HIGH' && (
                <p className="mt-2 flex items-center gap-1 text-xs font-medium text-red-700" data-testid="diaspora-ai-parse-blocked"><Lock className="h-3 w-3" /> High-risk: requires reviewer approval and remains blocked from automatic execution.</p>
              )}
            </div>
          )}
        </section>

        <section className="rounded-md border border-gray-200 bg-white p-5">
          <h2 className="text-lg font-semibold text-gray-950">Command queue</h2>
          <div className="mt-3 rounded-md border border-gray-200" data-testid="diaspora-ai-list">
            <Table>
              <TableHeader><TableRow><TableHead>Intent</TableHead><TableHead>Risk</TableHead><TableHead>Status</TableHead><TableHead>Action</TableHead></TableRow></TableHeader>
              <TableBody>
                {commands.length === 0 ? (
                  <TableRow><TableCell colSpan={4} className="h-12 text-center text-gray-500" data-testid="diaspora-ai-empty">No commands yet.</TableCell></TableRow>
                ) : commands.map((cmd) => (
                  <TableRow key={cmd.id} data-testid="diaspora-ai-command-row">
                    <TableCell className="font-medium">{cmd.intent}</TableCell>
                    <TableCell><Badge className={riskBadgeClass(cmd.risk_level)}>{cmd.risk_level}</Badge></TableCell>
                    <TableCell><span data-testid="diaspora-ai-status">{cmd.execution_status}</span></TableCell>
                    <TableCell className="space-x-1">
                      {cmd.risk_level === 'HIGH' ? (
                        <div className="flex flex-col gap-1">
                          <span className="flex items-center gap-1 text-xs font-medium text-red-700" data-testid="diaspora-ai-blocked-note"><Lock className="h-3 w-3" /> Execution blocked</span>
                          {isReviewer && cmd.approval_status === 'PENDING' && (
                            <Button size="sm" variant="outline" onClick={() => act(() => api.approveDiasporaAiCommand(cmd.id))} data-testid="diaspora-ai-approve">Approve (stays blocked)</Button>
                          )}
                        </div>
                      ) : cmd.execution_status === 'AWAITING_CONFIRMATION' ? (
                        <Button size="sm" onClick={() => act(() => api.confirmDiasporaAiCommand(cmd.id))} data-testid="diaspora-ai-confirm">Confirm</Button>
                      ) : (cmd.execution_status === 'DRAFT' || cmd.execution_status === 'CONFIRMED') ? (
                        <Button size="sm" onClick={() => act(() => api.executeDiasporaAiCommand(cmd.id))} data-testid="diaspora-ai-execute">Execute</Button>
                      ) : cmd.execution_status === 'EXECUTED' ? (
                        <Badge className="bg-green-100 text-green-800 hover:bg-green-100" data-testid="diaspora-ai-executed"><CheckCircle2 className="mr-1 h-3 w-3" /> Executed</Badge>
                      ) : cmd.execution_status === 'NEEDS_REVIEW' ? (
                        <span className="flex items-center gap-1 text-xs text-amber-700" data-testid="diaspora-ai-needs-review"><AlertTriangle className="h-3 w-3" /> Needs review</span>
                      ) : null}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <p className="mt-3 text-xs text-gray-500">Live execution only creates draft records or ledger-backed reservations. AI cannot release payment, approve compliance, verify documents, complete shipments, or override the stock ledger.</p>
        </section>
      </div>
    </div>
  )
}
