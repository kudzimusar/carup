import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Building2, Wrench, Shield, Car } from 'lucide-react'

const stakeholderSolutions = [
  { icon: Building2, title: 'Dealers', desc: 'Inventory, CRM, analytics, and lead management' },
  { icon: Wrench, title: 'Mechanics', desc: 'Service logs, parts ledger, and customer management' },
  { icon: Shield, title: 'Insurance', desc: 'Risk intelligence, fraud analytics, and API access' },
  { icon: Car, title: 'Enterprise', desc: 'Government, banks, and large fleet operators' },
]

export default function Pricing() {
  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-gradient-to-br from-[hsl(222,47%,11%)] to-[hsl(222,47%,18%)] text-white py-16">
        <div className="section-padding mx-auto max-w-[1440px] text-center">
          <Badge className="mb-4 bg-white/10 text-white border border-white/15">Pricing policy pending</Badge>
          <h1 className="text-3xl md:text-4xl font-bold mb-4">CarUp Plans</h1>
          <p className="text-gray-300 max-w-2xl mx-auto">
            CarUp has not published subscription prices yet. We will show prices here only after the
            commercial plan, currencies, billing provider, and entitlements are approved.
          </p>
        </div>
      </div>

      <div className="section-padding mx-auto max-w-[1440px] -mt-8 pb-16">
        <Card className="border-0 card-shadow max-w-3xl mx-auto">
          <CardHeader className="text-center">
            <h2 className="text-xl font-semibold">No placeholder prices</h2>
            <p className="text-sm text-gray-500">
              Until pricing is approved, CarUp will not present demo plan names, discounts, or monthly
              charges as if they were commercial offers.
            </p>
          </CardHeader>
          <CardContent className="p-6 flex flex-col sm:flex-row gap-3 justify-center">
            <Button asChild className="bg-orange-500 hover:bg-orange-600">
              <Link to="/register">Create an account</Link>
            </Button>
            <Button asChild variant="outline">
              <Link to="/contact">Contact CarUp</Link>
            </Button>
          </CardContent>
        </Card>

        <div className="mt-16">
          <h2 className="text-2xl font-bold text-center mb-3">Stakeholder Solutions</h2>
          <p className="text-sm text-gray-500 text-center mb-8">
            Capability descriptions are shown below. Commercial pricing remains unpublished.
          </p>
          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
            {stakeholderSolutions.map((item) => (
              <Card key={item.title} className="border-0 card-shadow text-center p-6">
                <item.icon className="w-10 h-10 text-orange-500 mx-auto mb-3" />
                <h3 className="font-semibold mb-1">{item.title}</h3>
                <p className="text-sm font-medium text-orange-600 mb-2">Pricing not published</p>
                <p className="text-sm text-gray-500">{item.desc}</p>
              </Card>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
