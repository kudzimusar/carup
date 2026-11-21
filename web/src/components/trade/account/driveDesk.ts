/**
 * RX-06 Account — pure helpers for the Drive connections desk (/diaspora/drive). No React.
 *
 * Everything shown is what GET /diaspora/drive/status, /files and /sync-attempts return. Token material
 * is never part of those answers and is never rendered. "Switched off" (enabled: false) and "not
 * activated" (no OAuth credentials) are different statements from "not connected", and each says so.
 */
import type { DiasporaDriveAuthUrl, DiasporaDriveFile, DiasporaDriveStatus, DiasporaDriveSyncAttempt } from '@/types'
import type { StatusTone } from '@/components/dealer/workspace/statusTone'
import { humanizeCode, type ReadPhase } from '@/components/trade/sourcing/deskKit'

export type DriveMode = 'off' | 'not-activated' | 'ready' | 'connected' | 'revoked'

/** The connection's situation, in the order the legacy page decided it. */
export function driveMode(status: DiasporaDriveStatus): DriveMode {
  if (!status.enabled) return 'off'
  if (status.connection?.connected) return 'connected'
  if (status.connection?.accessStatus === 'REVOKED') return 'revoked'
  if (status.activation?.pending) return 'not-activated'
  return 'ready'
}

/** Connect is offered exactly when the legacy page offered it: enabled, not connected, activated. */
export function canConnect(status: DiasporaDriveStatus): boolean {
  return Boolean(status.enabled) && !status.connection?.connected && !status.activation?.pending
}

export const DRIVE_MODE: Record<DriveMode, { label: string; tone: StatusTone }> = {
  off: { label: 'Switched off here', tone: 'neutral' },
  'not-activated': { label: 'Not activated', tone: 'warning' },
  ready: { label: 'Not connected', tone: 'neutral' },
  connected: { label: 'Connected', tone: 'info' },
  revoked: { label: 'Access revoked · reconnect needed', tone: 'danger' },
}

const SCOPE_MEANING: Record<string, string> = {
  'https://www.googleapis.com/auth/drive.file': 'Only the files CarUp creates, or that you open with CarUp — not the rest of your Drive.',
  'https://www.googleapis.com/auth/drive.readonly': 'Read-only access to your Drive.',
  'https://www.googleapis.com/auth/drive': 'Full access to your Drive.',
}

/** What a requested OAuth scope lets CarUp do, in words; null for a scope CarUp does not describe. */
export function scopeMeaning(scope: string): string | null {
  return SCOPE_MEANING[scope] ?? null
}

/** "drive.file" from the full scope URL — the short name Google's consent screen uses. */
export function scopeShortName(scope: string): string {
  const m = /\/auth\/(.+)$/.exec(scope)
  return m ? m[1] : scope
}

export function syncStatusTone(status: string | null | undefined): StatusTone {
  const s = String(status || '').toUpperCase()
  if (s === 'SYNCED' || s === 'SUCCEEDED') return 'info'
  if (s === 'FAILED' || s === 'DEAD_LETTERED' || s === 'ERROR') return 'danger'
  if (s === 'PENDING' || s === 'QUEUED' || s === 'IN_FLIGHT' || s === 'RETRYING') return 'warning'
  return 'neutral'
}

export function syncStatusLabel(status: string | null | undefined): string {
  return humanizeCode(status, 'Sync status not recorded')
}

/* ── View model ────────────────────────────────────────────────────────────────────────────── */

export interface DriveRead {
  phase: ReadPhase
  /** Which call failed: the connection status or the linked-file list. */
  stage?: 'status' | 'files'
  status?: number | null
  message?: string | null
}

export interface DriveHistory { fileId: string | null; phase: ReadPhase; status?: number | null; message?: string | null }
export interface DriveNotice { tone: 'info' | 'danger'; text: string }

export interface DriveModel {
  authLoading: boolean
  signedIn: boolean
  role: string
  canView: boolean
  status: DiasporaDriveStatus | null
  read: DriveRead
  loading: boolean
  onRetry: () => void
  files: DiasporaDriveFile[]
  authUrl: DiasporaDriveAuthUrl | null
  onConnect: () => void | Promise<void>
  onSync: () => void | Promise<void>
  onDisconnect: () => void | Promise<void>
  history: DriveHistory
  attempts: DiasporaDriveSyncAttempt[]
  durableTracking: boolean
  onShowHistory: (file: DiasporaDriveFile) => void | Promise<void>
  notice: DriveNotice | null
}
