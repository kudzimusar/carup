/**
 * O2-X5A — Workbook tools: the stakeholder-scoped workbook workspace.
 *
 * The page renders ONLY what the server-derived catalogue grants; unavailable
 * templates appear with their honest reasons instead of vanishing (client-side
 * hiding is presentation — the backend list is the gate, re-verified per call).
 */
import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { useCarUpApi } from '@/hooks/useCarUpApi'
import { useAuth } from '@/context/AuthContext'
import { toast } from 'sonner'
import WorkbookWorkspace from '@/components/workbook/WorkbookWorkspace'

interface CatalogueEntry { template_key: string; label: string; version: string; engine: string; actions: string[]; note?: string }
interface UnavailableEntry { template_key: string; reason: string; note?: string }

const REASON_LABELS: Record<string, string> = {
  business_context_required: 'Needs a registered business context',
  dealer_activation_required: 'Needs Dealer activation',
  trade_profile_required: 'Needs a verified trade profile',
  trade_profile_role_mismatch: 'Your trade profile has a different role',
  service_network_reconciliation_required: 'Not available yet — Service Network reconciliation required',
  provider_platform_is_the_integration_surface: 'Providers integrate through the provider platform, not spreadsheets',
  governed_activation_lane_exists: 'Registry data flows through its own governed lane',
  no_canonical_bulk_workflow: 'No bulk workflow exists for this yet',
}

export default function WorkbookTools() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const { fetchWorkbookCatalogue } = useCarUpApi()
  const [available, setAvailable] = useState<CatalogueEntry[]>([])
  const [unavailable, setUnavailable] = useState<UnavailableEntry[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    try {
      const data = await fetchWorkbookCatalogue() as unknown as { available: CatalogueEntry[]; unavailable: UnavailableEntry[] }
      setAvailable(data.available || [])
      setUnavailable(data.unavailable || [])
      const registryEntry = (data.available || []).find((entry) => entry.engine === 'registry')
      if (registryEntry) setSelected((current) => current || registryEntry.template_key)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'The workbook catalogue could not be loaded.')
    } finally {
      setLoading(false)
    }
  }, [fetchWorkbookCatalogue])

  const userId = user?.id
  useEffect(() => {
    if (!userId) { navigate('/login'); return }
    queueMicrotask(() => { void load() })
  }, [userId, navigate, load])

  if (loading) return <div className="p-6 text-sm text-gray-400">Loading your workbook catalogue…</div>

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-4 text-gray-100">
      <div>
        <h1 className="text-lg font-semibold">Workbook tools</h1>
        <p className="text-sm text-gray-400">
          Bulk templates, exports and governed imports for your role. Imports create drafts and claims —
          verification, compliance and publication always stay governed steps on the site.
        </p>
      </div>

      <div className="grid gap-2 sm:grid-cols-2" data-testid="catalogue-available">
        {available.map((entry) => (
          <Card key={entry.template_key}
            className={`cursor-pointer border ${selected === entry.template_key ? 'border-violet-700 bg-gray-900' : 'border-gray-800 bg-gray-950'}`}>
            <CardContent className="p-3" onClick={() => entry.engine === 'registry' ? setSelected(entry.template_key) : undefined}>
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">{entry.label}</span>
                <Badge className="bg-gray-800 text-gray-300">{entry.engine === 'registry' ? 'vehicle workbook' : 'diaspora pipeline'}</Badge>
              </div>
              {entry.note && <p className="mt-1 text-xs text-gray-400">{entry.note}</p>}
              {entry.engine !== 'registry' && (
                <Button size="sm" variant="outline" className="mt-2" data-testid={`open-diaspora-${entry.template_key}`}
                  onClick={() => navigate('/diaspora/trade-profile')}>
                  Open in Diaspora Trade tools
                </Button>
              )}
            </CardContent>
          </Card>
        ))}
        {available.length === 0 && <p className="text-sm text-gray-400">No workbooks are available to this account yet.</p>}
      </div>

      {selected && <WorkbookWorkspace templateKey={selected} title={available.find((entry) => entry.template_key === selected)?.label} />}

      {unavailable.length > 0 && (
        <div className="rounded-md border border-gray-800 bg-gray-950 p-3" data-testid="catalogue-unavailable">
          <div className="text-xs font-medium text-gray-400">Not available to this account (and why)</div>
          <ul className="mt-1 space-y-0.5 text-xs text-gray-400">
            {unavailable.map((entry) => (
              <li key={entry.template_key} data-testid={`unavailable-${entry.template_key}`}>
                {entry.template_key.replace(/_/g, ' ')} — {REASON_LABELS[entry.reason] || entry.reason}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
