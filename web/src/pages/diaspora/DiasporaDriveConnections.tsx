import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, CheckCircle2, Cloud, Loader2, ShieldCheck, Unplug, XCircle } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useAuth } from '@/context/AuthContext'
import { useCarUpApi } from '@/hooks/useCarUpApi'
import type { DiasporaDriveStatus, DiasporaDriveFile, DiasporaDriveAuthUrl, DiasporaDriveSyncAttempt } from '@/types'
import { describeSyncAttempt } from './driveSyncHelpers'

const allowedRoles = new Set(['owner', 'dealer', 'admin', 'platform_admin', 'super_admin', 'government', 'reviewer'])

export default function DiasporaDriveConnections() {
  const { user, isAuthenticated, loading: authLoading } = useAuth()
  // Destructure the individually memoized request functions rather than holding the aggregate
  // object. useCarUpApi() returns a NEW object every render and owns loading/error state, so a page
  // that keeps `api` and derives its effect deps from it re-fires that effect on every request —
  // the unbounded loop fixed in PR #130 for the trade-profile page. These identities are stable.
  const {
    fetchDiasporaDriveStatus,
    fetchDiasporaDriveFiles,
    fetchDiasporaDriveAuthorizeUrl,
    fetchDiasporaDriveSyncAttempts,
    disconnectDiasporaDrive,
    syncDiasporaDrive,
  } = useCarUpApi()
  const role = (user?.role || '').toLowerCase()
  const canView = isAuthenticated && allowedRoles.has(role)

  const [status, setStatus] = useState<DiasporaDriveStatus | null>(null)
  const [files, setFiles] = useState<DiasporaDriveFile[]>([])
  const [authUrl, setAuthUrl] = useState<DiasporaDriveAuthUrl | null>(null)
  const [attempts, setAttempts] = useState<DiasporaDriveSyncAttempt[]>([])
  const [durableTracking, setDurableTracking] = useState(true)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  // Synchronous single-flight guard: collapses overlapping loads from effects, rapid clicks and
  // StrictMode's double-invoked effects without itself causing a render.
  const inFlight = useRef(false)

  const load = useCallback(async () => {
    if (!canView) return
    if (inFlight.current) return
    inFlight.current = true
    setLoading(true)
    setError('')
    try {
      const s = await fetchDiasporaDriveStatus()
      setStatus(s)
      if (s.connection?.connected) {
        setFiles(await fetchDiasporaDriveFiles())
      } else {
        setFiles([])
        setAttempts([])
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load Drive status')
    } finally {
      setLoading(false)
      inFlight.current = false
    }
  }, [fetchDiasporaDriveStatus, fetchDiasporaDriveFiles, canView])

  // Stable deps, so this runs once per authenticated mount.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { if (!authLoading && canView) void load() }, [authLoading, canView, load])

  const showAttempts = async (file: DiasporaDriveFile) => {
    setError('')
    if (!file.linkedEntityType || !file.linkedEntityId) return
    try {
      const result = await fetchDiasporaDriveSyncAttempts(file.linkedEntityType, file.linkedEntityId)
      setAttempts(result.attempts || [])
      setDurableTracking(result.durableTracking !== false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load sync history')
    }
  }

  const handleConnect = async () => {
    setError('')
    try {
      setAuthUrl(await fetchDiasporaDriveAuthorizeUrl())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to start Drive authorization')
    }
  }

  const handleDisconnect = async () => {
    setError('')
    try { await disconnectDiasporaDrive(); setAuthUrl(null); await load() } catch (err) { setError(err instanceof Error ? err.message : 'Disconnect failed') }
  }

  const handleSync = async () => {
    setError('')
    try { await syncDiasporaDrive(); await load() } catch (err) { setError(err instanceof Error ? err.message : 'Sync failed') }
  }

  if (authLoading) return <div className="flex min-h-[50vh] items-center justify-center text-orange-600"><Loader2 className="h-5 w-5 animate-spin" /></div>
  if (!canView) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16" data-testid="diaspora-drive-access-denied">
        <Alert className="border-amber-200 bg-amber-50">
          <ShieldCheck className="h-4 w-4 text-amber-700" />
          <AlertTitle>Access denied</AlertTitle>
          <AlertDescription>Drive connections require an authorized trade role.</AlertDescription>
        </Alert>
      </div>
    )
  }

  const connection = status?.connection
  const connected = Boolean(connection?.connected)
  const activationPending = Boolean(status?.activation?.pending)

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6 lg:px-8" data-testid="diaspora-drive-page">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Badge className="bg-orange-100 text-orange-800 hover:bg-orange-100">Diaspora Trade OS</Badge>
          <h1 className="mt-3 flex items-center gap-2 text-2xl font-semibold text-gray-950"><Cloud className="h-6 w-6 text-orange-600" /> Drive connections</h1>
          <p className="mt-1 text-sm text-gray-500">Keep portable copies of trade documents in your own Google Drive. Tokens stay server-side and are never shown.</p>
        </div>
        <Button asChild variant="outline"><Link to="/diaspora/rfq">Reverse RFQ</Link></Button>
      </div>

      {loading && <p className="mt-4 flex items-center gap-2 text-sm text-orange-700" data-testid="diaspora-drive-loading"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</p>}
      {error && <Alert className="mt-4 border-red-200 bg-red-50" data-testid="diaspora-drive-error"><AlertTriangle className="h-4 w-4 text-red-700" /><AlertDescription>{error}</AlertDescription></Alert>}

      {status && !status.enabled && (
        <Alert className="mt-4 border-slate-200 bg-slate-50" data-testid="diaspora-drive-disabled">
          <AlertTriangle className="h-4 w-4 text-slate-700" />
          <AlertTitle>Drive integration is disabled</AlertTitle>
          <AlertDescription>This environment has not enabled Drive. Set DIASPORA_DRIVE_ENABLED and provide Google OAuth credentials to activate.</AlertDescription>
        </Alert>
      )}

      {status && status.enabled && (
        <div className="mt-6 grid min-w-0 gap-6 lg:grid-cols-2">
          <section className="min-w-0 rounded-md border border-gray-200 bg-white p-5" data-testid="diaspora-drive-status">
            <h2 className="text-lg font-semibold text-gray-950">Connection</h2>
            <div className="mt-2">
              {connected ? (
                <Badge className="bg-green-100 text-green-800 hover:bg-green-100" data-testid="diaspora-drive-connected-badge"><CheckCircle2 className="mr-1 h-3 w-3" /> Connected</Badge>
              ) : connection?.accessStatus === 'REVOKED' ? (
                <Badge className="bg-red-100 text-red-800 hover:bg-red-100" data-testid="diaspora-drive-revoked-badge">Revoked — reconnect required</Badge>
              ) : (
                <Badge variant="outline" data-testid="diaspora-drive-disconnected-badge">Not connected</Badge>
              )}
            </div>
            {connection?.providerAccountEmail && <p className="mt-2 text-sm text-gray-600">Account: {connection.providerAccountEmail}</p>}
            {connection?.lastSyncAt && <p className="text-xs text-gray-500" data-testid="diaspora-drive-last-sync">Last sync: {connection.lastSyncAt}</p>}

            <div className="mt-3 rounded-md border border-gray-200 p-3">
              <p className="text-xs font-medium uppercase text-gray-500">Requested scopes</p>
              {/* Scope URLs have no spaces, so without break-all a single one is wider than a
                  390px viewport and drags the whole section past the page edge. */}
              <ul className="mt-1 list-disc break-all pl-5 text-xs text-gray-600" data-testid="diaspora-drive-scopes">
                {(status.scopes || []).map((s) => <li key={s}>{s}</li>)}
              </ul>
            </div>

            {/* Truthful activation state. Without owner-provisioned OAuth credentials a Connect
                button can only fail with NOT_CONFIGURED, so say that instead of offering it. */}
            {activationPending && (
              <Alert className="mt-4 border-amber-200 bg-amber-50" data-testid="diaspora-drive-activation-pending">
                <AlertTriangle className="h-4 w-4 text-amber-700" />
                <AlertTitle>Drive is not yet activated</AlertTitle>
                <AlertDescription>
                  This deployment has no Google OAuth credentials configured, so a connection cannot be
                  completed yet. An administrator must provision them before Drive can be connected.
                </AlertDescription>
              </Alert>
            )}

            <div className="mt-4 flex flex-wrap gap-2">
              {!connected && !activationPending && (
                <Button onClick={handleConnect} data-testid="diaspora-drive-connect">Connect Google Drive</Button>
              )}
              {connected && (
                <>
                  <Button variant="outline" onClick={handleSync} data-testid="diaspora-drive-sync">Sync</Button>
                  <Button variant="outline" onClick={handleDisconnect} data-testid="diaspora-drive-disconnect"><Unplug className="mr-1 h-4 w-4" /> Disconnect</Button>
                </>
              )}
            </div>
            {authUrl && (
              <p className="mt-3 break-all text-xs text-gray-600">
                Continue authorization at <a className="text-orange-700 underline" href={authUrl.url} data-testid="diaspora-drive-authorize-url" rel="noreferrer">Google consent screen</a> (scopes: {authUrl.scopes.join(', ')}).
              </p>
            )}

            <p className="mt-4 text-xs text-gray-500" data-testid="diaspora-drive-xlsx-note">
              {status.workbookExport?.note || 'Binary XLSX export is not yet available; JSON/report export only.'}
            </p>
          </section>

          <section className="min-w-0 rounded-md border border-gray-200 bg-white p-5">
            <h2 className="text-lg font-semibold text-gray-950">Linked files</h2>
            {/* Wide content scrolls inside its own container; the page body must never scroll
                horizontally (the linked-entity column overflows a 390px viewport otherwise). */}
            <div className="mt-3 overflow-x-auto rounded-md border border-gray-200" data-testid="diaspora-drive-files">
              <Table>
                <TableHeader><TableRow><TableHead>File</TableHead><TableHead>Linked to</TableHead><TableHead>Sync</TableHead></TableRow></TableHeader>
                <TableBody>
                  {files.length === 0 ? (
                    <TableRow><TableCell colSpan={3} className="h-12 text-center text-gray-500" data-testid="diaspora-drive-files-empty">No linked files yet.</TableCell></TableRow>
                  ) : files.map((f) => (
                    <TableRow key={f.id} data-testid="diaspora-drive-file-row">
                      <TableCell className="font-medium">{f.fileName}</TableCell>
                      <TableCell className="text-xs text-gray-600">{f.linkedEntityType} {f.linkedEntityId}</TableCell>
                      <TableCell>
                        <button
                          type="button"
                          className="underline decoration-dotted underline-offset-2"
                          onClick={() => void showAttempts(f)}
                          data-testid="diaspora-drive-file-history"
                        >
                          <Badge variant="outline">{f.syncStatus}</Badge>
                        </button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            {/* Durable sync history. Every attempt is recorded server-side, so a file that never
                reached Drive is visible rather than merely absent from the list above. */}
            {attempts.length > 0 && (
              <div className="mt-4" data-testid="diaspora-drive-sync-attempts">
                <h3 className="text-sm font-semibold text-gray-900">Sync history</h3>
                {!durableTracking && (
                  <p className="mt-1 text-xs text-amber-700" data-testid="diaspora-drive-tracking-unavailable">
                    Durable tracking is unavailable, so this history may be incomplete.
                  </p>
                )}
                <ul className="mt-2 space-y-2">
                  {attempts.map((a) => {
                    const d = describeSyncAttempt(a)
                    return (
                      <li
                        key={a.id}
                        className={`min-w-0 break-words rounded-md border p-3 text-xs ${d.tone === 'failed' ? 'border-red-200 bg-red-50' : d.tone === 'ok' ? 'border-green-200 bg-green-50' : 'border-gray-200 bg-gray-50'}`}
                        data-testid={`diaspora-drive-attempt-${a.state}`}
                      >
                        <span className="flex min-w-0 flex-wrap items-center gap-2 font-medium">
                          {d.tone === 'failed'
                            ? <XCircle className="h-3.5 w-3.5 text-red-700" aria-hidden="true" />
                            : d.tone === 'ok'
                              ? <CheckCircle2 className="h-3.5 w-3.5 text-green-700" aria-hidden="true" />
                              : <Loader2 className="h-3.5 w-3.5 text-gray-600" aria-hidden="true" />}
                          {a.operation} — {d.label}
                        </span>
                        <span className="mt-1 block text-gray-600">{d.detail}</span>
                        {d.needsAction && (
                          <span className="mt-1 block font-medium text-red-800" data-testid="diaspora-drive-attempt-needs-action">
                            This file is not in your Drive. Re-upload it to try again.
                          </span>
                        )}
                      </li>
                    )
                  })}
                </ul>
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  )
}
