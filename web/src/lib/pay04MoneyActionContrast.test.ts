/**
 * CARUP-PAY-04 — WCAG 2 AA contrast of the money-action buttons on the garage-payment surfaces.
 *
 * Found in physical UAT (axe in headed Chromium): "Record a payment" in the Garage Hub invoice view rendered near-white
 * text on orange-500 (2.7:1), and PAY-04's own "Pay" and "Save instructions" buttons rendered white on orange-600
 * (3.6:1). AA needs 4.5:1 for this 14 px text. jsdom computes no colours, so this test reads every orange background
 * class on those surfaces from source and computes the contrast of its text on its resting and hover backgrounds with
 * the Tailwind 3 palette the app ships (tailwindcss 3.4). The browser spec's axe pass is the physical proof.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const SURFACES = [
  'components/garage/hub/InvoiceView.tsx',
  'components/garage/hub/ProviderPaymentsPanel.tsx',
  'components/owner/serviceJourney/InvoicePayment.tsx',
  'components/owner/serviceJourney/PaymentReturnNotice.tsx',
  'components/owner/serviceJourney/InvoiceCard.tsx',
  'pages/dashboard/garage/GaragePayments.tsx',
  'pages/dashboard/admin/GaragePaymentsOperator.tsx',
  'lib/pay04GaragePayments.ts',
] as const

// Tailwind 3 default palette (solid button shades only; light tints such as orange-50 carry dark text).
const ORANGE: Record<string, string> = {
  'orange-400': '#fb923c', 'orange-500': '#f97316', 'orange-600': '#ea580c',
  'orange-700': '#c2410c', 'orange-800': '#9a3412', 'orange-900': '#7c2d12',
}
const WHITE = '#ffffff'
const PRIMARY_FOREGROUND = '#fafafa' // hsl(0 0% 98%): the Button's default text colour when no text colour is given

function channel(v: number) {
  const s = v / 255
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
}
function luminance(hex: string) {
  const n = Number.parseInt(hex.slice(1), 16)
  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255)
}
function contrast(a: string, b: string) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

/** Every string literal on a surface that paints a solid orange background. */
function orangeClassStrings(file: string) {
  const src = readFileSync(path.resolve(__dirname, '..', file), 'utf8')
  return [...src.matchAll(/(["'`])([^"'`]*\bbg-orange-[4-9]00\b[^"'`]*)\1/g)].map((m) => m[2])
}

describe('PAY-04 money-action buttons meet WCAG 2 AA contrast (4.5:1 for normal text)', () => {
  it('the contrast helper reproduces the measured failures and the published ratios', () => {
    expect(contrast(PRIMARY_FOREGROUND, ORANGE['orange-500'])).toBeCloseTo(2.68, 1) // axe: "2.68 (#fafafa on #f97316)"
    expect(contrast(WHITE, ORANGE['orange-600'])).toBeCloseTo(3.56, 1)
    expect(contrast(WHITE, ORANGE['orange-700'])).toBeGreaterThanOrEqual(4.5)
  })

  it('the surfaces do paint orange money actions (the check below is not vacuous)', () => {
    expect(SURFACES.flatMap((f) => orangeClassStrings(f)).length).toBeGreaterThan(0)
  })

  it.each(SURFACES)('%s: text on every solid orange background is 4.5:1 or more, at rest and on hover', (file) => {
    const failures: string[] = []
    for (const cls of orangeClassStrings(file)) {
      const text = /(?:^|\s)text-white(?:\s|$)/.test(cls) ? WHITE : PRIMARY_FOREGROUND
      const rest = /(?:^|\s)bg-(orange-[4-9]00)(?:\s|$)/.exec(cls)?.[1]
      const hover = /(?:^|\s)hover:bg-(orange-[4-9]00)(?:\s|$)/.exec(cls)?.[1]
      for (const [state, shade] of [['rest', rest], ['hover', hover]] as const) {
        if (!shade) continue
        const ratio = contrast(text, ORANGE[shade])
        if (ratio < 4.5) failures.push(`${state} ${shade} with ${text}: ${ratio.toFixed(2)}:1 in "${cls}"`)
      }
    }
    expect(failures).toEqual([])
  })
})
