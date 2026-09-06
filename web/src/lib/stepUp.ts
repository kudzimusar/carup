/**
 * Does this failure mean "prove it is you again"?
 *
 * Lives apart from `StepUpPrompt` because a module that exports a component alongside a plain
 * function breaks React Fast Refresh — the component silently stops hot-reloading, which is the
 * kind of papercut nobody traces back to an export list.
 */
export function isStepUpRequired(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err ?? '')
  return /STEP_UP_REQUIRED|Recent re-authentication is required/i.test(message)
}
