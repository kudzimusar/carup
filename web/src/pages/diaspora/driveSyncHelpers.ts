import type { DiasporaDriveSyncAttempt } from '@/types'

export type SyncAttemptTone = 'ok' | 'pending' | 'failed'

export interface SyncAttemptDescription {
  label: string
  tone: SyncAttemptTone
  detail: string
  /** True when the user must do something: nothing further will happen on its own. */
  needsAction: boolean
}

/**
 * How a durable Drive sync attempt should read to a user.
 *
 * The distinction this exists to preserve: `failed` WITH a `nextAttemptAt` is still being retried
 * automatically, whereas `dead_lettered` means the file did NOT reach Drive and never will unless the
 * user acts. Rendering a dead letter as a warning-coloured "syncing" would tell someone their
 * document is safe when it is not — which is the specific outcome the Drive lane's integration
 * request asked the UI not to produce.
 *
 * A `failed` attempt with no scheduled retry is also terminal, so it needs action too.
 */
export function describeSyncAttempt(attempt: DiasporaDriveSyncAttempt): SyncAttemptDescription {
  switch (attempt.state) {
    case 'succeeded':
      return { label: 'Synced', tone: 'ok', detail: 'This file reached your Drive.', needsAction: false }
    case 'dead_lettered':
      return {
        label: 'Not synced',
        tone: 'failed',
        detail: `This file did not reach your Drive after ${attempt.attempts} attempt${attempt.attempts === 1 ? '' : 's'} and will not be retried automatically.`,
        needsAction: true,
      }
    case 'failed':
      return attempt.nextAttemptAt
        ? { label: 'Retrying', tone: 'pending', detail: 'The last attempt failed; another is scheduled.', needsAction: false }
        : { label: 'Failed', tone: 'failed', detail: 'The last attempt failed and no retry is scheduled.', needsAction: true }
    case 'in_flight':
      return { label: 'Syncing', tone: 'pending', detail: 'An upload is in progress.', needsAction: false }
    default:
      return { label: 'Queued', tone: 'pending', detail: 'Waiting to start.', needsAction: false }
  }
}
