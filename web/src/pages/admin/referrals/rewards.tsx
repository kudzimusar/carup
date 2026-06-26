import { useState, useEffect, useCallback } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { DollarSign, Download, RefreshCw } from 'lucide-react'
import { useCarUpApi } from '@/hooks/useCarUpApi'

/**
 * Admin Reward Operations (/admin/referrals/rewards)
 * Approve, hold, block, reverse, payable, paid — all with required reason.
 * CSV payout export from real stored payable/paid transactions.
 * Owners must not approve or mark paid — enforced by backend. Admin only.
 */

const TRANSITIONS = ['eligible', 'approved', 'payable', 'paid_or_applied', 'held', 'rejected'] as const
type Transition = typeof TRANSITIONS[number]

const STATUS_STYLES: Record<string, string> = {
  eligible: 'bg-blue-100 text-blue-700',
  approved: 'bg-green-100 text-green-700',
  payable: 'bg-emerald-100 text-emerald-700',
  paid_or_applied: 'bg-gray-100 text-gray-700',
  held: 'bg-orange-100 text-orange-700',
  rejected: 'bg-red-100 text-red-700',
}

export default function RewardOperations() {
  const { operateReward, exportPayoutCsv } = useCarUpApi()
  const [txId, setTxId] = useState('')
  const [newStatus, setNewStatus] = useState<Transition>('eligible')
  const [reason, setReason] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [result, setResult] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)
  const [exportStatus, setExportStatus] = useState<'payable' | 'paid_or_applied'>('payable')

  const operate = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!txId.trim()) { setError('Transaction ID is required.'); return }
    if (!reason.trim()) { setError('Reason is required.'); return }
    setSubmitting(true)
    setError(null)
    setResult(null)
    try {
      const res = await operateReward({ transaction_id: txId.trim(), new_status: newStatus, reason: reason.trim() })
      setResult(`Transition recorded. New status: ${res.transaction?.status}`)
      setTxId('')
      setReason('')
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Operation failed')
    } finally {
      setSubmitting(false)
    }
  }

  const doExport = async () => {
    setExporting(true)
    setError(null)
    try {
      const csv = await exportPayoutCsv(exportStatus)
      const blob = new Blob([String(csv)], { type: 'text/csv' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `payout_${exportStatus}_${Date.now()}.csv`
      a.click()
      URL.revokeObjectURL(url)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Export failed')
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="p-6 space-y-6 max-w-2xl">
      <h1 className="text-2xl font-bold flex items-center gap-2">
        <DollarSign className="h-6 w-6" /> Reward Operations
      </h1>
      <p className="text-sm text-amber-600 bg-amber-50 p-3 rounded border border-amber-200">
        Admin only. All transitions are audited. Owners cannot approve or mark rewards paid.
      </p>

      {error && <p className="text-sm text-red-600 bg-red-50 p-3 rounded">{error}</p>}
      {result && <p className="text-sm text-green-600 bg-green-50 p-3 rounded">{result}</p>}

      {/* Transition form */}
      <Card>
        <CardContent className="p-5">
          <p className="font-medium mb-3">Transition Wallet Transaction</p>
          <form onSubmit={operate} className="space-y-3">
            <div>
              <label className="text-xs text-gray-500">Wallet Transaction ID *</label>
              <Input
                placeholder="UUID of the wallet transaction"
                value={txId}
                onChange={e => setTxId(e.target.value)}
                className="font-mono text-sm"
              />
            </div>
            <div>
              <label className="text-xs text-gray-500">New Status *</label>
              <select
                className="w-full border rounded px-3 py-2 text-sm"
                value={newStatus}
                onChange={e => setNewStatus(e.target.value as Transition)}
              >
                {TRANSITIONS.map(t => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
              <Badge className={`mt-1 ${STATUS_STYLES[newStatus] || 'bg-gray-100 text-gray-700'}`}>
                → {newStatus}
              </Badge>
            </div>
            <div>
              <label className="text-xs text-gray-500">Reason * (min 3 chars)</label>
              <Input
                placeholder="Why is this transition being applied?"
                value={reason}
                onChange={e => setReason(e.target.value)}
              />
            </div>
            <Button type="submit" disabled={submitting} className="w-full">
              {submitting ? 'Applying…' : 'Apply Transition'}
            </Button>
          </form>
        </CardContent>
      </Card>

      {/* CSV export */}
      <Card>
        <CardContent className="p-5 space-y-3">
          <p className="font-medium flex items-center gap-2"><Download className="h-4 w-4" /> Payout CSV Export</p>
          <div>
            <label className="text-xs text-gray-500">Export Status</label>
            <select
              className="w-full border rounded px-3 py-2 text-sm"
              value={exportStatus}
              onChange={e => setExportStatus(e.target.value as 'payable' | 'paid_or_applied')}
            >
              <option value="payable">Payable (ready to pay)</option>
              <option value="paid_or_applied">Paid / Applied</option>
            </select>
          </div>
          <Button variant="outline" onClick={doExport} disabled={exporting} className="w-full">
            <Download className="h-4 w-4 mr-2" />
            {exporting ? 'Exporting…' : 'Export CSV'}
          </Button>
          <p className="text-xs text-gray-400">CSV is generated from real stored transactions. Empty file = no transactions at that status.</p>
        </CardContent>
      </Card>
    </div>
  )
}