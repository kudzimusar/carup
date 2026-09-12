/**
 * The ONE step-up recovery path, shared by every screen that calls a guarded route.
 *
 * `requireAuthenticationAssurance(ACTION_CLASSES.SENSITIVE|CRITICAL)` protects the actions that
 * change someone's standing, and a normal password login does not satisfy it. Without a shared
 * recovery each console has to grow its own — which is exactly how the primary identity console
 * ended up with none while People & Compliance had one, leaving admins able to open a case but
 * not decide it.
 *
 * What this does, and deliberately no more:
 *   - runs the guarded action;
 *   - on `STEP_UP_REQUIRED`, prompts for the account password and re-proves it server-side;
 *   - retries the SAME action with the SAME arguments;
 *   - surfaces a second refusal instead of looping or hiding it.
 *
 * It grants nothing. The guard still decides.
 */
import { useCallback, useState } from 'react'
import { StepUpDialog } from '@/components/security/StepUpDialog'
import { useCarUpApi } from '@/hooks/useCarUpApi'
import { toast } from 'sonner'

export const STEP_UP_REQUIRED = 'STEP_UP_REQUIRED'

/** Read the server's error code off any failure shape the API client can throw. */
export function apiErrorCode(error: unknown): string | undefined {
  const withCode = error as { code?: unknown; data?: { code?: unknown } } | null
  if (typeof withCode?.code === 'string') return withCode.code
  // Belt and braces: the structured body is preserved even when a path forgets to lift `code`.
  if (typeof withCode?.data?.code === 'string') return withCode.data.code
  return undefined
}

export interface StepUpGuard {
  /** Run a guarded action, recovering from STEP_UP_REQUIRED. Returns true when it completed. */
  runGuarded: (label: string, action: () => Promise<void>) => Promise<boolean>
  /** Render this once in the screen. */
  stepUpDialog: React.ReactNode
  /** True while a step-up prompt is open. */
  awaitingStepUp: boolean
}

export function useStepUpGuard(): StepUpGuard {
  const { stepUpSession } = useCarUpApi()
  const [pending, setPending] = useState<{ label: string; run: () => Promise<void> } | null>(null)

  const runGuarded = useCallback(async (label: string, action: () => Promise<void>) => {
    try {
      await action()
      return true
    } catch (error) {
      if (apiErrorCode(error) === STEP_UP_REQUIRED) {
        setPending({ label, run: action })
        return false
      }
      toast.error(error instanceof Error ? error.message : `${label} failed`)
      return false
    }
  }, [])

  const confirm = useCallback(async (password: string) => {
    const current = pending
    if (!current) return
    // A failed step-up throws here, so the dialog keeps its own error and stays open.
    await stepUpSession(password)
    setPending(null)
    // Retry exactly what the guard interrupted. A second refusal re-opens the prompt.
    await runGuarded(current.label, current.run)
  }, [pending, stepUpSession, runGuarded])

  const stepUpDialog = (
    <StepUpDialog
      open={pending !== null}
      actionLabel={pending?.label ?? null}
      onCancel={() => setPending(null)}
      onConfirm={confirm}
    />
  )

  return { runGuarded, stepUpDialog, awaitingStepUp: pending !== null }
}

export default useStepUpGuard
