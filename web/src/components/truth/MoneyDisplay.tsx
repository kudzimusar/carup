import { cn } from '@/lib/utils'
import { formatMoney, MONEY_SOURCE_LABELS, type MoneySource } from './money'

/**
 * RX-02A S1-3 — MoneyDisplay (UI_DESIGN_REFERENCE_AND_TOKENS.md §6.3).
 * The single permitted renderer of a monetary figure:
 *  - currency mandatory and explicit (USD/ZiG/ZAR/BWP); ZiG never renders as "$";
 *  - tabular numerals (token contract: type.tabularNumerals);
 *  - source label (asking / agreed / estimate / guide) beside the figure;
 *  - missing values render an explicit, labelled state — never a fabricated figure.
 */
export interface MoneyDisplayProps {
  amount?: number | null
  /** Mandatory explicit currency. Runtime-unknown values render the missing state. */
  currency?: string | null
  source?: MoneySource
  size?: 'md' | 'lg'
  className?: string
  /** Accessible label override; defaults to "<source> <amount> <currency>". */
  ariaLabel?: string
}

export function MoneyDisplay({
  amount,
  currency,
  source,
  size = 'md',
  className,
  ariaLabel,
}: MoneyDisplayProps) {
  const formatted = formatMoney(amount, currency)
  const sourceLabel = source ? MONEY_SOURCE_LABELS[source] : null

  const accessible =
    ariaLabel ??
    (formatted.kind === 'value'
      ? [sourceLabel, formatted.text, formatted.currency].filter(Boolean).join(', ')
      : [sourceLabel, 'amount not recorded'].filter(Boolean).join(', '))

  return (
    <span className={cn('inline-flex flex-wrap items-baseline gap-x-2', className)} aria-label={accessible}>
      {sourceLabel && (
        <span className="text-[10.5px] font-medium uppercase tracking-[0.08em] text-carup-text-3">
          {sourceLabel}
        </span>
      )}
      {formatted.kind === 'value' ? (
        <span
          data-testid="money-value"
          className={cn(
            'font-semibold tabular-nums text-carup-text',
            size === 'lg' ? 'text-[20px] leading-[1.2] tracking-[-0.02em]' : 'text-[14px] leading-[1.55]'
          )}
        >
          {formatted.text}
          <span className="sr-only"> {formatted.currency}</span>
        </span>
      ) : (
        <span
          data-testid="money-missing"
          className={cn(
            'rounded-[2px] border border-dashed border-carup-line-strong px-1.5 font-medium tabular-nums text-carup-text-2',
            size === 'lg' ? 'text-[14px]' : 'text-[12px]'
          )}
        >
          Not recorded
        </span>
      )}
    </span>
  )
}
