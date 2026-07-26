/**
 * SafeTradeStatusBanner — the at-a-glance header for a SafeTrade case.
 *
 * Shows the current CANONICAL state, the linked order reference, role-safe buyer/seller labels, the
 * declared total + currency, the policy version, and created/updated timestamps. It NEVER uses the
 * words "funds secured", "escrow balance" or "guaranteed" — money is framed as a declared total only.
 */
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  designStateOf,
  stateLabel,
  formatMoney,
  partySafeLabel,
  isEscapeHatchState,
  isTerminalState,
} from './safeTradeHelpers'
import type { SafeTradeTransaction } from '@/types'

export interface SafeTradeStatusBannerProps {
  txn: SafeTradeTransaction
  viewerId?: string | null
  testId?: string
}

export function SafeTradeStatusBanner({ txn, viewerId, testId = 'safetrade-status-banner' }: SafeTradeStatusBannerProps) {
  const state = designStateOf(txn)
  const buyer = partySafeLabel(txn, txn.buyer_id ?? txn.created_by ?? null, viewerId)
  const seller = partySafeLabel(txn, txn.seller_id ?? null, viewerId)
  const tone = isEscapeHatchState(state) ? 'destructive' : isTerminalState(state) ? 'secondary' : 'default'

  return (
    <Card data-testid={testId} aria-label="SafeTrade case status">
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-lg">
            SafeTrade case <span className="font-mono text-sm text-gray-500">#{shortRef(txn.id)}</span>
          </CardTitle>
          <Badge variant={tone} data-testid={`${testId}-state`} data-state={state ?? 'UNKNOWN'}>
            {stateLabel(state)}
          </Badge>
        </div>
      </CardHeader>
      <CardContent>
        <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
          <div className="flex justify-between gap-2 sm:block">
            <dt className="font-medium text-gray-700">Linked import order</dt>
            <dd className="font-mono text-gray-600" data-testid={`${testId}-order`}>#{shortRef(txn.import_order_id)}</dd>
          </div>
          <div className="flex justify-between gap-2 sm:block">
            <dt className="font-medium text-gray-700">Declared total</dt>
            <dd className="text-gray-900" data-testid={`${testId}-total`}>{formatMoney(txn.total_amount, txn.currency)}</dd>
          </div>
          <div className="flex justify-between gap-2 sm:block">
            <dt className="font-medium text-gray-700">Buyer</dt>
            <dd className="text-gray-600" data-testid={`${testId}-buyer`}>{buyer}</dd>
          </div>
          <div className="flex justify-between gap-2 sm:block">
            <dt className="font-medium text-gray-700">Seller</dt>
            <dd className="text-gray-600" data-testid={`${testId}-seller`}>{seller}</dd>
          </div>
          <div className="flex justify-between gap-2 sm:block">
            <dt className="font-medium text-gray-700">Policy version</dt>
            <dd className="text-gray-600" data-testid={`${testId}-policy`}>{txn.policy_version || '—'}</dd>
          </div>
          <div className="flex justify-between gap-2 sm:block">
            <dt className="font-medium text-gray-700">Last updated</dt>
            <dd className="text-gray-600" data-testid={`${testId}-updated`}>{formatTimestamp(txn.updated_at ?? txn.created_at)}</dd>
          </div>
        </dl>
      </CardContent>
    </Card>
  )
}

function shortRef(id: string | null | undefined): string {
  if (!id) return '—'
  return String(id).slice(0, 8)
}

function formatTimestamp(ts: string | null | undefined): string {
  if (!ts) return '—'
  const d = new Date(ts)
  return Number.isNaN(d.getTime()) ? String(ts) : d.toISOString().replace('T', ' ').slice(0, 16) + ' UTC'
}

export default SafeTradeStatusBanner
