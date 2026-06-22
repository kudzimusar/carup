/**
 * SubscriptionActions — sandbox billing controls (checkout / portal / change-plan / cancel).
 *
 * Rendered ONLY for trusted managers (frontend heuristic). The BACKEND remains authoritative: a
 * non-manager who reaches an endpoint still receives a 403, which the parent surfaces via the denial
 * panel — hidden buttons are convenience, not security.
 *
 * Safety guarantees:
 *  - change-plan and cancel require an explicit confirmation (AlertDialog) that states the effect,
 *    including the at-period-end behavior for cancel.
 *  - duplicate submission is prevented: while a request is in flight every action is disabled and the
 *    in-flight action is tracked, so a double click cannot fire two requests. Retrying after an error
 *    is idempotent-safe (the backend sandbox actions are safe to repeat).
 *  - sandbox wording is always visible; we NEVER claim a real charge/activation.
 *  - action outcomes are announced via an aria-live region; focus returns to the trigger after a
 *    dialog closes (Radix AlertDialog handles focus trap + return).
 */
import { useEffect, useState } from 'react'
import { CreditCard, ExternalLink, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { SANDBOX_BILLING_NOTICE } from '@/config/subscriptionFlag'
import { orderedPlans } from './subscriptionHelpers'
import type { Plan, SubscriptionStatus } from '@/types'

type ActionKind = 'checkout' | 'portal' | 'change-plan' | 'cancel'

export interface SubscriptionActionHandlers {
  onCheckout: (planKey: string) => Promise<void>
  onPortal: () => Promise<void>
  onChangePlan: (planKey: string) => Promise<void>
  onCancel: (atPeriodEnd: boolean) => Promise<void>
}

export interface SubscriptionActionsProps extends SubscriptionActionHandlers {
  plans: Plan[]
  status: SubscriptionStatus | null
  /** Last successful outcome message to announce (managed by the parent). */
  outcome?: string | null
  testId?: string
}

export function SubscriptionActions({
  plans,
  status,
  onCheckout,
  onPortal,
  onChangePlan,
  onCancel,
  outcome,
  testId = 'subscription-actions',
}: SubscriptionActionsProps) {
  const ordered = orderedPlans(plans)
  const firstTarget = ordered.find((p) => p.planKey !== status?.planKey)?.planKey || ordered[0]?.planKey || ''
  const [selectedPlan, setSelectedPlan] = useState<string>(firstTarget)
  const [pending, setPending] = useState<ActionKind | null>(null)
  const [confirm, setConfirm] = useState<null | 'change-plan' | 'cancel'>(null)

  // Plans may arrive AFTER first render (the parent renders this while still loading). Seed the
  // selection once a real default becomes available so the action controls are operable.
  useEffect(() => {
    if (!selectedPlan && firstTarget) setSelectedPlan(firstTarget)
  }, [firstTarget, selectedPlan])

  const effectivePlan = selectedPlan || firstTarget

  const busy = pending !== null

  // Single guarded runner: prevents a second invocation while one is in flight (anti-double-submit).
  async function run(kind: ActionKind, fn: () => Promise<void>) {
    if (busy) return
    setPending(kind)
    try {
      await fn()
    } finally {
      setPending(null)
    }
  }

  const cancelAtPeriodEnd = status?.cancelAtPeriodEnd ? false : true // toggle target for the cancel action

  return (
    <section aria-labelledby="subscription-actions-heading" data-testid={testId} className="rounded-md border border-gray-200 bg-white p-5">
      <h2 id="subscription-actions-heading" className="text-lg font-semibold text-gray-950">Manage subscription</h2>

      {/* Sandbox truthfulness — always visible. */}
      <p className="mt-1 rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-600" data-testid={`${testId}-sandbox-notice`}>
        {SANDBOX_BILLING_NOTICE}
      </p>

      {/* aria-live outcome region (announced politely; never claims a real charge). */}
      <p className="sr-only" aria-live="polite" role="status" data-testid={`${testId}-outcome`}>
        {outcome || ''}
      </p>

      <div className="mt-4 grid gap-3">
        <div className="flex flex-wrap items-end gap-2">
          <div className="grow">
            <Label htmlFor="subscription-plan-select" className="text-xs text-gray-600">Target plan</Label>
            <select
              id="subscription-plan-select"
              className="mt-1 block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
              value={effectivePlan}
              onChange={(e) => setSelectedPlan(e.target.value)}
              disabled={busy}
              data-testid={`${testId}-plan-select`}
            >
              {ordered.map((p) => (
                <option key={p.planKey} value={p.planKey}>{p.name}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button
            onClick={() => run('checkout', () => onCheckout(effectivePlan))}
            disabled={busy || !effectivePlan}
            data-testid={`${testId}-checkout`}
          >
            {pending === 'checkout' ? <Loader2 className="mr-1 h-4 w-4 animate-spin" aria-hidden="true" /> : <CreditCard className="mr-1 h-4 w-4" aria-hidden="true" />}
            Start sandbox checkout
          </Button>

          <Button
            variant="outline"
            onClick={() => setConfirm('change-plan')}
            disabled={busy || !effectivePlan}
            data-testid={`${testId}-change-plan`}
          >
            Change plan
          </Button>

          <Button
            variant="outline"
            onClick={() => run('portal', onPortal)}
            disabled={busy}
            data-testid={`${testId}-portal`}
          >
            <ExternalLink className="mr-1 h-4 w-4" aria-hidden="true" /> Open billing portal
          </Button>

          <Button
            variant="outline"
            className="text-red-700 hover:text-red-800"
            onClick={() => setConfirm('cancel')}
            disabled={busy || !status || status.cancelAtPeriodEnd}
            data-testid={`${testId}-cancel`}
          >
            Cancel subscription
          </Button>
        </div>
      </div>

      {/* Change-plan confirmation. */}
      <AlertDialog open={confirm === 'change-plan'} onOpenChange={(o) => !o && setConfirm(null)}>
        <AlertDialogContent data-testid={`${testId}-change-plan-dialog`}>
          <AlertDialogHeader>
            <AlertDialogTitle>Change plan?</AlertDialogTitle>
            <AlertDialogDescription>
              This will request a plan change to <strong>{ordered.find((p) => p.planKey === effectivePlan)?.name || effectivePlan}</strong> through
              the sandbox billing provider. {SANDBOX_BILLING_NOTICE}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid={`${testId}-change-plan-cancel`}>Keep current plan</AlertDialogCancel>
            <AlertDialogAction
              data-testid={`${testId}-change-plan-confirm`}
              onClick={() => { setConfirm(null); void run('change-plan', () => onChangePlan(effectivePlan)) }}
            >
              Confirm change
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Cancel confirmation — states the at-period-end effect explicitly. */}
      <AlertDialog open={confirm === 'cancel'} onOpenChange={(o) => !o && setConfirm(null)}>
        <AlertDialogContent data-testid={`${testId}-cancel-dialog`}>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel subscription?</AlertDialogTitle>
            <AlertDialogDescription>
              The subscription will be scheduled to cancel at the end of the current period. Access continues until then;
              it is not cancelled immediately. {SANDBOX_BILLING_NOTICE}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid={`${testId}-cancel-dismiss`}>Keep subscription</AlertDialogCancel>
            <AlertDialogAction
              data-testid={`${testId}-cancel-confirm`}
              onClick={() => { setConfirm(null); void run('cancel', () => onCancel(cancelAtPeriodEnd)) }}
            >
              Confirm cancellation
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  )
}

export default SubscriptionActions
