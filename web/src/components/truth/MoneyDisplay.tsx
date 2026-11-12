import { cn } from '@/lib/utils'
import { formatMoney, MONEY_SOURCE_LABELS, type MoneySource } from './money'

/**
 * RX-02A S1-3 — MoneyDisplay (UI_DESIGN_REFERENCE_AND_TOKENS.md §6.3).
 * The single permitted renderer of a monetary figure:
 *  - currency mandatory and explicit (USD/ZiG/ZAR/BWP); the currency CODE is always
 *    VISIBLE — a bare "$" is ambiguous, so USD renders as "$18,500 USD";
 *  - ZiG never renders as "$";
 *  - tabular numerals (token contract: type.tabularNumerals);
 *  - source label (asking / agreed / estimate / guide) beside the figure;
 *  - currency provenance is distinguished, never conflated:
 *      · recorded but unsupported currency (e.g. EUR) → amount + verbatim code,
 *        flagged "Unsupported currency" — never converted, never invented;
 *      · unrecorded currency (null/blank) → amount + "Currency not recorded";
 *      · missing amount → labelled "Not recorded" — never a fabricated figure.
 */
export interface MoneyDisplayProps {
  amount?: number | null
  /** Mandatory explicit currency. Runtime-unknown values render the honest
   *  currency-provenance state — the amount, when known, is still shown. */
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
      ? [sourceLabel, `${formatted.amountText} ${formatted.currency}`].filter(Boolean).join(', ')
      : formatted.kind === 'unsupported-currency'
        ? [sourceLabel, `amount ${formatted.amountText}, unsupported currency ${formatted.code}`].filter(Boolean).join(', ')
        : formatted.kind === 'currency-not-recorded'
          ? [sourceLabel, `amount ${formatted.amountText}, currency not recorded`].filter(Boolean).join(', ')
          : [sourceLabel, 'amount not recorded'].filter(Boolean).join(', '))

  const valueClasses = cn(
    'font-semibold tabular-nums text-carup-text',
    size === 'lg' ? 'text-[20px] leading-[1.2] tracking-[-0.02em]' : 'text-[14px] leading-[1.55]'
  )
  const chipClasses =
    'rounded-[2px] border border-dashed border-carup-line-strong px-1.5 font-medium text-carup-text-2'

  return (
    <span className={cn('inline-flex flex-wrap items-baseline gap-x-2', className)} aria-label={accessible}>
      {sourceLabel && (
        <span className="text-[10.5px] font-medium uppercase tracking-[0.08em] text-carup-text-3">
          {sourceLabel}
        </span>
      )}
      {formatted.kind === 'value' && (
        <span data-testid="money-value" className={valueClasses}>
          <span className="tabular-nums">{formatted.amountText}</span>{' '}
          <span data-testid="money-currency" className="font-medium text-carup-text-2">
            {formatted.currency}
          </span>
        </span>
      )}
      {formatted.kind === 'unsupported-currency' && (
        <span data-testid="money-value" className={valueClasses}>
          <span className="tabular-nums">{formatted.amountText}</span>{' '}
          <span data-testid="money-currency-unsupported" className={chipClasses}>
            Unsupported currency: {formatted.code}
          </span>
        </span>
      )}
      {formatted.kind === 'currency-not-recorded' && (
        <span data-testid="money-value" className={valueClasses}>
          <span className="tabular-nums">{formatted.amountText}</span>{' '}
          <span data-testid="money-currency-missing" className={chipClasses}>
            Currency not recorded
          </span>
        </span>
      )}
      {formatted.kind === 'missing' && (
        <span
          data-testid="money-missing"
          className={cn(
            chipClasses,
            'tabular-nums',
            size === 'lg' ? 'text-[14px]' : 'text-[12px]'
          )}
        >
          Not recorded
        </span>
      )}
    </span>
  )
}
