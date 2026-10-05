import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Search, Users, Car, Wrench, AlertCircle } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { resolveApiBaseUrl } from '@/lib/apiClient'

/**
 * Garage Customer Records (Service Network S9).
 *
 * This page previously shipped four invented people — fabricated names, phone numbers,
 * email addresses, visit counts and spend totals — presented as a garage's real customer
 * book. After S2 a garage has actual customers (the requesters of its service cases), so
 * the fabrication is replaced with truth rather than merely deleted.
 *
 * Two deliberate absences: no contact details are shown, because Communications owns
 * reaching a customer and a garage should message through the canonical conversation
 * rather than a harvested phone number; and no "Add Customer" action exists, because a
 * customer relationship is created by a real service case, not typed in.
 */
const BASE_URL = resolveApiBaseUrl(
  import.meta.env.VITE_API_URL,
  typeof window !== 'undefined' ? window.location.hostname : undefined,
)

type Customer = {
  user_id: string
  display_name: string | null
  vehicle_count: number
  case_count: number
  completed_count: number
  last_service_at: string | null
  spend_by_currency: Record<string, number>
  conversation_thread_id: string | null
}

function formatSpend(spend: Record<string, number>): string {
  const entries = Object.entries(spend || {})
  // An empty map means no cost has been recorded — not that the customer spent nothing.
  if (entries.length === 0) return 'No cost recorded'
  return entries.map(([currency, amount]) => `${currency} ${amount.toLocaleString()}`).join(' · ')
}

export default function CustomerRecords() {
  const [search, setSearch] = useState('')
  const [customers, setCustomers] = useState<Customer[] | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)

  useEffect(() => {
    let cancelled = false
    const controller = new AbortController()
    ;(async () => {
      try {
        const token = typeof localStorage !== 'undefined' ? localStorage.getItem('carup_token') : null
        const response = await fetch(`${BASE_URL}/garage/customers`, {
          signal: controller.signal,
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        })
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        const body = await response.json()
        if (!cancelled) {
          setCustomers(Array.isArray(body?.customers) ? body.customers : [])
          setLoadFailed(false)
        }
      } catch (error) {
        if (!cancelled && (error as Error)?.name !== 'AbortError') {
          setCustomers(null)
          setLoadFailed(true)
        }
      }
    })()
    return () => { cancelled = true; controller.abort() }
  }, [])

  const filtered = useMemo(() => {
    if (!customers) return []
    const term = search.trim().toLowerCase()
    if (!term) return customers
    return customers.filter(c => (c.display_name || '').toLowerCase().includes(term))
  }, [customers, search])

  const loading = customers === null && !loadFailed

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold">Customer Records</h1>
        <p className="text-gray-500">People who have brought a vehicle to your garage</p>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
        <Input
          placeholder="Search customers by name..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="pl-10"
          aria-label="Search customers by name"
        />
      </div>

      {loading && <p className="text-sm text-gray-500" data-testid="customers-loading">Loading customers…</p>}

      {loadFailed && (
        <Card className="border-0 card-shadow" data-testid="customers-error">
          <CardContent className="p-8 text-center">
            <AlertCircle className="w-7 h-7 text-gray-300 mx-auto mb-3" />
            <p className="font-semibold text-gray-800">Customer records could not be loaded</p>
            <p className="text-sm text-gray-500 mt-1">
              This is a loading problem, not a statement that you have no customers.
            </p>
          </CardContent>
        </Card>
      )}

      {!loading && !loadFailed && filtered.length === 0 && (
        <Card className="border-0 card-shadow" data-testid="customers-empty">
          <CardContent className="p-8 text-center">
            <Users className="w-7 h-7 text-gray-300 mx-auto mb-3" />
            <p className="font-semibold text-gray-800">
              {search.trim() ? 'No customers match your search' : 'No customers yet'}
            </p>
            <p className="text-sm text-gray-500 mt-1">
              {search.trim()
                ? 'Try a different name.'
                : 'A customer appears here once they request a service from your garage.'}
            </p>
          </CardContent>
        </Card>
      )}

      {!loadFailed && filtered.length > 0 && (
        <div className="space-y-3" data-testid="customers-list">
          {filtered.map(customer => (
            <Card key={customer.user_id} className="border-0 card-shadow">
              <CardContent className="p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="font-semibold text-gray-900" data-testid="customer-name">
                      {customer.display_name || 'Unnamed customer'}
                    </h2>
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500 mt-2">
                      <span className="flex items-center gap-1">
                        <Car className="w-3 h-3" aria-hidden="true" />
                        {customer.vehicle_count} vehicle{customer.vehicle_count === 1 ? '' : 's'}
                      </span>
                      <span className="flex items-center gap-1">
                        <Wrench className="w-3 h-3" aria-hidden="true" />
                        {customer.case_count} service{customer.case_count === 1 ? '' : 's'}
                        {customer.completed_count > 0 && ` (${customer.completed_count} completed)`}
                      </span>
                      <span data-testid="customer-spend">{formatSpend(customer.spend_by_currency)}</span>
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    {customer.last_service_at ? (
                      <Badge variant="secondary" className="text-xs">
                        Last: {new Date(customer.last_service_at).toLocaleDateString()}
                      </Badge>
                    ) : (
                      <Badge variant="secondary" className="text-xs">No service date recorded</Badge>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
