import { useState, useEffect, useCallback } from 'react'
import type { ReactNode } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { RefreshCw } from 'lucide-react'
import type { ReferralPagination } from '@/types/referral'

export interface ReferralListResult<T> {
  items: T[]
  pagination?: ReferralPagination
}

/**
 * Generic real-data list for admin referral surfaces (Phase E). Loads from a real
 * GET-list endpoint (passed as a memoized `load`), shows pagination totals, an
 * honest empty state, and a refresh control. Replaces the interim event-log views
 * as the PRIMARY list where a real endpoint now exists. Never renders fake rows.
 *
 * NOTE: `load` must be memoized by the caller (useCallback) to avoid refetch loops.
 */
export default function ReferralRealList<T>({
  title,
  load,
  renderRow,
  emptyText = 'No records yet.',
}: {
  title: string
  load: () => Promise<ReferralListResult<T>>
  renderRow: (item: T, index: number) => ReactNode
  emptyText?: string
}) {
  const [items, setItems] = useState<T[]>([])
  const [pagination, setPagination] = useState<ReferralPagination | undefined>(undefined)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const run = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await load()
      setItems(res.items ?? [])
      setPagination(res.pagination)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load list.')
    } finally {
      setLoading(false)
    }
  }, [load])

  useEffect(() => {
    run()
  }, [run])

  return (
    <Card className="border-0 card-shadow">
      <CardContent className="p-6">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h2 className="font-semibold">{title}</h2>
            {pagination && (
              <p className="text-[11px] text-gray-400">
                {items.length} shown · {pagination.total} total{pagination.has_more ? ' · more available' : ''}
              </p>
            )}
          </div>
          <Button size="sm" variant="outline" onClick={run} disabled={loading}>
            <RefreshCw className="w-3 h-3 mr-1" />Refresh
          </Button>
        </div>
        {error ? (
          <p className="text-sm text-red-600">{error}</p>
        ) : items.length === 0 ? (
          <p className="text-sm text-gray-500">{loading ? 'Loading…' : emptyText}</p>
        ) : (
          <div className="space-y-1">{items.map((item, index) => renderRow(item, index))}</div>
        )}
      </CardContent>
    </Card>
  )
}
