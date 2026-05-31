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

const mockPromotions = [
  { id: 1, title: 'Weekend Special: 5% Off All SUVs', type: 'percentage', value: '5%', status: 'active', views: 245, clicks: 32, startDate: '2026-05-20', endDate: '2026-05-25' },
  { id: 2, title: 'Free Roadworthy Certificate', type: 'free_service', value: '$50', status: 'active', views: 189, clicks: 21, startDate: '2026-05-18', endDate: '2026-05-30' },
  { id: 3, title: 'Trade-In Bonus: Extra $500', type: 'fixed', value: '$500', status: 'scheduled', views: 0, clicks: 0, startDate: '2026-06-01', endDate: '2026-06-15' },
]

export default function Promotions() {
  const { fetchDealerPromotions, createDealerPromotion, loading } = useCarUpApi()
  const [promotions, setPromotions] = useState<any[]>(mockPromotions)
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
      if (data && data.length > 0) {
        const formatted = data.map((d: any) => ({
          id: d.id,
          title: d.title,
          type: 'fixed',
          value: `$${d.discount_amount}`,
          status: d.status || 'active',
          views: 0,
          clicks: 0,
          startDate: new Date(d.start_date).toISOString().split('T')[0],
          endDate: new Date(d.end_date).toISOString().split('T')[0]
        }))
        setPromotions([...formatted, ...mockPromotions])
      }
    }).catch(() => {
      // API offline or not migrated, use mock
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
          views: 0,
          clicks: 0,
          startDate: formData.start_date,
          endDate: formData.end_date
        }, ...promotions])
      }
    } catch (err: any) {
      toast.error(err.message || 'Failed to create promotion')
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

      <div className="grid sm:grid-cols-3 gap-4">
        <Card className="border-0 card-shadow"><CardContent className="p-5"><p className="text-sm text-gray-500">Active Promotions</p><p className="text-2xl font-bold">{promotions.filter(p => p.status === 'active').length}</p></CardContent></Card>
        <Card className="border-0 card-shadow"><CardContent className="p-5"><p className="text-sm text-gray-500">Total Views</p><p className="text-2xl font-bold">434</p></CardContent></Card>
        <Card className="border-0 card-shadow"><CardContent className="p-5"><p className="text-sm text-gray-500">Click Rate</p><p className="text-2xl font-bold text-green-600">12.2%</p></CardContent></Card>
      </div>

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
                <span className="flex items-center gap-1.5"><Eye className="w-4 h-4 text-gray-400" />{promo.views} views</span>
                <span className="flex items-center gap-1.5"><TrendingUp className="w-4 h-4 text-gray-400" />{promo.clicks} clicks</span>
                <span className="flex items-center gap-1.5"><Calendar className="w-4 h-4 text-gray-400" />{promo.startDate} - {promo.endDate}</span>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}