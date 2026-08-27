import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Plus, TrendingUp, Eye, DollarSign, Calendar, Loader2 } from 'lucide-react'
import { useState, useEffect } from 'react'
import { useCarUpApi } from '@/hooks/useCarUpApi'
import { toast } from 'sonner'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import type { Promotion } from '@/types'

/**
 * There is deliberately no seeded promotion list here.
 *
 * Three fabricated campaigns used to be the INITIAL state and were then
 * CONCATENATED into successful API results, so every dealer saw two "active"
 * promotions with 245 and 189 views that did not exist — and a real dealer with
 * one real promotion saw four. Mock data that survives a successful read is
 * indistinguishable from data.
 */

export default function Promotions() {
  const { fetchDealerPromotions, createDealerPromotion, loading } = useCarUpApi()
  const [promotions, setPromotions] = useState<Promotion[]>([])
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'failed'>('loading')
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const [formData, setFormData] = useState({
    title: '',
    discount_amount: '',
    start_date: '',
    end_date: ''
  })

  useEffect(() => {
    fetchDealerPromotions().then(data => {
      if (Array.isArray(data)) {
        const formatted = data.map((d: Promotion) => ({
          id: d.id,
          title: d.title,
          type: d.type || 'fixed',
          value: d.discount_amount ? `$${d.discount_amount}` : d.value || '$0',
          status: (d.status || 'active') as 'active' | 'scheduled' | 'expired',
          views: d.views || 0,
          clicks: d.clicks || 0,
          startDate: d.start_date ? new Date(d.start_date).toISOString().split('T')[0] : d.startDate || new Date().toISOString().split('T')[0],
          endDate: d.end_date ? new Date(d.end_date).toISOString().split('T')[0] : d.endDate || new Date().toISOString().split('T')[0]
        }))
        setPromotions(formatted)
      }
      setLoadState('ready')
    }).catch(() => {
      // A failed read is NOT "no promotions". Saying so is the whole point.
      setLoadState('failed')
    })
  }, [fetchDealerPromotions])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsSubmitting(true)
    try {
      const res = await createDealerPromotion({
        title: formData.title,
        discount_amount: Number(formData.discount_amount),
        start_date: new Date(formData.start_date).toISOString(),
        end_date: new Date(formData.end_date).toISOString()
      })
      if (res.success) {
        toast.success('Promotion created successfully!')
        setIsModalOpen(false)
        setPromotions([{
          id: res.promotion?.id || Math.random(),
          title: formData.title,
          type: 'fixed',
          value: `$${formData.discount_amount}`,
          status: 'active',
          views: undefined,
          clicks: undefined,
          startDate: formData.start_date,
          endDate: formData.end_date
        }, ...promotions])
      }
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : 'Failed to create promotion'
      toast.error(errMsg)
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            Promotions
            {loading && <Loader2 className="w-4 h-4 animate-spin text-gray-400" />}
          </h1>
          <p className="text-gray-500">Create and manage promotional campaigns</p>
        </div>

        <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
          <DialogTrigger asChild>
            <Button className="bg-orange-500 hover:bg-orange-600 gap-1 text-white"><Plus className="w-4 h-4" /> New Promotion</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create New Promotion</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-4 mt-4">
              <div className="space-y-2">
                <Label>Promotion Title</Label>
                <Input required value={formData.title} onChange={e => setFormData({...formData, title: e.target.value})} placeholder="e.g. Easter Special" />
              </div>
              <div className="space-y-2">
                <Label>Discount Amount ($)</Label>
                <Input required type="number" value={formData.discount_amount} onChange={e => setFormData({...formData, discount_amount: e.target.value})} placeholder="500" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Start Date</Label>
                  <Input required type="date" value={formData.start_date} onChange={e => setFormData({...formData, start_date: e.target.value})} />
                </div>
                <div className="space-y-2">
                  <Label>End Date</Label>
                  <Input required type="date" value={formData.end_date} onChange={e => setFormData({...formData, end_date: e.target.value})} />
                </div>
              </div>
              <Button type="submit" className="w-full bg-orange-500 hover:bg-orange-600 text-white" disabled={isSubmitting}>
                {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                Launch Promotion
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {/* "Total Views 434" and "Click Rate 12.2%" were literals — the sum of the
          mock rows' views, and a rate with no numerator or denominator behind it.
          CarUp records no promotion impressions or clicks at all, so the only
          honest tile is a count of the promotions themselves. */}
      <div className="grid sm:grid-cols-3 gap-4">
        <Card className="border-0 card-shadow"><CardContent className="p-5">
          <p className="text-sm text-gray-500">Active promotions</p>
          <p className="text-2xl font-bold" data-testid="promotions-active-count">
            {loadState === 'ready' ? promotions.filter(p => p.status === 'active').length : '—'}
          </p>
        </CardContent></Card>
        <Card className="border-0 card-shadow"><CardContent className="p-5">
          <p className="text-sm text-gray-500">Views</p>
          <p className="text-base italic text-gray-500" data-testid="promotions-views-unavailable">Not tracked</p>
        </CardContent></Card>
        <Card className="border-0 card-shadow"><CardContent className="p-5">
          <p className="text-sm text-gray-500">Click rate</p>
          <p className="text-base italic text-gray-500" data-testid="promotions-clicks-unavailable">Not tracked</p>
        </CardContent></Card>
      </div>

      {loadState === 'failed' && (
        <p className="text-sm text-gray-600" data-testid="promotions-load-failed">
          Your promotions could not be loaded. This is not an empty list.
        </p>
      )}

      <div className="space-y-4">
        {promotions.map((promo) => (
          <Card key={promo.id} className="border-0 card-shadow transition-all hover:shadow-md">
            <CardContent className="p-5">
              <div className="flex items-center justify-between mb-2">
                <h3 className="font-semibold text-lg">{promo.title}</h3>
                <Badge className={promo.status === 'active' ? 'bg-green-500 text-white' : 'bg-amber-500 text-white'}>{promo.status.toUpperCase()}</Badge>
              </div>
              <div className="flex flex-wrap gap-4 text-sm text-gray-500 bg-gray-50 p-2 rounded-md">
                <span className="flex items-center gap-1.5"><DollarSign className="w-4 h-4 text-gray-400" />Value: <span className="font-medium text-gray-900">{promo.value}</span></span>
                {/* No promotion view or click is recorded anywhere in CarUp, so a
                    "0 views" here would be a measurement of zero where no
                    measurement is taken. */}
                <span className="flex items-center gap-1.5 italic"><Eye className="w-4 h-4 text-gray-400" />Views not tracked</span>
                <span className="flex items-center gap-1.5 italic"><TrendingUp className="w-4 h-4 text-gray-400" />Clicks not tracked</span>
                <span className="flex items-center gap-1.5"><Calendar className="w-4 h-4 text-gray-400" />{promo.startDate} - {promo.endDate}</span>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}