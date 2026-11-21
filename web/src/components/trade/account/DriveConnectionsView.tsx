/**
 * RX-06 Account — the unified Drive connections desk (/diaspora/drive).
 *
 * Presentation only. The connection status, the linked files, a file's durable sync history, and
 * connect / sync / disconnect are the page container's own reads and handlers (DiasporaDriveConnections).
 * Truth rules: "switched off here", "not activated" and "not connected" are different statements; Connect
 * is offered only when a connection could actually complete; a dead-lettered file is "not in your Drive",
 * never "syncing"; tokens are never shown.
 */
import { useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { CheckCircle2, Cloud, ExternalLink, FileText, History, Loader2, Unplug, XCircle } from 'lucide-react'
import { cn } from '@/lib/utils'
import { StatusChip } from '@/components/dealer/workspace/StatusChip'
import { WS_DANGER, WS_PRIMARY, WS_SECONDARY } from '@/components/dealer/workspace/workspaceStyles'
import { describeSyncAttempt } from '@/pages/diaspora/driveSyncHelpers'
import { buildLoginRedirect } from '@/lib/returnTo'
import type { DiasporaDriveFile, DiasporaDriveStatus } from '@/types'
import { DeskHeader, DeskPanel, DeskState, Fact, InlineConfirm, NextMove, RefCode, SourceChip } from '@/components/trade/sourcing/TradeDesk'
import { failureKind, formatDateTime, humanizeCode, plural, roleWords } from '@/components/trade/sourcing/deskKit'
import {
  DRIVE_MODE, canConnect, driveMode, scopeMeaning, scopeShortName, syncStatusLabel, syncStatusTone, type DriveModel,
} from './driveDesk'

export function DriveConnectionsView({ model }: { model: DriveModel }) {
  const header = (
    <DeskHeader
      eyebrow="Trade · Account"
      title="Drive connections"
      description="Keep portable copies of your trade documents in your own Google Drive. Access tokens stay on CarUp’s server and are never shown here."
      meta={model.status ? <StatusChip tone={DRIVE_MODE[driveMode(model.status)].tone} testId="trade-drive-mode">{DRIVE_MODE[driveMode(model.status)].label}</StatusChip> : undefined}
    />
  )
  const frame = (body: ReactNode) => (
    <div className="min-w-0 space-y-5 sm:space-y-6" data-testid="trade-drive" data-presentation="trade-desk">{header}{body}</div>
  )

  if (model.authLoading) return frame(<DeskState kind="loading" title="Checking your access…" testId="trade-drive-auth-loading" />)
  if (!model.signedIn) {
    return frame(
      <DeskState kind="signin" title="Sign in to manage Drive connections" action={<Link to={buildLoginRedirect('/diaspora/drive')} className={WS_PRIMARY}>Sign in</Link>} testId="trade-drive-signin">
        A Drive connection belongs to one signed-in trader. Nothing was loaded.
      </DeskState>,
    )
  }
  if (!model.canView) {
    return frame(
      <DeskState kind="denied" title="Drive connections need a trading role" testId="trade-drive-denied">
        Your account ({roleWords(model.role)}) cannot connect a Drive. Nothing was loaded. The server checks the role again on every request.
      </DeskState>,
    )
  }
  if (!model.status) {
    if (model.read.phase === 'failed') return frame(<StatusFailure model={model} />)
    return frame(<DeskState kind="loading" title="Reading your Drive connection…" testId="trade-drive-loading" />)
  }

  const status = model.status
  const mode = driveMode(status)
  return frame(
    <>
      {model.notice && <p role={model.notice.tone === 'info' ? 'status' : 'alert'} className={cn('rounded-control border px-3 py-2.5 text-sm text-carup-text', model.notice.tone === 'info' ? 'border-status-info bg-status-info-soft' : 'border-status-danger bg-status-danger-soft')} data-testid="trade-drive-notice">{model.notice.text}</p>}

      {mode === 'off' && (
        <DeskState kind="unavailable" title="Google Drive is switched off in this environment" testId="trade-drive-off">
          This server has not enabled the Drive integration, so no Drive can be connected and no document is copied anywhere — your documents stay in CarUp.
          Switching it on needs an administrator to enable Drive and provide Google OAuth credentials; nothing on this page can do that.
        </DeskState>
      )}
      {mode === 'not-activated' && (
        <DeskState kind="unavailable" title="Drive is switched on, but not activated" testId="trade-drive-not-activated">
          This deployment has no Google OAuth credentials, so a connection cannot be completed — a Connect button could only fail. An administrator must provide them first.
        </DeskState>
      )}
      {(mode === 'off' || mode === 'not-activated') && <HowDriveWorks />}
      {(mode === 'ready' || mode === 'connected' || mode === 'revoked') && <ConnectionPanel model={model} status={status} />}

      {model.read.phase === 'failed' && model.read.stage === 'files' && (
        <DeskState kind="failed" title="Your linked files could not be loaded" onRetry={model.onRetry} testId="trade-drive-files-failed">This is not a report that no files are linked.</DeskState>
      )}
      {mode === 'connected' && !(model.read.phase === 'failed' && model.read.stage === 'files') && <FilesPanel model={model} />}

      <ServerFacts status={status} />
    </>,
  )
}

function StatusFailure({ model }: { model: DriveModel }) {
  const kind = failureKind(model.read)
  if (kind === 'limited') return <DeskState kind="limited" title="Too many requests right now" onRetry={model.onRetry} retryLabel="Retry now" testId="trade-drive-failed">Your Drive connection could not be read because of the shared request limit. Nothing is retried automatically — wait about a minute, then retry.</DeskState>
  if (kind === 'denied') return <DeskState kind="denied" title="The server refused Drive to this account" testId="trade-drive-failed">This is a permission answer (403), not a missing connection.</DeskState>
  if (kind === 'missing') return <DeskState kind="unavailable" title="Drive is not available on this server" testId="trade-drive-failed">The server answered “not found” (404). The integration may not be installed here.</DeskState>
  if (kind === 'session') return <DeskState kind="signin" title="Your session ended" action={<Link to="/login" className={WS_PRIMARY}>Sign in again</Link>} testId="trade-drive-failed">Sign in again to see your Drive connection.</DeskState>
  return <DeskState kind="failed" title="Your Drive connection could not be loaded" onRetry={model.onRetry} testId="trade-drive-failed">This is not a report that you have no connection.</DeskState>
}

function ConnectionPanel({ model, status }: { model: DriveModel; status: DiasporaDriveStatus }) {
  const [busy, setBusy] = useState<null | 'connect' | 'sync' | 'disconnect'>(null)
  const [confirm, setConfirm] = useState(false)
  const mode = driveMode(status)
  const connection = status.connection
  const credential = status.credential
  async function run(kind: NonNullable<typeof busy>, fn: () => void | Promise<void>) {
    if (busy) return
    setBusy(kind)
    try { await fn() } finally { setBusy(null); setConfirm(false) }
  }
  const connectable = canConnect(status)

  return (
    <>
      <NextMove
        testId="trade-drive-next"
        title={mode === 'connected' ? 'Your Drive is connected' : mode === 'revoked' ? 'Google access was revoked — reconnect to keep copies' : 'Connect your Google Drive'}
        usuallyWith={mode === 'connected' ? 'Nobody — nothing is waiting' : 'You'}
        after={mode === 'connected'
          ? 'Sync refreshes the connection and records the time; it does not upload files by itself. Disconnect whenever you want.'
          : 'You continue on Google’s consent screen; CarUp never sees your Google password. CarUp then keeps copies only in the folder it creates.'}
        action={connectable ? (
          <button type="button" className={WS_PRIMARY} disabled={busy !== null} onClick={() => void run('connect', model.onConnect)} data-testid="trade-drive-connect">
            {busy === 'connect' ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <Cloud className="h-4 w-4" aria-hidden="true" />}
            {mode === 'revoked' ? 'Reconnect Google Drive' : 'Connect Google Drive'}
          </button>
        ) : undefined}
      />

      {model.authUrl && (
        <DeskPanel title="Continue on Google" testId="trade-drive-authorize">
          <p className="text-sm leading-6 text-carup-text-2">Authorisation has started. Open Google’s consent screen to finish; you will be asked to allow {plural(model.authUrl.scopes.length, 'permission')}:</p>
          <ul className="mt-2 space-y-1 text-sm">
            {model.authUrl.scopes.map((s) => <li key={s} className="text-carup-text"><span className="font-mono text-xs">{scopeShortName(s)}</span>{scopeMeaning(s) && <span className="text-carup-text-2"> — {scopeMeaning(s)}</span>}</li>)}
          </ul>
          <a href={model.authUrl.url} rel="noreferrer" className={cn(WS_PRIMARY, 'mt-3')} data-testid="trade-drive-authorize-url">Open Google’s consent screen<ExternalLink className="h-4 w-4" aria-hidden="true" /></a>
        </DeskPanel>
      )}

      {connection && (
        <DeskPanel title="Connection" testId="trade-drive-connection">
          <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-3">
            <Fact label="Google account" value={connection.providerAccountEmail || null} />
            <Fact label="Access" value={humanizeCode(connection.accessStatus, 'Not recorded')} />
            <Fact label="Last sync" value={formatDateTime(connection.lastSyncAt ?? null)} testId="trade-drive-last-sync" />
            {connection.revokedAt && <Fact label="Revoked" value={formatDateTime(connection.revokedAt)} />}
            {connection.rootFolderUrl && (
              <Fact label="CarUp folder in your Drive" value={<a href={connection.rootFolderUrl} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center gap-1 font-semibold text-carup-action underline-offset-4 hover:underline">Open folder<ExternalLink className="h-3.5 w-3.5" aria-hidden="true" /></a>} />
            )}
          </dl>
          {credential && (
            <div className="mt-4 rounded-control border border-carup-line bg-carup-bg-surface p-3" data-testid="trade-drive-credential">
              <p className="text-xs font-semibold text-carup-text">Stored credential <SourceChip className="ml-1">Held server-side · never shown</SourceChip></p>
              <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
                <Fact label="Status" value={humanizeCode(credential.status)} />
                <Fact label="Last refreshed" value={formatDateTime(credential.lastRefreshedAt)} />
                <Fact label="Expires" value={formatDateTime(credential.expiresAt)} />
                <Fact label="Last error" value={credential.lastErrorCode ? humanizeCode(credential.lastErrorCode) : null} />
              </dl>
            </div>
          )}
          {mode === 'connected' && (
            <div className="mt-4 border-t border-carup-line pt-4">
              {confirm ? (
                <InlineConfirm
                  tone="danger"
                  title="Disconnect Google Drive?"
                  testId="trade-drive-disconnect-confirm"
                  confirm={<button type="button" className={WS_DANGER} disabled={busy !== null} onClick={() => void run('disconnect', model.onDisconnect)} data-testid="trade-drive-disconnect-confirm-yes">{busy === 'disconnect' && <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />}<Unplug className="h-4 w-4" aria-hidden="true" />Disconnect</button>}
                  cancel={<button type="button" className={WS_SECONDARY} disabled={busy !== null} onClick={() => setConfirm(false)}>Stay connected</button>}
                >
                  CarUp drops its stored credential and asks Google to revoke access. Files already in your Drive stay there.
                </InlineConfirm>
              ) : (
                <div className="flex flex-wrap gap-2 [&>*]:flex-1 sm:[&>*]:flex-none">
                  <button type="button" className={WS_SECONDARY} disabled={busy !== null} onClick={() => void run('sync', model.onSync)} data-testid="trade-drive-sync">
                    {busy === 'sync' && <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />}Sync now
                  </button>
                  <button type="button" className={WS_DANGER} disabled={busy !== null} onClick={() => setConfirm(true)} data-testid="trade-drive-disconnect"><Unplug className="h-4 w-4" aria-hidden="true" />Disconnect…</button>
                </div>
              )}
            </div>
          )}
        </DeskPanel>
      )}
    </>
  )
}

function FilesPanel({ model }: { model: DriveModel }) {
  const loadingFiles = model.loading && model.files.length === 0
  return (
    <DeskPanel title="Linked files" testId="trade-drive-files">
      {loadingFiles ? (
        <DeskState compact kind="loading" title="Loading linked files…" />
      ) : model.files.length === 0 ? (
        <DeskState compact kind="empty" title="No files are linked to your Drive yet" testId="trade-drive-files-empty">A file appears here once a trade document has been copied to your Drive.</DeskState>
      ) : (
        <ul className="divide-y divide-carup-line" data-testid="trade-drive-file-list">
          {model.files.map((f) => (
            <FileRow key={f.id} file={f} model={model} />
          ))}
        </ul>
      )}
    </DeskPanel>
  )
}

function FileRow({ file, model }: { file: DiasporaDriveFile; model: DriveModel }) {
  const open = model.history.fileId === file.id
  const linked = Boolean(file.linkedEntityType && file.linkedEntityId)
  return (
    <li className="py-3 first:pt-0 last:pb-0" data-testid="trade-drive-file-row">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 font-semibold text-carup-text [overflow-wrap:anywhere]"><FileText className="h-4 w-4 shrink-0 text-carup-text-3" aria-hidden="true" />{file.fileName || 'File name not recorded'}</p>
          <p className="mt-0.5 text-xs text-carup-text-3">
            {linked ? <>Linked to {humanizeCode(file.linkedEntityType)} <RefCode value={file.linkedEntityId} label="Linked record" /></> : 'Not linked to a trade record'}
            {file.lastSyncAt ? ` · last sync ${formatDateTime(file.lastSyncAt)}` : ''}
          </p>
        </div>
        <StatusChip tone={syncStatusTone(file.syncStatus)}>{syncStatusLabel(file.syncStatus)}</StatusChip>
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        {linked && (
          <button type="button" className={WS_SECONDARY} onClick={() => void model.onShowHistory(file)} aria-expanded={open} data-testid="trade-drive-file-history">
            <History className="h-4 w-4" aria-hidden="true" />Sync history
          </button>
        )}
        {file.driveFileUrl && <a href={file.driveFileUrl} target="_blank" rel="noreferrer" className={WS_SECONDARY}>Open in Drive<ExternalLink className="h-4 w-4" aria-hidden="true" /></a>}
      </div>
      {open && <AttemptHistory model={model} />}
    </li>
  )
}

function AttemptHistory({ model }: { model: DriveModel }) {
  const h = model.history
  if (h.phase === 'loading' || h.phase === 'idle') return <div className="mt-3"><DeskState compact kind="loading" title="Loading sync history…" /></div>
  if (h.phase === 'failed') {
    return <div className="mt-3"><DeskState compact kind={failureKind(h) === 'limited' ? 'limited' : 'failed'} title={failureKind(h) === 'limited' ? 'Too many requests right now' : 'Sync history could not be loaded'} testId="trade-drive-history-failed">This is not a report that the file has no history.</DeskState></div>
  }
  return (
    <div className="mt-3 rounded-control border border-carup-line bg-carup-bg-surface p-3" data-testid="trade-drive-sync-attempts">
      {!model.durableTracking && <p className="mb-2 text-xs font-medium text-status-warning" data-testid="trade-drive-tracking-unavailable">Durable tracking is unavailable, so this history may be incomplete.</p>}
      {model.attempts.length === 0 ? (
        <p className="text-sm text-carup-text-2">No sync attempt is recorded for this file.</p>
      ) : (
        <ol className="space-y-2">
          {model.attempts.map((a) => {
            const d = describeSyncAttempt(a)
            return (
              <li key={a.id} className={cn('rounded-control border p-2.5 text-xs', d.tone === 'failed' ? 'border-status-danger bg-status-danger-soft' : 'border-carup-line bg-carup-bg-raised')} data-testid={`trade-drive-attempt-${a.state}`}>
                <p className="flex flex-wrap items-center gap-1.5 font-semibold text-carup-text">
                  {d.tone === 'failed' ? <XCircle className="h-3.5 w-3.5 text-status-danger" aria-hidden="true" /> : d.tone === 'ok' ? <CheckCircle2 className="h-3.5 w-3.5 text-status-success" aria-hidden="true" /> : <Loader2 className="h-3.5 w-3.5 text-carup-text-3" aria-hidden="true" />}
                  {humanizeCode(a.operation)} — {d.label}
                  <span className="font-normal text-carup-text-3">· {plural(a.attempts, 'attempt')}</span>
                </p>
                <p className="mt-1 text-carup-text-2">{d.detail}</p>
                {a.lastErrorCode && <p className="mt-1 text-carup-text-3">Last error: {humanizeCode(a.lastErrorCode)}</p>}
                {a.nextAttemptAt && d.tone !== 'ok' && <p className="mt-1 text-carup-text-3">Next attempt scheduled {formatDateTime(a.nextAttemptAt)}</p>}
                {d.needsAction && <p className="mt-1 font-semibold text-status-danger" data-testid="trade-drive-attempt-needs-action">This file is not in your Drive. Re-upload it to try again.</p>}
              </li>
            )
          })}
        </ol>
      )}
    </div>
  )
}

/** What a connection does once Drive is switched on — each step is something the code actually does. */
function HowDriveWorks() {
  const steps: Array<[string, string]> = [
    ['You connect on Google’s own consent screen', 'CarUp never sees your Google password.'],
    ['CarUp asks for drive.file access only', 'It can reach the files it creates, or that you open with it — not the rest of your Drive.'],
    ['Copies go to a CarUp folder in your Drive', 'Each linked file shows its sync status and a durable history, including a copy that did not arrive.'],
    ['You can disconnect at any time', 'CarUp then drops its stored credential and asks Google to revoke access; files already copied stay yours.'],
  ]
  return (
    <DeskPanel title="What Drive does once it is switched on" eyebrow="How it works" testId="trade-drive-how">
      <ol className="grid gap-3 sm:grid-cols-2">
        {steps.map(([title, body], i) => (
          <li key={title} className="flex gap-3 rounded-control border border-carup-line bg-carup-bg-surface p-3">
            <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-carup-bg-raised font-mono text-xs font-semibold text-carup-text" aria-hidden="true">{i + 1}</span>
            <span className="min-w-0">
              <span className="block text-sm font-semibold text-carup-text">{title}</span>
              <span className="mt-0.5 block text-xs leading-5 text-carup-text-2">{body}</span>
            </span>
          </li>
        ))}
      </ol>
    </DeskPanel>
  )
}

function ServerFacts({ status }: { status: DiasporaDriveStatus }) {
  const scopes = status.scopes || []
  return (
    <DeskPanel title="What the server reports" eyebrow="Integration facts" testId="trade-drive-facts">
      <dl className="grid gap-x-6 gap-y-4 md:grid-cols-2">
        <div className="min-w-0">
          <dt className="text-xs font-medium text-carup-text-3">Access a connection would request</dt>
          <dd className="mt-1 space-y-1" data-testid="trade-drive-scopes">
            {scopes.length === 0 ? <span className="text-sm text-carup-text-3">None reported</span> : scopes.map((s) => (
              <p key={s} className="text-sm text-carup-text [overflow-wrap:anywhere]">
                <span className="font-mono text-xs">{scopeShortName(s)}</span>
                {scopeMeaning(s) ? <span className="text-carup-text-2"> — {scopeMeaning(s)}</span> : <span className="block break-all font-mono text-xs text-carup-text-3">{s}</span>}
              </p>
            ))}
          </dd>
        </div>
        <Fact
          label="Google OAuth credentials"
          value={status.activation ? (status.activation.credentialsConfigured ? 'Configured' : 'Not configured') : null}
          source={status.activation ? <SourceChip>{plural(status.activation.redirectUris, 'redirect address', 'redirect addresses')} configured</SourceChip> : undefined}
          testId="trade-drive-credentials"
        />
        <Fact label="OneDrive" value={status.onedrive ? (status.onedrive.available ? 'Available' : 'Not available') : null} source={status.onedrive?.note ? <SourceChip>{status.onedrive.note}</SourceChip> : undefined} />
        <Fact label="Workbook export to Drive" value={status.workbookExport ? (status.workbookExport.xlsx ? 'XLSX available' : 'XLSX not available') : null} source={<SourceChip testId="trade-drive-xlsx-note">{status.workbookExport?.note || 'Drive sync covers JSON/report exports; binary XLSX database export is available from the Workbook Operator Console.'}</SourceChip>} />
      </dl>
    </DeskPanel>
  )
}
