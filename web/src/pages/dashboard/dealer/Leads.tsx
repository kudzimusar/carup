import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Phone, Mail, MessageSquare, Search, Users, Calendar, Loader2 } from 'lucide-react'
import { useState, useEffect } from 'react'
import { useCarUpApi } from '@/hooks/useCarUpApi'
import { SellerInquiriesCard } from '@/components/marketplace/SellerInquiriesCard'
import { toast } from 'sonner'
import type { Lead } from '@/types'

export default function Leads() {
  const { fetchDealerLeads, loading } = useCarUpApi()
  const [leadsData, setLeadsData] = useState<Lead[]>([])
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')

  useEffect(() => {
    let mounted = true
    fetchDealerLeads().then(data => {
      if (!mounted || !data || data.length === 0) return
      const formatted = data.map((d: Lead) => ({
        id: d.id,
        name: d.buyer_name || d.name || 'Unknown',
        email: d.email || 'N/A',
        phone: d.buyer_phone || d.phone || 'N/A',
        vehicle: d.vin ? `VIN: ${d.vin}` : d.vehicle || 'Unknown',
        status: d.status || 'new',
        source: d.source || 'Platform',
        date: d.created_at ? new Date(d.created_at).toLocaleDateString() : d.date || new Date().toLocaleDateString(),
        notes: d.message || d.notes || 'No message provided'
      }))
      setLeadsData(formatted)
    }).catch(() => {
      // API offline — the empty state below stays truthful; never backfill with mock leads.
    })
    return () => { mounted = false }
  }, [fetchDealerLeads])

  const filtered = leadsData.filter(l =>
    (!search || l.name.toLowerCase().includes(search.toLowerCase()) || l.vehicle.toLowerCase().includes(search.toLowerCase())) &&
    (statusFilter === 'all' || l.status === statusFilter)
  )

  const handleWhatsApp = (phone: string, vehicle: string) => {
    const cleanPhone = phone.replace(/[^0-9]/g, '')
    const msg = encodeURIComponent(`Hi! Following up on your interest in the ${vehicle} on CarUp.`)
    window.open(`https://wa.me/${cleanPhone}?text=${msg}`, '_blank')
  }

  const handleCall = (phone: string, name: string) => {
    toast.info(`Calling ${name}...`)
    window.location.href = `tel:${phone}`
  }

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            Leads
            {loading && <Loader2 className="w-4 h-4 animate-spin text-gray-400" />}
          </h1>
          <p className="text-gray-500">Manage and track your sales leads</p>
        </div>
        <div className="flex gap-2">
          {['all', 'new', 'contacted', 'negotiating', 'closed'].map(s => (
            <Button key={s} variant={statusFilter === s ? 'default' : 'outline'} size="sm" onClick={() => setStatusFilter(s)} className={statusFilter === s ? 'bg-orange-500 hover:bg-orange-600 text-white' : ''}>
              {s.charAt(0).toUpperCase() + s.slice(1)}
            </Button>
          ))}
        </div>
      </div>

      {/* Real marketplace inquiries on the dealer's own listings (ownership-scoped backend). */}
      <SellerInquiriesCard />

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
        <Input placeholder="Search leads by name or vehicle..." value={search} onChange={e => setSearch(e.target.value)} className="pl-10 bg-white" />
      </div>

      {filtered.length === 0 ? (
        <div className="text-center py-12 bg-white rounded-xl border border-gray-100" data-testid="dealer-leads-empty">
          <Users className="w-12 h-12 text-gray-200 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900 mb-1">
            {leadsData.length === 0 ? 'No leads yet' : 'No leads found'}
          </h3>
          <p className="text-gray-500">
            {leadsData.length === 0
              ? 'Leads from your marketplace listings will appear here as buyers reach out.'
              : 'Try adjusting your filters or search query.'}
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {filtered.map((lead) => (
            <Card key={lead.id} className="border-0 card-shadow transition-shadow hover:shadow-md">
              <CardContent className="p-5">
                <div className="flex items-start gap-4">
                  <div className="w-10 h-10 rounded-full bg-orange-100 flex items-center justify-center shrink-0">
                    <Users className="w-5 h-5 text-orange-600" />
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center justify-between mb-1">
                      <h3 className="font-semibold text-lg">{lead.name}</h3>
                      <Badge className={lead.status === 'new' ? 'bg-green-500 hover:bg-green-600' : lead.status === 'contacted' ? 'bg-blue-500 hover:bg-blue-600' : lead.status === 'negotiating' ? 'bg-amber-500 hover:bg-amber-600' : 'bg-gray-500 hover:bg-gray-600'}>
                        {lead.status.toUpperCase()}
                      </Badge>
                    </div>
                    <p className="text-sm text-gray-600 mb-2">Interested in: <span className="font-medium text-gray-900">{lead.vehicle}</span></p>
                    <p className="text-sm text-gray-500 mb-3 italic">"{lead.notes}"</p>
                    <div className="flex flex-wrap gap-4 text-sm text-gray-500 bg-gray-50 p-2 rounded-md">
                      <span className="flex items-center gap-1.5"><Phone className="w-3.5 h-3.5" />{lead.phone}</span>
                      <span className="flex items-center gap-1.5"><Mail className="w-3.5 h-3.5" />{lead.email}</span>
                      <span className="flex items-center gap-1.5"><Calendar className="w-3.5 h-3.5" />{lead.date}</span>
                    </div>
                  </div>
                  <div className="flex flex-col sm:flex-row gap-2">
                    <Button size="sm" variant="outline" className="border-gray-200" onClick={() => handleCall(lead.phone, lead.name)}>
                      <Phone className="w-4 h-4 text-blue-600" />
                    </Button>
                    <Button size="sm" variant="outline" className="border-emerald-200 bg-emerald-50 hover:bg-emerald-100" onClick={() => handleWhatsApp(lead.phone, lead.vehicle)}>
                      <MessageSquare className="w-4 h-4 text-emerald-600" />
                    </Button>
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