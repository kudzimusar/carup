import type { ChangeEvent } from 'react'
import { Input } from '@/components/ui/input'

/**
 * CARUP-DEALER-1.0-VISUAL-UAT-R1 — reviewer password step-up field (Owner UAT defects 3 & 4).
 *
 * - Says next to the field why the password is asked for again and that it is not stored.
 * - Browsers' password managers fill the saved username into the text input just before a password
 *   input. During UAT that put the reviewer's e-mail into the "registration number" field. A hidden,
 *   read-only `autocomplete="username"` input sits immediately before the password so a password
 *   manager pairs the credential with IT, never with a form field such as a registration number.
 * The page keeps its own <label htmlFor={id}>; enforcement stays server-side (every decision re-checks
 * the password, with lockout after repeated failures).
 */
export const REVIEWER_STEP_UP_EXPLANATION =
  'Enter your account password again to confirm this sensitive independent decision. It is not stored.'

export default function ReviewerStepUpField({
  id, value, onChange, username, className, inputClassName, plain = false,
}: {
  id: string
  value: string
  onChange: (value: string) => void
  username?: string | null
  className?: string
  inputClassName?: string
  /** Render a plain <input> (pages that do not use the shared Input primitive). */
  plain?: boolean
}) {
  const helpId = `${id}-help`
  const common = {
    id, type: 'password', name: 'password', autoComplete: 'current-password', value,
    'aria-describedby': helpId,
    onChange: (event: ChangeEvent<HTMLInputElement>) => onChange(event.target.value),
  } as const
  return (
    <div className={className}>
      <input type="text" name="username" autoComplete="username" value={username ?? ''} readOnly hidden
        aria-hidden="true" tabIndex={-1} data-testid={`${id}-username-anchor`} />
      {plain ? <input {...common} className={inputClassName} /> : <Input {...common} className={inputClassName} />}
      <p id={helpId} className="mt-1 text-xs text-gray-600" data-testid="reviewer-step-up-explanation">
        {REVIEWER_STEP_UP_EXPLANATION}
      </p>
    </div>
  )
}
